import { describe, it, expect, beforeEach } from 'vitest';
import { PinAuth } from '../src/core/storage/pinAuth';
import { STORAGE_KEYS } from '../src/core/storage/storageKeys';

describe('PinAuth', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('4자리 숫자가 아닌 PIN 설정 시 에러를 던진다', async () => {
    await expect(PinAuth.setInitialPin('123')).rejects.toThrow();
    await expect(PinAuth.setInitialPin('abcd')).rejects.toThrow();
    await expect(PinAuth.setInitialPin('12345')).rejects.toThrow();
  });

  it('올바른 4자리 PIN을 설정하면 해시값으로 저장되고 올바른 PIN만 검증에 성공한다', async () => {
    await PinAuth.setInitialPin('1234');

    expect(PinAuth.isPinConfigured()).toBe(true);
    const savedHash = localStorage.getItem(STORAGE_KEYS.PIN_HASH);
    expect(savedHash).toBeTruthy();
    expect(savedHash).not.toBe('1234'); // 평문이 아니어야 함

    const isValid = await PinAuth.verifyPin('1234');
    expect(isValid).toBe(true);

    const isWrong = await PinAuth.verifyPin('9999');
    expect(isWrong).toBe(false);
  });
});

describe('PinAuth 무차별 대입 잠금', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('5회 연속 실패 시 잠기고, 잠금 중에는 올바른 PIN도 거부한다', async () => {
    await PinAuth.setInitialPin('1234');
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(await PinAuth.verifyPin('0000', t0)).toBe(false);
    }
    expect(PinAuth.getLockoutRemainingMs(t0)).toBe(60_000);
    expect(await PinAuth.verifyPin('1234', t0 + 1_000)).toBe(false);

    // 잠금 해제 후 성공하면 카운터 초기화
    expect(await PinAuth.verifyPin('1234', t0 + 61_000)).toBe(true);
    expect(PinAuth.getLockoutRemainingMs(t0 + 61_000)).toBe(0);
  });

  it('반복 잠금 시 잠금 시간이 늘어난다', async () => {
    await PinAuth.setInitialPin('1234');
    let t = 1_000_000;
    for (let i = 0; i < 5; i++) await PinAuth.verifyPin('0000', t);
    t += 60_001;
    for (let i = 0; i < 5; i++) await PinAuth.verifyPin('0000', t);
    expect(PinAuth.getLockoutRemainingMs(t)).toBe(120_000);
  });
});
