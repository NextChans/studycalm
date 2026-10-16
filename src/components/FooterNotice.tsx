import React from 'react';

export const FooterNotice: React.FC = () => {
  return (
    <footer className="w-full py-3 px-4 flex items-center justify-center text-xs text-slate-500 font-medium select-none border-t border-slate-900 bg-slate-950/80">
      <div className="flex items-center gap-2">
        <span className="text-sm">🔒</span>
        <span>소음 측정만 하며, 오디오를 녹음·저장하지 않습니다. (안심 프라이버시 보호)</span>
      </div>
    </footer>
  );
};
