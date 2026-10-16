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
