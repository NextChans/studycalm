import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { RemoteConnectModal } from './components/RemoteConnectModal';
import { RemoteControllerView } from './components/RemoteControllerView';
import { FooterNotice } from './components/FooterNotice';
import { registerServiceWorker, activateWaitingWorker } from './core/pwa/registerServiceWorker';
import { useTabletRemote } from './hooks/useTabletRemote';
import { SoundPlayer } from './core/alert/SoundPlayer';
import { useBattery } from './hooks/useBattery';
import { StealthOverlay } from './components/StealthOverlay';
import { describeRule } from './core/schedule/schedule';
import { STORAGE_KEYS } from './core/storage/storageKeys';

/** 측정 중 여부를 저장해 재시작·새로고침 후 자동 재개 (숨김 설치 대응) */
const setMonitoringDesired = (on: boolean) => {
  try {
    if (on) localStorage.setItem(STORAGE_KEYS.MONITORING_DESIRED, '1');
    else localStorage.removeItem(STORAGE_KEYS.MONITORING_DESIRED);
  } catch {
    // ignore
  }
};
const isMonitoringDesired = () => {
  try {
    return localStorage.getItem(STORAGE_KEYS.MONITORING_DESIRED) === '1';
  } catch {
    return false;
  }
};

const STEALTH_REVEAL_MS = 30_000;

