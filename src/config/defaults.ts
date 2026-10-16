export interface NoiseConfig {
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
  /** 경고 음성 mp3 목록 (로테이션 재생) */
  soundFiles: string[];
}

export const DEFAULT_CONFIG: NoiseConfig = {
  calibrationDurationMs: 30_000,
  thresholdOffsetDb: 15,
  sustainMs: 1_500,
  hysteresisMs: 200,
  postPlaybackMuteMs: 1_500,
  cooldownMs: 45_000,
  volume: 0.8,
  emaAlpha: 0.15,
  sampleIntervalMs: 50,
  soundFiles: ['/sounds/alert-1.mp3', '/sounds/alert-2.mp3'],
};
