import React, { useEffect, useRef, useState } from 'react';
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS, VOICE_BITRATE, pickRecorderMimeType } from '../core/remote/voiceClip';

interface VoiceRecorderProps {
  disabled: boolean;
  /** 대상 설명 (예: "1층 열람실" / "전체 3대") */
  targetLabel: string;
  /** 없으면 '지금 방송' 버튼을 숨김 (정시 안내 녹음 등록용) */
  onBroadcast?: (blob: Blob) => Promise<void>;
  onSaveAsAlert: (blob: Blob) => Promise<void>;
  title?: string;
  saveLabel?: string;
  confirmLabel?: string;
  confirmHint?: string;
  compact?: boolean;
}

type Phase = 'idle' | 'recording' | 'recorded' | 'sending';

/**
 * 리모컨 음성 녹음: 녹음 → 폰에서 미리듣기 → 즉시 방송 또는 경고음 등록
 */
export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  disabled,
  targetLabel,
  onBroadcast,
  onSaveAsAlert,
  title = '🎙 음성 녹음 방송',
  saveLabel = '🔔 경고음으로 등록',
  confirmLabel = '경고음 교체 확인',
  confirmHint,
  compact = false,
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipUrlRef = useRef<string | null>(null);

  const releaseMic = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const replaceClip = (next: { blob: Blob; url: string } | null) => {
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = next?.url ?? null;
    setClip(next);
  };

  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      releaseMic();
      if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    },
    []
  );

  const start = async () => {
    setError(null);
    setConfirmSave(false);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('이 브라우저는 녹음을 지원하지 않습니다. 최신 Safari/Chrome을 사용해주세요.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: VOICE_BITRATE,
      });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        releaseMic();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/mp4' });
        chunksRef.current = [];
        if (blob.size === 0) {
          setError('녹음된 소리가 없습니다. 다시 시도해주세요.');
          setPhase('idle');
          return;
        }
        if (blob.size > MAX_VOICE_BYTES) {
          setError('녹음 파일이 너무 큽니다. 조금 더 짧게 녹음해주세요.');
          setPhase('idle');
          return;
        }
        replaceClip({ blob, url: URL.createObjectURL(blob) });
        setPhase('recorded');
      };

      recorder.start();
      setPhase('recording');
      setElapsed(0);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const sec = (Date.now() - startedAt) / 1000;
        setElapsed(sec);
        if (sec >= MAX_VOICE_SECONDS && recorder.state === 'recording') recorder.stop();
      }, 200);
    } catch (err) {
      releaseMic();
      const name = (err as DOMException)?.name;
      setError(
        name === 'NotAllowedError'
          ? '마이크 권한이 거부되었습니다. 브라우저 설정에서 마이크를 허용해주세요.'
          : '녹음을 시작할 수 없습니다.'
      );
      setPhase('idle');
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const discard = () => {
    replaceClip(null);
    setConfirmSave(false);
    setPhase('idle');
  };

  const send = async (action: 'broadcast' | 'save') => {
    if (!clip) return;
    if (action === 'save' && !confirmSave) {
      setConfirmSave(true);
      return;
    }
    setPhase('sending');
    setError(null);
    try {
      if (action === 'broadcast') await onBroadcast?.(clip.blob);
      else await onSaveAsAlert(clip.blob);
      setConfirmSave(false);
      setPhase('recorded'); // 같은 녹음으로 재방송 가능하도록 유지
    } catch (err) {
      setError(err instanceof Error ? err.message : '전송에 실패했습니다.');
      setPhase('recorded');
    }
  };

  return (
    <div
      className={
        compact
          ? 'flex flex-col gap-2'
          : 'bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3'
      }
    >
      <div className="flex justify-between items-center">
        <span className="text-xs font-bold text-slate-200">{title}</span>
        <span className="text-[10px] text-slate-500">최대 {MAX_VOICE_SECONDS}초</span>
      </div>

      {phase === 'idle' && (
        <button
          onClick={start}
          disabled={disabled}
          className={`${compact ? 'py-2.5' : 'py-4'} rounded-xl bg-rose-700/80 hover:bg-rose-600 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition`}
        >
          <span className="w-3 h-3 rounded-full bg-white" />
          녹음 시작
        </button>
      )}

      {phase === 'recording' && (
        <button
          onClick={stop}
          className="py-4 rounded-xl bg-rose-600 text-white font-bold text-sm flex items-center justify-center gap-2"
        >
          <span className="w-3 h-3 rounded-sm bg-white animate-pulse" />
          녹음 중 {elapsed.toFixed(1)}초 — 눌러서 완료
        </button>
      )}

      {(phase === 'recorded' || phase === 'sending') && clip && (
        <div className="flex flex-col gap-2">
          <audio src={clip.url} controls playsInline className="w-full h-10" />
          <div className={`grid gap-2 ${onBroadcast ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {onBroadcast && (
              <button
                onClick={() => void send('broadcast')}
                disabled={disabled || phase === 'sending'}
                className="py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition"
              >
                {phase === 'sending' ? '전송 중...' : '📢 지금 방송'}
              </button>
            )}
            <button
              onClick={() => void send('save')}
              disabled={disabled || phase === 'sending'}
              className={`py-3 rounded-xl disabled:opacity-50 text-xs font-bold transition ${
                confirmSave ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 hover:bg-slate-700 text-amber-300'
              }`}
            >
              {phase === 'sending' && !onBroadcast ? '전송 중...' : confirmSave ? confirmLabel : saveLabel}
            </button>
          </div>
          {confirmSave && (
            <p className="text-[11px] text-amber-300">
              {confirmHint ?? `[${targetLabel}]의 자동 경고음이 이 녹음으로 바뀝니다. 한 번 더 누르면 등록됩니다.`}
            </p>
          )}
          <button onClick={discard} disabled={phase === 'sending'} className="text-[11px] text-slate-400 underline self-start">
            다시 녹음
          </button>
        </div>
      )}

      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
};
