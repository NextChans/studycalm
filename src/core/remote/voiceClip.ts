import { base64UrlToBytes, bytesToBase64Url } from './pairing';

/**
 * 리모컨 음성 녹음 → 태블릿 전송용 분할/재조립
 *
 * 실시간 중계(Supabase Broadcast / MQTT)는 작은 메시지에 최적화되어 있으므로
 * 녹음 파일을 9KB 단위 조각으로 나누어 각 조각을 개별 암호화 메시지로 전송한다.
 * 별도 저장소(서버)를 거치지 않으므로 녹음 원본이 어디에도 남지 않는다.
 */

export const MAX_VOICE_SECONDS = 15;
/** 조각당 원본 바이트 (base64 + 암호화 후 약 16KB) */
export const VOICE_CHUNK_BYTES = 9_000;
export const MAX_VOICE_CHUNKS = 40;
export const MAX_VOICE_BYTES = VOICE_CHUNK_BYTES * MAX_VOICE_CHUNKS;
/** 녹음 비트레이트 — 음성용으로 충분하고 15초 ≈ 60KB(7조각) */
export const VOICE_BITRATE = 32_000;
/** 조각 사이 전송 간격 (Supabase 클라이언트 초당 전송 제한 대응) */
export const VOICE_CHUNK_INTERVAL_MS = 120;
/** 조각이 모두 오지 않으면 이 시간 뒤 폐기 */
const ASSEMBLY_TIMEOUT_MS = 30_000;
const MAX_PENDING_CLIPS = 4;

export type VoiceMode = 'play' | 'save';

export interface VoiceChunk {
  type: 'VOICE_CHUNK';
  clipId: string;
  seq: number;
  total: number;
  mime: string;
  mode: VoiceMode;
  data: string;
}

/**
 * 모든 기기에서 재생 가능한 형식을 우선 선택 (AAC/mp4 → Opus/webm 순)
 * iOS Safari는 mp4(AAC)만, Android Chrome은 버전에 따라 webm 또는 mp4를 녹음한다.
 */
export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/aac',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export function newClipId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function splitVoiceClip(
  blob: Blob,
  mode: VoiceMode,
  clipId: string = newClipId()
): Promise<VoiceChunk[]> {
  if (blob.size === 0) throw new Error('녹음된 음성이 없습니다.');
  if (blob.size > MAX_VOICE_BYTES) throw new Error('녹음 파일이 너무 큽니다. 더 짧게 녹음해주세요.');

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const total = Math.ceil(bytes.length / VOICE_CHUNK_BYTES);
  const mime = (blob.type || 'audio/mp4').slice(0, 60);
  const chunks: VoiceChunk[] = [];
  for (let seq = 0; seq < total; seq++) {
    const part = bytes.subarray(seq * VOICE_CHUNK_BYTES, (seq + 1) * VOICE_CHUNK_BYTES);
    chunks.push({ type: 'VOICE_CHUNK', clipId, seq, total, mime, mode, data: bytesToBase64Url(part) });
  }
  return chunks;
}

export interface AssembledClip {
  clipId: string;
  mode: VoiceMode;
  blob: Blob;
  /** 보낸 리모컨 기기 */
  senderId: string;
}

interface PendingClip {
  senderId: string;
  mode: VoiceMode;
  mime: string;
  total: number;
  parts: (Uint8Array | undefined)[];
  received: number;
  firstAt: number;
}

/**
 * 태블릿 측 조각 재조립기 (중복/순서 뒤바뀜/유실 처리)
 */
export class VoiceClipAssembler {
  private pending = new Map<string, PendingClip>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** 마지막 조각이 들어오면 완성된 클립 반환 */
  public push(chunk: VoiceChunk, senderId: string): AssembledClip | null {
    this.purgeExpired();

    let clip = this.pending.get(chunk.clipId);
    if (!clip) {
      if (this.pending.size >= MAX_PENDING_CLIPS) {
        const oldest = this.pending.keys().next().value;
        if (oldest !== undefined) this.pending.delete(oldest);
      }
      clip = {
        senderId,
        mode: chunk.mode,
        mime: chunk.mime,
        total: chunk.total,
        parts: new Array(chunk.total),
        received: 0,
        firstAt: this.now(),
      };
      this.pending.set(chunk.clipId, clip);
    }

    // 다른 기기가 같은 clipId를 덮어쓰거나 메타데이터가 바뀌는 것을 거부
    if (clip.senderId !== senderId || clip.total !== chunk.total || chunk.seq >= clip.total) return null;
    if (clip.parts[chunk.seq]) return null;

    let part: Uint8Array;
    try {
      part = base64UrlToBytes(chunk.data);
    } catch {
      return null;
    }
    clip.parts[chunk.seq] = part;
    clip.received++;

    if (clip.received < clip.total) return null;

    this.pending.delete(chunk.clipId);
    const blob = new Blob(clip.parts as Uint8Array[], { type: clip.mime });
    return { clipId: chunk.clipId, mode: clip.mode, blob, senderId };
  }

  public pendingCount(): number {
    this.purgeExpired();
    return this.pending.size;
  }

  private purgeExpired(): void {
    const cutoff = this.now() - ASSEMBLY_TIMEOUT_MS;
    for (const [id, clip] of this.pending) {
      if (clip.firstAt < cutoff) this.pending.delete(id);
    }
  }
}
