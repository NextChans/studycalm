import React from 'react';
import { AudioEngineError } from '../core/audio/AudioEngine';

interface ErrorBannerProps {
  error: AudioEngineError | null;
  onDismiss: () => void;
  onRetry: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ error, onDismiss, onRetry }) => {
  if (!error) return null;

  const getErrorContent = () => {
    switch (error.type) {
      case 'PERMISSION_DENIED':
        return {
          title: '마이크 권한 거부됨',
          guide:
            '브라우저 주소창 좌측의 설정/자물쇠 아이콘을 터치하여 마이크 권한을 [허용]으로 변경한 후 다시 시도해 주세요.',
        };
      case 'NO_DEVICE':
        return {
          title: '마이크 장치 없음',
          guide:
            '태블릿 또는 기기에 연결된 마이크를 인식할 수 없습니다. 내장 마이크 상태나 외장 마이크 연결을 확인해 주세요.',
        };
      case 'NOT_SECURE_CONTEXT':
        return {
          title: 'HTTPS 보안 연결 필요',
          guide:
            '브라우저 보안 정책상 마이크는 HTTPS 연결(또는 localhost)에서만 작동합니다. Vercel 배포 URL(https://)로 접속해 주세요.',
        };
      case 'MICROPHONE_LOST':
        return {
          title: '마이크 연결 끊김',
          guide:
            '마이크 오디오 트랙이 예기치 않게 종료되었습니다. 자동 재연결에 실패하였으므로 다시 시작 버튼을 눌러주세요.',
        };
      default:
        return {
          title: '오디오 초기화 오류',
          guide: error.message || '오디오 시스템 초기화 중 문제가 발생했습니다.',
        };
    }
  };

  const { title, guide } = getErrorContent();

  return (
    <div className="w-full bg-rose-950/90 border border-rose-700/80 rounded-xl p-4 shadow-xl flex items-start justify-between gap-4 text-rose-200">
      <div className="flex gap-3">
        <span className="text-2xl select-none">🚫</span>
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-bold text-white tracking-wide">{title}</h4>
          <p className="text-xs text-rose-200/90 leading-relaxed">{guide}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onRetry}
          className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow transition"
        >
          다시 시도
        </button>
        <button
          onClick={onDismiss}
          className="px-2.5 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-800 text-rose-300 text-xs font-medium transition"
        >
          닫기
        </button>
      </div>
    </div>
  );
};
