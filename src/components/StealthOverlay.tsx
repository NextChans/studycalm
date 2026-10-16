import React from 'react';

interface StealthOverlayProps {
  onReveal: () => void;
}

/**
 * 숨김 설치용 검은 화면.
 * 웹앱은 화면이 꺼지면 측정·원격 연결이 멈추므로, 화면은 켜둔 채(Wake Lock) 검은 화면만 표시한다.
 * 화면을 터치하면 잠시 원래 화면이 보인다 (정지·설정 등은 여전히 관리자 PIN 필요).
 */
export const StealthOverlay: React.FC<StealthOverlayProps> = ({ onReveal }) => (
  <div
    role="button"
    aria-label="숨김 모드 - 터치하면 잠시 화면 표시"
    onClick={onReveal}
    className="fixed inset-0 z-[100] bg-black cursor-none select-none"
    style={{ touchAction: 'manipulation' }}
  />
);
