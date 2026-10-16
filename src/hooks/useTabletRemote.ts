import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteClient } from '../core/remote/RemoteClient';
import { createPairingSession } from '../core/remote/pairing';
import { TelemetryData } from '../core/remote/remoteTypes';
import { NoiseTuning, sanitizeTuning } from '../config/defaults';
import { TransportStatus } from '../core/remote/transports';
import { PairingRepo } from '../core/storage/pairingRepo';
import { VoiceClipAssembler } from '../core/remote/voiceClip';

/** 리모컨 PING이 이 시간 안에 있었으면 "보고 있는 리모컨"으로 간주하고 텔레메트리 송신 */
const REMOTE_ACTIVE_WINDOW_MS = 15_000;
const TELEMETRY_INTERVAL_MS = 1_000;

export interface TabletRemoteHandlers {
  getTelemetry: () => Omit<TelemetryData, 'remoteCount' | 'tabletName'>;
  onAlert: () => Promise<boolean>;
  onTts: (text: string) => Promise<boolean>;
  onRecalibrate: () => void;
  onAdjust: (tuning: Partial<NoiseTuning>) => void;
  onStop: () => void;
  /** 리모컨 녹음 음성 즉시 방송 */
  onVoice: (blob: Blob) => Promise<boolean>;
  /** 리모컨 녹음 음성을 이 태블릿의 경고음으로 등록 (재생 불가 형식이면 false) */
  onSaveAlertSound: (blob: Blob) => Promise<boolean>;
  /** 커스텀 경고음 삭제 → 기본 경고음 복원 */
  onResetAlertSound: () => Promise<void>;
  onSetMute: (muted: boolean) => void;
}

