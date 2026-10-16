import { VoiceFallback } from './VoiceFallback';
import { ChimeSynthesizer } from './ChimeSynthesizer';

export interface SoundPlayerOptions {
  soundFiles: string[];
  volume: number;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}

const TTS_CACHE_LIMIT = 20;
const DEFAULT_ALERT_FILE = '/sounds/alert-1.wav';

function decodeAudio(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // 구형 Safari는 Promise 형 decodeAudioData를 지원하지 않으므로 콜백 형태 사용
  return new Promise<AudioBuffer>((resolve, reject) => {
    const maybePromise = ctx.decodeAudioData(data, resolve, reject);
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(reject);
    }
  });
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const type = res.headers.get('content-type') ?? '';
  // SPA rewrite로 index.html이 돌아오는 경우(파일 누락, 로컬 dev의 /api 부재)를 조기 차단
  if (type.includes('text/html')) throw new Error(`Unexpected HTML response for ${url}`);
  return res.arrayBuffer();
}

type Mode = 'drop-if-busy' | 'queue';

/**
 * 경고음 / 안내 방송 재생기.
 *
 * 모든 소리를 측정용으로 이미 사용자 터치 안에서 활성화된 단일 AudioContext로 재생한다.
 * - iOS/iPadOS Safari: 터치 이벤트 밖에서 새로 만든 HTMLAudioElement 재생을 차단하므로
 *   소음 감지·원격 명령처럼 비동기로 발생하는 재생은 Web Audio여야 확실히 출력된다.
 * - iOS는 HTMLMediaElement.volume을 무시하지만 GainNode 볼륨은 적용된다.
 * - 재생은 직렬화되어 자동 경고와 원격 방송이 겹쳐 나오지 않는다.
 */
export class SoundPlayer {
  private soundFiles: string[];
  private volume: number;
  private customAudio: { blob: Blob; url: string } | null = null;
  private onPlaybackStart?: () => void;
  private onPlaybackEnd?: () => void;

  private readonly fileBuffers = new Map<string, Promise<AudioBuffer>>();
  private customBuffer: { blob: Blob; buffer: Promise<AudioBuffer> } | null = null;
  private readonly ttsBuffers = new Map<string, Promise<AudioBuffer>>();

  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private generation = 0;
  private stopCurrent: (() => void) | null = null;

