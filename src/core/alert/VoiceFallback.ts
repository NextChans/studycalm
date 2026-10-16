/**
 * Web Speech API (speechSynthesis) 폴백 음성 안내 모듈
 * iOS WebKit의 묵음 및 이벤트 블로킹 버그를 방지하기 위해 안전 타임아웃과 프라이밍을 적용합니다.
 */
export class VoiceFallback {
  private static defaultPhrase = '조용히 해주세요.';

  // WebKit / Chromium 가비지 컬렉터 버그 방지용 전역 Utterance 보관소
  // (함수 로컬 변수로만 두면 발화 중간 또는 큐 대기 중 GC가 수거하여 영구 음소거 및 후속 발화 차단 발생)
  private static activeUtterances: Set<SpeechSynthesisUtterance> = new Set();

  /**
   * 사용자 최초 터치 제스처 시 호출하여 iOS WebKit의 음성 합성 엔진 잠금을 해제
   */
  public static unlock(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      const dummy = new SpeechSynthesisUtterance('');
      dummy.volume = 0;
      this.activeUtterances.add(dummy);
      dummy.onend = () => {
        this.activeUtterances.delete(dummy);
      };
      dummy.onerror = () => {
        this.activeUtterances.delete(dummy);
      };
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

    // 1. 이전 발화가 진행 중인 경우에만 cancel 후 짧은 텀(60ms) 대기 (WebKit cancel 비동기 유실 방지)
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      await new Promise<void>((r) => setTimeout(r, 60));
    }

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    return new Promise<void>((resolve) => {
      let isSettled = false;

      // iOS WebKit에서 onend/onerror가 유실되어 상태 머신이 영구 블로킹되는 현상을 막기 위한 안전 타임아웃
      const maxWaitMs = Math.max(4000, phrase.length * 400);

      const utterance = new SpeechSynthesisUtterance(phrase);

      const safetyTimeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          this.activeUtterances.delete(utterance);
          try {
            window.speechSynthesis.cancel();
          } catch {
            // ignore
          }
          resolve();
        }
      }, maxWaitMs);

      const done = () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(safetyTimeout);
          this.activeUtterances.delete(utterance);
          resolve();
        }
      };

      try {
        utterance.lang = 'ko-KR';
        utterance.volume = Math.max(0, Math.min(1, volume));
        utterance.rate = 0.95;
        utterance.pitch = 1.0;

        // GC 방지를 위해 static Set 및 window 전역 객체에 강력 참조 유지
        this.activeUtterances.add(utterance);
        if (typeof window !== 'undefined') {
          const w = window as unknown as { __studycalm_utterances?: Set<SpeechSynthesisUtterance> };
          w.__studycalm_utterances = this.activeUtterances;
        }

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
