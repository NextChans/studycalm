import { VoiceFallback } from './VoiceFallback';

export interface SoundPlayerOptions {
  soundFiles: string[];
  volume: number;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}

export class SoundPlayer {
  private soundFiles: string[];
  private volume: number;
  private currentIndex: number = 0;
  private isPlaying: boolean = false;
  private currentAudio: HTMLAudioElement | null = null;
  private onPlaybackStart?: () => void;
  private onPlaybackEnd?: () => void;

  constructor(options: SoundPlayerOptions) {
    this.soundFiles = options.soundFiles.length > 0 ? options.soundFiles : ['/sounds/alert-1.mp3'];
    this.volume = options.volume;
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

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * 로테이션 방식으로 사운드 재생 시도. 실패 시 speechSynthesis로 자동 폴백.
   */
  public async playNextAlert(): Promise<void> {
    if (this.isPlaying) return;
    this.isPlaying = true;

    if (this.onPlaybackStart) {
      this.onPlaybackStart();
    }

    const soundUrl = this.soundFiles[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.soundFiles.length;

    try {
      await this.playAudioFile(soundUrl);
    } catch (audioErr) {
      console.warn(`[SoundPlayer] Failed to play ${soundUrl}. Falling back to SpeechSynthesis:`, audioErr);
      await VoiceFallback.speak('조용히 해주세요.', this.volume);
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

      const cleanup = () => {
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
