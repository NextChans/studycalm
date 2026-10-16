import React from 'react';
import { DB_RANGE } from '../config/defaults';
import {
  MAX_SCHEDULE_RULES,
  ScheduleDays,
  ScheduleMode,
  ScheduleRule,
  SCHEDULE_DAYS_LABEL,
  newScheduleRule,
} from '../core/schedule/schedule';

interface ScheduleEditorProps {
  rules: ScheduleRule[];
  onChange: (rules: ScheduleRule[]) => void;
}

const field =
  'bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500';

/**
 * 시간대별 운영 스케줄 편집 (태블릿 설정 화면 / 원격 리모컨 공용)
 * 위에 있는 규칙이 우선 적용된다.
 */
export const ScheduleEditor: React.FC<ScheduleEditorProps> = ({ rules, onChange }) => {
  const update = (id: string, patch: Partial<ScheduleRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(rules.filter((r) => r.id !== id));
  const add = () => onChange([...rules, newScheduleRule()]);

  return (
    <div className="flex flex-col gap-2">
      {rules.length === 0 && (
        <p className="text-[11px] text-slate-500">
          등록된 스케줄이 없습니다. 예: 매일 22:00~08:00 음소거, 평일 12:00~13:00 임계치 -40dB
        </p>
      )}

      {rules.map((rule, idx) => (
        <div
          key={rule.id}
          className={`flex flex-col gap-2 p-2.5 rounded-xl border ${
            rule.enabled ? 'bg-slate-950/60 border-slate-700' : 'bg-slate-950/30 border-slate-800 opacity-60'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => update(rule.id, { enabled: e.target.checked })}
                className="accent-indigo-500"
              />
              규칙 {idx + 1}
            </label>
            <button type="button" onClick={() => remove(rule.id)} className="text-[11px] text-rose-300 underline">
              삭제
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={rule.days}
              onChange={(e) => update(rule.id, { days: e.target.value as ScheduleDays })}
              className={field}
            >
              {(Object.keys(SCHEDULE_DAYS_LABEL) as ScheduleDays[]).map((d) => (
                <option key={d} value={d}>
                  {SCHEDULE_DAYS_LABEL[d]}
                </option>
              ))}
            </select>
            <input
              type="time"
              value={rule.start}
              onChange={(e) => e.target.value && update(rule.id, { start: e.target.value })}
              className={field}
            />
            <span className="text-xs text-slate-500">~</span>
            <input
              type="time"
              value={rule.end}
              onChange={(e) => e.target.value && update(rule.id, { end: e.target.value })}
              className={field}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={rule.mode}
              onChange={(e) => update(rule.id, { mode: e.target.value as ScheduleMode })}
              className={field}
            >
              <option value="mute">자동 경고 음소거</option>
              <option value="threshold">임계치 변경</option>
            </select>
            {rule.mode === 'threshold' && (
              <label className="flex items-center gap-1 text-xs text-slate-300">
                <input
                  type="number"
                  min={DB_RANGE.min}
                  max={DB_RANGE.max}
                  value={rule.thresholdDb}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) update(rule.id, { thresholdDb: v });
                  }}
                  className={`${field} w-20`}
                />
                dB 넘으면 경고
              </label>
            )}
          </div>
        </div>
      ))}

      {rules.length < MAX_SCHEDULE_RULES && (
        <button
          type="button"
          onClick={add}
          className="self-start px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-indigo-300"
        >
          + 스케줄 추가
        </button>
      )}
      <p className="text-[10px] text-slate-500">
        종료 시각이 시작보다 이르면 자정을 넘기는 구간입니다 (예: 22:00~08:00). 겹치면 위의 규칙이 우선합니다.
      </p>
    </div>
  );
};
