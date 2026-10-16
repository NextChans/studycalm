import { VoiceFallback } from './VoiceFallback';
import { ChimeSynthesizer } from './ChimeSynthesizer';

export interface SoundPlayerOptions {
  soundFiles: string[];
  volume: number;
  customAudioUrl?: string | null;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}

export class SoundPlayer {
  private soundFiles: string[];
  private volume: number;
  private customAudioUrl: string | null = null;
  private currentIndex: number = 0;
  private isPlaying: boolean = false;
  private currentAudio: HTMLAudioElement | null = null;
  private currentBufferSource: AudioBufferSourceNode | null = null;
  private onPlaybackStart?: () => void;
  private onPlaybackEnd?: () => void;

  constructor(options: SoundPlayerOptions) {
    this.soundFiles = options.soundFiles.length > 0 ? options.soundFiles : ['/sounds/alert-1.wav'];
    this.volume = options.volume;
    this.customAudioUrl = options.customAudioUrl ?? null;
    this.onPlaybackStart = options.onPlaybackStart;
    this.onPlaybackEnd = options.onPlaybackEnd;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.currentAudio) {
      this.currentAudio.volume = this.volume;
    }
  }

  public setSoundFiles(files: string[]): void {
    if (files.length > 0) {
      this.soundFiles = files;
      this.currentIndex = 0;
    }
  }

  public setCustomAudioUrl(url: string | null): void {
    this.customAudioUrl = url;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * 사용자 터치 시 호출하여 iOS Safari 오디오 서브시스템을 잠금 해제(Prime)
   */
  public unlock(): void {
    try {
      VoiceFallback.unlock();
      const ctx = ChimeSynthesizer.getContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  /**
   * 커스텀 등록 음원 우선 재생 -> 로테이션 파일 재생 -> Web Audio Chime & SpeechSynthesis 폴백
   */
  public async playNextAlert(): Promise<void> {
    if (this.isPlaying) return;
    this.isPlaying = true;

    if (this.onPlaybackStart) {
      this.onPlaybackStart();
    }

    try {
      // 1. 커스텀 등록 음원이 있는 경우 우선 재생
      if (this.customAudioUrl) {
        try {
          await this.playAudioFile(this.customAudioUrl);
          return;
        } catch (customErr) {
          console.warn('[SoundPlayer] Failed to play custom audio. Falling back to default list:', customErr);
        }
      }

      // 2. 기본 음원 로테이션 파일 재생
      const soundUrl = this.soundFiles[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.soundFiles.length;

      try {
        await this.playAudioFile(soundUrl);
      } catch (audioErr) {
        console.warn(`[SoundPlayer] Failed to play ${soundUrl}. Falling back to ChimeSynthesizer & SpeechSynthesis:`, audioErr);
        // 3. 브라우저 Web Audio API 기반 순수 신디사이저 차임벨 재생 (무조건 출력 보장)
        await ChimeSynthesizer.playChime(this.volume);
        // 4. 브라우저 음성 합성 폴백
        await VoiceFallback.speak('조용히 해주세요.', this.volume);
      }
    } finally {
      this.isPlaying = false;
      this.currentAudio = null;
      this.currentBufferSource = null;
      if (this.onPlaybackEnd) {
        this.onPlaybackEnd();
      }
    }
  }

  private async playAudioFile(url: string): Promise<void> {
    // 1. 공유 AudioContext를 통한 Web Audio 버퍼 재생 우선 시도
    // (iOS 사파리에서 HTML5 Audio 태그가 마이크 레코딩 세션을 가로채거나 중단시키는 현상 방지)
    try {
      const ctx = ChimeSynthesizer.getContext();
      if (ctx && ctx.state !== 'closed') {
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        await this.playViaWebAudio(ctx, url);
        return;
      }
    } catch (webAudioErr) {
      console.warn('[SoundPlayer] Web Audio playback failed, falling back to HTMLAudioElement:', webAudioErr);
    }

    // 2. HTMLAudioElement 폴백 재생
    await this.playViaHtmlAudio(url);
  }

  private playViaWebAudio(ctx: AudioContext, url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP error ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buf) => {
          return new Promise<AudioBuffer>((resBuf, rejBuf) => {
            ctx.decodeAudioData(buf, resBuf, rejBuf);
          });
        })
        .then((audioBuffer) => {
          const source = ctx.createBufferSource();
          this.currentBufferSource = source;
          source.buffer = audioBuffer;

          const gainNode = ctx.createGain();
          gainNode.gain.setValueAtTime(this.volume, ctx.currentTime);

          source.connect(gainNode);
          gainNode.connect(ctx.destination);

          let isSettled = false;
          const safetyTimer = setTimeout(() => {
            if (!isSettled) {
              isSettled = true;
              try {
                source.stop();
              } catch {}
              this.currentBufferSource = null;
              resolve();
            }
          }, (audioBuffer.duration + 0.5) * 1000);

          source.onended = () => {
            if (!isSettled) {
              isSettled = true;
              clearTimeout(safetyTimer);
              this.currentBufferSource = null;
              resolve();
            }
          };

          source.start();
        })
        .catch(reject);
    });
  }

  private playViaHtmlAudio(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const audio = new Audio(url);
      this.currentAudio = audio;
      audio.volume = this.volume;

      // iOS WebKit에서 이벤트 미발생으로 인한 영구 블로킹 방지 안전 타이머 (최대 7초)
      const safetyTimer = setTimeout(() => {
        cleanup();
        reject(new Error('Audio playback timed out.'));
      }, 7000);

      const cleanup = () => {
        clearTimeout(safetyTimer);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
      };

      const handleEnded = () => {
        cleanup();
        resolve();
      };

      const handleError = (e: Event) => {
        cleanup();
        reject(e);
      };

      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('error', handleError);

      audio.play().catch((playErr) => {
        cleanup();
        reject(playErr);
      });
    });
  }

  public stop(): void {
    if (this.currentBufferSource) {
      try {
        this.currentBufferSource.stop();
      } catch {
        // ignore
      }
      this.currentBufferSource = null;
    }
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.isPlaying = false;
  }
}
