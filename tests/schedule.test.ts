import { describe, it, expect } from 'vitest';
import {
  applySchedule,
  dueAnnouncements,
  nextAnnouncement,
  ruleMatches,
  sanitizeSchedule,
  ScheduleRule,
} from '../src/core/schedule/schedule';
import { DEFAULT_CONFIG } from '../src/config/defaults';

const rule = (over: Partial<ScheduleRule>): ScheduleRule => ({
  id: 'r1',
  enabled: true,
  days: 'daily',
  start: '22:00',
  end: '08:00',
  mode: 'mute',
  thresholdDb: -45,
  text: '',
  repeat: 1,
  useVoice: false,
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
    expect(sanitizeSchedule(new Array(30).fill({ start: '01:00', end: '02:00', days: 'daily', mode: 'mute' }))).toHaveLength(20);
  });
});

describe('schedule 정시 안내(announce)', () => {
  const ann = (over: Partial<ScheduleRule>): ScheduleRule =>
    rule({ mode: 'announce', start: '23:50', end: '23:50', text: '마감 10분 전입니다.', ...over });

  it('방송 시각부터 2분 안에만, 하루 1회 대상이 된다', () => {
    const r = ann({ id: 'close' });
    expect(dueAnnouncements([r], at(16, '23:49'), {})).toHaveLength(0);
    expect(dueAnnouncements([r], at(16, '23:50'), {})).toHaveLength(1);
    expect(dueAnnouncements([r], at(16, '23:51'), {})).toHaveLength(1);
    expect(dueAnnouncements([r], at(16, '23:52'), {})).toHaveLength(0); // 너무 늦으면 건너뜀
    expect(dueAnnouncements([r], at(16, '23:50'), { close: '2026-10-16' })).toHaveLength(0); // 오늘 이미 방송
    expect(dueAnnouncements([r], at(16, '23:50'), { close: '2026-10-15' })).toHaveLength(1); // 어제 방송 → 오늘 다시
  });

  it('요일 조건과 비활성 규칙을 지킨다', () => {
    expect(dueAnnouncements([ann({ days: 'weekends' })], at(16, '23:50'), {})).toHaveLength(0); // 금
    expect(dueAnnouncements([ann({ days: 'weekends' })], at(17, '23:50'), {})).toHaveLength(1); // 토
    expect(dueAnnouncements([ann({ enabled: false })], at(16, '23:50'), {})).toHaveLength(0);
  });

  it('안내 규칙은 음소거/임계치 구간 계산에 영향을 주지 않는다', () => {
    const cfg = { ...DEFAULT_CONFIG, schedule: [ann({ start: '00:00', end: '00:00' })] };
    const { effective, rule: active } = applySchedule(cfg, at(16, '12:00'));
    expect(active).toBeNull();
    expect(effective.autoAlertMuted).toBe(false);
  });

  it('다음 안내 시각을 계산한다 (오늘 지났으면 다음 해당 요일)', () => {
    const r = ann({ id: 'a', days: 'weekdays', start: '09:00', end: '09:00' });
    expect(nextAnnouncement([r], at(16, '08:00'))?.at.getDate()).toBe(16); // 금 09:00
    expect(nextAnnouncement([r], at(16, '10:00'))?.at.getDate()).toBe(19); // 다음 월요일
    expect(nextAnnouncement([], at(16, '10:00'))).toBeNull();
  });

  it('검증: 멘트 공백 정리·길이 제한, 반복 1~3, 멘트·녹음 둘 다 없으면 버림, 중복 id 재발급', () => {
    const out = sanitizeSchedule([
      { id: 'x', mode: 'announce', days: 'daily', start: '23:50', text: '  마감   안내  ', repeat: 9 },
      { id: 'x', mode: 'announce', days: 'daily', start: '12:00', text: 'a'.repeat(300), repeat: 0 },
      { id: 'y', mode: 'announce', days: 'daily', start: '12:00', text: '   ' },
      { id: 'z', mode: 'announce', days: 'daily', start: '12:00', text: '', useVoice: true },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: 'x', text: '마감 안내', repeat: 3, end: '23:50' });
    expect(out[1].id).not.toBe('x');
    expect(out[1].text).toHaveLength(120);
    expect(out[1].repeat).toBe(1);
    expect(out[2]).toMatchObject({ id: 'z', useVoice: true });
  });
});
