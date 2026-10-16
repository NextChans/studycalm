import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteClient } from '../core/remote/RemoteClient';
import { createPairingSession } from '../core/remote/pairing';
import { RemoteCommand, TabletEvent, TelemetryData } from '../core/remote/remoteTypes';
import { TransportStatus } from '../core/remote/transports';
import { RemotePairing } from '../core/storage/pairingRepo';

const PING_INTERVAL_MS = 5_000;

export interface TabletLinkState {
  key: string;
  fingerprint: string;
  statuses: TransportStatus[];
  telemetry: TelemetryData | null;
  lastTelemetryAt: number;
  error: string | null;
}

interface LinkHandle {
  client: RemoteClient<'remote'> | null;
  dispose: () => void;
}

const emptyState = (key: string): TabletLinkState => ({
  key,
  fingerprint: '',
  statuses: [],
  telemetry: null,
  lastTelemetryAt: 0,
  error: null,
});

/**
 * 관리자 폰에서 여러 태블릿에 동시에 연결 (태블릿마다 독립된 페어링 키/암호화 채널)
 */
export function useRemoteFleet(
  pairings: RemotePairing[],
  onEvent: (key: string, event: TabletEvent) => void
) {
  const [links, setLinks] = useState<Record<string, TabletLinkState>>({});
  const handlesRef = useRef(new Map<string, LinkHandle>());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const patch = useCallback((key: string, update: Partial<TabletLinkState>) => {
    setLinks((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], ...update } } : prev));
  }, []);

  const keysSignature = pairings.map((p) => p.key).join(',');

  // 페어링 목록 변화에 맞춰 연결을 증분 추가/제거 (기존 연결은 유지)
  useEffect(() => {
    const wanted = new Set(keysSignature ? keysSignature.split(',') : []);
    const handles = handlesRef.current;

    for (const [key, handle] of handles) {
      if (!wanted.has(key)) {
        handle.dispose();
        handles.delete(key);
        setLinks((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    }

    for (const key of wanted) {
      if (handles.has(key)) continue;

      let disposed = false;
      let pingTimer: ReturnType<typeof setInterval> | null = null;
      const handle: LinkHandle = { client: null, dispose: () => {} };

      const ping = () => {
        if (handle.client && document.visibilityState === 'visible') {
          void handle.client.send({ type: 'PING' });
        }
      };

      handle.dispose = () => {
        disposed = true;
        if (pingTimer) clearInterval(pingTimer);
        document.removeEventListener('visibilitychange', ping);
        handle.client?.disconnect();
        handle.client = null;
      };
      handles.set(key, handle);
      setLinks((prev) => ({ ...prev, [key]: prev[key] ?? emptyState(key) }));

      createPairingSession(key)
        .then((session) => {
          if (disposed) return;
          patch(key, { fingerprint: session.fingerprint, error: null });

          let wasConnected = false;
          const client = new RemoteClient('remote', session, (statuses) => {
            if (disposed) return;
            patch(key, { statuses });
            const connected = statuses.some((s) => s.connected);
            if (connected && !wasConnected) ping();
            wasConnected = connected;
          });
          handle.client = client;

          client.onMessage((body) => {
            if (disposed) return;
            if (body.type === 'TELEMETRY') {
              patch(key, { telemetry: body.data, lastTelemetryAt: Date.now() });
            }
            onEventRef.current(key, body);
          });

          client.connect();
          pingTimer = setInterval(ping, PING_INTERVAL_MS);
          document.addEventListener('visibilitychange', ping);
        })
        .catch((err) => {
          if (!disposed) patch(key, { error: err instanceof Error ? err.message : String(err) });
        });
    }
  }, [keysSignature, patch]);

  // 언마운트 시 전체 해제
  useEffect(() => {
    const handles = handlesRef.current;
    return () => {
      for (const handle of handles.values()) handle.dispose();
      handles.clear();
    };
  }, []);

  const send = useCallback(async (key: string, command: RemoteCommand): Promise<string | null> => {
    const client = handlesRef.current.get(key)?.client;
    return client ? client.send(command) : null;
  }, []);

  return { links, send };
}
