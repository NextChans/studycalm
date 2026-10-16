import { DEFAULT_CONFIG, NoiseConfig } from '../../config/defaults';
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
      return { ...DEFAULT_CONFIG, ...parsed };
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
