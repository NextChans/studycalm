import { DEFAULT_CONFIG, NoiseConfig, sanitizeTuning } from '../../config/defaults';
import { STORAGE_KEYS } from './storageKeys';

export class SettingsRepo {
  public static load(): NoiseConfig {
    if (typeof localStorage === 'undefined') {
      return { ...DEFAULT_CONFIG };
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!stored) {
        return { ...DEFAULT_CONFIG };
      }
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        ...sanitizeTuning({ ...DEFAULT_CONFIG, ...parsed }),
        // 음원 목록은 UI에서 바꿀 수 없는 앱 기본값 — 구버전에 저장된 목록(mp3/로테이션)이 남아
        // 태블릿마다 다른 멘트가 나오지 않도록 항상 현재 기본값을 사용
        soundFiles: DEFAULT_CONFIG.soundFiles,
      };
    } catch (e) {
      console.warn('[SettingsRepo] Failed to parse stored settings:', e);
      return { ...DEFAULT_CONFIG };
    }
  }

  public static save(config: NoiseConfig): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(config));
    } catch (e) {
      console.error('[SettingsRepo] Failed to save settings to localStorage:', e);
    }
  }

  public static resetToDefault(): NoiseConfig {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    }
    return { ...DEFAULT_CONFIG };
  }
}