export const App: React.FC = () => {
  // 모바일 원격 리모컨 라우트 감지 (/remote, #k=페어링키, 구버전 ?room= 링크)
  const [isRemoteRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const { pathname, search, hash } = window.location;
    const params = new URLSearchParams(search);
    return (
      pathname.startsWith('/remote') ||
      /(^#|&)k=/.test(hash) ||
      params.has('room') ||
      params.get('mode') === 'remote'
    );
  });

  const {
    config,
    updateConfig,
    snapshot,
    dailyAlertCount,
    audioError,
    isAudioRunning,
    customAudio,
    saveCustomAudio,
    deleteCustomAudio,
    start,
    stop,
    recalibrate,
    triggerManualAlert,
    speakTts,
    playRemoteVoice,
    previewAlert,
    stopPlayback,
    isOutputReady,
    isPlaybackActive,
    dismissError,
    unlockAudio,
    effectiveConfig,
    activeScheduleRule,
  } = useNoiseMonitor();
  const battery = useBattery();

  const { isLocked, requestLock, releaseLock } = useWakeLock();
  const { isBackground } = useVisibility();

  // PWA 업데이트 감지 상태
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState<boolean>(false);

  // 모달 상태 — 설정/원격 연결 모두 관리자 PIN 인증 후에만 진입
  // 측정 정지 / 재보정도 관리자 전용 (손님이 경고 시스템을 끄거나 시끄러운 상태로 기준을 재설정하는 것 방지)
  const [pinTarget, setPinTarget] = useState<'settings' | 'remote' | 'stop' | 'recalibrate' | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState<boolean>(false);

  // 최신 상태 ref (원격 텔레메트리 콜백에서 사용)
  const customAudioNameRef = useRef<string | null>(customAudio?.name ?? null);
  customAudioNameRef.current = customAudio?.name ?? null;

  const latestTelemetryRef = useRef({
    snapshot,
    dailyAlertCount,
    isAudioRunning,
    config,
    effectiveConfig,
    activeScheduleRule,
    battery,
  });
  useEffect(() => {
    latestTelemetryRef.current = {
      snapshot,
      dailyAlertCount,
      isAudioRunning,
      config,
      effectiveConfig,
      activeScheduleRule,
      battery,
    };
  }, [snapshot, dailyAlertCount, isAudioRunning, config, effectiveConfig, activeScheduleRule, battery]);

  // 숨김 모드: 터치하면 30초간 화면 표시 후 다시 검은 화면
  const [stealthRevealed, setStealthRevealed] = useState(false);
  useEffect(() => {
    if (!stealthRevealed) return;
    const t = setTimeout(() => setStealthRevealed(false), STEALTH_REVEAL_MS);
    return () => clearTimeout(t);
  }, [stealthRevealed]);
  const showStealth = !isRemoteRoute && config.stealthMode && !stealthRevealed && pinTarget === null;

  // PWA 서비스워커 등록
  useEffect(() => {
    registerServiceWorker({
      onUpdateAvailable: (registration) => {
        setSwRegistration(registration);
        setShowUpdateBanner(true);
      },
    });
  }, []);

  // 화면 어디든 첫 터치/클릭/키 입력 시 오디오 출력 잠금 해제
  // (측정을 시작하지 않은 상태에서도 원격 안내 방송이 나오도록, iOS/Android 자동재생 정책 대응)
  useEffect(() => {
    if (isRemoteRoute) return;
    const handler = () => unlockAudio();
    window.addEventListener('pointerdown', handler, { passive: true });
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    };
  }, [isRemoteRoute, unlockAudio]);

  // 재시작·새로고침 후 자동 재개: 이전에 측정 중이었다면 터치 없이 다시 측정 시작
  // (마이크 권한이 이미 허용된 경우. 소리 출력은 Android 홈 화면 앱은 바로 가능, iPad는 화면 터치 필요)
  const autoResumeTriedRef = useRef(false);
  useEffect(() => {
    if (isRemoteRoute || autoResumeTriedRef.current || !isMonitoringDesired()) return;
    autoResumeTriedRef.current = true;
    void (async () => {
      await start();
      await requestLock();
    })();
  }, [isRemoteRoute, start, requestLock]);

  // 태블릿 원격 수신 (다중 중계 + E2E 암호화)
  const remote = useTabletRemote(!isRemoteRoute, {
    getTelemetry: () => {
      const {
        snapshot: snap,
        dailyAlertCount: count,
        isAudioRunning: running,
        config: cfg,
        effectiveConfig: eff,
        activeScheduleRule: rule,
        battery: bat,
      } = latestTelemetryRef.current;
      return {
        currentDb: snap.currentDb,
        smoothedDb: snap.smoothedDb,
        baselineDb: snap.baselineDb,
        thresholdDb: snap.thresholdDb,
        state: snap.state,
        dailyAlertCount: count,
        isAudioRunning: running,
        isAudioUnlocked: isOutputReady(),
        isPlaying: isPlaybackActive(),
        customAlertName: customAudioNameRef.current,
        autoAlertMuted: cfg.autoAlertMuted,
        effectiveMuted: eff.autoAlertMuted,
        activeSchedule: rule ? describeRule(rule) : null,
        schedule: cfg.schedule,
        stealthMode: cfg.stealthMode,
        battery: bat,
        tuning: {
          baselineMode: cfg.baselineMode,
          manualBaselineDb: cfg.manualBaselineDb,
          thresholdMode: cfg.thresholdMode,
          absoluteThresholdDb: cfg.absoluteThresholdDb,
          thresholdOffsetDb: cfg.thresholdOffsetDb,
        },
      };
    },
    onAlert: triggerManualAlert,
    onTts: speakTts,
    onRecalibrate: recalibrate,
    onAdjust: updateConfig,
    onStop: stopPlayback,
    onVoice: playRemoteVoice,
    onSaveAlertSound: async (blob) => {
      // 이 태블릿에서 재생할 수 없는 형식(예: 구형 iPad의 webm)은 등록하지 않는다
      if (!(await SoundPlayer.canDecode(blob))) return false;
      const stamp = new Date().toLocaleString('ko-KR', { hour12: false });
      await saveCustomAudio(blob, `리모컨 녹음 (${stamp})`);
      return true;
    },
    onResetAlertSound: deleteCustomAudio,
    onSetMute: (muted) => updateConfig({ autoAlertMuted: muted }),
    onSetStealth: (enabled) => {
      updateConfig({ stealthMode: enabled });
      setStealthRevealed(false);
    },
    onSetSchedule: (rules) => updateConfig({ schedule: rules }),
  });

  const handleApplyUpdate = useCallback(() => {
    if (swRegistration) {
      activateWaitingWorker(swRegistration);
    }
  }, [swRegistration]);

  // 측정 시작 시 Wake Lock 요청, 정지 시 해제
  const handleToggleStart = async () => {
    if (isAudioRunning) {
      setPinTarget('stop');
    } else {
      setMonitoringDesired(true);
      await start();
      await requestLock();
    }
  };

  const handlePinAuthenticated = () => {
    if (pinTarget === 'settings') setIsSettingsModalOpen(true);
    if (pinTarget === 'remote') setIsRemoteModalOpen(true);
    if (pinTarget === 'stop') {
      setMonitoringDesired(false);
      stop();
      void releaseLock();
    }
    if (pinTarget === 'recalibrate') recalibrate();
    setPinTarget(null);
  };

  // 모바일 원격 리모컨 뷰 렌더링
  if (isRemoteRoute) {
    return <RemoteControllerView />;
  }

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
        {/* 원격 맞춤 멘트 방송 시 태블릿 화면 팝업 배너 */}
        {remote.broadcastText && (
          <div className="p-4 rounded-2xl bg-indigo-950/95 border-2 border-indigo-500 shadow-2xl shadow-indigo-900/50 flex items-center gap-4 animate-bounce">
            <span className="text-3xl">📢</span>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-indigo-300">매장 관리자 원격 안내 방송</span>
              <span className="text-xl font-black text-white">{remote.broadcastText}</span>
            </div>
          </div>
        )}
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

          {/* 스마트폰 원격 리모컨 연결 버튼 */}
          <button
            onClick={() => setPinTarget('remote')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-800 text-xs font-bold transition shadow"
          >
            <span>📱</span>
            <span className="hidden sm:inline">원격 리모컨</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                remote.isConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-ping'
              }`}
            />
            {remote.remoteCount > 0 && (
              <span className="text-[10px] text-emerald-300 font-mono">{remote.remoteCount}</span>
            )}
          </button>

          {/* 오늘 경고 횟수 카운터 */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold">
            <span className="text-slate-400">오늘 경고</span>
            <span className="px-1.5 py-0.5 rounded-md bg-rose-950 text-rose-300 border border-rose-800 font-mono font-bold">
              {dailyAlertCount}회
            </span>
          </div>

          {/* 관리자 설정 버튼 */}
          <button
            onClick={() => setPinTarget('settings')}
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
        {effectiveConfig.autoAlertMuted && (
          <div className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-slate-200 text-sm font-bold">
            🔇 자동 경고 음소거 중 · 측정만 진행합니다
          </div>
        )}
        {activeScheduleRule && (
          <div className="px-3 py-1.5 rounded-lg bg-sky-950/60 border border-sky-800 text-sky-200 text-xs font-semibold">
            🕒 스케줄 적용 중: {describeRule(activeScheduleRule)}
          </div>
        )}

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
        <div className="flex flex-col items-center justify-center gap-3 w-full">
          {!isAudioRunning && (
            <div className="w-full max-w-lg p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs text-center font-medium flex items-center justify-center gap-2">
              <span>💡</span>
              <span>
                화면을 터치하여 <strong>[소음 모니터링 시작]</strong>을 눌러주세요.<br />
                (브라우저 보안 정책상 화면 터치 후 마이크 측정 및 원격 음성 방송이 활성화됩니다.)
              </span>
            </div>
          )}

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
                onClick={() => setPinTarget('recalibrate')}
                disabled={snapshot.state === 'CALIBRATING' || config.baselineMode === 'manual'}
                className="flex items-center gap-2 px-5 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 disabled:opacity-50 text-slate-200 font-bold text-sm border border-slate-700 shadow-lg transition"
              >
                <span>🔄</span>
                <span>배경소음 재보정</span>
              </button>
            )}
          </div>
        </div>
      </main>

      {/* 모달 컴포넌트 */}
      <AdminPinModal
        isOpen={pinTarget !== null}
        onClose={() => setPinTarget(null)}
        onSuccess={handlePinAuthenticated}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        config={config}
        customAudio={customAudio}
        onSave={updateConfig}
        onRecalibrate={recalibrate}
        activeBaselineDb={snapshot.baselineDb}
        liveDb={isAudioRunning ? snapshot.smoothedDb : null}
        onSaveCustomAudio={saveCustomAudio}
        onDeleteCustomAudio={deleteCustomAudio}
        onPreview={previewAlert}
        onStopPreview={stopPlayback}
      />

      <RemoteConnectModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
        pairingKey={remote.pairingKey}
        tabletName={remote.tabletName}
        onRenameTablet={remote.setTabletName}
        fingerprint={remote.fingerprint}
        statuses={remote.statuses}
        remoteCount={remote.remoteCount}
        initError={remote.initError}
        onRotateKey={remote.rotateKey}
      />

      {showStealth && <StealthOverlay onReveal={() => setStealthRevealed(true)} />}

      {/* 하단 안심 문구 (고정) */}
      <FooterNotice />
    </div>
  );
};
export default App;
