import { STORAGE_KEYS } from './storageKeys';
import { generatePairingKey, isValidPairingKey } from '../remote/pairing';

export const MAX_TABLET_NAME_LENGTH = 30;

/** 리모컨(관리자 폰)에 저장되는 태블릿 페어링 정보 */
export interface RemotePairing {
  key: string;
  /** QR 생성 시점의 태블릿 이름 (접속 후에는 텔레메트리의 최신 이름을 우선 표시) */
  name: string;
  addedAt: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 사파리 개인정보 보호 모드 등 저장 불가 환경 — 세션 동안만 유지
  }
}

export function sanitizeTabletName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_TABLET_NAME_LENGTH);
}

export class PairingRepo {
  // ---------------------------------------------------------------- 태블릿(호스트)

  /** 태블릿 페어링 키 — 없으면 생성 */
  public static getOrCreateTabletKey(): string {
    const stored = read(STORAGE_KEYS.TABLET_PAIRING_KEY);
    if (stored && isValidPairingKey(stored)) return stored;

    const key = generatePairingKey();
    write(STORAGE_KEYS.TABLET_PAIRING_KEY, key);
    // 구버전(평문 룸 코드) 정보 정리
    write(STORAGE_KEYS.REMOTE_ROOM_ID_LEGACY, null);
    return key;
  }

  /** 키 재발급 → 이 태블릿에 페어링된 모든 리모컨의 접근이 즉시 차단됨 */
  public static rotateTabletKey(): string {
    const key = generatePairingKey();
    write(STORAGE_KEYS.TABLET_PAIRING_KEY, key);
    return key;
  }

  public static getTabletName(): string {
    return sanitizeTabletName(read(STORAGE_KEYS.TABLET_NAME) ?? '') || '매장 태블릿';
  }

  public static setTabletName(name: string): string {
    const clean = sanitizeTabletName(name) || '매장 태블릿';
    write(STORAGE_KEYS.TABLET_NAME, clean);
    return clean;
  }

  // ---------------------------------------------------------------- 리모컨(관리자 폰)

  public static getRemotePairings(): RemotePairing[] {
    try {
      const parsed = JSON.parse(read(STORAGE_KEYS.REMOTE_PAIRINGS) ?? '[]') as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (p): p is RemotePairing =>
          !!p && typeof p === 'object' && isValidPairingKey((p as RemotePairing).key)
      ).map((p) => ({
        key: p.key,
        name: sanitizeTabletName(String(p.name ?? '')) || '매장 태블릿',
        addedAt: Number(p.addedAt) || 0,
      }));
    } catch {
      return [];
    }
  }

  /** 같은 키가 있으면 이름만 갱신, 없으면 추가 */
  public static upsertRemotePairing(key: string, name?: string): RemotePairing[] {
    const list = this.getRemotePairings();
    const existing = list.find((p) => p.key === key);
    const cleanName = name ? sanitizeTabletName(name) : '';
    if (existing) {
      if (cleanName) existing.name = cleanName;
    } else {
      list.push({ key, name: cleanName || `태블릿 ${list.length + 1}`, addedAt: Date.now() });
    }
    write(STORAGE_KEYS.REMOTE_PAIRINGS, JSON.stringify(list));
    return list;
  }

  public static removeRemotePairing(key: string): RemotePairing[] {
    const list = this.getRemotePairings().filter((p) => p.key !== key);
    write(STORAGE_KEYS.REMOTE_PAIRINGS, JSON.stringify(list));
    return list;
  }
}
