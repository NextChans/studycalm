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
   * 입력된 PIN 검증 (잠금 중이면 검증하지 않고 false)
   */
  public static async verifyPin(pin: string, now: number = Date.now()): Promise<boolean> {
    const savedHash = localStorage.getItem(STORAGE_KEYS.PIN_HASH);
    if (!savedHash) {
      return false;
    }
    if (this.getLockoutRemainingMs(now) > 0) {
      return false;
    }
    const inputHash = await this.hashPin(pin);
    const ok = savedHash === inputHash;
    this.recordAttempt(ok, now);
    return ok;
  }

  // ------------------------------------------------------------ 무차별 대입 방지
  // 4자리 PIN(1만 가지)은 잠금 없이는 매장 손님이 수 분 내에 뚫을 수 있다.
  // 5회 연속 실패마다 잠금 시간이 1분 → 2분 → 4분 … 최대 60분으로 늘어난다.

  private static readonly FREE_ATTEMPTS = 5;
  private static readonly BASE_LOCK_MS = 60_000;
  private static readonly MAX_LOCK_MS = 60 * 60_000;

  private static readLockout(): { failures: number; lockedUntil: number } {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.PIN_LOCKOUT) ?? '{}') as {
        failures?: unknown;
        lockedUntil?: unknown;
      };
      return {
        failures: typeof raw.failures === 'number' ? raw.failures : 0,
        lockedUntil: typeof raw.lockedUntil === 'number' ? raw.lockedUntil : 0,
      };
    } catch {
      return { failures: 0, lockedUntil: 0 };
    }
  }

  private static recordAttempt(success: boolean, now: number): void {
    if (success) {
      localStorage.removeItem(STORAGE_KEYS.PIN_LOCKOUT);
      return;
    }
    const state = this.readLockout();
    const failures = state.failures + 1;
    let lockedUntil = state.lockedUntil;
    if (failures % this.FREE_ATTEMPTS === 0) {
      const rounds = failures / this.FREE_ATTEMPTS - 1;
      lockedUntil = now + Math.min(this.MAX_LOCK_MS, this.BASE_LOCK_MS * 2 ** rounds);
    }
    localStorage.setItem(STORAGE_KEYS.PIN_LOCKOUT, JSON.stringify({ failures, lockedUntil }));
  }

  /** 남은 잠금 시간 (ms). 0이면 입력 가능 */
  public static getLockoutRemainingMs(now: number = Date.now()): number {
    return Math.max(0, this.readLockout().lockedUntil - now);
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
