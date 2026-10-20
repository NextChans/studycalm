/**
 * Vercel Analytics로 보내는 URL 정리
 *
 * - 리모컨 링크의 fragment(`#k=<페어링 키>&n=<이름>`)는 태블릿 제어 권한 그 자체이므로 절대 외부로 내보내지 않는다.
 * - 쿼리스트링도 모두 버리고, 화면 구분만 경로로 남긴다: 태블릿 `/`, 리모컨 `/remote`
 */
export function sanitizeAnalyticsUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '/';
  }
  const isRemote = url.searchParams.get('mode') === 'remote' || url.pathname.startsWith('/remote');
  return `${url.origin}${isRemote ? '/remote' : '/'}`;
}
