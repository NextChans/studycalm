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
      ChimeSynthesizer.getContext();
      const dummy = new Audio('/sounds/alert-1.wav');
      dummy.volume = 0;
      dummy
        .play()
        .then(() => {
          dummy.pause();
          dummy.currentTime = 0;
        })
        .catch(() => {});
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
      if (this.onPlaybackEnd) {
        this.onPlaybackEnd();
      }
    }
  }

  private playAudioFile(url: string): Promise<void> {
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
