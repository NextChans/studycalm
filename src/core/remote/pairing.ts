/**
 * 태블릿-리모컨 페어링 및 종단간(E2E) 메시지 보호
 *
 * - 페어링 키(32바이트 난수)는 태블릿에서만 생성되며 QR/링크의 URL fragment(#k=...)로만 전달된다.
 *   fragment는 HTTP 요청에 포함되지 않으므로 Vercel/중계 서버 로그에 남지 않는다.
 * - 중계 채널명은 키의 SHA-256 해시에서 파생하므로 채널명만으로는 키를 역산할 수 없다.
 * - 모든 메시지는 AES-GCM(256)으로 암호화·인증된다. 키가 없는 제3자는 공용 브로커를 구독하더라도
 *   텔레메트리를 읽을 수 없고, 경고/TTS 명령을 위조할 수도 없다.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;
const CHANNEL_PREFIX = 'studycalm-v2:';

export interface PairingSession {
  /** 중계 채널(토픽) 식별자 — 키에서 파생된 공개 가능한 값 */
  channelId: string;
  /** 사람이 확인하기 위한 짧은 지문(태블릿/리모컨 화면 대조용) */
  fingerprint: string;
  encrypt(plain: string): Promise<string>;
  /** 복호화/인증 실패 시 null */
  decrypt(cipher: string): Promise<string | null>;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generatePairingKey(): string {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function isValidPairingKey(value: string | null | undefined): boolean {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try {
    return base64UrlToBytes(value).length === KEY_BYTES;
  } catch {
    return false;
  }
}

/**
 * 붙여넣은 링크 / 키 문자열에서 페어링 키 추출
 */
export function extractPairingKey(input: string): string | null {
  const trimmed = input.trim();
  if (isValidPairingKey(trimmed)) return trimmed;
  const match = trimmed.match(/[#&?]k=([A-Za-z0-9_-]{43})/);
  return match && isValidPairingKey(match[1]) ? match[1] : null;
}

/**
 * 리모컨 링크(…/remote#k=KEY&n=이름)에서 키와 태블릿 이름 추출
 */
export function parsePairingLink(input: string): { key: string; name?: string } | null {
  const key = extractPairingKey(input);
  if (!key) return null;
  const nameMatch = input.match(/[#&?]n=([^&#]*)/);
  let name: string | undefined;
  if (nameMatch) {
    try {
      name = decodeURIComponent(nameMatch[1]);
    } catch {
      name = undefined;
    }
  }
  return { key, name };
}

export async function createPairingSession(pairingKey: string): Promise<PairingSession> {
  if (!isValidPairingKey(pairingKey)) {
    throw new Error('Invalid pairing key');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto(SubtleCrypto)를 사용할 수 없습니다. HTTPS 환경에서 접속해주세요.');
  }

  const raw = base64UrlToBytes(pairingKey);
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(CHANNEL_PREFIX + pairingKey))
  );
  const channelId = toHex(digest.slice(0, 16));
  const fingerprint = toHex(digest.slice(16, 19)).toUpperCase();

  const aesKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  // AAD로 채널을 묶어 다른 채널로의 재전송(cross-channel replay)을 차단
  const aad = new TextEncoder().encode(channelId);

  return {
    channelId,
    fingerprint,
    async encrypt(plain: string): Promise<string> {
      const iv = new Uint8Array(IV_BYTES);
      crypto.getRandomValues(iv);
      const cipher = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData: aad },
          aesKey,
          new TextEncoder().encode(plain)
        )
      );
      const packed = new Uint8Array(iv.length + cipher.length);
      packed.set(iv, 0);
      packed.set(cipher, iv.length);
      return bytesToBase64Url(packed);
    },
    async decrypt(cipherText: string): Promise<string | null> {
      try {
        const packed = base64UrlToBytes(cipherText);
        if (packed.length <= IV_BYTES + 16) return null;
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: packed.slice(0, IV_BYTES), additionalData: aad },
          aesKey,
          packed.slice(IV_BYTES)
        );
        return new TextDecoder().decode(plain);
      } catch {
        return null;
      }
    },
  };
}
