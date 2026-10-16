import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { parsePairingLink } from '../core/remote/pairing';
import { MAX_TTS_TEXT_LENGTH, RemoteCommand, TabletEvent } from '../core/remote/remoteTypes';
import { PairingRepo, RemotePairing } from '../core/storage/pairingRepo';
import {
  AlertVoiceMode,
  AlertVoiceSettings,
  DETECTION_RANGES,
  DetectionSettings,
  MAX_ALERT_PHRASES,
  NoiseTuning,
  sanitizeAlertVoice,
  sanitizeDetection,
} from '../config/defaults';
import { MAX_TABLET_NAME_LENGTH } from '../core/storage/pairingRepo';
import { TabletLinkState, useRemoteFleet } from '../hooks/useRemoteFleet';
import { TuningControls } from './TuningControls';
import { VoiceRecorder } from './VoiceRecorder';
import { STORAGE_KEYS } from '../core/storage/storageKeys';
import { ScheduleEditor } from './ScheduleEditor';
import { ScheduleRule, sanitizeSchedule } from '../core/schedule/schedule';
import { MAX_VOICE_BYTES, VOICE_CHUNK_INTERVAL_MS, VoiceMode, newClipId, splitVoiceClip } from '../core/remote/voiceClip';
import { Collapsible } from './Collapsible';
import { APP_VERSION } from '../hooks/useAppUpdate';

/** 이 시간 동안 태블릿 텔레메트리가 없으면 오프라인으로 판단 */
const TABLET_OFFLINE_AFTER_MS = 8_000;
/** 방송 완료 메시지가 유실되어도 버튼이 영구 비활성화되지 않도록 하는 상한 */
const BROADCAST_TIMEOUT_MS = 30_000;
const ADJUST_DEBOUNCE_MS = 400;
const ALL = '__all__';

const PRESETS_LIMIT = 6;

const loadPresets = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.REMOTE_PRESETS) ?? 'null') as unknown;
    if (Array.isArray(parsed)) {
      const list = parsed
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim().slice(0, MAX_TTS_TEXT_LENGTH))
        .filter(Boolean)
        .slice(0, PRESETS_LIMIT);
      if (list.length > 0) return list;
    }
  } catch {
    // ignore
  }
  return [...DEFAULT_PRESET_PHRASES];
};
const savePresets = (list: string[]) => {
  try {
    localStorage.setItem(STORAGE_KEYS.REMOTE_PRESETS, JSON.stringify(list));
  } catch {
    // ignore
  }
};

