import React from 'react';
import { DB_RANGE, NoiseTuning } from '../config/defaults';

interface TuningControlsProps {
  value: NoiseTuning;
  onChange: (patch: Partial<NoiseTuning>) => void;
  /** 현재 적용 중인 기준값 (자동 측정 결과 포함) */
  activeBaselineDb: number | null;
  /** 실시간 소음 (EMA) */
  liveDb: number | null;
  compact?: boolean;
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${v.toFixed(1)} dB`);

const SegButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition ${
      active ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
    }`}
  >
    {children}
  </button>
);

/**
 * 기준(배경소음)·임계치 수동 조정 컨트롤 — 태블릿 설정 화면과 원격 리모컨에서 공용
 */
export const TuningControls: React.FC<TuningControlsProps> = ({
  value,
  onChange,
  activeBaselineDb,
  liveDb,
  compact = false,
}) => {
  const effectiveBaseline = value.baselineMode === 'manual' ? value.manualBaselineDb : activeBaselineDb;
  const effectiveThreshold =
    value.thresholdMode === 'absolute'
      ? value.absoluteThresholdDb
      : effectiveBaseline === null
        ? null
        : effectiveBaseline + value.thresholdOffsetDb;

  const box = `flex flex-col gap-2 bg-slate-950/60 ${compact ? 'p-3' : 'p-3'} rounded-xl border border-slate-800`;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
          <div className="text-slate-500">실시간</div>
          <div className="font-mono font-bold text-white">{fmt(liveDb)}</div>
        </div>
        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
          <div className="text-slate-500">기준</div>
          <div className="font-mono font-bold text-sky-300">{fmt(effectiveBaseline)}</div>
        </div>
        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
          <div className="text-slate-500">임계치</div>
          <div className="font-mono font-bold text-amber-300">{fmt(effectiveThreshold)}</div>
        </div>
      </div>

      {/* 기준 */}
      <div className={box}>
        <div className="flex justify-between items-center">
          <span className="font-semibold text-slate-200 text-sm">기준 (배경소음)</span>
          {value.baselineMode === 'manual' && (
            <span className="font-mono font-bold text-sky-300 text-sm">{value.manualBaselineDb} dB</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <SegButton active={value.baselineMode === 'auto'} onClick={() => onChange({ baselineMode: 'auto' })}>
            자동 측정
          </SegButton>
          <SegButton
            active={value.baselineMode === 'manual'}
            onClick={() =>
              onChange({
                baselineMode: 'manual',
                // 처음 수동 전환 시 현재 측정 기준을 시작값으로 사용
                ...(activeBaselineDb !== null && value.baselineMode !== 'manual'
                  ? { manualBaselineDb: Math.round(activeBaselineDb) }
                  : {}),
              })
            }
          >
            수동 지정
          </SegButton>
        </div>
        {value.baselineMode === 'manual' ? (
          <>
            <input
              type="range"
              min={DB_RANGE.min}
              max={DB_RANGE.max - 10}
              step={1}
              value={value.manualBaselineDb}
              onChange={(e) => onChange({ manualBaselineDb: Number(e.target.value) })}
              className="accent-sky-400 cursor-pointer"
            />
            {liveDb !== null && (
              <button
                type="button"
                onClick={() => onChange({ manualBaselineDb: Math.round(liveDb) })}
                className="self-start text-[11px] text-sky-300 underline"
              >
                지금 소음({liveDb.toFixed(0)} dB)을 기준으로 지정
              </button>
            )}
          </>
        ) : (
          <p className="text-[11px] text-slate-400">측정 시작/재보정 시 배경소음을 측정해 자동으로 정합니다.</p>
        )}
      </div>

      {/* 임계치 */}
      <div className={box}>
        <div className="flex justify-between items-center">
          <span className="font-semibold text-slate-200 text-sm">경고 임계치</span>
          <span className="font-mono font-bold text-amber-300 text-sm">
            {value.thresholdMode === 'absolute' ? `${value.absoluteThresholdDb} dB` : `기준 +${value.thresholdOffsetDb} dB`}
          </span>
        </div>
        <div className="flex gap-1.5">
          <SegButton active={value.thresholdMode === 'offset'} onClick={() => onChange({ thresholdMode: 'offset' })}>
            기준 + N dB
          </SegButton>
          <SegButton
            active={value.thresholdMode === 'absolute'}
            onClick={() =>
              onChange({
                thresholdMode: 'absolute',
                ...(effectiveThreshold !== null && value.thresholdMode !== 'absolute'
                  ? { absoluteThresholdDb: Math.round(effectiveThreshold) }
                  : {}),
              })
            }
          >
            절대값 지정
          </SegButton>
        </div>
        {value.thresholdMode === 'absolute' ? (
          <input
            type="range"
            min={DB_RANGE.min + 10}
            max={DB_RANGE.max}
            step={1}
            value={value.absoluteThresholdDb}
            onChange={(e) => onChange({ absoluteThresholdDb: Number(e.target.value) })}
            className="accent-amber-400 cursor-pointer"
          />
        ) : (
          <input
            type="range"
            min={1}
            max={40}
            step={1}
            value={value.thresholdOffsetDb}
            onChange={(e) => onChange({ thresholdOffsetDb: Number(e.target.value) })}
            className="accent-amber-400 cursor-pointer"
          />
        )}
        <p className="text-[11px] text-slate-400">
          {value.thresholdMode === 'absolute'
            ? '배경소음과 관계없이 이 값을 넘으면 경고합니다.'
            : '배경소음보다 이만큼 시끄러워지면 경고합니다.'}
        </p>
      </div>
    </div>
  );
};
