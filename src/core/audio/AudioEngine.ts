import { Detector } from './Detector';
import { RmsDetector } from './RmsDetector';
import { EmaFilter } from './EmaFilter';

export type AudioEngineErrorType =
  | 'PERMISSION_DENIED'
  | 'NO_DEVICE'
  | 'NOT_SECURE_CONTEXT'
  | 'MICROPHONE_LOST'
  | 'UNKNOWN';

export interface AudioEngineError {
  type: AudioEngineErrorType;
  message: string;
  originalError?: unknown;
}

export interface AudioEngineCallbacks {
  /** 측정된 원시 dBFS 및 EMA 스무딩된 dBFS 콜백 */
  onLevelSample: (rawDb: number, smoothedDb: number) => void;
  /** 오류 발생 시 콜백 */
  onError: (error: AudioEngineError) => void;
  /** 오디오 컨텍스트 상태 변경 콜백 */
  onStateChange?: (state: AudioContextState) => void;
}

/**
 * [측정 루프 트레이드오프 분석: setInterval vs AudioWorklet vs requestAnimationFrame]
 *
 * 1. requestAnimationFrame (rAF):
 *    - 장점: 화면 주사율에 맞춰 매끄러운 렌더링 동기화.
 *    - 단점: 탭이 백그라운드로 가거나 화면이 꺼지면 브라우저가 완전히 rAF 루프를 정지(0 FPS)시킴.
 *            본 스터디카페 앱은 상시 측정이 목표이므로 부적합.
 *
 * 2. setInterval (약 50ms 주기, 현 구현 채택):
 *    - 장점: 메인 스레드에서 AnalyserNode의 Float32Array를 가볍게 폴링. 브라우저 호환성이 가장 높고
 *            메모리 오버헤드가 극히 적으며, 컴포넌트 라이프사이클과 동기화가 직관적임.
 *    - 트레이드오프: 백그라운드 탭 진입 시 브라우저 정책(Chrome/Safari timer throttling)에 따라
 *                  1초 단위로 타이머가 스로틀링될 수 있음. 본 앱에서는 VisibilityWatcher를 통해
 *                  백그라운드 전환을 감지하고 UI에 경고하며 복귀 시 즉시 동기화하도록 보완함.
 *
 * 3. AudioWorklet:
 *    - 장점: 오디오 렌더 스레드에서 직접 실시간 버퍼를 처리하므로 백그라운드 스로틀링의 영향을 전혀 받지 않음.
 *    - 단점: 별도의 worklet 파일 분리 및 모듈 로딩 필요, 워클릿과 메인 스레드 간 MessagePort 통신
 *            오버헤드 발생, 일부 구형 태블릿 웹뷰 호환성 리스크.
 *    - 본 MVP에서는 번들 복잡도를 낮추고 안정성을 보장하기 위해 setInterval 방식을 기본 채택하고,
 *      Detector 인터페이스를 통해 추후 워클릿 노드로 손쉽게 확장할 수 있도록 인터페이스를 분리함.
 */
