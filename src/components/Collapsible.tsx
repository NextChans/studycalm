import React, { useState } from 'react';

const STORAGE_KEY = 'studycalm_remote_sections_v1';

const readOpen = (): Record<string, boolean> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
};

interface CollapsibleProps {
  /** 열림 상태를 기억하기 위한 고유 id */
  id: string;
  title: string;
  /** 접혀 있을 때 오른쪽에 보여줄 현재 상태 요약 */
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * 리모컨 설정 그룹 (열고 닫기, 열림 상태는 이 폰에 기억)
 */
export const Collapsible: React.FC<CollapsibleProps> = ({ id, title, summary, defaultOpen = false, children }) => {
  const [open, setOpen] = useState<boolean>(() => readOpen()[id] ?? defaultOpen);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readOpen(), [id]: next }));
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex justify-between items-center gap-2 px-4 py-3 text-left hover:bg-slate-800/40 transition"
      >
        <span className="text-xs font-bold text-slate-200 shrink-0">{title}</span>
        <span className="flex items-center gap-2 min-w-0">
          {!open && summary && <span className="text-[11px] text-slate-400 truncate">{summary}</span>}
          <span className={`text-slate-500 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </span>
      </button>
      {open && <div className="px-4 pb-4 flex flex-col gap-3">{children}</div>}
    </div>
  );
};
