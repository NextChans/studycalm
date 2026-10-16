const CACHE_NAME = 'studycalm-v4';

const PRECACHE_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.ico', '/sounds/alert-1.wav?v=3'];

self.addEventListener('install', (event) => {
  // 숨겨 설치한 태블릿은 업데이트 배너를 누를 사람이 없으므로 새 버전을 즉시 활성화한다
  // (페이지는 controllerchange 시 새로고침되고, 측정 중이었다면 자동 재개됨)
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // HTTP 캐시(max-age)에 남은 구버전 음원을 프리캐시하지 않도록 반드시 네트워크에서 새로 받는다
      .then((cache) => cache.addAll(PRECACHE_ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .catch((err) => {
        console.warn('[SW] Precache failed (some assets might be missing):', err);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 외부 요청, 서버리스 API(/api/tts 등)는 서비스워커를 거치지 않는다
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // 경고 음원은 네트워크 우선 (파일 교체가 즉시 반영되도록), 오프라인일 때만 캐시 사용
  if (url.pathname.startsWith('/sounds/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cloned = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // HTML 파일 및 sw.js는 네트워크 우선(Stale-While-Revalidate or Network First)으로 새 버전 감지
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/sw.js') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 해시된 assets는 캐시 우선 (Cache First)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return networkResponse;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
