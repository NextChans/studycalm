import type { AlertVoiceSettings, NoiseTuning } from '../../config/defaults';
import type { ScheduleRule } from '../schedule/schedule';
import { MAX_VOICE_CHUNKS, VOICE_CHUNK_BYTES, type VoiceChunk } from './voiceClip';

export type RemoteRole = 'tablet' | 'remote';

export const MAX_TTS_TEXT_LENGTH = 120;

export interface TelemetryData {
  /** 관리자가 지정한 태블릿 이름 (예: 1층 열람실) */
  tabletName: string;
  currentDb: number;
  smoothedDb: number;
  baselineDb: number | null;
  thresholdDb: number | null;
  state: string;
  dailyAlertCount: number;
  isAudioRunning: boolean;
  /** 태블릿 오디오 출력 준비 여부 (화면 터치로 오디오 잠금 해제됨) */
  isAudioUnlocked: boolean;
  /** 태블릿에서 현재 소리(자동 경고/원격 방송) 재생 중 */
  isPlaying: boolean;
  /** 최근 15초 이내 활성 리모컨 수 */
  remoteCount: number;
  /** 현재 기준/임계치 설정 */
  tuning: NoiseTuning;
  /** 자동 경고 음소거 여부 (관리자가 켠 수동 음소거) */
  autoAlertMuted: boolean;
  /** 스케줄까지 반영한 실제 음소거 여부 */
  effectiveMuted: boolean;
  /** 현재 적용 중인 스케줄 설명 (없으면 null) */
  activeSchedule: string | null;
  /** 시간대별 스케줄 규칙 */
  schedule: ScheduleRule[];
  /** 숨김(검은 화면) 모드 */
  stealthMode: boolean;
  /** 마이크/측정 오류 메시지 (권한 거부 등, 없으면 null) */
  audioError: string | null;
  /** 배터리 (지원하지 않는 기기는 null) */
  battery: { level: number; charging: boolean } | null;
  /** 자동 경고 음성 방식 (기본 경고음 / 특정 멘트 / 랜덤 롤링) */
  alertVoice: AlertVoiceSettings;
  /** 녹음 음성이 등록된 정시 안내 규칙 id 목록 */
  announceVoices: string[];
  /** 다음 정시 안내 설명 (없으면 null) */
  nextAnnouncement: string | null;
  /** 커스텀 경고음 등록 여부와 이름 */
  customAlertName: string | null;
}

/** 리모컨 → 태블릿 */
export type RemoteCommand =
  | { type: 'ALERT' }
  | { type: 'TTS'; text: string }
  | { type: 'RECALIBRATE' }
  /** 재생 중인 방송/경고음 및 대기열 즉시 중지 */
  | { type: 'STOP' }
  /** 기준/임계치 원격 조정 (태블릿에 영구 저장됨) */
  | { type: 'ADJUST'; tuning: Partial<NoiseTuning> }
  /** 리모컨에서 녹음한 음성 조각 (mode=play: 즉시 방송, save: 경고음으로 등록) */
  | VoiceChunk
  /** 자동 경고 음성 방식 변경 (태블릿에서 재검증 후 저장) */
  | { type: 'SET_ALERT_VOICE'; settings: AlertVoiceSettings }
  /** 정시 안내 규칙을 지금 한 번 방송 (미리 듣기) */
  | { type: 'PLAY_ANNOUNCEMENT'; ruleId: string }
  /** 소음 측정 원격 시작/정지 (리모컨은 페어링 키를 가진 관리자이므로 PIN 없이 허용) */
  | { type: 'START_MONITORING' }
  | { type: 'STOP_MONITORING' }
  /** 숨김(검은 화면) 모드 켜기/끄기 */
  | { type: 'SET_STEALTH'; enabled: boolean }
  /** 시간대별 스케줄 전체 교체 */
  | { type: 'SET_SCHEDULE'; rules: ScheduleRule[] }
  /** 자동 경고 음소거 켜기/끄기 (태블릿에 저장됨) */
  | { type: 'SET_MUTE'; muted: boolean }
  /** 커스텀 경고음 삭제 → 기본 경고음으로 복원 */
  | { type: 'RESET_ALERT_SOUND' }
  /** 리모컨이 화면을 보고 있는 동안 주기적으로 전송 (텔레메트리 요청 겸 접속 알림) */
  | { type: 'PING' };

