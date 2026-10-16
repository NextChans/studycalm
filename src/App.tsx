import React, { useState, useEffect, useCallback } from 'react';
import { useNoiseMonitor } from './hooks/useNoiseMonitor';
import { useWakeLock } from './hooks/useWakeLock';
import { useVisibility } from './hooks/useVisibility';
import { LevelMeter } from './components/LevelMeter';
import { StatusBadge } from './components/StatusBadge';
import { ErrorBanner } from './components/ErrorBanner';
import { BackgroundBanner } from './components/BackgroundBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { AdminPinModal } from './components/AdminPinModal';
import { SettingsModal } from './components/SettingsModal';
import { FooterNotice } from './components/FooterNotice';
import { registerServiceWorker, activateWaitingWorker } from './core/pwa/registerServiceWorker';

export const App: React.FC = () => {
  const {
    config,
    updateConfig,
    snapshot,
    dailyAlertCount,
    audioError,
    isAudioRunning,
    start,
    stop,
    recalibrate,
    dismissError,
  } = useNoiseMonitor();

  const { isLocked, requestLock, releaseLock } = useWakeLock();
  const { isBackground } = useVisibility();

  // PWA 업데이트 감지 상태
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState<boolean>(false);

  // 모달 상태
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);

  // PWA 서비스워커 등록
  useEffect(() => {
    registerServiceWorker({
      onUpdateAvailable: (registration) => {
        setSwRegistration(registration);
        setShowUpdateBanner(true);
      },
    });
  }, []);

  const handleApplyUpdate = useCallback(() => {
    if (swRegistration) {
      activateWaitingWorker(swRegistration);
    }
  }, [swRegistration]);

  // 측정 시작 시 Wake Lock 요청, 정지 시 해제
  const handleToggleStart = async () => {
    if (isAudioRunning) {
      stop();
      await releaseLock();
    } else {
      await start();
      await requestLock();
    }
  };

  const handleOpenSettings = () => {
    setIsPinModalOpen(true);
  };

  const handlePinAuthenticated = () => {
    setIsPinModalOpen(false);
    setIsSettingsModalOpen(true);
  };

  return (
    <div className="flex-1 flex flex-col justify-between bg-slate-950 text-slate-100 min-h-screen">
      {/* 최상단 알림 배너 영역 */}
      <div className="flex flex-col gap-2 p-3 sm:px-6 z-20">
        <BackgroundBanner isBackground={isBackground} />
        {showUpdateBanner && <UpdateBanner onUpdate={handleApplyUpdate} />}
        <ErrorBanner
          error={audioError}
          onDismiss={dismissError}
          onRetry={handleToggleStart}
        />
      </div>

      {/* 헤더 바 */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-slate-900 bg-slate-950/60 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-sky-400 flex items-center justify-center text-xl shadow-lg shadow-indigo-600/30">
            🤫
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              StudyCalm
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-800">
                Tablet MVP
              </span>
            </h1>
            <p className="text-xs text-slate-400">스터디카페 자동 소음 경고 시스템</p>
          </div>
        </div>

        {/* 우측 인디케이터 & 설정 버튼 */}
        <div className="flex items-center gap-3">
          {/* 화면 유지 상태 배지 */}
          <div
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
              isLocked
                ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isLocked ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span>{isLocked ? '화면 켜짐 유지 중' : '화면 절전 모드'}</span>
          </div>

          {/* 오늘 경고 횟수 카운터 */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold">
            <span className="text-slate-400">오늘 경고</span>
            <span className="px-1.5 py-0.5 rounded-md bg-rose-950 text-rose-300 border border-rose-800 font-mono font-bold">
              {dailyAlertCount}회
            </span>
          </div>

          {/* 관리자 설정 버튼 */}
          <button
            onClick={handleOpenSettings}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-xs font-bold text-slate-200 border border-slate-700 shadow transition"
          >
            <span>🔐</span>
            <span>설정</span>
          </button>
        </div>
      </header>

      {/* 메인 모니터링 영역 (태블릿 가로 중앙 정렬) */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-6 flex flex-col justify-center items-center gap-6">
        {/* 상태 배지 */}
        <StatusBadge
          state={snapshot.state}
          calibrationProgress={snapshot.calibrationProgress}
          cooldownRemainingMs={snapshot.cooldownRemainingMs}
        />

        {/* 대형 실시간 레벨 미터 */}
        <LevelMeter
          currentDb={snapshot.currentDb}
          smoothedDb={snapshot.smoothedDb}
          baselineDb={snapshot.baselineDb}
          thresholdDb={snapshot.thresholdDb}
          state={snapshot.state}
          exceedingProgress={snapshot.exceedingProgress}
        />

        {/* 하단 제어 컨트롤 버튼 */}
        <div className="flex flex-wrap items-center justify-center gap-4 w-full">
          {/* 메인 시작 / 정지 버튼 (터치 권한 획득 유도) */}
          <button
            onClick={handleToggleStart}
            className={`flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-black text-base tracking-wide shadow-xl transition-all transform active:scale-95 ${
              isAudioRunning
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/40 ring-4 ring-indigo-500/20'
            }`}
          >
            <span className="text-xl">{isAudioRunning ? '⏹' : '▶'}</span>
            <span>{isAudioRunning ? '측정 정지' : '소음 모니터링 시작'}</span>
          </button>

          {/* 배경소음 재보정 버튼 */}
          {isAudioRunning && (
            <button
              onClick={recalibrate}
              disabled={snapshot.state === 'CALIBRATING'}
              className="flex items-center gap-2 px-5 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 disabled:opacity-50 text-slate-200 font-bold text-sm border border-slate-700 shadow-lg transition"
            >
              <span>🔄</span>
              <span>배경소음 재보정</span>
            </button>
          )}
        </div>
      </main>

      {/* 모달 컴포넌트 */}
      <AdminPinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        onSuccess={handlePinAuthenticated}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        config={config}
        onSave={updateConfig}
        onRecalibrate={recalibrate}
      />

      {/* 하단 안심 문구 (고정) */}
      <FooterNotice />
    </div>
  );
};
export default App;
