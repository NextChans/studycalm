import { STORAGE_KEYS } from './storageKeys';

/**
 * 4자리 관리자 PIN 해시 생성 및 검증 모듈
 * Web Crypto API (SHA-256)를 사용하며, PIN 평문은 절대 저장하지 않습니다.
 */
export class PinAuth {
  /**
   * 문자열을 SHA-256 hex string으로 변환
   */
  public static async hashPin(pin: string): Promise<string> {
    const cryptoObj = typeof window !== 'undefined' ? window.crypto : globalThis.crypto;
    if (cryptoObj && cryptoObj.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(`studycalm_salt_${pin}`);
      const hashBuffer = await cryptoObj.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // 폴백
    let hash = 0;
    const salted = `studycalm_salt_${pin}`;
    for (let i = 0; i < salted.length; i++) {
      const char = salted.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }

  /**
   * 관리자 PIN이 이미 설정되어 있는지 확인
   */
  public static isPinConfigured(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return !!localStorage.getItem(STORAGE_KEYS.PIN_HASH);
  }

  /**
   * 최초 PIN 설정 (해시값만 저장)
   */
  public static async setInitialPin(pin: string): Promise<boolean> {
    if (!/^\d{4}$/.test(pin)) {
      throw new Error('PIN은 4자리 숫자여야 합니다.');
    }
    const hash = await this.hashPin(pin);
    localStorage.setItem(STORAGE_KEYS.PIN_HASH, hash);
    return true;
  }

  /**
   * 입력된 PIN 검증
   */
  public static async verifyPin(pin: string): Promise<boolean> {
    const savedHash = localStorage.getItem(STORAGE_KEYS.PIN_HASH);
    if (!savedHash) {
      return false;
    }
    const inputHash = await this.hashPin(pin);
    return savedHash === inputHash;
  }

  /**
   * PIN 재설정 (기존 PIN 검증 후 새 PIN 저장)
   */
  public static async resetPin(currentPin: string, newPin: string): Promise<boolean> {
    const isValid = await this.verifyPin(currentPin);
    if (!isValid) {
      return false;
    }
    await this.setInitialPin(newPin);
    return true;
  }
}