/** 태블릿 → 리모컨 */
export type TabletEvent =
  | { type: 'TELEMETRY'; data: TelemetryData }
  | { type: 'BROADCAST_STATUS'; requestId: string; status: 'PLAYING' | 'DONE' | 'FAILED' | 'STOPPED'; text: string };

export type RemotePayload = RemoteCommand | TabletEvent;

/** 암호화 전 평문 봉투 */
export interface RemoteEnvelope<T extends RemotePayload = RemotePayload> {
  v: 2;
  /** 중복 제거 및 재전송 공격 방지용 메시지 ID */
  id: string;
  sender: RemoteRole;
  deviceId: string;
  ts: number;
  body: T;
}

const COMMAND_TYPES = new Set([
  'ALERT',
  'TTS',
  'RECALIBRATE',
  'ADJUST',
  'STOP',
  'VOICE_CHUNK',
  'RESET_ALERT_SOUND',
  'SET_MUTE',
  'SET_STEALTH',
  'START_MONITORING',
  'STOP_MONITORING',
  'SET_SCHEDULE',
  'PLAY_ANNOUNCEMENT',
  'SET_ALERT_VOICE',
  'PING',
]);
/** 조각 base64 길이 상한 (9KB → base64 12KB) */
const MAX_VOICE_DATA_CHARS = Math.ceil((VOICE_CHUNK_BYTES * 4) / 3) + 4;
const EVENT_TYPES = new Set(['TELEMETRY', 'BROADCAST_STATUS']);
const RULE_ID_RE = /^[a-z0-9]{1,16}$/i;

/**
 * 복호화된 평문을 런타임 검증 (키를 가진 기기라도 형식이 틀린 메시지는 버림)
 */
export function parseEnvelope(plain: string): RemoteEnvelope | null {
  let raw: unknown;
  try {
    raw = JSON.parse(plain);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const env = raw as Partial<RemoteEnvelope>;
  if (
    env.v !== 2 ||
    typeof env.id !== 'string' ||
    typeof env.deviceId !== 'string' ||
    typeof env.ts !== 'number' ||
    (env.sender !== 'tablet' && env.sender !== 'remote') ||
    !env.body ||
    typeof env.body !== 'object'
  ) {
    return null;
  }

  const body = env.body as Record<string, unknown> & { type?: unknown; text?: unknown; tuning?: unknown };
  const allowed = env.sender === 'remote' ? COMMAND_TYPES : EVENT_TYPES;
  if (typeof body.type !== 'string' || !allowed.has(body.type)) return null;

  if (body.type === 'TTS') {
    if (typeof body.text !== 'string') return null;
    const text = body.text.trim();
    if (!text || text.length > MAX_TTS_TEXT_LENGTH) return null;
  }

  if (body.type === 'ADJUST' && (!body.tuning || typeof body.tuning !== 'object')) return null;
  if (body.type === 'SET_MUTE' && typeof body.muted !== 'boolean') return null;
  if (body.type === 'SET_STEALTH' && typeof body.enabled !== 'boolean') return null;
  if (body.type === 'SET_SCHEDULE' && !Array.isArray(body.rules)) return null;
  if (body.type === 'SET_ALERT_VOICE' && (!body.settings || typeof body.settings !== 'object')) return null;
  if (body.type === 'PLAY_ANNOUNCEMENT' && (typeof body.ruleId !== 'string' || !RULE_ID_RE.test(body.ruleId))) {
    return null;
  }

  if (body.type === 'VOICE_CHUNK') {
    const { clipId, seq, total, mime, mode, slot, data } = body;
    if (
      typeof clipId !== 'string' ||
      !/^[0-9a-f]{8,32}$/.test(clipId) ||
      !Number.isInteger(seq) ||
      !Number.isInteger(total) ||
      (total as number) < 1 ||
      (total as number) > MAX_VOICE_CHUNKS ||
      (seq as number) < 0 ||
      (seq as number) >= (total as number) ||
      typeof mime !== 'string' ||
      !/^audio\/[a-z0-9.+-]+(;[ a-z0-9=.,"-]*)?$/i.test(mime) ||
      (mode !== 'play' && mode !== 'save' && mode !== 'announce') ||
      (mode === 'announce' ? typeof slot !== 'string' || !RULE_ID_RE.test(slot) : slot !== undefined) ||
      typeof data !== 'string' ||
      data.length === 0 ||
      data.length > MAX_VOICE_DATA_CHARS
    ) {
      return null;
    }
  }

  return env as RemoteEnvelope;
}