export function useTabletRemote(enabled: boolean, handlers: TabletRemoteHandlers) {
  const [pairingKey, setPairingKey] = useState<string>(() => PairingRepo.getOrCreateTabletKey());
  const [tabletName, setTabletNameState] = useState<string>(() => PairingRepo.getTabletName());
  const tabletNameRef = useRef(tabletName);
  tabletNameRef.current = tabletName;
  const [fingerprint, setFingerprint] = useState<string>('');
  const [statuses, setStatuses] = useState<TransportStatus[]>([]);
  const [remoteCount, setRemoteCount] = useState(0);
  const [broadcastText, setBroadcastText] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let client: RemoteClient<'tablet'> | null = null;
    let telemetryTimer: ReturnType<typeof setInterval> | null = null;
    let bannerTimer: ReturnType<typeof setTimeout> | null = null;
    const lastSeen = new Map<string, number>();
    let stopGeneration = 0;
    const assembler = new VoiceClipAssembler();

    const activeRemoteCount = () => {
      const cutoff = Date.now() - REMOTE_ACTIVE_WINDOW_MS;
      for (const [id, ts] of lastSeen) {
        if (ts < cutoff) lastSeen.delete(id);
      }
      return lastSeen.size;
    };

    const sendTelemetry = () => {
      if (!client) return;
      void client.send({
        type: 'TELEMETRY',
        data: {
          ...handlersRef.current.getTelemetry(),
          tabletName: tabletNameRef.current,
          remoteCount: lastSeen.size,
        },
      });
    };

    const showBanner = (text: string | null, clearAfterMs?: number) => {
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = null;
      setBroadcastText(text);
      if (text && clearAfterMs) {
        bannerTimer = setTimeout(() => setBroadcastText(null), clearAfterMs);
      }
    };

    const runBroadcast = async (requestId: string, label: string, task: () => Promise<boolean>) => {
      const startedGeneration = stopGeneration;
      showBanner(label);
      await client?.send({ type: 'BROADCAST_STATUS', requestId, status: 'PLAYING', text: label });
      let ok = false;
      try {
        ok = await task();
      } catch (err) {
        console.warn('[useTabletRemote] broadcast failed', err);
      }
      const stopped = startedGeneration !== stopGeneration;
      await client?.send({
        type: 'BROADCAST_STATUS',
        requestId,
        status: stopped ? 'STOPPED' : ok ? 'DONE' : 'FAILED',
        text: label,
      });
      if (stopped) showBanner(null);
      else showBanner(label, 3000);
    };

    createPairingSession(pairingKey)
      .then((session) => {
        if (disposed) return;
        setFingerprint(session.fingerprint);
        setInitError(null);

        client = new RemoteClient('tablet', session, (s) => {
          if (!disposed) setStatuses(s);
        });

        client.onMessage((body, envelope) => {
          lastSeen.set(envelope.deviceId, Date.now());
          switch (body.type) {
            case 'PING':
              sendTelemetry();
              break;
            case 'ALERT':
              void runBroadcast(envelope.id, '🚨 원격 긴급 경고 방송', () => handlersRef.current.onAlert());
              break;
            case 'TTS':
              void runBroadcast(envelope.id, body.text, () => handlersRef.current.onTts(body.text));
              break;
            case 'RECALIBRATE':
              handlersRef.current.onRecalibrate();
              sendTelemetry();
              break;
            case 'STOP':
              stopGeneration++;
              handlersRef.current.onStop();
              showBanner(null);
              setTimeout(sendTelemetry, 100);
              break;
            case 'VOICE_CHUNK': {
              const clip = assembler.push(body, envelope.deviceId);
              if (!clip) break;
              if (clip.mode === 'play') {
                void runBroadcast(clip.clipId, '🎙 관리자 음성 방송', () => handlersRef.current.onVoice(clip.blob));
              } else {
                void (async () => {
                  const ok = await handlersRef.current.onSaveAlertSound(clip.blob).catch(() => false);
                  await client?.send({
                    type: 'BROADCAST_STATUS',
                    requestId: clip.clipId,
                    status: ok ? 'DONE' : 'FAILED',
                    text: ok ? '경고음 등록 완료' : '경고음 등록 실패 (재생할 수 없는 녹음 형식)',
                  });
                  setTimeout(sendTelemetry, 100);
                })();
              }
              break;
            }
            case 'SET_MUTE':
              handlersRef.current.onSetMute(body.muted);
              setTimeout(sendTelemetry, 100);
              break;
            case 'RESET_ALERT_SOUND':
              void handlersRef.current
                .onResetAlertSound()
                .catch((err) => console.warn('[useTabletRemote] reset alert sound failed', err))
                .finally(() => setTimeout(sendTelemetry, 100));
              break;
            case 'ADJUST': {
              const tuning = sanitizeTuning(body.tuning);
              if (Object.keys(tuning).length > 0) {
                handlersRef.current.onAdjust(tuning);
                // 상태 반영(React 렌더) 이후 최신 설정을 회신
                setTimeout(sendTelemetry, 100);
              }
              break;
            }
          }
        });

        client.connect();

        telemetryTimer = setInterval(() => {
          const count = activeRemoteCount();
          setRemoteCount(count);
          // 보고 있는 리모컨이 없을 때는 송신하지 않아 무료 중계 쿼터(Supabase 메시지 수)를 아낀다
          if (count > 0) sendTelemetry();
        }, TELEMETRY_INTERVAL_MS);
      })
      .catch((err) => {
        console.error('[useTabletRemote] pairing init failed', err);
        if (!disposed) setInitError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      if (telemetryTimer) clearInterval(telemetryTimer);
      if (bannerTimer) clearTimeout(bannerTimer);
      client?.disconnect();
      client = null;
      setStatuses([]);
      setRemoteCount(0);
    };
  }, [enabled, pairingKey]);

  const rotateKey = useCallback(() => {
    setPairingKey(PairingRepo.rotateTabletKey());
  }, []);

  const setTabletName = useCallback((name: string) => {
    setTabletNameState(PairingRepo.setTabletName(name));
  }, []);

  return {
    pairingKey,
    tabletName,
    setTabletName,
    fingerprint,
    statuses,
    isConnected: statuses.some((s) => s.connected),
    remoteCount,
    broadcastText,
    initError,
    rotateKey,
  };
}