export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private detector: Detector;
  private emaFilter: EmaFilter;
  private sampleIntervalId: ReturnType<typeof setInterval> | null = null;
  private buffer: Float32Array | null = null;
  private callbacks: AudioEngineCallbacks;
  private intervalMs: number;
  private isRunning: boolean = false;

  constructor(
    callbacks: AudioEngineCallbacks,
    options?: {
      detector?: Detector;
      emaAlpha?: number;
      intervalMs?: number;
    }
  ) {
    this.callbacks = callbacks;
    this.detector = options?.detector ?? new RmsDetector();
    this.emaFilter = new EmaFilter(options?.emaAlpha ?? 0.15);
    this.intervalMs = options?.intervalMs ?? 50;
  }

  public setEmaAlpha(alpha: number): void {
    this.emaFilter.setAlpha(alpha);
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * 사용자 제스처(시작 버튼 터치) 후 호출하여 오디오 파이프라인 초기화 및 시작
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    // 1. 비HTTPS 검사 (localhost 예외 처리)
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '[::1]';
    if (!window.isSecureContext && !isLocalhost) {
      const err: AudioEngineError = {
        type: 'NOT_SECURE_CONTEXT',
        message: '마이크 접근을 위해 HTTPS 보안 연결이 필요합니다.',
      };
      this.callbacks.onError(err);
      throw err;
    }

    try {
      // 2. getUserMedia 제약조건 설정 (모든 가공 비활성화하여 순수 소음 측정)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      this.mediaStream = stream;

      // 마이크 트랙 종료 감지 및 자동 재획득 핸들러
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          this.handleTrackEnded();
        };
      }

      // 3. AudioContext 초기화
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      this.audioContext = ctx;

      // AudioContext suspended 상태 감지 및 자동 복구 시도
      ctx.onstatechange = () => {
        if (this.callbacks.onStateChange) {
          this.callbacks.onStateChange(ctx.state);
        }
        if (ctx.state === 'suspended' && this.isRunning) {
          ctx.resume().catch((e) => {
            console.warn('[AudioEngine] Failed to resume AudioContext:', e);
          });
        }
      };

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // 4. AnalyserNode 구성
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      this.analyserNode = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      this.sourceNode = source;

      // 원본 오디오는 절대 저장하지 않으며, Float32Array 메모리 버퍼에서만 레벨 계산
      this.buffer = new Float32Array(analyser.fftSize);

      // 5. 폴링 측정 루프 시작
      this.isRunning = true;
      this.startSamplingLoop();
    } catch (err: unknown) {
      this.isRunning = false;
      this.cleanup();

      const domError = err as DOMException;
      let errorType: AudioEngineErrorType = 'UNKNOWN';
      let message = '마이크 초기화 중 알 수 없는 오류가 발생했습니다.';

      if (domError?.name === 'NotAllowedError' || domError?.name === 'PermissionDeniedError') {
        errorType = 'PERMISSION_DENIED';
        message = '마이크 권한이 거부되었습니다. 브라우저 설정에서 마이크 사용을 허용해주세요.';
      } else if (
        domError?.name === 'NotFoundError' ||
        domError?.name === 'DevicesNotFoundError'
      ) {
        errorType = 'NO_DEVICE';
        message = '연결된 마이크 장치를 찾을 수 없습니다. 장치를 확인해주세요.';
      } else if (err instanceof Error) {
        message = err.message;
      }

      const engineError: AudioEngineError = {
        type: errorType,
        message,
        originalError: err,
      };
      this.callbacks.onError(engineError);
      throw engineError;
    }
  }

  /**
   * 측정 루프 실행
   */
  private startSamplingLoop(): void {
    this.stopSamplingLoop();

    this.sampleIntervalId = setInterval(() => {
      if (!this.isRunning || !this.analyserNode || !this.buffer) {
        return;
      }

      // 시간 영역 데이터 추출 (-1.0 ~ 1.0)
      this.analyserNode.getFloatTimeDomainData(this.buffer);

      // 레벨 계산 및 EMA 스무딩
      const rawDb = this.detector.process(this.buffer);
      const smoothedDb = this.emaFilter.next(rawDb);

      this.callbacks.onLevelSample(rawDb, smoothedDb);
    }, this.intervalMs);
  }

  private stopSamplingLoop(): void {
    if (this.sampleIntervalId !== null) {
      clearInterval(this.sampleIntervalId);
      this.sampleIntervalId = null;
    }
  }

  /**
   * 마이크 트랙이 예기치 않게 종료되었을 때 재획득 시도
   */
  private async handleTrackEnded(): Promise<void> {
    if (!this.isRunning) return;

    try {
      console.warn('[AudioEngine] Microphone track ended. Attempting to re-acquire...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      this.mediaStream = stream;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => this.handleTrackEnded();
      }

      if (this.audioContext && this.analyserNode) {
        if (this.sourceNode) {
          this.sourceNode.disconnect();
        }
        this.sourceNode = this.audioContext.createMediaStreamSource(stream);
        this.sourceNode.connect(this.analyserNode);
      }
    } catch (e) {
      console.error('[AudioEngine] Re-acquiring microphone failed:', e);
      this.callbacks.onError({
        type: 'MICROPHONE_LOST',
        message: '마이크 연결이 끊겼으며 재연결에 실패했습니다. 장치를 다시 연결해주세요.',
        originalError: e,
      });
      this.stop();
    }
  }

  /**
   * 오디오 엔진 정지 및 리소스 정리
   */
  public stop(): void {
    this.isRunning = false;
    this.stopSamplingLoop();
    this.cleanup();
  }

  private cleanup(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // ignore
      }
      this.audioContext = null;
    }

    this.analyserNode = null;
    this.buffer = null;
    this.emaFilter.reset();
  }
}
