import React, { useState, useRef, useEffect } from 'react';
import { DEFAULT_CONFIG, NoiseConfig } from '../config/defaults';
import { CustomAudioItem } from '../core/storage/customAudioRepo';
import { TuningControls } from './TuningControls';
import { ScheduleEditor } from './ScheduleEditor';
import { sanitizeSchedule } from '../core/schedule/schedule';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: NoiseConfig;
  customAudio: CustomAudioItem | null;
  onSave: (newConfig: Partial<NoiseConfig>) => void;
  onRecalibrate: () => void;
  /** 현재 적용 중인 기준값 / 실시간 소음 (조정 시 참고용) */
  activeBaselineDb: number | null;
  liveDb: number | null;
  onSaveCustomAudio: (blob: Blob, name: string) => Promise<void>;
  onDeleteCustomAudio: () => Promise<void>;
  /** 현재 설정된 경고음 미리듣기 (실제 경고와 동일한 재생 경로) */
  onPreview: (volume: number) => Promise<void>;
  onStopPreview: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  customAudio,
  onSave,
  onRecalibrate,
  activeBaselineDb,
  liveDb,
  onSaveCustomAudio,
  onDeleteCustomAudio,
  onPreview,
  onStopPreview,
}) => {
  const [formData, setFormData] = useState<NoiseConfig>({ ...config });
  const [saveToast, setSaveToast] = useState(false);

  // 음원 미리듣기 상태
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  // 음원 녹음 상태
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 모달을 열 때마다 저장된 최신 설정으로 폼을 초기화 (취소 후 재진입 시 미저장 값이 남는 문제 방지)
  useEffect(() => {
    if (isOpen) setFormData({ ...config });
  }, [isOpen, config]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const handleChange = <K extends keyof NoiseConfig>(key: K, value: NoiseConfig[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave({ ...formData, schedule: sanitizeSchedule(formData.schedule) });
    setSaveToast(true);
    setTimeout(() => {
      setSaveToast(false);
      onClose();
    }, 600);
  };

  const handleResetDefaults = () => {
    setFormData({ ...DEFAULT_CONFIG });
  };

  // 1. 파일 업로드 핸들러
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await onSaveCustomAudio(file, file.name);
      e.target.value = '';
    } catch (err) {
      alert('오디오 파일 저장 중 오류가 발생했습니다: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // 2. 즉석 녹음 시작/중지 핸들러
  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        const now = new Date();
        const fileName = `현장녹음_${now.getHours()}시${now.getMinutes()}분.webm`;
        await onSaveCustomAudio(audioBlob, fileName);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert('마이크 녹음을 시작할 수 없습니다: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  // 3. 미리 듣기 핸들러 (저장 전 슬라이더 볼륨으로 재생)
  const handleTogglePreview = async () => {
    if (isPlayingPreview) {
      onStopPreview();
      setIsPlayingPreview(false);
      return;
    }

    setIsPlayingPreview(true);
    try {
      await onPreview(formData.volume);
    } catch (err) {
      console.warn('[SettingsModal] Preview error:', err);
    } finally {
      setIsPlayingPreview(false);
    }
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
          {/* ==================== 커스텀 음성 관리 섹션 ==================== */}
          <div className="flex flex-col gap-3 bg-indigo-950/40 p-4 rounded-xl border border-indigo-800/80">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-base">🎙️</span>
                <span className="font-bold text-indigo-200">경고 음성 파일 관리</span>
              </div>
              <span
                className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold ${
                  customAudio
                    ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {customAudio ? '커스텀 음원 적용 중' : '기본 시스템 음원'}
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              스터디카페 맞춤 안내 음성을 업로드하거나 태블릿에서 직접 녹음하여 즉시 적용할 수 있습니다. (서버 전송 없이 태블릿 기기에 안전하게 영구 저장됩니다)
            </p>

            {customAudio && (
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/80 border border-slate-700 text-xs text-slate-200">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-emerald-400">✓</span>
                  <span className="font-medium truncate">{customAudio.name}</span>
                  <span className="text-slate-400 font-mono text-[11px]">
                    ({Math.round(customAudio.size / 1024)} KB)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onDeleteCustomAudio}
                  className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[11px] font-semibold transition shrink-0 ml-2"
                >
                  기본음으로 복원
                </button>
              </div>
            )}

            {/* 업로드 & 녹음 버튼 그룹 */}
            <div className="grid grid-cols-2 gap-2 mt-1">
              {/* 파일 업로드 */}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition"
              >
                <span>📁</span>
                <span>음원 파일 선택</span>
              </button>

              {/* 직접 녹음 버튼 */}
              {isRecording ? (
                <button
                  type="button"
                  onClick={handleStopRecording}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition animate-pulse"
                >
                  <span>⏹</span>
                  <span>녹음 중지 ({recordingSeconds}초)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartRecording}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition"
                >
                  <span>🔴</span>
                  <span>지금 직접 녹음</span>
                </button>
              )}
            </div>

            {/* 미리 듣기 버튼 */}
            <button
              type="button"
              onClick={handleTogglePreview}
              className={`w-full py-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-2 ${
                isPlayingPreview
                  ? 'bg-amber-600 border-amber-500 text-white'
                  : 'bg-indigo-900/60 hover:bg-indigo-800/80 border-indigo-700 text-indigo-200'
              }`}
            >
              <span>{isPlayingPreview ? '⏹' : '▶'}</span>
              <span>{isPlayingPreview ? '미리 듣기 정지' : '현재 안내 음성 미리 듣기'}</span>
            </button>
            <p className="text-[11px] text-slate-400 text-center leading-relaxed">
              💡 아이패드에서 소리가 나지 않는다면 제어 센터의 <strong>무음 모드(종 모양 🔕)</strong>를 해제하고 볼륨을 확인해 주세요.
            </p>
          </div>

          {/* ==================== 기존 소음 판정 설정 항목 ==================== */}

          {/* 0. 자동 경고 음소거 */}
          <label className="flex items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800 cursor-pointer">
            <div className="flex flex-col">
              <span className="font-semibold text-slate-200 text-sm">🔇 자동 경고 음소거</span>
              <span className="text-[11px] text-slate-400">
                소음 측정은 계속하되 자동 경고 음성은 내보내지 않습니다. (원격 방송은 재생)
              </span>
            </div>
            <input
              type="checkbox"
              checked={formData.autoAlertMuted}
              onChange={(e) => handleChange('autoAlertMuted', e.target.checked)}
              className="w-5 h-5 accent-indigo-500 shrink-0"
            />
          </label>

          {/* 0-1. 숨김(검은 화면) 모드 */}
          <label className="flex items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800 cursor-pointer">
            <div className="flex flex-col">
              <span className="font-semibold text-slate-200 text-sm">🌑 숨김 모드 (검은 화면)</span>
              <span className="text-[11px] text-slate-400">
                태블릿을 숨겨 설치할 때 사용. 화면은 켜둔 채 검은 화면만 표시하며, 터치하면 30초간 보입니다.
              </span>
            </div>
            <input
              type="checkbox"
              checked={formData.stealthMode}
              onChange={(e) => handleChange('stealthMode', e.target.checked)}
              className="w-5 h-5 accent-indigo-500 shrink-0"
            />
          </label>

          {/* 0-2. 시간대별 스케줄 */}
          <div className="flex flex-col gap-2 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="font-semibold text-slate-200 text-sm">🕒 시간대별 운영 스케줄</span>
            <ScheduleEditor
              rules={formData.schedule}
              onChange={(rules) => handleChange('schedule', rules)}
            />
          </div>

          {/* 1. 기준 / 임계치 (자동·수동) */}
          <TuningControls
            value={formData}
            onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
            activeBaselineDb={activeBaselineDb}
            liveDb={liveDb}
          />

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
              disabled={config.baselineMode === 'manual'}
              title={config.baselineMode === 'manual' ? '수동 기준 모드에서는 재보정하지 않습니다' : undefined}
              onClick={() => {
                onRecalibrate();
                onClose();
              }}
              className="disabled:opacity-40 px-3 py-2 rounded-xl bg-sky-900/60 hover:bg-sky-800 text-xs font-semibold text-sky-200 transition"
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
