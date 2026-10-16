import { useEffect, useState } from 'react';

export interface BatteryInfo {
  /** 0~100 */
  level: number;
  charging: boolean;
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

/**
 * 배터리 잔량/충전 상태 (Battery Status API — Android Chrome·데스크톱 Chrome 지원, Safari 미지원 시 null)
 */
export function useBattery(): BatteryInfo | null {
  const [info, setInfo] = useState<BatteryInfo | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (typeof nav.getBattery !== 'function') return;

    let battery: BatteryManagerLike | null = null;
    let disposed = false;
    const update = () => {
      if (battery && !disposed) {
        setInfo({ level: Math.round(battery.level * 100), charging: battery.charging });
      }
    };

    nav
      .getBattery()
      .then((b) => {
        if (disposed) return;
        battery = b;
        update();
        b.addEventListener('levelchange', update);
        b.addEventListener('chargingchange', update);
      })
      .catch(() => {});

    return () => {
      disposed = true;
      battery?.removeEventListener('levelchange', update);
      battery?.removeEventListener('chargingchange', update);
    };
  }, []);

  return info;
}
