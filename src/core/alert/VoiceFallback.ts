/**
 * 브라우저 내장 Web Speech API(speechSynthesis) 폴백.
 *
 * 1차 음성 경로는 서버 TTS(/api/tts) → Web Audio 재생이며, 이 모듈은 오프라인 등으로 서버 TTS를
 * 쓸 수 없을 때만 사용한다. (iOS는 마이크 사용 중 speechSynthesis가 무음 처리되는 경우가 있고,
 * 한국어 보이스가 설치되지 않은 Android/Windows 기기도 있어 1차 경로로 쓰기에 불안정하다.)
 */
export class VoiceFallback {
  // WebKit / Chromium GC 버그 방지용 강한 참조 (로컬 변수만 두면 발화 도중 수거되어 onend 유실)
  private static activeUtterances: Set<SpeechSynthesisUtterance> = new Set();

  public static isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /**
   * 사용자 터치 제스처 안에서 호출하여 iOS WebKit 음성 합성 엔진 잠금 해제
   */
  public static unlock(): void {
    if (!this.isSupported()) return;
    try {
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) return;
      if (synth.paused) synth.resume();
      // 빈 문자열은 iOS에서 발화로 인정되지 않으므로 공백 1자를 무음으로 발화
      const dummy = new SpeechSynthesisUtterance(' ');
      dummy.volume = 0;
      this.retain(dummy);
      synth.speak(dummy);
      // 보이스 목록 비동기 로딩 트리거 (Chrome/Android)
      synth.getVoices();
    } catch {
      // ignore
    }
  }

  public static async speak(phrase: string, volume: number = 0.8): Promise<void> {
    if (!this.isSupported()) {
      throw new Error('speechSynthesis is not supported');
    }
    const synth = window.speechSynthesis;

    if (synth.speaking || synth.pending) {
      synth.cancel();
      await new Promise<void>((r) => setTimeout(r, 60));
    }
    if (synth.paused) synth.resume();

    await new Promise<void>((resolve) => {
      let settled = false;
      const utterance = new SpeechSynthesisUtterance(phrase);

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimeout);
        this.activeUtterances.delete(utterance);
        resolve();
      };

      // onend/onerror 유실 시 상태 머신이 영구 블로킹되지 않도록 안전 타임아웃
      const safetyTimeout = setTimeout(() => {
        try {
          synth.cancel();
        } catch {
          // ignore
        }
        finish();
      }, Math.max(5000, phrase.length * 400));

      try {
        utterance.lang = 'ko-KR';
        utterance.volume = Math.max(0, Math.min(1, volume));
        utterance.rate = 0.95;
        const koVoice = synth.getVoices().find((v) => v.lang === 'ko-KR' || v.lang.startsWith('ko'));
        if (koVoice) utterance.voice = koVoice;

        utterance.onend = finish;
        utterance.onerror = (e) => {
          console.warn('[VoiceFallback] speechSynthesis error:', e.error);
          finish();
        };
        this.retain(utterance);
        synth.speak(utterance);
      } catch (err) {
        console.warn('[VoiceFallback] Failed to trigger speech synthesis:', err);
        finish();
      }
    });
  }

  private static retain(utterance: SpeechSynthesisUtterance): void {
    this.activeUtterances.add(utterance);
    const release = () => this.activeUtterances.delete(utterance);
    utterance.addEventListener('end', release);
    utterance.addEventListener('error', release);
  }
}
