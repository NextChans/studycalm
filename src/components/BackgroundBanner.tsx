import React from 'react';

interface BackgroundBannerProps {
  isBackground: boolean;
}

export const BackgroundBanner: React.FC<BackgroundBannerProps> = ({ isBackground }) => {
  if (!isBackground) return null;

  return (
    <div className="w-full bg-amber-950/90 border border-amber-600 text-amber-200 rounded-xl p-3 shadow-lg flex items-center justify-between text-xs animate-pulse">
      <div className="flex items-center gap-2">
        <span className="text-lg">⏸️</span>
        <span>
          <strong>백그라운드 전환 감지:</strong> 브라우저 절전 정책으로 인해 소음 측정이 지연되거나 중단될 수 있습니다. 화면을 켜두세요.
        </span>
      </div>
    </div>
  );
};
