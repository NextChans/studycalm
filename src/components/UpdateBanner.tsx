import React from 'react';

interface UpdateBannerProps {
  onUpdate: () => void;
}

export const UpdateBanner: React.FC<UpdateBannerProps> = ({ onUpdate }) => {
  return (
    <div className="w-full bg-indigo-950/95 border border-indigo-600 text-indigo-100 rounded-xl p-3 shadow-xl flex items-center justify-between text-xs animate-bounce">
      <div className="flex items-center gap-2">
        <span className="text-base">🚀</span>
        <span>
          <strong>새로운 버전이 준비되었습니다:</strong> 업데이트를 적용하려면 새로고침하세요. (측정 중에는 원하실 때 클릭하세요)
        </span>
      </div>
      <button
        onClick={onUpdate}
        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition shrink-0"
      >
        지금 새로고침
      </button>
    </div>
  );
};