  constructor(options: SoundPlayerOptions) {
    this.soundFiles = options.soundFiles.length > 0 ? options.soundFiles : [DEFAULT_ALERT_FILE];
    this.volume = options.volume;
    this.onPlaybackStart = options.onPlaybackStart;
    this.onPlaybackEnd = options.onPlaybackEnd;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  public setSoundFiles(files: string[]): void {
    if (files.length > 0) {
      this.soundFiles = files;
    }
  }

  public setCustomAudio(blob: Blob | null, url: string | null): void {
    this.customAudio = blob && url ? { blob, url } : null;
    if (!blob) this.customBuffer = null;
  }

  public getIsPlaying(): boolean {
    return this.pending > 0;
  }

  /** 오디오 출력이 실제로 가능한 상태인지 (터치로 컨텍스트가 running 상태) */
  public isOutputReady(): boolean {
    return ChimeSynthesizer.peekContext()?.state === 'running';
  }

  /**
   * 반드시 사용자 터치/클릭 핸들러 안에서 호출: AudioContext 활성화 + iOS 무음 버퍼 언락 + 음성 엔진 언락
   */
  public unlock(): void {
    try {
      const ctx = ChimeSynthesizer.getContext();
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = silent;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // ignore
    }
    VoiceFallback.unlock();
    this.preload();
  }

  /** 경고음 파일을 미리 다운로드·디코딩하여 첫 경고 지연 제거 */
  public preload(): void {
    this.getFileBuffer(this.primarySoundFile()).catch(() => {});
    if (this.customAudio) this.getCustomBuffer().catch(() => {});
  }

  /**
   * 자동/수동 경고 재생 (이미 재생 중이면 무시)
   * 모든 태블릿이 같은 멘트를 내도록 로테이션 없이 항상 같은 음원(커스텀 우선, 없으면 첫 번째 기본 음원)을 재생한다.
   * @returns 실제로 재생했는지 여부
   */
  public playNextAlert(): Promise<boolean> {
    return this.run('drop-if-busy', (gen) => this.playConfiguredAlert(gen));
  }

  /** 설정 화면 미리듣기: 현재 설정된 경고음(커스텀 우선) 1회 재생 */
  public playPreview(volume?: number): Promise<boolean> {
    return this.run('drop-if-busy', async (gen) => {
      const saved = this.volume;
      if (volume !== undefined) this.volume = Math.max(0, Math.min(1, volume));
      try {
        await this.playConfiguredAlert(gen);
      } finally {
        this.volume = saved;
      }
    });
  }

  private async playConfiguredAlert(gen: number): Promise<void> {
    if (this.customAudio) {
      try {
        await this.playCustom(gen);
        return;
      } catch (err) {
        console.warn('[SoundPlayer] Custom audio failed, falling back to default alert:', err);
      }
    }
    await this.playDefaultAlert(this.primarySoundFile(), gen);
  }

  private primarySoundFile(): string {
    return this.soundFiles[0] ?? DEFAULT_ALERT_FILE;
  }

  /**
   * 원격 맞춤 안내 방송: 딩동 차임 → 한국어 음성. 재생 중이면 대기열에 넣어 순서대로 재생.
   */
  public playAnnouncement(text: string): Promise<boolean> {
    // 차임이 울리는 동안 음성 데이터를 미리 받아둔다
    const speech = this.getTtsBuffer(text);
    speech.catch(() => {});
    return this.run('queue', async (gen) => {
      await ChimeSynthesizer.playChime(this.volume);
      if (gen !== this.generation) return;
      await this.speak(text, speech, gen);
    });
  }

  /**
   * 리모컨에서 녹음해 보낸 음성 방송: 딩동 차임 → 녹음 음성. 재생 중이면 대기열에서 순서대로 재생.
   */
  public playVoiceClip(blob: Blob): Promise<boolean> {
    const decoded = SoundPlayer.decodeBlob(blob);
    decoded.catch(() => {});
    const url = URL.createObjectURL(blob);
    return this.run('queue', async (gen) => {
      try {
        await ChimeSynthesizer.playChime(this.volume);
        if (gen !== this.generation) return;
        try {
          await this.playBuffer(await decoded, gen);
        } catch (err) {
          console.warn('[SoundPlayer] Voice clip decode failed, trying HTMLAudio:', err);
          await this.playHtmlAudio(url, gen);
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  }

  /** 이 기기에서 재생(디코딩) 가능한 음원인지 확인 — 경고음 등록 전 검증용 */
  public static async canDecode(blob: Blob): Promise<boolean> {
    try {
      const buffer = await this.decodeBlob(blob);
      return buffer.duration > 0;
    } catch {
      return false;
    }
  }

  private static async decodeBlob(blob: Blob): Promise<AudioBuffer> {
    return decodeAudio(ChimeSynthesizer.getContext(), await blob.arrayBuffer());
  }

  public stop(): void {
    this.generation++;
    this.stopCurrent?.();
    this.stopCurrent = null;
    if (VoiceFallback.isSupported()) {
      window.speechSynthesis.cancel();
    }
  }

  // ---------------------------------------------------------------------------

  private run(mode: Mode, task: (gen: number) => Promise<void>): Promise<boolean> {
    if (mode === 'drop-if-busy' && this.pending > 0) return Promise.resolve(false);

    this.pending++;
    const gen = this.generation;
    const result = this.queue.then(async () => {
      if (gen !== this.generation) return false; // stop() 이후 대기열에 남은 작업은 폐기
      this.onPlaybackStart?.();
      try {
        await task(gen);
        return true;
      } catch (err) {
        console.warn('[SoundPlayer] Playback failed:', err);
        return false;
      } finally {
        this.stopCurrent = null;
        this.onPlaybackEnd?.();
      }
    });
    this.queue = result.then(
      () => {
        this.pending--;
      },
      () => {
        this.pending--;
      }
    );
    return result;
  }

  private async playDefaultAlert(url: string, gen: number): Promise<void> {
    try {
      await this.playBuffer(await this.getFileBuffer(url), gen);
    } catch (err) {
      console.warn(`[SoundPlayer] Web Audio playback of ${url} failed, trying HTMLAudio:`, err);
      try {
        await this.playHtmlAudio(url, gen);
      } catch (htmlErr) {
        console.warn('[SoundPlayer] HTMLAudio failed, using synthesized chime + voice:', htmlErr);
        await ChimeSynthesizer.playChime(this.volume);
        if (gen === this.generation) await this.speak('조용히 해주세요.', this.getTtsBuffer('조용히 해주세요.'), gen);
      }
    }
  }

  private async playCustom(gen: number): Promise<void> {
    const custom = this.customAudio;
    if (!custom) return;
    try {
      await this.playBuffer(await this.getCustomBuffer(), gen);
    } catch (err) {
      console.warn('[SoundPlayer] Custom audio decode failed, trying HTMLAudio:', err);
      await this.playHtmlAudio(custom.url, gen);
    }
  }

  private async speak(text: string, speech: Promise<AudioBuffer>, gen: number): Promise<void> {
    try {
      await this.playBuffer(await speech, gen);
    } catch (err) {
      console.warn('[SoundPlayer] Server TTS unavailable, falling back to speechSynthesis:', err);
      this.ttsBuffers.delete(text);
      if (gen === this.generation) await VoiceFallback.speak(text, this.volume);
    }
  }

  private getFileBuffer(url: string): Promise<AudioBuffer> {
    let cached = this.fileBuffers.get(url);
    if (!cached) {
      cached = fetchArrayBuffer(url).then((data) => decodeAudio(ChimeSynthesizer.getContext(), data));
      cached.catch(() => this.fileBuffers.delete(url));
      this.fileBuffers.set(url, cached);
    }
    return cached;
  }

  private getCustomBuffer(): Promise<AudioBuffer> {
    const custom = this.customAudio;
    if (!custom) return Promise.reject(new Error('No custom audio'));
    if (this.customBuffer?.blob !== custom.blob) {
      // blob: URL fetch는 CSP connect-src에 막히므로 Blob에서 직접 읽는다
      const buffer = custom.blob
        .arrayBuffer()
        .then((data) => decodeAudio(ChimeSynthesizer.getContext(), data));
      buffer.catch(() => {
        if (this.customBuffer?.buffer === buffer) this.customBuffer = null;
      });
      this.customBuffer = { blob: custom.blob, buffer };
    }
    return this.customBuffer.buffer;
  }

  private getTtsBuffer(text: string): Promise<AudioBuffer> {
    let cached = this.ttsBuffers.get(text);
    if (!cached) {
      cached = fetchArrayBuffer(`/api/tts?text=${encodeURIComponent(text)}`).then((data) =>
        decodeAudio(ChimeSynthesizer.getContext(), data)
      );
      cached.catch(() => this.ttsBuffers.delete(text));
      this.ttsBuffers.set(text, cached);
      if (this.ttsBuffers.size > TTS_CACHE_LIMIT) {
        const oldest = this.ttsBuffers.keys().next().value;
        if (oldest !== undefined) this.ttsBuffers.delete(oldest);
      }
    }
    return cached;
  }

  private playBuffer(buffer: AudioBuffer, gen: number): Promise<void> {
    if (gen !== this.generation) return Promise.resolve();
    const ctx = ChimeSynthesizer.getContext();
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {});
    }

    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = this.volume;
      source.connect(gain);
      gain.connect(ctx.destination);

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        try {
          source.disconnect();
          gain.disconnect();
        } catch {
          // ignore
        }
        resolve();
      };
      // 컨텍스트가 중단되어 onended가 오지 않는 경우 대비 (실제 길이 + 여유)
      const safety = setTimeout(finish, buffer.duration * 1000 + 1500);
      source.onended = finish;
      this.stopCurrent = () => {
        try {
          source.stop();
        } catch {
          // ignore
        }
        finish();
      };
      source.start();
    });
  }

  private playHtmlAudio(url: string, gen: number): Promise<void> {
    if (gen !== this.generation) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const audio = new Audio(url);
      audio.volume = this.volume;
      audio.setAttribute('playsinline', '');

      let safety = setTimeout(() => finish(), 15_000);
      const finish = (err?: unknown) => {
        clearTimeout(safety);
        audio.onended = null;
        audio.onerror = null;
        audio.onloadedmetadata = null;
        if (err) reject(err);
        else resolve();
      };
      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration)) {
          clearTimeout(safety);
          safety = setTimeout(() => finish(), audio.duration * 1000 + 1500);
        }
      };
      audio.onended = () => finish();
      audio.onerror = () => finish(audio.error ?? new Error('HTMLAudio error'));
      this.stopCurrent = () => {
        audio.pause();
        finish();
      };
      audio.play().catch((err) => finish(err));
    });
  }
}
