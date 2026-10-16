import { DB_RANGE, type NoiseConfig } from '../../config/defaults';

export type ScheduleDays = 'daily' | 'weekdays' | 'weekends';
export type ScheduleMode = 'mute' | 'threshold' | 'announce';

/**
 * 시간대별 운영 규칙
 * - mute: 해당 시간에는 자동 경고 음소거 (측정은 계속)
 * - threshold: 해당 시간에는 임계치를 절대값(dB)으로 덮어씀
 * - announce: start 시각에 안내 방송 1회 (텍스트 음성 또는 리모컨 녹음 음성)
 */
export interface ScheduleRule {
  id: string;
  enabled: boolean;
  days: ScheduleDays;
  /** "HH:MM" (24시간). announce는 방송 시각 */
  start: string;
  /** "HH:MM" — start보다 이르면 자정을 넘기는 구간 (예: 22:00~02:00). announce는 사용하지 않음 */
  end: string;
  mode: ScheduleMode;
  /** mode=threshold일 때 적용할 절대 임계치 (dBFS) */
  thresholdDb: number;
  /** mode=announce: 안내 멘트 (음성 합성) */
  text: string;
  /** mode=announce: 반복 횟수 1~3 */
  repeat: number;
  /** mode=announce: 리모컨에서 녹음한 음성이 등록되어 있으면 텍스트 대신 녹음 음성 사용 */
  useVoice: boolean;
}

export const MAX_SCHEDULE_RULES = 20;
export const MAX_ANNOUNCE_TEXT_LENGTH = 120;
/** 태블릿이 잠시 멈췄다가 깨어나도 이 시간 안이면 늦게라도 방송 (그 이후는 건너뜀) */
export const ANNOUNCE_GRACE_MINUTES = 2;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const SCHEDULE_DAYS_LABEL: Record<ScheduleDays, string> = {
  daily: '매일',
  weekdays: '평일',
  weekends: '주말',
};

export function newScheduleRule(mode: ScheduleMode = 'mute'): ScheduleRule {
  return {
    id: Math.random().toString(36).slice(2, 10),
    enabled: true,
    days: 'daily',
    start: mode === 'announce' ? '23:50' : '22:00',
    end: mode === 'announce' ? '23:50' : '08:00',
    mode,
    thresholdDb: -45,
    text: mode === 'announce' ? '마감 10분 전입니다. 이용해 주셔서 감사합니다.' : '',
    repeat: 1,
    useVoice: false,
  };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const dayMatches = (days: ScheduleDays, weekday: number) =>
  days === 'daily' || (days === 'weekdays' ? weekday >= 1 && weekday <= 5 : weekday === 0 || weekday === 6);

/**
 * 구간 규칙(mute/threshold)이 주어진 시각에 적용되는지.
 * 자정을 넘는 구간(22:00~02:00)은 "시작한 날"의 요일 기준으로 판단한다
 * (금요일 22:00~02:00 평일 규칙은 토요일 01:00에도 적용).
 */
export function ruleMatches(rule: ScheduleRule, at: Date): boolean {
  if (!rule.enabled || rule.mode === 'announce') return false;
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

/** 목록에서 먼저 나온 활성 구간 규칙이 우선 */
export function activeRule(rules: ScheduleRule[], at: Date): ScheduleRule | null {
  return rules.find((r) => ruleMatches(r, at)) ?? null;
}

export function localDateKey(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

/**
 * 지금 방송해야 할 정시 안내 목록.
 * 오늘 요일에 해당하고, 방송 시각부터 ANNOUNCE_GRACE_MINUTES 이내이며, 오늘 아직 방송하지 않은 규칙.
 * @param firedOn 규칙 id → 마지막 방송 날짜(YYYY-MM-DD)
 */
export function dueAnnouncements(
  rules: ScheduleRule[],
  at: Date,
  firedOn: Record<string, string>
): ScheduleRule[] {
  const today = localDateKey(at);
  const now = at.getHours() * 60 + at.getMinutes();
  return rules.filter((r) => {
    if (!r.enabled || r.mode !== 'announce') return false;
    if (!dayMatches(r.days, at.getDay())) return false;
    const diff = now - toMinutes(r.start);
    return diff >= 0 && diff < ANNOUNCE_GRACE_MINUTES && firedOn[r.id] !== today;
  });
}

/** 다음 정시 안내 (오늘 남은 것 → 내일 이후 7일 내) */
export function nextAnnouncement(rules: ScheduleRule[], at: Date): { rule: ScheduleRule; at: Date } | null {
  let best: { rule: ScheduleRule; at: Date } | null = null;
  for (const rule of rules) {
    if (!rule.enabled || rule.mode !== 'announce') continue;
    const minutes = toMinutes(rule.start);
    for (let d = 0; d < 8; d++) {
      const day = new Date(at.getFullYear(), at.getMonth(), at.getDate() + d, Math.floor(minutes / 60), minutes % 60);
      if (day.getTime() < at.getTime() - 60_000) continue;
      if (!dayMatches(rule.days, day.getDay())) continue;
      if (!best || day < best.at) best = { rule, at: day };
      break;
    }
  }
  return best;
}

export function describeRule(rule: ScheduleRule): string {
  if (rule.mode === 'announce') {
    const body = rule.useVoice ? '녹음 음성' : `"${rule.text.length > 18 ? rule.text.slice(0, 18) + '…' : rule.text}"`;
    return `${SCHEDULE_DAYS_LABEL[rule.days]} ${rule.start} 안내 ${body}${rule.repeat > 1 ? ` ×${rule.repeat}` : ''}`;
  }
  const action = rule.mode === 'mute' ? '음소거' : `임계치 ${rule.thresholdDb}dB`;
  return `${SCHEDULE_DAYS_LABEL[rule.days]} ${rule.start}~${rule.end} ${action}`;
}

/**
 * 저장된 기본 설정에 현재 시각의 구간 스케줄을 덮어써 실제 적용할 설정을 계산
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
  const seenIds = new Set<string>();
  for (const raw of input.slice(0, MAX_SCHEDULE_RULES)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.start !== 'string' || !TIME_RE.test(r.start)) continue;
    if (r.days !== 'daily' && r.days !== 'weekdays' && r.days !== 'weekends') continue;
    if (r.mode !== 'mute' && r.mode !== 'threshold' && r.mode !== 'announce') continue;
    const end = r.mode === 'announce' ? r.start : r.end;
    if (typeof end !== 'string' || !TIME_RE.test(end)) continue;

    const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, MAX_ANNOUNCE_TEXT_LENGTH) : '';
    const useVoice = r.useVoice === true;
    // 텍스트도 녹음도 없는 안내는 무의미하므로 버림
    if (r.mode === 'announce' && !text && !useVoice) continue;

    let id = typeof r.id === 'string' && /^[a-z0-9]{1,16}$/i.test(r.id) ? r.id : newScheduleRule().id;
    while (seenIds.has(id)) id = newScheduleRule().id;
    seenIds.add(id);

    const thr = typeof r.thresholdDb === 'number' && Number.isFinite(r.thresholdDb) ? r.thresholdDb : -45;
    const repeat = typeof r.repeat === 'number' && Number.isFinite(r.repeat) ? Math.round(r.repeat) : 1;
    out.push({
      id,
      enabled: r.enabled !== false,
      days: r.days,
      start: r.start,
      end,
      mode: r.mode,
      thresholdDb: Math.round(Math.min(DB_RANGE.max, Math.max(DB_RANGE.min, thr))),
      text,
      repeat: Math.min(3, Math.max(1, repeat)),
      useVoice,
    });
  }
  return out;
}
