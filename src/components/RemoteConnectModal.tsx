import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface RemoteConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  onRegenerateRoomId: () => void;
  isConnected: boolean;
}

export const RemoteConnectModal: React.FC<RemoteConnectModalProps> = ({
  isOpen,
  onClose,
  roomId,
  onRegenerateRoomId,
  isConnected,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const remoteUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/remote?room=${roomId}`
    : `https://studycalm-five.vercel.app/remote?room=${roomId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(remoteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-white">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📱</span>
            <h3 className="text-base font-bold">스마트폰 원격 리모컨 연결</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {/* 연결 상태 인디케이터 */}
        <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
          <span className="text-slate-400">실시간 통신 상태:</span>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-ping'
              }`}
            />
            <span className={isConnected ? 'text-emerald-300 font-semibold' : 'text-amber-300 font-medium'}>
              {isConnected ? '원격 수신 대기 중' : '클라우드 중계 연결 중...'}
            </span>
          </div>
        </div>

        {/* QR 코드 영역 */}
        <div className="flex flex-col items-center justify-center gap-3 p-4 bg-white rounded-2xl shadow-inner">
          <QRCodeSVG value={remoteUrl} size={180} level="M" />
          <span className="text-[11px] font-bold text-slate-800 tracking-wide">
            스마트폰 카메라로 스캔하세요
          </span>
        </div>

        {/* 룸 코드 및 주소 복사 */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center text-xs text-slate-400">
            <span>고유 룸 코드: <strong className="text-indigo-300 font-mono text-sm">{roomId}</strong></span>
            <button
              onClick={onRegenerateRoomId}
              className="text-[11px] text-slate-400 hover:text-slate-200 underline"
            >
              코드 재발급
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={remoteUrl}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 select-all focus:outline-none"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold transition shrink-0"
            >
              {copied ? '복사됨!' : '주소 복사'}
            </button>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed text-center">
          외출 중이나 외부에서도 스마트폰 브라우저로 위 주소에 접속하면 실시간 소음 확인 및 즉시 경고 음성을 송출할 수 있습니다.
        </p>
      </div>
    </div>
  );
};
