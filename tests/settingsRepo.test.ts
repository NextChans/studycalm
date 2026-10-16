import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsRepo } from '../src/core/storage/settingsRepo';
import { STORAGE_KEYS } from '../src/core/storage/storageKeys';
import { DEFAULT_CONFIG } from '../src/config/defaults';

describe('SettingsRepo', () => {
  beforeEach(() => localStorage.clear());

  it('구버전에 저장된 음원 목록(로테이션)은 무시하고 항상 같은 기본 음원을 사용한다', () => {
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({ soundFiles: ['/sounds/alert-2.mp3', '/sounds/alert-1.mp3'], volume: 0.5 })
    );
    const cfg = SettingsRepo.load();
    expect(cfg.soundFiles).toEqual(['/sounds/alert-1.wav']);
    expect(cfg.soundFiles).toEqual(DEFAULT_CONFIG.soundFiles);
    expect(cfg.volume).toBe(0.5);
  });
});
