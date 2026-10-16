import React from 'react';
import { MachineState } from '../core/machine/types';

interface LevelMeterProps {
  currentDb: number;
  smoothedDb: number;
  baselineDb: number | null;
  thresholdDb: number | null;
  state: MachineState;
  exceedingProgress: number;
}

export const LevelMeter: React.FC<LevelMeterProps> = ({
  smoothedDb,
  baselineDb,
  thresholdDb,
  state,
  exceedingProgress,
}) => {
  // 미터 범위: -80 dBFS ~ 0 dBFS
  const MIN_DB = -80;
  const MAX_DB = 0;

  const dbToPercent = (db: number | null): number => {
    if (db === null) return 0;
    const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
    return ((clamped - MIN_DB) / (MAX_DB - MIN_DB)) * 100;
  };

  const currentPercent = dbToPercent(smoothedDb);
  const baselinePercent = baselineDb !== null ? dbToPercent(baselineDb) : null;
  const thresholdPercent = thresholdDb !== null ? dbToPercent(thresholdDb) : null;

  // 상태별 바 색상
  const getBarColor = () => {
    if (state === 'ALERTING') return 'from-rose-500 to-red-600 shadow-rose-500/50';
    if (state === 'EXCEEDING') return 'from-amber-400 to-orange-500 shadow-amber-500/50';
    if (state === 'CALIBRATING') return 'from-sky-400 to-blue-500 shadow-sky-500/50';
    if (thresholdDb !== null && smoothedDb >= thresholdDb) {
      return 'from-amber-400 to-rose-500';
    }
    return 'from-emerald-400 to-teal-500 shadow-emerald-500/30';
  };

  return (
    <div className="w-full flex flex-col gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-2xl backdrop-blur-md">
      {/* 상단 수치 디스플레이 (태블릿에서 멀리서도 잘 보이도록 대형 폰트 적용) */}
      <div className="flex items-end justify-between">
        <div>
          <span className="text-xs uppercase font-semibold text-slate-400 tracking-wider">
            실시간 소음 레벨
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-6xl font-mono font-extrabold tracking-tight text-white">
              {smoothedDb > MIN_DB ? smoothedDb.toFixed(1) : '-∞'}
            </span>
            <span className="text-xl font-bold text-slate-400">dBFS</span>
          </div>
        </div>

        {/* 기준선 및 임계치 정보 배지 */}
        <div className="flex items-center gap-4 text-xs font-medium">
          {baselineDb !== null && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-950/60 border border-sky-800 text-sky-300">
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              <span>기준선(Baseline): <strong>{baselineDb.toFixed(1)} dB</strong></span>
            </div>
          )}
          {thresholdDb !== null && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-300">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>임계치(Threshold): <strong>{thresholdDb.toFixed(1)} dB</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* 메인 레벨 게이지 바 */}
      <div className="relative w-full h-14 bg-slate-950/90 rounded-xl overflow-hidden border border-slate-800 p-1 flex items-center">
        {/* 채워지는 바 */}
        <div
          className={`h-full rounded-lg bg-gradient-to-r transition-all duration-75 shadow-lg ${getBarColor()}`}
          style={{ width: `${currentPercent}%` }}
        />

        {/* 기준선(Baseline) 마커 */}
        {baselinePercent !== null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-sky-400 z-10 flex flex-col items-center pointer-events-none"
            style={{ left: `${baselinePercent}%` }}
          >
            <div className="w-2 h-2 bg-sky-400 rounded-full -mt-1 shadow-sm" />
            <span className="mt-auto mb-1 text-[10px] font-bold text-sky-300 bg-sky-950/80 px-1 rounded shadow">
              기준
            </span>
          </div>
        )}

        {/* 임계치(Threshold) 마커 */}
        {thresholdPercent !== null && (
          <div
            className="absolute top-0 bottom-0 w-1 bg-amber-400 z-10 flex flex-col items-center pointer-events-none"
            style={{ left: `${thresholdPercent}%` }}
          >
            <div className="w-2.5 h-2.5 bg-amber-400 rounded-full -mt-1 shadow" />
            <span className="mt-auto mb-1 text-[10px] font-bold text-amber-300 bg-amber-950/80 px-1 rounded shadow">
              임계치
            </span>
          </div>
        )}
      </div>

      {/* 目盛 (Scale Ticks) */}
      <div className="flex justify-between text-[11px] font-mono text-slate-500 px-1 select-none">
        <span>-80 dB</span>
        <span>-60 dB</span>
        <span>-40 dB</span>
        <span>-20 dB</span>
        <span>0 dB</span>
      </div>

      {/* 초과 지속(Sustain) 진행률 프로그레스 바 */}
      {state === 'EXCEEDING' && (
        <div className="w-full flex flex-col gap-1 mt-1 animate-fadeIn">
          <div className="flex justify-between text-xs font-semibold text-amber-400">
            <span>⚠️ 소음 초과 감지 - 안내 발동까지 지속 시간</span>
            <span>{Math.round(exceedingProgress * 100)}%</span>
          </div>
          <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-amber-900/50">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-75"
              style={{ width: `${exceedingProgress * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
