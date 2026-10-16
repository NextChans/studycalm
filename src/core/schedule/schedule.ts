import { DB_RANGE, type NoiseConfig } from '../../config/defaults';

export type ScheduleDays = 'daily' | 'weekdays' | 'weekends';
export type ScheduleMode = 'mute' | 'threshold';

/**
 * 시간대별 운영 규칙
 * - mute: 해당 시간에는 자동 경고 음소거 (측정은 계속)
 * - threshold: 해당 시간에는 임계치를 절대값(dB)으로 덮어씀
 */
export interface ScheduleRule {
  id: string;
  enabled: boolean;
  days: ScheduleDays;
  /** "HH:MM" (24시간) */
  start: string;
  /** "HH:MM" — start보다 이르면 자정을 넘기는 구간 (예: 22:00~02:00) */
  end: string;
  mode: ScheduleMode;
  /** mode=threshold일 때 적용할 절대 임계치 (dBFS) */
  thresholdDb: number;
}

export const MAX_SCHEDULE_RULES = 10;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const SCHEDULE_DAYS_LABEL: Record<ScheduleDays, string> = {
  daily: '매일',
  weekdays: '평일',
  weekends: '주말',
};

export function newScheduleRule(): ScheduleRule {
  return {
    id: Math.random().toString(36).slice(2, 10),
    enabled: true,
    days: 'daily',
    start: '22:00',
    end: '08:00',
    mode: 'mute',
    thresholdDb: -45,
  };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const dayMatches = (days: ScheduleDays, weekday: number) =>
  days === 'daily' || (days === 'weekdays' ? weekday >= 1 && weekday <= 5 : weekday === 0 || weekday === 6);

/**
 * 규칙이 주어진 시각에 적용되는지.
 * 자정을 넘는 구간(22:00~02:00)은 "시작한 날"의 요일 기준으로 판단한다
 * (금요일 22:00~02:00 평일 규칙은 토요일 01:00에도 적용).
 */
export function ruleMatches(rule: ScheduleRule, at: Date): boolean {
  if (!rule.enabled) return false;
  const start = toMinutes(rule.start);
  const end = toMinutes(rule.end);
  const now = at.getHours() * 60 + at.getMinutes();
  const weekday = at.getDay();
  if (start === end) return dayMatches(rule.days, weekday); // 하루 종일
  if (start < end) return dayMatches(rule.days, weekday) && now >= start && now < end;
  // 자정을 넘는 구간
  if (now >= start) return dayMatches(rule.days, weekday);
  if (now < end) return dayMatches(rule.days, (weekday + 6) % 7);
  return false;
}

/** 목록에서 먼저 나온 활성 규칙이 우선 */
export function activeRule(rules: ScheduleRule[], at: Date): ScheduleRule | null {
  return rules.find((r) => ruleMatches(r, at)) ?? null;
}

export function describeRule(rule: ScheduleRule): string {
  const action = rule.mode === 'mute' ? '음소거' : `임계치 ${rule.thresholdDb}dB`;
  return `${SCHEDULE_DAYS_LABEL[rule.days]} ${rule.start}~${rule.end} ${action}`;
}

/**
 * 저장된 기본 설정에 현재 시각의 스케줄을 덮어써 실제 적용할 설정을 계산
 */
export function applySchedule(config: NoiseConfig, at: Date): { effective: NoiseConfig; rule: ScheduleRule | null } {
  const rule = activeRule(config.schedule, at);
  if (!rule) return { effective: config, rule: null };
  if (rule.mode === 'mute') return { effective: { ...config, autoAlertMuted: true }, rule };
  return {
    effective: { ...config, thresholdMode: 'absolute', absoluteThresholdDb: rule.thresholdDb },
    rule,
  };
}

/** 원격 입력·저장값 검증 (형식이 틀린 규칙은 버림) */
export function sanitizeSchedule(input: unknown): ScheduleRule[] {
  if (!Array.isArray(input)) return [];
  const out: ScheduleRule[] = [];
  for (const raw of input.slice(0, MAX_SCHEDULE_RULES)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.start !== 'string' || !TIME_RE.test(r.start)) continue;
    if (typeof r.end !== 'string' || !TIME_RE.test(r.end)) continue;
    if (r.days !== 'daily' && r.days !== 'weekdays' && r.days !== 'weekends') continue;
    if (r.mode !== 'mute' && r.mode !== 'threshold') continue;
    const thr = typeof r.thresholdDb === 'number' && Number.isFinite(r.thresholdDb) ? r.thresholdDb : -45;
    out.push({
      id: typeof r.id === 'string' && /^[a-z0-9]{1,16}$/i.test(r.id) ? r.id : newScheduleRule().id,
      enabled: r.enabled !== false,
      days: r.days,
      start: r.start,
      end: r.end,
      mode: r.mode,
      thresholdDb: Math.round(Math.min(DB_RANGE.max, Math.max(DB_RANGE.min, thr))),
    });
  }
  return out;
}
