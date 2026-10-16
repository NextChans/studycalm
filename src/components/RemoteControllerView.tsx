import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { parsePairingLink } from '../core/remote/pairing';
import { MAX_TTS_TEXT_LENGTH, RemoteCommand, TabletEvent } from '../core/remote/remoteTypes';
import { PairingRepo, RemotePairing } from '../core/storage/pairingRepo';
import { NoiseTuning } from '../config/defaults';
import { TabletLinkState, useRemoteFleet } from '../hooks/useRemoteFleet';
import { TuningControls } from './TuningControls';

/** 이 시간 동안 태블릿 텔레메트리가 없으면 오프라인으로 판단 */
const TABLET_OFFLINE_AFTER_MS = 8_000;
/** 방송 완료 메시지가 유실되어도 버튼이 영구 비활성화되지 않도록 하는 상한 */
const BROADCAST_TIMEOUT_MS = 30_000;
const ADJUST_DEBOUNCE_MS = 400;
const ALL = '__all__';

const PRESET_PHRASES = [
  '조용히 해주세요.',
  '이용자 여러분, 정숙해 주시기 바랍니다.',
  '대화나 잡담은 스터디존 밖에서 이용해 주세요.',
  '전화 통화는 라운지 또는 휴게실을 이용해 주세요.',
];

const STATE_LABEL: Record<string, string> = {
  IDLE: '대기',
  CALIBRATING: '기준 측정 중',
  MONITORING: '감시 중',
  EXCEEDING: '소음 초과',
  ALERTING: '경고 중',
  COOLDOWN: '쿨다운',
};

/**
 * URL fragment(#k=...&n=...)의 페어링 정보를 저장하고 주소창에서 제거 (스크린샷/화면공유 유출 방지)
 */
function consumePairingFromUrl(): { pairings: RemotePairing[]; isLegacyLink: boolean; addedKey: string | null } {
  const parsed = parsePairingLink(window.location.hash);
  const isLegacyLink = new URLSearchParams(window.location.search).has('room');
  let pairings = PairingRepo.getRemotePairings();
  if (parsed) {
    pairings = PairingRepo.upsertRemotePairing(parsed.key, parsed.name);
  }
  if (parsed || isLegacyLink || window.location.hash) {
    // 정적 호스팅 라우팅에 의존하지 않도록 루트 경로 + 쿼리로 유지 (새로고침 시에도 리모컨 화면)
    window.history.replaceState(null, '', '/?mode=remote');
  }
  return { pairings, isLegacyLink: isLegacyLink && !parsed, addedKey: parsed?.key ?? null };
}

const isOnline = (link: TabletLinkState | undefined, now: number) =>
  !!link && link.statuses.some((s) => s.connected) && now - link.lastTelemetryAt < TABLET_OFFLINE_AFTER_MS;

