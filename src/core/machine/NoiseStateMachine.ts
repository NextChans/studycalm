import { DEFAULT_CONFIG, NoiseConfig } from '../../config/defaults';
import { MachineState, StateMachineListeners, StateMachineSnapshot } from './types';

export class NoiseStateMachine {
  private state: MachineState = 'IDLE';
  private config: NoiseConfig;
  private readonly now: () => number;
  private listeners: StateMachineListeners;

  // 보정 관련 상태
  private calibrationSamples: number[] = [];
  private calibrationStartTime: number = 0;
  private baselineDb: number | null = null;

  // 초과 및 히스테리시스 관련 상태
  private exceedingStartTime: number | null = null;
  private belowThresholdSince: number | null = null;

  // 음소거 및 쿨다운 관련 상태
  private isAlertAudioPlaying: boolean = false;
  private muteUntilTime: number = 0;
  private cooldownUntilTime: number = 0;

  // 실시간 측정치 보관
  private lastRawDb: number = -100;
  private lastSmoothedDb: number = -100;

  constructor(
    config: Partial<NoiseConfig> = {},
    listeners: StateMachineListeners = {},
    timeProvider: () => number = () => Date.now()
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.listeners = listeners;
    this.now = timeProvider;
  }

  public updateConfig(newConfig: Partial<NoiseConfig>): void {
    const prev = this.config;
    this.config = { ...this.config, ...newConfig };
    if (this.state === 'IDLE') return;

    // 기준 방식/값이 바뀌면 측정 중에도 즉시 반영
    if (this.config.baselineMode === 'manual') {
      if (prev.baselineMode !== 'manual' || prev.manualBaselineDb !== this.config.manualBaselineDb) {
        this.applyManualBaseline();
      }
    } else if (prev.baselineMode === 'manual') {
      this.startCalibration();
    }
  }

  public getConfig(): Readonly<NoiseConfig> {
    return this.config;
  }

  public getState(): MachineState {
    return this.state;
  }

  public getBaseline(): number | null {
    return this.baselineDb;
  }

  public setBaseline(baseline: number): void {
    this.baselineDb = baseline;
    if (this.listeners.onBaselineUpdated) {
      this.listeners.onBaselineUpdated(baseline);
    }
  }

  public getThreshold(): number | null {
    if (this.config.thresholdMode === 'absolute') return this.config.absoluteThresholdDb;
    if (this.baselineDb === null) return null;
    return this.baselineDb + this.config.thresholdOffsetDb;
  }

  /**
   * 측정 시작 -> 자동 기준이면 CALIBRATING, 수동 기준이면 즉시 MONITORING
   */
  public start(): void {
    if (this.config.baselineMode === 'manual') {
      this.applyManualBaseline();
    } else {
      this.startCalibration();
    }
  }

  private applyManualBaseline(): void {
    this.calibrationSamples = [];
    this.setBaseline(this.config.manualBaselineDb);
    if (this.state === 'IDLE' || this.state === 'CALIBRATING') {
      this.resetTransientStates();
      this.transitionTo('MONITORING');
    }
  }

  /**
   * 측정 정지 -> IDLE 상태 진입
   */
  public stop(): void {
    this.transitionTo('IDLE');
    this.resetTransientStates();
  }

  /**
   * 수동 재보정 요청
   */
  public recalibrate(): void {
    if (this.state === 'IDLE') return;
    // 수동 기준 모드에서는 측정값으로 덮어쓰지 않는다
    if (this.config.baselineMode === 'manual') {
      this.applyManualBaseline();
      return;
    }
    this.startCalibration();
  }

  private startCalibration(): void {
    this.resetTransientStates();
    this.calibrationSamples = [];
    this.calibrationStartTime = this.now();
    this.transitionTo('CALIBRATING');
  }

  /**
   * 실시간 오디오 레벨 처리 (주기적 호출)
   */
  public processSample(rawDb: number, smoothedDb: number): void {
    const currentTime = this.now();
    this.lastRawDb = rawDb;
    this.lastSmoothedDb = smoothedDb;

    // 1. 피드백 루프 방지: 오디오 재생 중이거나 재생 직후 Mute 시간인 경우 측정 무시
    if (this.isAlertAudioPlaying || currentTime < this.muteUntilTime) {
      this.emitSnapshot();
      return;
    }

    // 2. ALERTING 상태에서 mute 시간까지 지났다면 COOLDOWN으로 전환
    if (this.state === 'ALERTING' && !this.isAlertAudioPlaying && currentTime >= this.muteUntilTime) {
      this.enterCooldown();
    }

    // 3. 상태별 로직 처리
    switch (this.state) {
      case 'CALIBRATING':
        this.handleCalibrating(smoothedDb, currentTime);
        break;

      case 'MONITORING':
        this.handleMonitoring(smoothedDb, currentTime);
        break;

      case 'EXCEEDING':
        this.handleExceeding(smoothedDb, currentTime);
        break;

      case 'COOLDOWN':
        this.handleCooldown(currentTime);
        break;

      case 'ALERTING':
      case 'IDLE':
      default:
        break;
    }

    this.emitSnapshot();
  }

