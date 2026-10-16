export interface ServiceWorkerCallbacks {
  onUpdateAvailable?: (registration: ServiceWorkerRegistration) => void;
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
}

export function registerServiceWorker(callbacks: ServiceWorkerCallbacks = {}): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (callbacks.onSuccess) {
          callbacks.onSuccess(registration);
        }

        // 이미 대기 중인 새 워커가 있는 경우
        if (registration.waiting) {
          if (callbacks.onUpdateAvailable) {
            callbacks.onUpdateAvailable(registration);
          }
        }

        // 새 버전 워커 다운로드 중 상태 변경 감지
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // 새 버전 대기 상태 -> 배너 노출
                if (callbacks.onUpdateAvailable) {
                  callbacks.onUpdateAvailable(registration);
                }
              }
            }
          });
        });
      })
      .catch((error) => {
        console.warn('[PWA] ServiceWorker registration failed:', error);
      });

    // 새 서비스워커 활성화 후 페이지 리로드
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}

/**
 * 대기 중인 서비스 워커에 SKIP_WAITING 메시지를 전송하여 즉시 활성화
 */
export function activateWaitingWorker(registration: ServiceWorkerRegistration): void {
  if (registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
}
