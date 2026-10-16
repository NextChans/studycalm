export type BaselineMode = 'auto' | 'manual';
export type ThresholdMode = 'offset' | 'absolute';

export interface NoiseConfig {
  /** 기준(배경소음) 결정 방식: auto=시작 시 자동 측정, manual=관리자 지정값 사용 */
  baselineMode: BaselineMode;
  /** 수동 기준값 (dBFS) */
  manualBaselineDb: number;
  /** 임계치 결정 방식: offset=기준+N dB, absolute=관리자 지정 절대값 */
  thresholdMode: ThresholdMode;
  /** 절대 임계치 (dBFS) */
  absoluteThresholdDb: number;
  /** 배경소음 보정 측정 시간 (ms, 기본 30초) */
  calibrationDurationMs: number;
  /** 기준선(baseline) 대비 초과 임계치 N (dB, 기본 +15dB) */
  thresholdOffsetDb: number;
  /** 초과 상태가 지속되어야 경고가 발생하는 최소 지속 시간 (ms, 기본 1500ms) */
  sustainMs: number;
  /** 소음이 임계치 아래로 일시 하강했을 때 허용하는 히스테리시스 (ms, 기본 200ms) */
  hysteresisMs: number;
  /** 경고 음성 재생 중 및 종료 후 피드백 루프 방지를 위한 마이크 판정 무시 시간 (ms, 기본 1500ms) */
  postPlaybackMuteMs: number;
  /** 경고 발생 후 재경고를 금지하는 쿨다운 시간 (ms, 기본 45000ms) */
  cooldownMs: number;
  /** 경고 음성 출력 볼륨 (0.0 ~ 1.0, 기본 0.8) */
  volume: number;
  /** 지수이동평균(EMA) 스무딩 계수 alpha (0 < alpha <= 1, 기본 0.15) */
  emaAlpha: number;
  /** 오디오 레벨 측정 주기 (ms, 약 50ms) */
  sampleIntervalMs: number;
  /** 경고 음원 목록 — 첫 번째 파일만 재생 (모든 태블릿이 같은 멘트를 내도록 로테이션하지 않음) */
  soundFiles: string[];
}

export const DB_RANGE = { min: -90, max: 0 } as const;

export const DEFAULT_CONFIG: NoiseConfig = {
  baselineMode: 'auto',
  manualBaselineDb: -60,
  thresholdMode: 'offset',
  absoluteThresholdDb: -45,
  calibrationDurationMs: 30_000,
  thresholdOffsetDb: 15,
  sustainMs: 1_500,
  hysteresisMs: 200,
  postPlaybackMuteMs: 1_500,
  cooldownMs: 45_000,
  volume: 0.8,
  emaAlpha: 0.15,
  sampleIntervalMs: 50,
  soundFiles: ['/sounds/alert-1.wav'],
};

/** 기준/임계치 조정 항목 (원격 리모컨에서 변경 가능한 범위) */
export type NoiseTuning = Pick<
  NoiseConfig,
  'baselineMode' | 'manualBaselineDb' | 'thresholdMode' | 'absoluteThresholdDb' | 'thresholdOffsetDb'
>;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * 외부 입력(원격 명령, 손상된 localStorage)을 안전한 범위로 정규화
 */
export function sanitizeTuning(input: Partial<Record<keyof NoiseTuning, unknown>>): Partial<NoiseTuning> {
  const out: Partial<NoiseTuning> = {};
  if (input.baselineMode === 'auto' || input.baselineMode === 'manual') out.baselineMode = input.baselineMode;
  if (input.thresholdMode === 'offset' || input.thresholdMode === 'absolute') out.thresholdMode = input.thresholdMode;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const mb = num(input.manualBaselineDb);
  if (mb !== null) out.manualBaselineDb = Math.round(clamp(mb, DB_RANGE.min, DB_RANGE.max));
  const at = num(input.absoluteThresholdDb);
  if (at !== null) out.absoluteThresholdDb = Math.round(clamp(at, DB_RANGE.min, DB_RANGE.max));
  const off = num(input.thresholdOffsetDb);
  if (off !== null) out.thresholdOffsetDb = Math.round(clamp(off, 1, 40));
  return out;
}
