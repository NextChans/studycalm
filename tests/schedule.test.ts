import { describe, it, expect } from 'vitest';
import { applySchedule, ruleMatches, sanitizeSchedule, ScheduleRule } from '../src/core/schedule/schedule';
import { DEFAULT_CONFIG } from '../src/config/defaults';

const rule = (over: Partial<ScheduleRule>): ScheduleRule => ({
  id: 'r1',
  enabled: true,
  days: 'daily',
  start: '22:00',
  end: '08:00',
  mode: 'mute',
  thresholdDb: -45,
  ...over,
});
// 2026-10-16은 금요일
const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 9, day, h, m);
};

describe('schedule.ruleMatches', () => {
  it('같은 날 구간: 시작 포함, 종료 미포함', () => {
    const r = rule({ start: '12:00', end: '13:00' });
    expect(ruleMatches(r, at(16, '11:59'))).toBe(false);
    expect(ruleMatches(r, at(16, '12:00'))).toBe(true);
    expect(ruleMatches(r, at(16, '12:59'))).toBe(true);
    expect(ruleMatches(r, at(16, '13:00'))).toBe(false);
  });

  it('자정을 넘는 구간 (22:00~08:00)', () => {
    const r = rule({});
    expect(ruleMatches(r, at(16, '21:59'))).toBe(false);
    expect(ruleMatches(r, at(16, '23:30'))).toBe(true);
    expect(ruleMatches(r, at(17, '07:59'))).toBe(true);
    expect(ruleMatches(r, at(17, '08:00'))).toBe(false);
  });

  it('평일 야간 규칙은 금요일 밤에 시작해 토요일 새벽까지 적용, 토요일 밤에는 미적용', () => {
    const r = rule({ days: 'weekdays' });
    expect(ruleMatches(r, at(16, '23:00'))).toBe(true); // 금 23시
    expect(ruleMatches(r, at(17, '01:00'))).toBe(true); // 토 01시 (금요일 시작분)
    expect(ruleMatches(r, at(17, '23:00'))).toBe(false); // 토 23시
    expect(ruleMatches(r, at(19, '01:00'))).toBe(false); // 월 01시 (일요일 시작분)
  });

  it('주말 규칙과 비활성 규칙', () => {
    expect(ruleMatches(rule({ days: 'weekends', start: '09:00', end: '18:00' }), at(18, '10:00'))).toBe(true); // 일
    expect(ruleMatches(rule({ days: 'weekends', start: '09:00', end: '18:00' }), at(16, '10:00'))).toBe(false); // 금
    expect(ruleMatches(rule({ enabled: false }), at(16, '23:00'))).toBe(false);
  });
});

describe('schedule.applySchedule', () => {
  it('음소거 규칙은 자동 경고를 음소거하고, 임계치 규칙은 절대 임계치를 덮어쓴다 (먼저 나온 규칙 우선)', () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      schedule: [
        rule({ id: 'a', start: '12:00', end: '13:00', mode: 'threshold', thresholdDb: -38 }),
        rule({ id: 'b', start: '00:00', end: '23:59', mode: 'mute' }),
      ],
    };
    const noon = applySchedule(cfg, at(16, '12:30'));
    expect(noon.rule?.id).toBe('a');
    expect(noon.effective.thresholdMode).toBe('absolute');
    expect(noon.effective.absoluteThresholdDb).toBe(-38);
    expect(noon.effective.autoAlertMuted).toBe(false);

    const evening = applySchedule(cfg, at(16, '18:00'));
    expect(evening.rule?.id).toBe('b');
    expect(evening.effective.autoAlertMuted).toBe(true);
    // 기본 설정 자체는 변경하지 않음
    expect(cfg.autoAlertMuted).toBe(false);
  });
});

describe('schedule.sanitizeSchedule', () => {
  it('형식이 틀린 규칙은 버리고 값 범위를 보정한다', () => {
    const out = sanitizeSchedule([
      { start: '25:00', end: '08:00', days: 'daily', mode: 'mute' },
      { start: '22:00', end: '08:00', days: 'sometimes', mode: 'mute' },
      { id: 'ok', start: '12:00', end: '13:00', days: 'weekdays', mode: 'threshold', thresholdDb: -500 },
      'garbage',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'ok', thresholdDb: -90, enabled: true });
    expect(sanitizeSchedule('nope')).toEqual([]);
    expect(sanitizeSchedule(new Array(20).fill({ start: '01:00', end: '02:00', days: 'daily', mode: 'mute' }))).toHaveLength(10);
  });
});
