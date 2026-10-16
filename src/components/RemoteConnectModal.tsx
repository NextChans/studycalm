import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { TransportStatus } from '../core/remote/transports';
import { MAX_TABLET_NAME_LENGTH } from '../core/storage/pairingRepo';

interface RemoteConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  pairingKey: string;
  tabletName: string;
  onRenameTablet: (name: string) => void;
  fingerprint: string;
  statuses: TransportStatus[];
  remoteCount: number;
  initError: string | null;
  onRotateKey: () => void;
}

export const RemoteConnectModal: React.FC<RemoteConnectModalProps> = ({
  isOpen,
  onClose,
  pairingKey,
  tabletName,
  onRenameTablet,
  fingerprint,
  statuses,
  remoteCount,
  initError,
  onRotateKey,
}) => {
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [nameInput, setNameInput] = useState(tabletName);

  useEffect(() => {
    if (isOpen) setNameInput(tabletName);
  }, [isOpen, tabletName]);

  if (!isOpen) return null;

  const isConnected = statuses.some((s) => s.connected);
  const hasSupabase = statuses.some((s) => s.id === 'supabase');
  // 페어링 키는 URL fragment(#)로만 전달 → 서버 요청/로그에 포함되지 않음
  const remoteUrl = `${window.location.origin}/remote#k=${pairingKey}&n=${encodeURIComponent(tabletName)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(remoteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 권한이 없는 환경(구형 브라우저/비HTTPS)에서는 입력창을 길게 눌러 복사
    }
  };

  const handleRotate = () => {
    if (!confirmRotate) {
      setConfirmRotate(true);
      return;
    }
    onRotateKey();
    setConfirmRotate(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-white max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📱</span>
            <h3 className="text-base font-bold">스마트폰 원격 리모컨 연결</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg font-bold p-1">
            ✕
          </button>
        </div>

        {/* 태블릿 이름 (관리자 리모컨에서 여러 태블릿을 구분) */}
        <div className="flex flex-col gap-1.5 text-xs">
          <label className="text-slate-400">이 태블릿 이름</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={nameInput}
              maxLength={MAX_TABLET_NAME_LENGTH}
              placeholder="예: 1층 열람실"
              onChange={(e) => setNameInput(e.target.value)}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => onRenameTablet(nameInput)}
              disabled={nameInput.trim() === tabletName}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold transition shrink-0"
            >
              저장
            </button>
          </div>
        </div>

        {/* 연결 상태 */}
        <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">실시간 통신 상태</span>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-ping'
                }`}
              />
              <span className={isConnected ? 'text-emerald-300 font-semibold' : 'text-amber-300 font-medium'}>
                {isConnected ? `원격 수신 대기 중 · 리모컨 ${remoteCount}대 접속` : '클라우드 중계 연결 중...'}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-900">
            {statuses.map((s) => (
              <span
                key={s.id}
                className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${
                  s.connected
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                    : 'bg-slate-900 border-slate-700 text-slate-500'
                }`}
              >
                {s.connected ? '●' : '○'} {s.label}
              </span>
            ))}
          </div>
          {!hasSupabase && (
            <p className="text-[10px] text-amber-300/80 leading-relaxed">
              Supabase 중계가 설정되지 않았습니다. 매장 Wi-Fi가 8084/8884 포트를 막으면 연결되지 않을 수 있으니
              VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 환경변수 설정을 권장합니다.
            </p>
          )}
          {initError && <p className="text-[10px] text-rose-300">{initError}</p>}
        </div>

        {/* QR 코드 */}
        <div className="flex flex-col items-center justify-center gap-3 p-4 bg-white rounded-2xl shadow-inner">
          <QRCodeSVG value={remoteUrl} size={200} level="M" />
          <span className="text-[11px] font-bold text-slate-800 tracking-wide">
            관리자 스마트폰 카메라로 스캔하세요
          </span>
          {fingerprint && (
            <span className="text-[10px] font-mono text-slate-500">보안 확인 코드: {fingerprint}</span>
          )}
        </div>

        {/* 링크 복사 */}
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={remoteUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none"
          />
          <button
            onClick={handleCopy}
            className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold transition shrink-0"
          >
            {copied ? '복사됨!' : '링크 복사'}
          </button>
        </div>

        <div className="flex flex-col gap-2 p-3 rounded-xl bg-rose-950/30 border border-rose-900/60 text-[11px] text-rose-200/90 leading-relaxed">
          <span>
            🔒 이 QR/링크에는 매장 제어 권한(암호화 키)이 들어 있습니다. 손님에게 노출되지 않도록 주의하세요.
            분실·유출 시 아래 버튼으로 키를 재발급하면 기존에 연결된 모든 리모컨이 즉시 차단됩니다.
          </span>
          <button
            onClick={handleRotate}
            className={`self-end px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${
              confirmRotate ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-rose-300'
            }`}
          >
            {confirmRotate ? '정말 재발급할까요? (다시 누르면 실행)' : '페어링 키 재발급 (전체 리모컨 해제)'}
          </button>
        </div>
      </div>
    </div>
  );
};
