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
import { RoomRepo } from './core/storage/roomRepo';
import { RemoteClient, BrokerId } from './core/remote/RemoteClient';

export const App: React.FC = () => {
  // 모바일 원격 리모컨 라우트 감지 (/remote 또는 ?room= 또는 ?mode=remote)
  const isRemoteRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/remote') ||
      window.location.search.includes('room=') ||
      window.location.search.includes('mode=remote'));

  const {
    config,
    updateConfig,
    snapshot,
    dailyAlertCount,
    audioError,
    isAudioRunning,
    customAudio,
    customAudioUrl,
    saveCustomAudio,
    deleteCustomAudio,
    start,
    stop,
    recalibrate,
    triggerManualAlert,
    speakTts,
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
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState<boolean>(false);

  // 원격 통신 (태블릿 호스트)
  const [roomId, setRoomId] = useState<string>(() => RoomRepo.getOrCreateRoomId());
  const [isRemoteConnected, setIsRemoteConnected] = useState<boolean>(false);
  const [activeBroker, setActiveBroker] = useState<BrokerId>('emqx');
  const [remoteBroadcastText, setRemoteBroadcastText] = useState<string | null>(null);
  const remoteClientRef = useRef<RemoteClient | null>(null);

  // 최신 텔레메트리 데이터 ref (리렌더링 시 interval 취소 방지)
  const latestTelemetryRef = useRef({ snapshot, dailyAlertCount, isAudioRunning });
  useEffect(() => {
    latestTelemetryRef.current = { snapshot, dailyAlertCount, isAudioRunning };
  }, [snapshot, dailyAlertCount, isAudioRunning]);

  // PWA 서비스워커 등록
  useEffect(() => {
    registerServiceWorker({
      onUpdateAvailable: (registration) => {
        setSwRegistration(registration);
        setShowUpdateBanner(true);
      },
    });
  }, []);

  // 태블릿 원격 통신 수신 클라이언트 초기화
  useEffect(() => {
    if (isRemoteRoute) return;

    const client = new RemoteClient(
      roomId,
      'tablet',
      (connected, brokerId) => {
        setIsRemoteConnected(connected);
        if (brokerId) {
          setActiveBroker(brokerId);
        }
      },
      activeBroker
    );
    client.connect();
    remoteClientRef.current = client;

    const unsubscribe = client.onMessage(async (msg) => {
      if (msg.type === 'ALERT') {
        setRemoteBroadcastText('🚨 원격 긴급 경고 방송 송출!');
        // 원격 리모컨으로 방송 시작 상태 ACK 전송
        remoteClientRef.current?.sendMessage({
          type: 'BROADCAST_STATUS',
          status: 'PLAYING',
          text: '긴급 경고 방송',
        });

        try {
          await triggerManualAlert();
        } finally {
          // 원격 리모컨으로 방송 완료 상태 ACK 전송
          remoteClientRef.current?.sendMessage({
            type: 'BROADCAST_STATUS',
            status: 'DONE',
            text: '긴급 경고 방송',
          });
          setTimeout(() => setRemoteBroadcastText(null), 3000);
        }
      } else if (msg.type === 'TTS') {
        setRemoteBroadcastText(msg.text);
        // 원격 리모컨으로 방송 시작 상태 ACK 전송
        remoteClientRef.current?.sendMessage({
          type: 'BROADCAST_STATUS',
          status: 'PLAYING',
          text: msg.text,
        });

        try {
          await speakTts(msg.text);
        } finally {
          // 원격 리모컨으로 방송 완료 상태 ACK 전송
          remoteClientRef.current?.sendMessage({
            type: 'BROADCAST_STATUS',
            status: 'DONE',
            text: msg.text,
          });
          setTimeout(() => setRemoteBroadcastText(null), 3000);
        }
      } else if (msg.type === 'RECALIBRATE') {
        recalibrate();
      }
    });

    return () => {
      unsubscribe();
      client.disconnect();
    };
  }, [roomId, isRemoteRoute, triggerManualAlert, speakTts, recalibrate, activeBroker]);

  // 실시간 텔레메트리 (소음 수치, 카운터) 전송
  useEffect(() => {
    if (isRemoteRoute || !remoteClientRef.current || !isRemoteConnected) return;

    const sendTelemetry = () => {
      const { snapshot: snap, dailyAlertCount: count, isAudioRunning: running } = latestTelemetryRef.current;
      remoteClientRef.current?.sendMessage({
        type: 'TELEMETRY',
        data: {
          currentDb: snap.currentDb,
          smoothedDb: snap.smoothedDb,
          baselineDb: snap.baselineDb,
          thresholdDb: snap.thresholdDb,
          state: snap.state,
          dailyAlertCount: count,
          isAudioRunning: running,
        },
      });
    };

    // 연결 즉시 1회 전송 후 1초 주기로 전송
    sendTelemetry();
    const timer = setInterval(sendTelemetry, 1000);

    return () => clearInterval(timer);
  }, [isRemoteConnected, isRemoteRoute]);

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

  const handleRegenerateRoomId = () => {
    const newId = RoomRepo.regenerateRoomId();
    setRoomId(newId);
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
        {remoteBroadcastText && (
          <div className="p-4 rounded-2xl bg-indigo-950/95 border-2 border-indigo-500 shadow-2xl shadow-indigo-900/50 flex items-center gap-4 animate-bounce">
            <span className="text-3xl">📢</span>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-indigo-300">매장 관리자 원격 안내 방송</span>
              <span className="text-xl font-black text-white">{remoteBroadcastText}</span>
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
            onClick={() => setIsRemoteModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-800 text-xs font-bold transition shadow"
          >
            <span>📱</span>
            <span className="hidden sm:inline">원격 리모컨</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isRemoteConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-ping'
              }`}
            />
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
                onClick={recalibrate}
                disabled={snapshot.state === 'CALIBRATING'}
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
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        onSuccess={handlePinAuthenticated}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        config={config}
        customAudio={customAudio}
        customAudioUrl={customAudioUrl}
        onSave={updateConfig}
        onRecalibrate={recalibrate}
        onSaveCustomAudio={saveCustomAudio}
        onDeleteCustomAudio={deleteCustomAudio}
      />

      <RemoteConnectModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
        roomId={roomId}
        isConnected={isRemoteConnected}
        activeBroker={activeBroker}
        onToggleBroker={() => {
          const next: BrokerId = activeBroker === 'emqx' ? 'hivemq' : 'emqx';
          setActiveBroker(next);
          remoteClientRef.current?.setBroker(next);
        }}
        onRegenerateRoomId={handleRegenerateRoomId}
      />

      {/* 하단 안심 문구 (고정) */}
      <FooterNotice />
    </div>
  );
};
export default App;