  private handleCalibrating(smoothedDb: number, currentTime: number): void {
    this.calibrationSamples.push(smoothedDb);

    const elapsed = currentTime - this.calibrationStartTime;
    if (elapsed >= this.config.calibrationDurationMs) {
      // 보정 구간의 중앙값(Median) 계산
      if (this.calibrationSamples.length > 0) {
        const sorted = [...this.calibrationSamples].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median =
          sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        this.setBaseline(median);
      }
      this.calibrationSamples = [];
      this.transitionTo('MONITORING');
    }
  }

  private handleMonitoring(smoothedDb: number, currentTime: number): void {
    const threshold = this.getThreshold();
    if (threshold === null) return;

    if (smoothedDb >= threshold) {
      this.exceedingStartTime = currentTime;
      this.belowThresholdSince = null;
      this.transitionTo('EXCEEDING');
    }
  }

  private handleExceeding(smoothedDb: number, currentTime: number): void {
    const threshold = this.getThreshold();
    if (threshold === null) {
      this.transitionTo('MONITORING');
      return;
    }

    if (smoothedDb >= threshold) {
      // 임계치 이상 유지 중 (잠깐 하강했던 히스테리시스 취소)
      this.belowThresholdSince = null;
      if (this.exceedingStartTime === null) {
        this.exceedingStartTime = currentTime;
      }

      // sustainMs 이상 연속 초과 확인
      if (currentTime - this.exceedingStartTime >= this.config.sustainMs) {
        this.triggerAlert();
      }
    } else {
      // 임계치 아래로 일시 하강
      if (this.belowThresholdSince === null) {
        this.belowThresholdSince = currentTime;
      } else {
        const dipDuration = currentTime - this.belowThresholdSince;
        // 히스테리시스 허용 시간 초과 시 누적 리셋 후 MONITORING 복귀
        if (dipDuration >= this.config.hysteresisMs) {
          this.exceedingStartTime = null;
          this.belowThresholdSince = null;
          this.transitionTo('MONITORING');
        }
      }
    }
  }

  private handleCooldown(currentTime: number): void {
    if (currentTime >= this.cooldownUntilTime) {
      this.cooldownUntilTime = 0;
      this.transitionTo('MONITORING');
    }
  }

  private triggerAlert(): void {
    this.transitionTo('ALERTING');
    this.exceedingStartTime = null;
    this.belowThresholdSince = null;

    if (this.listeners.onAlertTriggered) {
      this.listeners.onAlertTriggered();
    }
  }

  /**
   * 음성 재생 시작 시 오디오 플레이어에서 호출
   */
  public notifyPlaybackStarted(): void {
    this.isAlertAudioPlaying = true;
  }

  /**
   * 음성 재생 완료(또는 실패) 시 오디오 플레이어에서 호출
   */
  public notifyPlaybackEnded(): void {
    this.isAlertAudioPlaying = false;
    // 재생 종료 후 postPlaybackMuteMs 동안 추가 음소거
    this.muteUntilTime = this.now() + this.config.postPlaybackMuteMs;
  }

  private enterCooldown(): void {
    this.cooldownUntilTime = this.now() + this.config.cooldownMs;
    this.transitionTo('COOLDOWN');
  }

  private transitionTo(nextState: MachineState): void {
    if (this.state === nextState) return;
    const oldState = this.state;
    this.state = nextState;
    if (this.listeners.onStateChange) {
      this.listeners.onStateChange(nextState, oldState);
    }
  }

  private resetTransientStates(): void {
    this.exceedingStartTime = null;
    this.belowThresholdSince = null;
    this.isAlertAudioPlaying = false;
    this.muteUntilTime = 0;
    this.cooldownUntilTime = 0;
  }

  /**
   * UI 렌더링용 스냅샷 계산
   */
  public getSnapshot(): StateMachineSnapshot {
    const currentTime = this.now();

    // 보정 진행률
    let calibrationProgress = 0;
    if (this.state === 'CALIBRATING') {
      const elapsed = currentTime - this.calibrationStartTime;
      calibrationProgress = Math.min(1.0, Math.max(0.0, elapsed / this.config.calibrationDurationMs));
    }

    // 초과 sustain 진행률
    let exceedingProgress = 0;
    if (this.state === 'EXCEEDING' && this.exceedingStartTime !== null) {
      const elapsed = currentTime - this.exceedingStartTime;
      exceedingProgress = Math.min(1.0, Math.max(0.0, elapsed / this.config.sustainMs));
    }

    // 쿨다운 남은 시간
    const cooldownRemainingMs =
      this.state === 'COOLDOWN' ? Math.max(0, this.cooldownUntilTime - currentTime) : 0;

    return {
      state: this.state,
      baselineDb: this.baselineDb,
      thresholdDb: this.getThreshold(),
      currentDb: this.lastRawDb,
      smoothedDb: this.lastSmoothedDb,
      exceedingProgress,
      cooldownRemainingMs,
      calibrationProgress,
    };
  }

  private emitSnapshot(): void {
    if (this.listeners.onSnapshot) {
      this.listeners.onSnapshot(this.getSnapshot());
    }
  }
}