export const RemoteControllerView: React.FC = () => {
  const [initial] = useState(consumePairingFromUrl);
  const [pairings, setPairings] = useState<RemotePairing[]>(initial.pairings);
  const [selected, setSelected] = useState<string>(() => initial.addedKey ?? initial.pairings[0]?.key ?? ALL);
  const [isAdding, setIsAdding] = useState(initial.pairings.length === 0);
  const [pasteInput, setPasteInput] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const [customText, setCustomText] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  /** tabletKey → 진행 중인 방송 requestId */
  const [pending, setPending] = useState<Record<string, string>>({});

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const clearPending = useCallback((key: string, requestId?: string) => {
    setPending((prev) => {
      if (!(key in prev) || (requestId && prev[key] !== requestId)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const timer = pendingTimersRef.current.get(key);
    if (timer && !requestId) {
      clearTimeout(timer);
      pendingTimersRef.current.delete(key);
    }
  }, []);

  useEffect(() => {
    const timers = pendingTimersRef.current;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  const nameOf = useCallback(
    (key: string, telemetryName?: string) => telemetryName || pairings.find((p) => p.key === key)?.name || '태블릿',
    [pairings]
  );

  const handleEvent = useCallback(
    (key: string, event: TabletEvent) => {
      if (event.type === 'TELEMETRY') {
        // 태블릿에서 이름을 바꾸면 로컬 저장 이름도 동기화
        const stored = pairings.find((p) => p.key === key);
        if (stored && event.data.tabletName && stored.name !== event.data.tabletName) {
          setPairings(PairingRepo.upsertRemotePairing(key, event.data.tabletName));
        }
        return;
      }
      const name = nameOf(key);
      if (event.status === 'PLAYING') {
        showToast(`📢 [${name}] 방송 중: "${event.text}"`);
        return;
      }
      clearPending(key, event.requestId);
      const messages = {
        DONE: `✅ [${name}] 방송 완료`,
        STOPPED: `⏹ [${name}] 방송 중지됨`,
        FAILED: `⚠️ [${name}] 방송 실패 — 이미 재생 중이거나 태블릿 소리 출력이 허용되지 않았습니다`,
      } as const;
      showToast(messages[event.status]);
    },
    [pairings, nameOf, showToast, clearPending]
  );

  const { links, send } = useRemoteFleet(pairings, handleEvent);

  const targetKeys = useMemo(
    () => (selected === ALL ? pairings.map((p) => p.key).filter((k) => isOnline(links[k], now)) : [selected]),
    [selected, pairings, links, now]
  );
  const selectedLink = selected === ALL ? undefined : links[selected];
  const selectedOnline = selected === ALL ? targetKeys.length > 0 : isOnline(selectedLink, now);
  const targetBusy = targetKeys.some((k) => pending[k] || links[k]?.telemetry?.isPlaying);
  const canBroadcast = selectedOnline && !targetKeys.some((k) => pending[k]);

  const sendToTargets = async (command: RemoteCommand, toast: string) => {
    if (targetKeys.length === 0) {
      showToast('⚠️ 응답하는 태블릿이 없습니다.');
      return;
    }
    let sent = 0;
    for (const key of targetKeys) {
      const id = await send(key, command);
      if (!id) continue;
      sent++;
      if (command.type === 'ALERT' || command.type === 'TTS') {
        setPending((prev) => ({ ...prev, [key]: id }));
        const old = pendingTimersRef.current.get(key);
        if (old) clearTimeout(old);
        pendingTimersRef.current.set(
          key,
          setTimeout(() => {
            pendingTimersRef.current.delete(key);
            clearPending(key, id);
          }, BROADCAST_TIMEOUT_MS)
        );
      }
      if (command.type === 'STOP') clearPending(key);
    }
    if (sent === 0) {
      showToast('⚠️ 중계 서버에 연결되어 있지 않습니다.');
      return;
    }
    navigator.vibrate?.(command.type === 'ALERT' ? 200 : 80);
    showToast(targetKeys.length > 1 ? `${toast} (${sent}대)` : toast);
  };

  const handleSendTts = (text: string) => {
    const trimmed = text.trim().slice(0, MAX_TTS_TEXT_LENGTH);
    if (!trimmed) return;
    void sendToTargets({ type: 'TTS', text: trimmed }, `📢 안내 방송 전송: "${trimmed}"`);
    setCustomText('');
  };

  const handleAdd = () => {
    const parsed = parsePairingLink(pasteInput);
    if (!parsed) {
      setPasteError('올바른 리모컨 링크가 아닙니다. 태블릿의 [원격 리모컨] 창에서 링크를 복사해주세요.');
      return;
    }
    setPairings(PairingRepo.upsertRemotePairing(parsed.key, parsed.name));
    setSelected(parsed.key);
    setPasteError(null);
    setPasteInput('');
    setIsAdding(false);
  };

  const handleRemove = (key: string) => {
    if (confirmRemove !== key) {
      setConfirmRemove(key);
      return;
    }
    const next = PairingRepo.removeRemotePairing(key);
    setPairings(next);
    clearPending(key);
    setConfirmRemove(null);
    if (selected === key) setSelected(next[0]?.key ?? ALL);
    if (next.length === 0) setIsAdding(true);
  };

  // ------------------------------------------------------------------ 태블릿 추가 화면
  if (isAdding) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-6">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📱</span>
            <h2 className="text-lg font-bold">태블릿 연결 추가</h2>
          </div>
          {initial.isLegacyLink && (
            <p className="text-xs p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
              보안 강화로 이전 QR 코드는 더 이상 사용할 수 없습니다. 태블릿에서 새 QR 코드를 다시 스캔해주세요.
            </p>
          )}
          <p className="text-xs text-slate-400 leading-relaxed">
            각 태블릿에서 <strong className="text-slate-200">[📱 원격 리모컨]</strong> → 관리자 PIN 입력 후 표시되는 QR
            코드를 스마트폰 카메라로 스캔하세요. 스캔할 때마다 이 리모컨에 태블릿이 추가됩니다. 복사한 링크를 아래에
            붙여넣어도 됩니다.
          </p>
          <input
            type="text"
            placeholder="리모컨 링크 붙여넣기"
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-base sm:text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
          />
          {pasteError && <p className="text-[11px] text-rose-300">{pasteError}</p>}
          <button
            onClick={handleAdd}
            disabled={!pasteInput.trim()}
            className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-bold shadow-lg transition"
          >
            태블릿 추가
          </button>
          {pairings.length > 0 && (
            <button onClick={() => setIsAdding(false)} className="text-xs text-slate-400 underline">
              돌아가기
            </button>
          )}
        </div>
      </div>
    );
  }

  const onlineCount = pairings.filter((p) => isOnline(links[p.key], now)).length;

  // ------------------------------------------------------------------ 대시보드
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-md mx-auto p-4 gap-4 select-none">
      {toastMessage && (
        <div className="fixed top-4 left-4 right-4 z-50 p-3 rounded-2xl bg-indigo-600 text-white text-xs font-bold text-center shadow-2xl">
          {toastMessage}
        </div>
      )}

      <header className="flex items-center justify-between pb-3 border-b border-slate-900">
        <div>
          <h1 className="text-base font-extrabold tracking-tight">StudyCalm 관리자 리모컨</h1>
          <span className="text-[11px] text-slate-400">
            태블릿 {pairings.length}대 · 응답 {onlineCount}대
          </span>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-indigo-300 transition"
        >
          + 태블릿 추가
        </button>
      </header>

      {/* 태블릿 목록 */}
      <section className="flex flex-col gap-2">
        {pairings.length > 1 && (
          <button
            onClick={() => setSelected(ALL)}
            className={`p-3 rounded-2xl border text-left text-xs font-bold transition ${
              selected === ALL ? 'bg-indigo-950/70 border-indigo-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-300'
            }`}
          >
            📣 전체 태블릿 동시 제어 (응답 중 {onlineCount}대)
          </button>
        )}
        {pairings.map((p) => {
          const link = links[p.key];
          const online = isOnline(link, now);
          const t = link?.telemetry;
          const relay = link?.statuses.some((s) => s.connected);
          return (
            <div
              key={p.key}
              onClick={() => setSelected(p.key)}
              className={`p-3 rounded-2xl border transition cursor-pointer ${
                selected === p.key ? 'bg-slate-900 border-indigo-500' : 'bg-slate-900/60 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${online ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                  <span className="text-sm font-bold truncate">{nameOf(p.key, t?.tabletName)}</span>
                  {online && t?.isPlaying && (
                    <span className="text-[10px] px-1.5 rounded bg-rose-900 text-rose-200 shrink-0">방송 중</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 shrink-0">
                  {online
                    ? t?.isAudioRunning
                      ? STATE_LABEL[t.state] ?? t.state
                      : '측정 정지'
                    : relay
                      ? '태블릿 응답 없음'
                      : '중계 연결 중...'}
                </span>
              </div>
              <div className="flex items-end justify-between mt-1.5">
                <span className="text-2xl font-mono font-extrabold">
                  {online && t?.isAudioRunning ? t.smoothedDb.toFixed(1) : '-'}
                  <span className="text-[11px] text-slate-500 ml-1">dB</span>
                </span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-rose-300">오늘 경고 {t?.dailyAlertCount ?? 0}회</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(p.key);
                    }}
                    className={`underline ${confirmRemove === p.key ? 'text-rose-400 font-bold' : 'text-slate-500'}`}
                  >
                    {confirmRemove === p.key ? '삭제 확인' : '삭제'}
                  </button>
                </div>
              </div>
              {online && t && !t.isAudioUnlocked && (
                <p className="mt-1.5 text-[10px] text-amber-300">
                  ⚠️ 태블릿 소리 출력 미허용 — 태블릿 화면을 한 번 터치해야 방송이 나옵니다.
                </p>
              )}
              {link?.error && <p className="mt-1.5 text-[10px] text-rose-300">{link.error}</p>}
              {link?.fingerprint && selected === p.key && (
                <p className="mt-1 text-[10px] font-mono text-slate-600">
                  확인 코드 {link.fingerprint} · {link.statuses.map((s) => `${s.connected ? '●' : '○'}${s.label}`).join(' ')}
                </p>
              )}
            </div>
          );
        })}
      </section>

      {/* 제어 패널 */}
      <section className="flex flex-col gap-3">
        <div className="text-[11px] text-slate-400 px-1">
          제어 대상:{' '}
          <strong className="text-slate-200">
            {selected === ALL ? `전체 (${targetKeys.length}대)` : nameOf(selected, selectedLink?.telemetry?.tabletName)}
          </strong>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            onClick={() => void sendToTargets({ type: 'ALERT' }, '🚨 경고 방송 요청을 전송했습니다!')}
            disabled={!canBroadcast}
            className="py-5 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 active:scale-95 disabled:opacity-50 text-white font-black text-base shadow-xl border border-rose-500/50 flex items-center justify-center gap-2 transition"
          >
            <span className="text-2xl">🚨</span>
            <span>즉시 주의 방송</span>
          </button>
          <button
            onClick={() => void sendToTargets({ type: 'STOP' }, '⏹ 방송 중지 명령을 전송했습니다.')}
            disabled={!selectedOnline || !targetBusy}
            className="px-5 rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40 border border-slate-600 text-white font-black text-sm flex flex-col items-center justify-center gap-0.5 transition"
          >
            <span className="text-xl">⏹</span>
            <span>중지</span>
          </button>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          <span className="text-xs font-bold text-slate-200">📢 맞춤 멘트 방송</span>
          <div className="grid grid-cols-1 gap-2">
            {PRESET_PHRASES.map((phrase) => (
              <button
                key={phrase}
                onClick={() => handleSendTts(phrase)}
                disabled={!canBroadcast}
                className="py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 disabled:opacity-50 border border-slate-700/60 text-xs text-left text-slate-200 transition truncate"
              >
                "{phrase}"
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="직접 멘트 입력"
              value={customText}
              maxLength={MAX_TTS_TEXT_LENGTH}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => {
                // 한글 IME 조합 중 Enter 무시 (마지막 글자 중복 전송 방지)
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && canBroadcast) handleSendTts(customText);
              }}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-base sm:text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => handleSendTts(customText)}
              disabled={!canBroadcast || !customText.trim()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-bold text-white transition shrink-0"
            >
              전송
            </button>
          </div>
        </div>

        {selected !== ALL && selectedOnline && selectedLink?.telemetry && (
          <RemoteTuningPanel
            key={selected}
            link={selectedLink}
            onSend={(tuning) => void send(selected, { type: 'ADJUST', tuning })}
            onRecalibrate={() => void sendToTargets({ type: 'RECALIBRATE' }, '🔄 배경소음 재측정 명령을 전송했습니다.')}
          />
        )}
      </section>

      <footer className="mt-auto pt-3 border-t border-slate-900 text-center text-[10px] text-slate-500">
        StudyCalm 원격 제어 · 종단간 암호화
      </footer>
    </div>
  );
};

/**
 * 선택한 태블릿의 기준/임계치 원격 조정 (슬라이더 조작 중 메시지 폭주 방지를 위해 디바운스)
 */
const RemoteTuningPanel: React.FC<{
  link: TabletLinkState;
  onSend: (tuning: Partial<NoiseTuning>) => void;
  onRecalibrate: () => void;
}> = ({ link, onSend, onRecalibrate }) => {
  const telemetry = link.telemetry!;
  const [draft, setDraft] = useState<NoiseTuning>(telemetry.tuning);
  const dirtyRef = useRef<Partial<NoiseTuning>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  // 조작 중이 아닐 때만 태블릿의 실제 값으로 동기화
  useEffect(() => {
    if (!timerRef.current) setDraft(telemetry.tuning);
  }, [telemetry.tuning]);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        onSendRef.current(dirtyRef.current);
      }
    },
    []
  );

  const handleChange = (patch: Partial<NoiseTuning>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    dirtyRef.current = { ...dirtyRef.current, ...patch };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onSendRef.current(dirtyRef.current);
      dirtyRef.current = {};
    }, ADJUST_DEBOUNCE_MS);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <span className="text-xs font-bold text-slate-200">🎚 기준 · 임계치 조정</span>
        <button
          onClick={onRecalibrate}
          disabled={draft.baselineMode === 'manual' || !telemetry.isAudioRunning}
          className="text-[11px] text-sky-300 underline disabled:opacity-40"
        >
          🔄 배경소음 재측정
        </button>
      </div>
      <TuningControls
        value={draft}
        onChange={handleChange}
        activeBaselineDb={telemetry.baselineDb}
        liveDb={telemetry.isAudioRunning ? telemetry.smoothedDb : null}
        compact
      />
      <p className="text-[10px] text-slate-500">변경 내용은 태블릿에 즉시 적용·저장됩니다.</p>
    </div>
  );
};
