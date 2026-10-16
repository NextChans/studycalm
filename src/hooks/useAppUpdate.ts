import { useCallback, useEffect, useRef, useState } from 'react';

const CHECK_INTERVAL_MS = 5 * 60_000;
/** 영업 중 갑작스러운 새로고침을 피하기 위해 자동 적용은 새벽 시간대에만 (iPad는 새로고침 후 화면 터치 전까지 소리 차단) */
const AUTO_APPLY_HOURS = { from: 3, to: 5 };

export const APP_VERSION = __APP_VERSION__;

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * 새 배포 감지 및 적용 (태블릿 전용)
 * - 숨겨 설치한 태블릿은 아무도 새로고침하지 않으므로 5분마다 /version.json을 확인
 * - 새 버전은 새벽 3~5시에 재생 중이 아닐 때 자동 적용, 리모컨에서 즉시 적용 가능
 * - 새로고침 후에는 측정 자동 재개 기능으로 측정이 다시 시작됨
 */
export function useAppUpdate(enabled: boolean, isBusy: () => boolean) {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  const updateAvailable = !!latestVersion && latestVersion !== APP_VERSION;

  const check = useCallback(async () => {
    const latest = await fetchLatestVersion();
    if (latest) setLatestVersion(latest);
    // 서비스워커 파일이 바뀐 경우도 함께 확인
    void navigator.serviceWorker?.getRegistration().then((r) => r?.update().catch(() => {}));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void check();
    const t = setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, check]);

  /** 재생 중이면 끝날 때까지(최대 60초) 기다렸다가 새로고침 */
  const applyNow = useCallback(async () => {
    for (let i = 0; i < 60 && isBusyRef.current(); i++) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    window.location.reload();
  }, []);

  // 새벽 시간대 자동 적용
  useEffect(() => {
    if (!enabled || !updateAvailable) return;
    const t = setInterval(() => {
      const hour = new Date().getHours();
      if (hour >= AUTO_APPLY_HOURS.from && hour < AUTO_APPLY_HOURS.to && !isBusyRef.current()) {
        window.location.reload();
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [enabled, updateAvailable]);

  return { appVersion: APP_VERSION, latestVersion, updateAvailable, applyNow, check };
}