const DEFAULT_PRESET_PHRASES = [
  '조용히 해주세요.',
  '이용자 여러분, 정숙해 주시기 바랍니다.',
  '휴게실 소리가 스터디존까지 들립니다. 목소리를 조금만 낮춰주세요.',
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

/** 리모컨을 연 뒤 이 시간이 지나도록 한 번도 응답이 없으면 '응답 없음'으로 경고 */
const FIRST_CONTACT_GRACE_MS = 20_000;
const LOW_BATTERY_PERCENT = 20;

interface TabletIssue {
  id: string;
  text: string;
  severity: 'critical' | 'warning';
}

/**
 * 숨겨 설치한 태블릿은 화면을 볼 수 없으므로 원격에서 이상 상태를 판정해 알린다
 */
function tabletIssues(link: TabletLinkState | undefined, now: number, openedAt: number): TabletIssue[] {
  if (!link) return [];
  const relay = link.statuses.some((s) => s.connected);
  if (!relay) return [];
  const t = link.telemetry;
  const silentFor = now - link.lastTelemetryAt;
  if (link.lastTelemetryAt === 0 ? now - openedAt > FIRST_CONTACT_GRACE_MS : silentFor >= TABLET_OFFLINE_AFTER_MS) {
    return [{ id: 'offline', text: '응답 없음 (꺼짐·Wi-Fi 끊김·앱 종료 확인)', severity: 'critical' }];
  }
  if (!t) return [];
  const issues: TabletIssue[] = [];
  if (t.audioError) issues.push({ id: 'audio-error', text: `측정 오류: ${t.audioError}`, severity: 'critical' });
  else if (!t.isAudioRunning)
    issues.push({ id: 'stopped', text: '소음 측정이 멈춰 있음 (리모컨에서 시작 가능)', severity: 'critical' });
  if (!t.isAudioUnlocked)
    issues.push({ id: 'audio', text: '소리 출력 미허용 (태블릿 화면 한 번 터치 필요)', severity: 'warning' });
  if (!t.appVersion) {
    // 버전 정보를 보내지 않는 구버전 앱 — 새 설정(정시 안내 등)을 처리하지 못함
    issues.push({ id: 'outdated', text: '구버전 앱 실행 중 — 태블릿 페이지를 한 번 새로고침해주세요', severity: 'critical' });
  } else if (t.updateAvailable) {
    issues.push({
      id: 'update',
      text: '새 버전 대기 중 (새벽 3~5시 자동 적용 · 태블릿 관리에서 즉시 적용 가능)',
      severity: 'warning',
    });
  }
  if (t.battery && !t.battery.charging) {
    issues.push(
      t.battery.level <= LOW_BATTERY_PERCENT
        ? { id: 'battery-low', text: `배터리 부족 ${t.battery.level}% · 충전기 연결 필요`, severity: 'critical' }
        : { id: 'unplugged', text: `충전기 분리됨 (배터리 ${t.battery.level}%)`, severity: 'warning' }
    );
  }
  return issues;
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
  const [confirmStop, setConfirmStop] = useState(false);
  const [presets, setPresets] = useState<string[]>(loadPresets);
  const [editingPresets, setEditingPresets] = useState(false);
  const [presetDraft, setPresetDraft] = useState<string[]>([]);
  useEffect(() => {
    if (editingPresets) setPresetDraft(presets);
    // 편집을 시작할 때만 현재 프리셋을 복사
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPresets]);
  const finishPresetEdit = () => {
    const cleaned = presetDraft
      .map((p) => p.trim().slice(0, MAX_TTS_TEXT_LENGTH))
      .filter(Boolean)
      .slice(0, PRESETS_LIMIT);
    const next = cleaned.length > 0 ? cleaned : [...DEFAULT_PRESET_PHRASES];
    setPresets(next);
    savePresets(next);
    setEditingPresets(false);
  };

  const [now, setNow] = useState(() => Date.now());
  const [customText, setCustomText] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  /** tabletKey → 진행 중인 방송 requestId */
  const [pending, setPending] = useState<Record<string, string>>({});

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedAtRef = useRef(Date.now());
  const knownIssuesRef = useRef(new Set<string>());
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
      // 경고음 등록/복원 결과는 태블릿이 보낸 문구를 그대로 표시
      if (event.text.startsWith('경고음') || event.text.startsWith('안내 녹음')) {
        showToast(`${event.status === 'DONE' ? '✅' : '⚠️'} [${name}] ${event.text}`);
        return;
      }
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
  /** 대상이 모두 음소거 상태이면 버튼은 '해제', 하나라도 켜져 있으면 '음소거' */
  /** 대상 중 하나라도 측정 중이면 '정지' 버튼, 모두 정지 상태면 '시작' 버튼 */
  const targetsRunning = targetKeys.some((k) => links[k]?.telemetry?.isAudioRunning === true);
  const targetsStealth =
    targetKeys.length > 0 && targetKeys.every((k) => links[k]?.telemetry?.stealthMode === true);
  const targetsMuted =
    targetKeys.length > 0 && targetKeys.every((k) => links[k]?.telemetry?.autoAlertMuted === true);

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

  /**
   * 녹음 음성을 대상 태블릿들로 전송 (조각마다 암호화, 초당 전송 제한을 피하도록 간격을 둠)
   */
  const sendVoice = async (blob: Blob, mode: VoiceMode, slot?: string) => {
    if (targetKeys.length === 0) throw new Error('응답하는 태블릿이 없습니다.');
    const clipId = newClipId();
    const chunks = await splitVoiceClip(blob, mode, clipId, slot);
    let delivered = 0;
    for (const key of targetKeys) {
      let ok = true;
      for (const chunk of chunks) {
        if (!(await send(key, chunk))) {
          ok = false;
          break;
        }
        await new Promise((r) => setTimeout(r, VOICE_CHUNK_INTERVAL_MS));
      }
      if (!ok) continue;
      delivered++;
      if (mode === 'play') {
        setPending((prev) => ({ ...prev, [key]: clipId }));
        const old = pendingTimersRef.current.get(key);
        if (old) clearTimeout(old);
        pendingTimersRef.current.set(
          key,
          setTimeout(() => {
            pendingTimersRef.current.delete(key);
            clearPending(key, clipId);
          }, BROADCAST_TIMEOUT_MS)
        );
      }
    }
    if (delivered === 0) throw new Error('중계 서버에 연결되어 있지 않습니다.');
    navigator.vibrate?.(80);
    const suffix = targetKeys.length > 1 ? ` (${delivered}대)` : '';
    showToast(
      mode === 'play'
        ? `🎙 음성 방송을 전송했습니다${suffix}`
        : mode === 'announce'
          ? '📌 안내 녹음 등록 요청을 전송했습니다'
          : `🔔 경고음 등록 요청을 전송했습니다${suffix}`
    );
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

  const allIssues = pairings.flatMap((p) =>
    tabletIssues(links[p.key], now, openedAtRef.current).map((issue) => ({
      ...issue,
      key: `${p.key}:${issue.id}`,
      name: nameOf(p.key, links[p.key]?.telemetry?.tabletName),
    }))
  );
  const issueSignature = allIssues.map((i) => i.key).join('|');

  // 새로운 이상이 생기면 진동 + 토스트로 즉시 알림 (이미 알린 이상은 반복 알림하지 않음)
  useEffect(() => {
    const current = new Set(issueSignature ? issueSignature.split('|') : []);
    const fresh = [...current].filter((k) => !knownIssuesRef.current.has(k));
    knownIssuesRef.current = current;
    if (fresh.length > 0) {
      navigator.vibrate?.([200, 100, 200]);
      showToast('🚨 태블릿 확인이 필요합니다. 상단 알림을 확인하세요.');
    }
  }, [issueSignature, showToast]);

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

      {/* 태블릿 이상 알림 */}
      {allIssues.length > 0 && (
        <section className="flex flex-col gap-1.5 p-3 rounded-2xl bg-rose-950/60 border border-rose-700">
          <span className="text-xs font-black text-rose-200">🚨 태블릿 확인 필요 ({allIssues.length})</span>
          {allIssues.map((issue) => (
            <span
              key={issue.key}
              className={`text-[11px] ${issue.severity === 'critical' ? 'text-rose-100 font-semibold' : 'text-amber-200'}`}
            >
              • [{issue.name}] {issue.text}
            </span>
          ))}
        </section>
      )}

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
                  {online && t?.effectiveMuted && (
                    <span className="text-[10px] px-1.5 rounded bg-slate-700 text-slate-200 shrink-0">🔇 음소거</span>
                  )}
                  {online && t?.stealthMode && (
                    <span className="text-[10px] px-1.5 rounded bg-slate-800 text-slate-300 shrink-0">🌑 숨김</span>
                  )}
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
                  {online && t?.battery && (
                    <span className={t.battery.charging ? 'text-emerald-300' : 'text-amber-300'}>
                      {t.battery.charging ? '⚡' : '🔋'}
                      {t.battery.level}%
                    </span>
                  )}
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
              {online && t?.activeSchedule && (
                <p className="mt-1.5 text-[10px] text-sky-300">🕒 스케줄 적용 중: {t.activeSchedule}</p>
              )}
              {online && t?.nextAnnouncement && (
                <p className="mt-1 text-[10px] text-slate-400 truncate">📢 다음 안내: {t.nextAnnouncement}</p>
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

        <button
          onClick={() =>
            void sendToTargets(
              { type: 'SET_MUTE', muted: !targetsMuted },
              targetsMuted ? '🔔 자동 경고 음소거를 해제했습니다.' : '🔇 자동 경고를 음소거했습니다. (측정은 계속)'
            )
          }
          disabled={!selectedOnline}
          className={`py-3 rounded-2xl border text-sm font-bold transition disabled:opacity-40 ${
            targetsMuted
              ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
              : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
          }`}
        >
          {targetsMuted ? '🔔 자동 경고 음소거 해제' : '🔇 자동 경고 음소거 (측정만)'}
        </button>

        <button
          onClick={() => {
            if (targetsRunning && !confirmStop) {
              setConfirmStop(true);
              return;
            }
            setConfirmStop(false);
            void sendToTargets(
              targetsRunning ? { type: 'STOP_MONITORING' } : { type: 'START_MONITORING' },
              targetsRunning ? '⏹ 측정 정지를 요청했습니다.' : '▶ 측정 시작을 요청했습니다.'
            );
          }}
          disabled={!selectedOnline}
          className={`py-3 rounded-2xl border text-sm font-bold transition disabled:opacity-40 ${
            targetsRunning
              ? confirmStop
                ? 'bg-rose-600 border-rose-500 text-white'
                : 'bg-slate-900 border-slate-700 text-rose-300 hover:bg-slate-800'
              : 'bg-emerald-700 border-emerald-500 text-white hover:bg-emerald-600'
          }`}
        >
          {targetsRunning
            ? confirmStop
              ? '정말 측정을 정지할까요? (다시 누르면 정지)'
              : '⏹ 소음 측정 정지'
            : '▶ 소음 측정 시작'}
        </button>

        {selected === ALL && (
        <button
          onClick={() =>
            void sendToTargets(
              { type: 'SET_STEALTH', enabled: !targetsStealth },
              targetsStealth ? '☀️ 숨김 모드를 해제했습니다.' : '🌑 숨김 모드(검은 화면)를 켰습니다.'
            )
          }
          disabled={!selectedOnline}
          className="py-2.5 rounded-2xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-bold text-slate-300 transition disabled:opacity-40"
        >
          {targetsStealth ? '☀️ 숨김 모드 해제 (화면 표시)' : '🌑 숨김 모드 켜기 (검은 화면)'}
        </button>
        )}

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-200">📢 맞춤 멘트 방송</span>
            <button
              onClick={() => (editingPresets ? finishPresetEdit() : setEditingPresets(true))}
              className="text-[11px] text-indigo-300 underline"
            >
              {editingPresets ? '편집 완료' : '멘트 편집'}
            </button>
          </div>
          {editingPresets ? (
            <div className="flex flex-col gap-2">
              {presetDraft.map((phrase, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    type="text"
                    value={phrase}
                    maxLength={MAX_TTS_TEXT_LENGTH}
                    onChange={(e) => setPresetDraft((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                    className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => setPresetDraft((prev) => prev.filter((_, j) => j !== i))}
                    className="px-2.5 rounded-xl bg-slate-800 text-rose-300 text-xs"
                    aria-label="멘트 삭제"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex justify-between">
                {presetDraft.length < PRESETS_LIMIT ? (
                  <button
                    onClick={() => setPresetDraft((prev) => [...prev, ''])}
                    className="text-[11px] text-indigo-300 underline"
                  >
                    + 멘트 추가
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-500">최대 {PRESETS_LIMIT}개</span>
                )}
                <button
                  onClick={() => setPresetDraft([...DEFAULT_PRESET_PHRASES])}
                  className="text-[11px] text-slate-400 underline"
                >
                  기본값으로
                </button>
              </div>
              <p className="text-[10px] text-slate-500">프리셋은 이 폰에 저장됩니다.</p>
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-2">
            {presets.map((phrase) => (
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
          )}
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

        <Collapsible id="voice-recorder" title="🎙 음성 녹음 방송" summary="녹음해서 바로 방송 · 경고음 등록">
          <VoiceRecorder
            compact
            title=""
            disabled={!canBroadcast}
            targetLabel={selected === ALL ? `전체 ${targetKeys.length}대` : nameOf(selected, selectedLink?.telemetry?.tabletName)}
            onBroadcast={(blob) => sendVoice(blob, 'play')}
            onSaveAsAlert={(blob) => sendVoice(blob, 'save')}
          />
        </Collapsible>

        {/* ---------------- 태블릿 설정 (그룹별 열고 닫기) ---------------- */}
        {selected === ALL ? (
          <p className="px-1 text-[11px] text-slate-500">⚙️ 세부 설정은 위 목록에서 태블릿을 하나 선택하면 표시됩니다.</p>
        ) : selectedOnline && selectedLink?.telemetry ? (
          <div className="flex flex-col gap-2">
            <span className="px-1 pt-2 text-[11px] font-bold text-slate-400">
              ⚙️ {nameOf(selected, selectedLink.telemetry.tabletName)} 설정
            </span>

            {selectedLink.telemetry.alertVoice && (
              <Collapsible
                id="alert-voice"
                title="🔔 자동 경고 음성"
                summary={
                  selectedLink.telemetry.alertVoice.alertVoiceMode === 'sound'
                    ? selectedLink.telemetry.customAlertName ?? '기본 경고음'
                    : selectedLink.telemetry.alertVoice.alertVoiceMode === 'fixed'
                      ? `특정 멘트 · ${selectedLink.telemetry.alertVoice.alertFixedPhrase}`
                      : `랜덤 롤링 · ${selectedLink.telemetry.alertVoice.alertPhrases.length}개`
                }
              >
                <RemoteAlertVoicePanel
                  key={`alert-voice-${selected}`}
                  current={selectedLink.telemetry.alertVoice}
                  presets={presets}
                  onSave={(settings) =>
                    sendToTargets({ type: 'SET_ALERT_VOICE', settings }, '🔔 자동 경고 음성 설정을 저장했습니다.')
                  }
                  customAlertName={selectedLink.telemetry.customAlertName}
                  onResetAlertSound={() =>
                    void sendToTargets({ type: 'RESET_ALERT_SOUND' }, '↩️ 기본 경고음 복원을 요청했습니다.')
                  }
                  onUploadAlertFile={(file) => sendVoice(file, 'save')}
                />
              </Collapsible>
            )}

            <Collapsible
              id="tuning"
              title="🎚 기준 · 임계치"
              summary={
                selectedLink.telemetry.tuning.thresholdMode === 'absolute'
                  ? `임계치 ${selectedLink.telemetry.tuning.absoluteThresholdDb}dB`
                  : `기준 +${selectedLink.telemetry.tuning.thresholdOffsetDb}dB`
              }
            >
              <RemoteTuningPanel
                key={selected}
                link={selectedLink}
                onSend={(tuning) => void send(selected, { type: 'ADJUST', tuning })}
                onRecalibrate={() =>
                  void sendToTargets({ type: 'RECALIBRATE' }, '🔄 배경소음 재측정 명령을 전송했습니다.')
                }
              />
            </Collapsible>

            {selectedLink.telemetry.detection && (
              <Collapsible
                id="detection"
                title="⏱ 감지 · 재경고 · 볼륨"
                summary={`${(selectedLink.telemetry.detection.sustainMs / 1000).toFixed(1)}초 지속 · 쿨다운 ${Math.round(
                  selectedLink.telemetry.detection.cooldownMs / 1000
                )}초 · 볼륨 ${Math.round(selectedLink.telemetry.detection.volume * 100)}%`}
              >
                <RemoteDetectionPanel
                  key={`detection-${selected}`}
                  current={selectedLink.telemetry.detection}
                  onSave={(settings) =>
                    sendToTargets({ type: 'SET_DETECTION', settings }, '⏱ 감지 설정을 저장했습니다.')
                  }
                />
              </Collapsible>
            )}

            <Collapsible
              id="schedule"
              title="🕒 시간대별 운영 스케줄"
              summary={`${selectedLink.telemetry.schedule.length}개 규칙`}
            >
              <RemoteSchedulePanel
                key={`schedule-${selected}`}
                rules={selectedLink.telemetry.schedule}
                announceVoices={selectedLink.telemetry.announceVoices ?? []}
                onSave={(rules) => sendToTargets({ type: 'SET_SCHEDULE', rules }, '🕒 스케줄을 저장했습니다.')}
                onPlayAnnouncement={(ruleId) =>
                  void sendToTargets({ type: 'PLAY_ANNOUNCEMENT', ruleId }, '📢 안내 방송을 요청했습니다.')
                }
                onRecordAnnouncement={(ruleId, blob) => sendVoice(blob, 'announce', ruleId)}
              />
            </Collapsible>

            <Collapsible
              id="device"
              title="📟 태블릿 관리"
              summary={selectedLink.telemetry.stealthMode ? '🌑 숨김 모드' : '화면 표시'}
            >
              <RemoteDevicePanel
                key={`device-${selected}`}
                name={selectedLink.telemetry.tabletName}
                stealthMode={selectedLink.telemetry.stealthMode}
                appVersion={selectedLink.telemetry.appVersion}
                updateAvailable={!!selectedLink.telemetry.updateAvailable}
                onApplyUpdate={() =>
                  void sendToTargets({ type: 'APPLY_UPDATE' }, '🔄 태블릿에 업데이트 적용을 요청했습니다.')
                }
                onRename={(name) => sendToTargets({ type: 'SET_TABLET_NAME', name }, '📟 태블릿 이름을 변경했습니다.')}
                onToggleStealth={() =>
                  void sendToTargets(
                    { type: 'SET_STEALTH', enabled: !selectedLink.telemetry!.stealthMode },
                    selectedLink.telemetry!.stealthMode ? '☀️ 숨김 모드를 해제했습니다.' : '🌑 숨김 모드(검은 화면)를 켰습니다.'
                  )
                }
              />
            </Collapsible>
          </div>
        ) : null}
      </section>

      <footer className="mt-auto pt-3 border-t border-slate-900 text-center text-[10px] text-slate-500">
        StudyCalm 원격 제어 · 종단간 암호화
      </footer>
    </div>
  );
};

const ALERT_VOICE_MODES: { mode: AlertVoiceMode; label: string; desc: string }[] = [
  { mode: 'sound', label: '🔔 기본 경고음', desc: '경고음 파일(또는 등록한 녹음)을 재생합니다.' },
  { mode: 'fixed', label: '📌 특정 멘트', desc: '선택한 멘트 하나만 "딩동 → 음성"으로 재생합니다.' },
  { mode: 'random', label: '🔀 랜덤 롤링', desc: '선택한 멘트 중 무작위로 재생합니다 (같은 멘트 연속 방지).' },
];

/**
 * 선택한 태블릿의 자동 경고 음성 설정 (기본 경고음 / 특정 멘트 고정 / 멘트 랜덤 롤링)
 */
const RemoteAlertVoicePanel: React.FC<{
  current: AlertVoiceSettings;
  presets: string[];
  onSave: (settings: AlertVoiceSettings) => Promise<void>;
  customAlertName: string | null;
  onResetAlertSound: () => void;
  onUploadAlertFile: (file: File) => Promise<void>;
}> = ({ current, presets, onSave, customAlertName, onResetAlertSound, onUploadAlertFile }) => {
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<AlertVoiceSettings>(current);
  const [dirty, setDirty] = useState(false);
  const [customInput, setCustomInput] = useState('');

  useEffect(() => {
    if (!dirty) setDraft(current);
  }, [current, dirty]);

  const patch = (p: Partial<AlertVoiceSettings>) => {
    setDraft((prev) => ({ ...prev, ...p }));
    setDirty(true);
  };

  // 선택지: 리모컨 프리셋 + 태블릿에 이미 저장된 멘트 (중복 제거)
  const options = [...new Set([...presets, ...current.alertPhrases, current.alertFixedPhrase].filter(Boolean))];
  const togglePhrase = (text: string) => {
    const has = draft.alertPhrases.includes(text);
    if (!has && draft.alertPhrases.length >= MAX_ALERT_PHRASES) return;
    patch({ alertPhrases: has ? draft.alertPhrases.filter((p) => p !== text) : [...draft.alertPhrases, text] });
  };
  const addCustom = () => {
    const text = customInput.trim();
    if (!text) return;
    if (draft.alertVoiceMode === 'fixed') patch({ alertFixedPhrase: text });
    else if (!draft.alertPhrases.includes(text) && draft.alertPhrases.length < MAX_ALERT_PHRASES)
      patch({ alertPhrases: [...draft.alertPhrases, text] });
    setCustomInput('');
  };
  const invalid = draft.alertVoiceMode === 'random' && draft.alertPhrases.length === 0;

  return (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            {ALERT_VOICE_MODES.map((m) => (
              <button
                key={m.mode}
                onClick={() => patch({ alertVoiceMode: m.mode })}
                className={`py-2 rounded-lg text-[11px] font-bold transition ${
                  draft.alertVoiceMode === m.mode ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">{ALERT_VOICE_MODES.find((m) => m.mode === draft.alertVoiceMode)?.desc}</p>

          {draft.alertVoiceMode !== 'sound' && (
            <div className="flex flex-col gap-1.5">
              {options.map((text) => {
                const checked =
                  draft.alertVoiceMode === 'fixed' ? draft.alertFixedPhrase === text : draft.alertPhrases.includes(text);
                return (
                  <label
                    key={text}
                    className={`flex items-start gap-2 p-2 rounded-lg border text-xs cursor-pointer ${
                      checked ? 'border-indigo-500 bg-indigo-950/40 text-white' : 'border-slate-800 text-slate-300'
                    }`}
                  >
                    <input
                      type={draft.alertVoiceMode === 'fixed' ? 'radio' : 'checkbox'}
                      name="alert-fixed"
                      checked={checked}
                      onChange={() =>
                        draft.alertVoiceMode === 'fixed' ? patch({ alertFixedPhrase: text }) : togglePhrase(text)
                      }
                      className="mt-0.5 accent-indigo-500"
                    />
                    <span>{text}</span>
                  </label>
                );
              })}
              {draft.alertVoiceMode === 'fixed' && !options.includes(draft.alertFixedPhrase) && draft.alertFixedPhrase && (
                <p className="text-[11px] text-indigo-300">선택: "{draft.alertFixedPhrase}"</p>
              )}
              {draft.alertVoiceMode === 'random' &&
                draft.alertPhrases
                  .filter((p) => !options.includes(p))
                  .map((p) => (
                    <p key={p} className="text-[11px] text-indigo-300">
                      ✔ "{p}"{' '}
                      <button onClick={() => togglePhrase(p)} className="underline text-rose-300">
                        빼기
                      </button>
                    </p>
                  ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customInput}
                  maxLength={MAX_TTS_TEXT_LENGTH}
                  placeholder="직접 입력해 추가"
                  onChange={(e) => setCustomInput(e.target.value)}
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500"
                />
                <button onClick={addCustom} className="px-3 rounded-xl bg-slate-800 text-xs text-indigo-300 shrink-0">
                  {draft.alertVoiceMode === 'fixed' ? '선택' : '추가'}
                </button>
              </div>
              {draft.alertVoiceMode === 'random' && (
                <p className="text-[10px] text-slate-500">
                  {draft.alertPhrases.length}/{MAX_ALERT_PHRASES}개 선택
                  {invalid && ' — 1개 이상 선택해주세요'}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void onSave(sanitizeAlertVoice(draft)).then(() => setDirty(false))}
              disabled={!dirty || invalid}
              className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-bold text-white"
            >
              저장
            </button>
            {dirty && (
              <button
                onClick={() => {
                  setDraft(current);
                  setDirty(false);
                }}
                className="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
              >
                취소
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-500">저장 후 위의 "즉시 주의 방송"으로 실제 소리를 확인할 수 있습니다.</p>

          {/* 기본 경고음 모드에서 쓰는 음원 */}
          <div className="flex flex-col gap-2 pt-3 border-t border-slate-800">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>
                경고음 음원: <strong className="text-slate-200">{customAlertName ?? '기본 경고음'}</strong>
              </span>
              {customAlertName && (
                <button onClick={onResetAlertSound} className="underline text-sky-300">
                  기본으로 복원
                </button>
              )}
            </div>
            <label className="self-start px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-indigo-300 cursor-pointer">
              📁 음원 파일로 등록
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  if (file.size > MAX_VOICE_BYTES) {
                    setUploadMsg(`파일이 너무 큽니다 (${Math.round(file.size / 1024)}KB). ${Math.round(MAX_VOICE_BYTES / 1024)}KB 이하 음원을 사용해주세요.`);
                    return;
                  }
                  setUploadMsg('전송 중...');
                  onUploadAlertFile(file)
                    .then(() => setUploadMsg(null))
                    .catch((err) => setUploadMsg(err instanceof Error ? err.message : '전송 실패'));
                }}
              />
            </label>
            <p className="text-[10px] text-slate-500">
              녹음으로 등록하려면 위 "🎙 음성 녹음 방송"에서 녹음 후 "경고음으로 등록"을 누르세요. 파일은{' '}
              {Math.round(MAX_VOICE_BYTES / 1024)}KB 이하(약 15~20초 mp3/m4a).
            </p>
            {uploadMsg && <p className="text-[11px] text-amber-300">{uploadMsg}</p>}
          </div>
        </>
  );
};

const DETECTION_FIELDS: {
  key: keyof DetectionSettings;
  label: string;
  hint: string;
  format: (v: number) => string;
}[] = [
  {
    key: 'sustainMs',
    label: '초과 지속 시간',
    hint: '이 시간 이상 계속 시끄러울 때만 경고 (순간 소음 무시)',
    format: (v) => `${(v / 1000).toFixed(1)}초`,
  },
  {
    key: 'cooldownMs',
    label: '재경고 쿨다운',
    hint: '경고 후 이 시간 동안은 다시 경고하지 않음',
    format: (v) => `${Math.round(v / 1000)}초`,
  },
  { key: 'volume', label: '안내 음성 볼륨', hint: '경고음·방송 전체 볼륨', format: (v) => `${Math.round(v * 100)}%` },
  {
    key: 'postPlaybackMuteMs',
    label: '재생 후 판정 무시',
    hint: '경고음이 마이크에 다시 잡혀 연속 경고되는 것을 방지',
    format: (v) => `${(v / 1000).toFixed(1)}초`,
  },
  {
    key: 'emaAlpha',
    label: '스무딩 계수',
    hint: '낮을수록 소음 수치가 부드럽게(느리게) 변함',
    format: (v) => v.toFixed(2),
  },
];

/**
 * 감지·재경고·볼륨 세부 설정 (태블릿 설정 화면과 동일 범위, 저장 버튼으로 전송)
 */
const RemoteDetectionPanel: React.FC<{
  current: DetectionSettings;
  onSave: (settings: Partial<DetectionSettings>) => Promise<void>;
}> = ({ current, onSave }) => {
  const [draft, setDraft] = useState<DetectionSettings>(current);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(current);
  }, [current, dirty]);

  return (
    <>
      {DETECTION_FIELDS.map((f) => {
        const range = DETECTION_RANGES[f.key];
        return (
          <div key={f.key} className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-200">{f.label}</span>
              <span className="font-mono text-indigo-300">{f.format(draft[f.key])}</span>
            </div>
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={range.step}
              value={draft[f.key]}
              onChange={(e) => {
                setDraft((prev) => ({ ...prev, [f.key]: Number(e.target.value) }));
                setDirty(true);
              }}
              className="accent-indigo-400 cursor-pointer"
            />
            <span className="text-[10px] text-slate-500">{f.hint}</span>
          </div>
        );
      })}
      <div className="flex gap-2">
        <button
          onClick={() => void onSave(sanitizeDetection(draft)).then(() => setDirty(false))}
          disabled={!dirty}
          className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-bold text-white"
        >
          저장
        </button>
        {dirty && (
          <button
            onClick={() => {
              setDraft(current);
              setDirty(false);
            }}
            className="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
          >
            취소
          </button>
        )}
      </div>
    </>
  );
};

/**
 * 태블릿 이름 변경 · 숨김 모드 (관리자 PIN·페어링 키 재발급은 보안상 태블릿에서만)
 */
const RemoteDevicePanel: React.FC<{
  name: string;
  stealthMode: boolean;
  appVersion?: string;
  updateAvailable: boolean;
  onRename: (name: string) => Promise<void>;
  onToggleStealth: () => void;
  onApplyUpdate: () => void;
}> = ({ name, stealthMode, appVersion, updateAvailable, onRename, onToggleStealth, onApplyUpdate }) => {
  const [nameInput, setNameInput] = useState(name);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setNameInput(name);
  }, [name, editing]);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-slate-200">태블릿 이름</span>
        <div className="flex gap-2">
          <input
            type="text"
            value={nameInput}
            maxLength={MAX_TABLET_NAME_LENGTH}
            onFocus={() => setEditing(true)}
            onChange={(e) => setNameInput(e.target.value)}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() =>
              void onRename(nameInput.trim()).then(() => setEditing(false))
            }
            disabled={!nameInput.trim() || nameInput.trim() === name}
            className="px-3 rounded-xl bg-slate-800 disabled:opacity-40 text-xs font-bold text-indigo-300 shrink-0"
          >
            변경
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-slate-200">🌑 숨김 모드 (검은 화면)</span>
          <span className="text-[10px] text-slate-500">화면은 켜둔 채 검은 화면만 표시 (터치 시 30초 표시)</span>
        </div>
        <button
          onClick={onToggleStealth}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 ${
            stealthMode ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          {stealthMode ? '켜짐' : '꺼짐'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-slate-200">앱 버전</span>
          <span className={`text-[10px] font-mono ${updateAvailable || !appVersion ? 'text-amber-300' : 'text-slate-500'}`}>
            태블릿 {appVersion ?? '구버전'} · 리모컨 {APP_VERSION}
            {updateAvailable ? ' · 새 버전 있음' : ''}
          </span>
        </div>
        <button
          onClick={onApplyUpdate}
          disabled={!appVersion || (!updateAvailable && appVersion === APP_VERSION)}
          className="px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 bg-slate-800 text-indigo-300 disabled:opacity-40"
        >
          🔄 지금 업데이트
        </button>
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        새 버전은 새벽 3~5시에 자동 적용됩니다. 지금 적용하면 태블릿이 새로고침되고 측정은 자동으로 다시 시작됩니다
        (iPad는 새로고침 후 화면을 한 번 터치해야 소리가 납니다).
      </p>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        🔒 관리자 PIN 변경과 페어링 키 재발급은 보안을 위해 태블릿 화면에서만 할 수 있습니다.
      </p>
    </>
  );
};

/**
 * 선택한 태블릿의 시간대별 스케줄 원격 편집 (저장 버튼을 눌러야 전송)
 */
const RemoteSchedulePanel: React.FC<{
  rules: ScheduleRule[];
  announceVoices: string[];
  onSave: (rules: ScheduleRule[]) => Promise<void>;
  onPlayAnnouncement: (ruleId: string) => void;
  onRecordAnnouncement: (ruleId: string, blob: Blob) => Promise<void>;
}> = ({ rules, announceVoices, onSave, onPlayAnnouncement, onRecordAnnouncement }) => {
  const [recordingFor, setRecordingFor] = useState<string | null>(null);

  // 태블릿에 저장된 규칙만 녹음 등록·미리 듣기 가능 (녹음은 규칙 id에 연결되므로)
  const renderAnnounceExtras = (rule: ScheduleRule) => {
    const saved = !dirty && rules.some((r) => r.id === rule.id);
    if (!saved) {
      return <p className="text-[10px] text-slate-500">스케줄을 저장하면 녹음 등록과 미리 듣기를 할 수 있습니다.</p>;
    }
    const hasVoice = announceVoices.includes(rule.id);
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={hasVoice ? 'text-emerald-300' : 'text-slate-500'}>
            {hasVoice ? '🎙 녹음 등록됨' : '녹음 없음'}
          </span>
          <button onClick={() => onPlayAnnouncement(rule.id)} className="px-2 py-1 rounded-lg bg-slate-800 text-indigo-300">
            ▶ 지금 한 번 방송
          </button>
          <button
            onClick={() => setRecordingFor((cur) => (cur === rule.id ? null : rule.id))}
            className="px-2 py-1 rounded-lg bg-slate-800 text-rose-300"
          >
            {recordingFor === rule.id ? '녹음 닫기' : hasVoice ? '🎙 다시 녹음' : '🎙 녹음하기'}
          </button>
        </div>
        {recordingFor === rule.id && (
          <VoiceRecorder
            compact
            disabled={false}
            targetLabel={rule.start}
            title={`🎙 ${rule.start} 안내 녹음`}
            saveLabel="📌 이 안내에 녹음 등록"
            confirmLabel="등록 확인"
            confirmHint="이 안내 방송에 녹음이 등록됩니다. '녹음한 음성으로 방송'이 켜져 있어야 녹음으로 나갑니다. 한 번 더 누르면 등록됩니다."
            onSaveAsAlert={async (blob) => {
              await onRecordAnnouncement(rule.id, blob);
              setRecordingFor(null);
            }}
          />
        )}
      </div>
    );
  };
  const [draft, setDraft] = useState<ScheduleRule[]>(rules);
  const [dirty, setDirty] = useState(false);

  // 편집 중이 아닐 때만 태블릿의 실제 값으로 동기화
  useEffect(() => {
    if (!dirty) setDraft(rules);
  }, [rules, dirty]);

  return (
        <>
          <ScheduleEditor
            rules={draft}
            onChange={(next) => {
              setDraft(next);
              setDirty(true);
            }}
            renderAnnounceExtras={renderAnnounceExtras}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                void onSave(sanitizeSchedule(draft)).then(() => setDirty(false));
              }}
              disabled={!dirty}
              className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-bold text-white"
            >
              스케줄 저장
            </button>
            {dirty && (
              <button
                onClick={() => {
                  setDraft(rules);
                  setDirty(false);
                }}
                className="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
              >
                취소
              </button>
            )}
          </div>
        </>
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
    <>
      <div className="flex justify-end items-center">
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
    </>
  );
};
