import React, { useState } from 'react';
import { DEFAULT_CONFIG, NoiseConfig } from '../config/defaults';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: NoiseConfig;
  onSave: (newConfig: Partial<NoiseConfig>) => void;
  onRecalibrate: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
  onRecalibrate,
}) => {
  const [formData, setFormData] = useState<NoiseConfig>({ ...config });
  const [saveToast, setSaveToast] = useState(false);

  if (!isOpen) return null;

  const handleChange = <K extends keyof NoiseConfig>(key: K, value: NoiseConfig[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(formData);
    setSaveToast(true);
    setTimeout(() => {
      setSaveToast(false);
      onClose();
    }, 600);
  };

  const handleResetDefaults = () => {
    setFormData({ ...DEFAULT_CONFIG });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl flex flex-col gap-6 text-white max-h-[90vh] overflow-y-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            <h3 className="text-lg font-bold">관리자 설정 패널</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl font-bold p-1"
          >
            ✕
          </button>
        </div>

        {saveToast && (
          <div className="p-2.5 rounded-lg bg-emerald-950/90 border border-emerald-600 text-emerald-200 text-xs text-center font-bold">
            설정이 성공적으로 저장되었습니다!
          </div>
        )}

        <div className="flex flex-col gap-5 text-sm">
          {/* 1. 임계치 오프셋 N dB */}
          <div className="flex flex-col gap-1.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-slate-200">
                임계치 오프셋 (N dB)
              </label>
              <span className="font-mono font-bold text-amber-400">
                +{formData.thresholdOffsetDb} dB
              </span>
            </div>
            <p className="text-xs text-slate-400">
              배경소음 기준선(Baseline)보다 몇 dB 높을 때 소음 초과로 판정할지 설정합니다.
            </p>
            <input
              type="range"
              min={5}
              max={30}
              step={1}
              value={formData.thresholdOffsetDb}
              onChange={(e) => handleChange('thresholdOffsetDb', Number(e.target.value))}
              className="accent-amber-400 cursor-pointer"
            />
          </div>

          {/* 2. 초과 지속 시간 (sustainMs) */}
          <div className="flex flex-col gap-1.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-slate-200">
                초과 지속 시간 (sustainMs)
              </label>
              <span className="font-mono font-bold text-indigo-300">
                {formData.sustainMs} ms ({ (formData.sustainMs / 1000).toFixed(1) }초)
              </span>
            </div>
            <p className="text-xs text-slate-400">
              책을 떨어뜨리는 등 순간적인 소음은 무시하고, 연속으로 유지될 때만 경고를 발생시킵니다.
            </p>
            <input
              type="range"
              min={500}
              max={5000}
              step={100}
              value={formData.sustainMs}
              onChange={(e) => handleChange('sustainMs', Number(e.target.value))}
              className="accent-indigo-400 cursor-pointer"
            />
          </div>

          {/* 3. 재경고 금지 쿨다운 시간 (cooldownMs) */}
          <div className="flex flex-col gap-1.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-slate-200">
                경고 후 쿨다운 (cooldownMs)
              </label>
              <span className="font-mono font-bold text-teal-300">
                {formData.cooldownMs / 1000}초
              </span>
            </div>
            <p className="text-xs text-slate-400">
              안내 방송이 나간 후 너무 잦은 반복 방송으로 이용객이 불쾌해하지 않도록 대기합니다.
            </p>
            <input
              type="range"
              min={10000}
              max={120000}
              step={5000}
              value={formData.cooldownMs}
              onChange={(e) => handleChange('cooldownMs', Number(e.target.value))}
              className="accent-teal-400 cursor-pointer"
            />
          </div>

          {/* 4. 안내 음성 볼륨 */}
          <div className="flex flex-col gap-1.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-slate-200">
                안내 음성 볼륨
              </label>
              <span className="font-mono font-bold text-rose-300">
                {Math.round(formData.volume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={formData.volume}
              onChange={(e) => handleChange('volume', Number(e.target.value))}
              className="accent-rose-400 cursor-pointer"
            />
          </div>

          {/* 5. 스무딩 계수 (EMA alpha) */}
          <div className="flex flex-col gap-1.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-slate-200">
                측정값 스무딩 (EMA Alpha)
              </label>
              <span className="font-mono font-bold text-sky-300">
                {formData.emaAlpha.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              낮을수록 노이즈 변동이 부드러워지며, 높을수록 순간 변화에 빠르게 반응합니다.
            </p>
            <input
              type="range"
              min={0.05}
              max={0.5}
              step={0.01}
              value={formData.emaAlpha}
              onChange={(e) => handleChange('emaAlpha', Number(e.target.value))}
              className="accent-sky-400 cursor-pointer"
            />
          </div>

          {/* 6. 피드백 루프 방지 Mute 시간 */}
          <div className="flex flex-col gap-1.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-slate-200">
                재생 종료 후 마이크 무시 시간 (postPlaybackMuteMs)
              </label>
              <span className="font-mono font-bold text-purple-300">
                {formData.postPlaybackMuteMs} ms
              </span>
            </div>
            <input
              type="range"
              min={500}
              max={4000}
              step={100}
              value={formData.postPlaybackMuteMs}
              onChange={(e) => handleChange('postPlaybackMuteMs', Number(e.target.value))}
              className="accent-purple-400 cursor-pointer"
            />
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
            >
              기본값 복원
            </button>
            <button
              type="button"
              onClick={() => {
                onRecalibrate();
                onClose();
              }}
              className="px-3 py-2 rounded-xl bg-sky-900/60 hover:bg-sky-800 text-xs font-semibold text-sky-200 transition"
            >
              배경소음 즉시 재보정
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold shadow-lg transition"
            >
              설정 저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
