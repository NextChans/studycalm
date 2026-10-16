import React, { useState } from 'react';
import { PinAuth } from '../core/storage/pinAuth';

interface AdminPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AdminPinModal: React.FC<AdminPinModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const isConfigured = PinAuth.isPinConfigured();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!/^\d{4}$/.test(pin)) {
      setErrorMessage('PIN 번호는 4자리 숫자여야 합니다.');
      return;
    }

    if (!isConfigured) {
      // 최초 설정
      if (pin !== confirmPin) {
        setErrorMessage('PIN 번호가 일치하지 않습니다. 다시 확인해주세요.');
        return;
      }
      try {
        await PinAuth.setInitialPin(pin);
        onSuccess();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'PIN 설정 중 오류가 발생했습니다.');
      }
    } else {
      // 기존 PIN 검증
      const isValid = await PinAuth.verifyPin(pin);
      if (isValid) {
        onSuccess();
      } else {
        setErrorMessage('PIN 번호가 일치하지 않습니다.');
        setPin('');
      }
    }
  };

  const handleKeypadPress = (digit: string) => {
    if (!isConfigured) {
      if (pin.length < 4) {
        setPin((prev) => prev + digit);
      } else if (confirmPin.length < 4) {
        setConfirmPin((prev) => prev + digit);
      }
    } else {
      if (pin.length < 4) {
        setPin((prev) => prev + digit);
      }
    }
  };

  const handleBackspace = () => {
    if (!isConfigured) {
      if (confirmPin.length > 0) {
        setConfirmPin((prev) => prev.slice(0, -1));
      } else if (pin.length > 0) {
        setPin((prev) => prev.slice(0, -1));
      }
    } else {
      setPin((prev) => prev.slice(0, -1));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔐</span>
            <h3 className="text-base font-bold">
              {isConfigured ? '관리자 PIN 인증' : '관리자 PIN 최초 설정'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-slate-400">
          {isConfigured
            ? '설정을 변경하려면 등록된 4자리 PIN을 입력하세요.'
            : '설정 화면 잠금을 위해 사용할 4자리 PIN을 최초 1회 등록합니다.'}
        </p>

        {errorMessage && (
          <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-300 text-xs text-center font-medium">
            {errorMessage}
          </div>
        )}

        {/* PIN 마스킹 표시 디스플레이 */}
        <div className="flex flex-col gap-2 items-center my-2">
          <div className="flex gap-3">
            {[0, 1, 2, 3].map((idx) => (
              <div
                key={idx}
                className={`w-11 h-12 rounded-xl border flex items-center justify-center text-xl font-bold transition-all ${
                  pin.length > idx
                    ? 'border-indigo-500 bg-indigo-950/60 text-indigo-300 shadow-md'
                    : 'border-slate-700 bg-slate-950/70 text-slate-600'
                }`}
              >
                {pin.length > idx ? '●' : ''}
              </div>
            ))}
          </div>

          {!isConfigured && (
            <div className="flex flex-col items-center gap-1 mt-2">
              <span className="text-[11px] text-slate-400">PIN 확인 재입력:</span>
              <div className="flex gap-3">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className={`w-11 h-12 rounded-xl border flex items-center justify-center text-xl font-bold transition-all ${
                      confirmPin.length > idx
                        ? 'border-indigo-500 bg-indigo-950/60 text-indigo-300 shadow-md'
                        : 'border-slate-700 bg-slate-950/70 text-slate-600'
                    }`}
                  >
                    {confirmPin.length > idx ? '●' : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 터치 친화적 숫자 키패드 (태블릿 최적화) */}
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleKeypadPress(digit)}
              className="h-12 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-lg font-semibold transition flex items-center justify-center"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setPin('');
              setConfirmPin('');
            }}
            className="h-12 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-xs font-medium text-slate-400 transition flex items-center justify-center"
          >
            초기화
          </button>
          <button
            type="button"
            onClick={() => handleKeypadPress('0')}
            className="h-12 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-lg font-semibold transition flex items-center justify-center"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            className="h-12 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-sm font-medium text-slate-300 transition flex items-center justify-center"
          >
            ←
          </button>
        </div>

        <button
          onClick={handleSubmit}
          className="w-full mt-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-sm tracking-wide shadow-lg transition"
        >
          {isConfigured ? '확인 및 설정 열기' : 'PIN 등록 완료'}
        </button>
      </div>
    </div>
  );
};
