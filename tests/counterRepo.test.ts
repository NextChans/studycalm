import { describe, it, expect, beforeEach } from 'vitest';
import { CounterRepo } from '../src/core/storage/counterRepo';

describe('CounterRepo', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('동일한 날짜에는 카운터가 누적 증가한다', () => {
    const today = new Date('2026-10-16T10:00:00');
    expect(CounterRepo.getTodayCount(today)).toBe(0);

    expect(CounterRepo.increment(today)).toBe(1);
    expect(CounterRepo.increment(today)).toBe(2);
    expect(CounterRepo.getTodayCount(today)).toBe(2);
  });

  it('자정이 지나 다음 날이 되면 카운터가 자동으로 0으로 리셋된다', () => {
    const day1 = new Date('2026-10-16T23:59:00');
    CounterRepo.increment(day1);
    CounterRepo.increment(day1);
    expect(CounterRepo.getTodayCount(day1)).toBe(2);

    // 자정 지난 시점
    const day2 = new Date('2026-10-17T00:01:00');
    expect(CounterRepo.getTodayCount(day2)).toBe(0);

    // 새 날짜에서 1 증가
    expect(CounterRepo.increment(day2)).toBe(1);
  });
});
