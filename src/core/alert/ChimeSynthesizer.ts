/**
 * Web Audio API를 활용한 순수 신디사이저 차임벨
 * 외부 파일 로드 실패, 코덱 미지원, iOS 사파리 비동기 오디오 차단 리스크가 전혀 없는 가장 안전한 차임벨입니다.
 */
export class ChimeSynthesizer {
  private static sharedCtx: AudioContext | null = null;

  public static getContext(): AudioContext {
    if (typeof window === 'undefined') {
      throw new Error('Web Audio is not available.');
    }

    if (!this.sharedCtx || this.sharedCtx.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.sharedCtx = new AudioCtx();
    }

    if (this.sharedCtx.state === 'suspended') {
      this.sharedCtx.resume().catch(() => {});
    }

    return this.sharedCtx;
  }

  /**
   * 맑고 부드러운 스터디카페 2음 차임벨 (E5: 659Hz -> C5: 523Hz) 합성 재생
   */
  public static async playChime(volume: number = 0.8): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const ctx = this.getContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const now = ctx.currentTime;
      const targetVolume = Math.max(0.1, Math.min(1.0, volume));

      // 메인 마스터 게인 노드
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      masterGain.gain.setValueAtTime(targetVolume * 0.7, now);

      // 음 1: '딩~' (E5, 659.25Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(1.0, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc1.connect(gain1);
      gain1.connect(masterGain);

      // 음 2: '동~' (C5, 523.25Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(523.25, now + 0.45);
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.setValueAtTime(1.0, now + 0.45);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
      osc2.connect(gain2);
      gain2.connect(masterGain);

      osc1.start(now);
      osc1.stop(now + 0.6);

      osc2.start(now + 0.45);
      osc2.stop(now + 1.4);

      return new Promise<void>((resolve) => {
        setTimeout(resolve, 1400);
      });
    } catch (err) {
      console.warn('[ChimeSynthesizer] Failed to synthesize chime:', err);
    }
  }
}
