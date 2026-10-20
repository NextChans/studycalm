import { describe, expect, it } from 'vitest';
import { sanitizeAnalyticsUrl } from '../src/core/analytics/sanitizeAnalyticsUrl';

const KEY = 'a'.repeat(43);

describe('sanitizeAnalyticsUrl', () => {
  it('리모컨 링크의 페어링 키(fragment)와 쿼리를 제거하고 /remote 로 기록한다', () => {
    const out = sanitizeAnalyticsUrl(
      `https://studycalm-five.vercel.app/?mode=remote#k=${KEY}&n=%EC%97%B4%EB%9E%8C%EC%8B%A4`
    );
    expect(out).toBe('https://studycalm-five.vercel.app/remote');
    expect(out).not.toContain(KEY);
  });

  it('레거시 /remote 경로도 키 없이 /remote 로 기록한다', () => {
    expect(sanitizeAnalyticsUrl(`https://x.vercel.app/remote#k=${KEY}`)).toBe(
      'https://x.vercel.app/remote'
    );
  });

  it('태블릿 화면은 쿼리·fragment 없이 / 로 기록한다', () => {
    expect(sanitizeAnalyticsUrl('https://x.vercel.app/index.html?utm=1#foo')).toBe(
      'https://x.vercel.app/'
    );
  });

  it('파싱할 수 없는 URL은 / 로 기록한다', () => {
    expect(sanitizeAnalyticsUrl('not a url')).toBe('/');
  });
});
