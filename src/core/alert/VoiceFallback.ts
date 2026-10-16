/**
 * Web Speech API (speechSynthesis) 폴백 음성 안내 모듈
 */
export class VoiceFallback {
  private static defaultPhrase = '조용히 해주세요.';

  public static async speak(phrase: string = this.defaultPhrase, volume: number = 0.8): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('[VoiceFallback] speechSynthesis is not supported in this environment.');
      return;
    }

    return new Promise<void>((resolve) => {
      try {
        window.speechSynthesis.cancel(); // 이전 진행 중인 음성 취소

        const utterance = new SpeechSynthesisUtterance(phrase);
        utterance.lang = 'ko-KR';
        utterance.volume = Math.max(0, Math.min(1, volume));
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // ko-KR 보이스 탐색 (가능한 경우)
        const voices = window.speechSynthesis.getVoices();
        const koVoice = voices.find((v) => v.lang === 'ko-KR' || v.lang.startsWith('ko'));
        if (koVoice) {
          utterance.voice = koVoice;
        }

        utterance.onend = () => {
          resolve();
        };

        utterance.onerror = (e) => {
          console.warn('[VoiceFallback] speechSynthesis error:', e);
          resolve(); // 오류 시에도 프로미스 해결하여 블로킹 방지
        };

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[VoiceFallback] Failed to trigger speech synthesis:', err);
        resolve();
      }
    });
  }
}
