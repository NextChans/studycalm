/**
 * Web Speech API (speechSynthesis) 폴백 음성 안내 모듈
 * iOS WebKit의 묵음 및 이벤트 블로킹 버그를 방지하기 위해 안전 타임아웃과 프라이밍을 적용합니다.
 */
export class VoiceFallback {
  private static defaultPhrase = '조용히 해주세요.';

  /**
   * 사용자 최초 터치 제스처 시 호출하여 iOS WebKit의 음성 합성 엔진 잠금을 해제
   */
  public static unlock(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.resume();
      const dummy = new SpeechSynthesisUtterance('');
      dummy.volume = 0;
      window.speechSynthesis.speak(dummy);
    } catch {
      // ignore
    }
  }

  public static async speak(phrase: string = this.defaultPhrase, volume: number = 0.8): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('[VoiceFallback] speechSynthesis is not supported in this environment.');
      return;
    }

    return new Promise<void>((resolve) => {
      let isSettled = false;

      // iOS WebKit에서 onend/onerror가 유실되어 상태 머신이 영구 블로킹되는 현상을 막기 위한 안전 타임아웃
      const maxWaitMs = Math.max(3000, phrase.length * 350);
      const safetyTimeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          resolve();
        }
      }, maxWaitMs);

      const done = () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(safetyTimeout);
          resolve();
        }
      };

      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }

        const utterance = new SpeechSynthesisUtterance(phrase);
        utterance.lang = 'ko-KR';
        utterance.volume = Math.max(0, Math.min(1, volume));
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // ko-KR 보이스 탐색
        const voices = window.speechSynthesis.getVoices();
        const koVoice = voices.find((v) => v.lang === 'ko-KR' || v.lang.startsWith('ko'));
        if (koVoice) {
          utterance.voice = koVoice;
        }

        utterance.onend = () => {
          done();
        };

        utterance.onerror = (e) => {
          console.warn('[VoiceFallback] speechSynthesis error:', e);
          done();
        };

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[VoiceFallback] Failed to trigger speech synthesis:', err);
        done();
      }
    });
  }
}
