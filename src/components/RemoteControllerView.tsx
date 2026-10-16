import React, { useState, useEffect, useRef } from 'react';
import { RemoteClient } from '../core/remote/RemoteClient';
import { TelemetryData } from '../core/remote/remoteTypes';

interface RemoteControllerViewProps {
  initialRoomId?: string;
}

export const RemoteControllerView: React.FC<RemoteControllerViewProps> = ({ initialRoomId }) => {
  const [roomId, setRoomId] = useState<string>(() => {
    if (initialRoomId) return initialRoomId;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('room') || '';
    }
    return '';
  });

  const [inputRoomId, setInputRoomId] = useState(roomId);
  const [isConnected, setIsConnected] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [customText, setCustomText] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const clientRef = useRef<RemoteClient | null>(null);

  // 토스트 알림 헬퍼
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  useEffect(() => {
    if (!roomId) return;

    const client = new RemoteClient(roomId, 'remote', (connected) => {
      setIsConnected(connected);
    });

    client.connect();
    clientRef.current = client;

    const unsubscribe = client.onMessage((msg) => {
      if (msg.type === 'TELEMETRY') {
        setTelemetry(msg.data);
      }
    });

    return () => {
      unsubscribe();
      client.disconnect();
    };
  }, [roomId]);

  // 원격 즉시 경고 방송 송출
  const handleSendAlert = () => {
    if (!clientRef.current) return;
    clientRef.current.sendMessage({ type: 'ALERT' });
    if (navigator.vibrate) {
      navigator.vibrate(200);
    }
    showToast('🚨 매장 태블릿으로 경고 방송 요청을 전송했습니다!');
  };

  // 맞춤 멘트 (TTS) 송출
  const handleSendTts = (text: string) => {
    if (!clientRef.current || !text.trim()) return;
    clientRef.current.sendMessage({
      type: 'TTS',
      text: text.trim(),
    });
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }
    showToast(`📢 안내 방송 전송: "${text}"`);
    setCustomText('');
  };

  // 배경소음 재보정 요청
  const handleSendRecalibrate = () => {
    if (!clientRef.current) return;
    clientRef.current.sendMessage({ type: 'RECALIBRATE' });
    showToast('🔄 배경소음 재보정 명령을 전송했습니다.');
  };

  // 룸 코드 입력 화면
  if (!roomId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-6">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📱</span>
            <h2 className="text-lg font-bold">원격 리모컨 룸 연결</h2>
          </div>
          <p className="text-xs text-slate-400">
            태블릿 화면의 [📱 원격 연결] 창에 표시된 룸 코드를 입력하거나, QR 코드를 직접 스캔해주세요.
          </p>

          <input
            type="text"
            placeholder="룸 코드 입력 (예: sc-a8f3b2)"
            value={inputRoomId}
            onChange={(e) => setInputRoomId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-center text-white focus:outline-none focus:border-indigo-500"
          />

          <button
            onClick={() => setRoomId(inputRoomId.trim())}
            disabled={!inputRoomId.trim()}
            className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-bold shadow-lg transition"
          >
            매장 태블릿 연결하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between max-w-md mx-auto p-4 select-none">
      {/* 상단 알림 토스트 */}
      {toastMessage && (
        <div className="fixed top-4 left-4 right-4 z-50 p-3 rounded-2xl bg-indigo-600 text-white text-xs font-bold text-center shadow-2xl animate-bounce">
          {toastMessage}
        </div>
      )}

      {/* 헤더 */}
      <header className="flex items-center justify-between pb-4 border-b border-slate-900">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">📱</span>
          <div>
            <h1 className="text-base font-extrabold tracking-tight">StudyCalm 원격 리모컨</h1>
            <span className="text-[11px] font-mono text-slate-400">룸: {roomId}</span>
          </div>
        </div>

        {/* 연결 배지 */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold ${
            isConnected
              ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
              : 'bg-rose-950/60 border-rose-800 text-rose-300 animate-pulse'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          <span>{isConnected ? '매장 연결됨' : '연결 중...'}</span>
        </div>
      </header>

      {/* 메인 컨트롤러 영역 */}
      <main className="flex-1 flex flex-col gap-4 py-4 overflow-y-auto">
        {/* 1. 실시간 매장 소음 현황 모니터링 카드 */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col gap-3">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-400">매장 실시간 소음</span>
            {telemetry && (
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold text-[10px]">
                {telemetry.state}
              </span>
            )}
          </div>

          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-mono font-extrabold text-white">
                {telemetry ? telemetry.smoothedDb.toFixed(1) : '-'}
              </span>
              <span className="text-sm font-bold text-slate-400">dBFS</span>
            </div>

            <div className="text-right">
              <span className="text-[11px] text-slate-400">오늘 경고</span>
              <div className="text-lg font-bold text-rose-400">
                {telemetry ? telemetry.dailyAlertCount : 0}회
              </div>
            </div>
          </div>
        </div>

        {/* 2. 원클릭 긴급 주의 방송 송출 버튼 */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleSendAlert}
            disabled={!isConnected}
            className="w-full py-5 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 active:scale-95 disabled:opacity-50 text-white font-black text-base shadow-xl shadow-rose-950/60 border border-rose-500/50 flex items-center justify-center gap-2.5 transition"
          >
            <span className="text-2xl animate-pulse">🚨</span>
            <span>즉시 주의 방송 송출</span>
          </button>
          <span className="text-[11px] text-slate-400 text-center">
            터치 시 매장 태블릿에서 즉시 등록된 경고 음성이 출력됩니다.
          </span>
        </div>

        {/* 3. 맞춤 안내 멘트(TTS) 전송 섹션 */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-base">📢</span>
            <span className="text-xs font-bold text-slate-200">원격 맞춤 멘트 방송 (TTS)</span>
          </div>

          {/* 빠른 프리셋 버튼 */}
          <div className="grid grid-cols-1 gap-2">
            {[
              '조용히 해주세요.',
              '이용자 여러분, 정숙해 주시기 바랍니다.',
              '대화나 잡담은 스터디존 밖에서 이용해 주세요.',
              '전화 통화는 라운지 또는 휴게실을 이용해 주세요.',
            ].map((phrase) => (
              <button
                key={phrase}
                onClick={() => handleSendTts(phrase)}
                disabled={!isConnected}
                className="py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 border border-slate-700/60 text-xs font-medium text-left text-slate-200 transition truncate"
              >
                "{phrase}"
              </button>
            ))}
          </div>

          {/* 직접 입력 멘트 */}
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              placeholder="직접 멘트 입력 (예: 5번 좌석 조용히 해주세요)"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendTts(customText);
              }}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => handleSendTts(customText)}
              disabled={!isConnected || !customText.trim()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-bold text-white transition shrink-0"
            >
              전송
            </button>
          </div>
        </div>

        {/* 4. 기타 원격 제어 */}
        <div className="flex justify-between items-center px-1">
          <button
            onClick={handleSendRecalibrate}
            disabled={!isConnected}
            className="text-xs text-slate-400 hover:text-slate-200 underline py-2"
          >
            🔄 매장 배경소음 재보정 요청
          </button>
          <a
            href="/"
            className="text-xs text-slate-400 hover:text-slate-200 py-2"
          >
            태블릿 메인 화면으로 이동
          </a>
        </div>
      </main>

      {/* 하단 고정 상태 푸터 */}
      <footer className="pt-3 border-t border-slate-900 text-center text-[10px] text-slate-400">
        StudyCalm 원격 클라우드 제어 시스템
      </footer>
    </div>
  );
};
