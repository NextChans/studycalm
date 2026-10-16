import { describe, it, expect } from 'vitest';
import { EmaFilter } from '../src/core/audio/EmaFilter';

describe('EmaFilter', () => {
  it('첫 번째 샘플은 입력값 그대로 출력된다', () => {
    const filter = new EmaFilter(0.2);
    const out = filter.next(-50);
    expect(out).toBe(-50);
  });

  it('연속된 샘플에 대해 지수이동평균 공식(alpha * X + (1 - alpha) * S)에 맞춰 계산된다', () => {
    const filter = new EmaFilter(0.5);
    filter.next(10); // S_0 = 10
    const out = filter.next(20); // S_1 = 0.5 * 20 + 0.5 * 10 = 15
    expect(out).toBe(15);
  });

  it('리셋 시 내부 상태가 초기화된다', () => {
    const filter = new EmaFilter(0.2);
    filter.next(-30);
    filter.reset();
    expect(filter.current()).toBeNull();
    const nextVal = filter.next(-60);
    expect(nextVal).toBe(-60);
  });
});
