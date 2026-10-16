import React from 'react';
import { MachineState } from '../core/machine/types';

interface StatusBadgeProps {
  state: MachineState;
  calibrationProgress: number;
  cooldownRemainingMs: number;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  state,
  calibrationProgress,
  cooldownRemainingMs,
}) => {
  const getBadgeConfig = () => {
    switch (state) {
      case 'IDLE':
        return {
          label: '대기 중 (시작 버튼을 눌러주세요)',
          bg: 'bg-slate-800 text-slate-300 border-slate-700',
          dot: 'bg-slate-500',
        };
      case 'CALIBRATING':
        return {
          label: `배경소음 보정 중 (${Math.round(calibrationProgress * 100)}%)`,
          bg: 'bg-sky-950/80 text-sky-300 border-sky-800',
          dot: 'bg-sky-400 animate-pulse',
        };
      case 'MONITORING':
        return {
          label: '정상 모니터링 중',
          bg: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
          dot: 'bg-emerald-400',
        };
      case 'EXCEEDING':
        return {
          label: '임계치 초과 지속 중',
          bg: 'bg-amber-950/80 text-amber-300 border-amber-700',
          dot: 'bg-amber-400 animate-ping',
        };
      case 'ALERTING':
        return {
          label: '⚠️ 안내 음성 재생 중',
          bg: 'bg-rose-950/90 text-rose-200 border-rose-600 shadow-lg shadow-rose-950/50',
          dot: 'bg-rose-400 animate-ping',
        };
      case 'COOLDOWN':
        return {
          label: `쿨다운 대기 중 (${Math.ceil(cooldownRemainingMs / 1000)}초)`,
          bg: 'bg-indigo-950/80 text-indigo-300 border-indigo-800',
          dot: 'bg-indigo-400 animate-pulse',
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <div
      className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-sm font-medium tracking-wide transition-all duration-300 ${config.bg}`}
    >
      <span className={`w-2.5 h-2.5 rounded-full ${config.dot}`} />
      <span>{config.label}</span>
    </div>
  );
};
