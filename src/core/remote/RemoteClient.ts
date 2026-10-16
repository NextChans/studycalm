import { PairingSession } from './pairing';
import {
  RemoteEnvelope,
  RemotePayload,
  RemoteRole,
  RemoteCommand,
  TabletEvent,
  parseEnvelope,
} from './remoteTypes';
import { RemoteTransport, TransportStatus, createDefaultTransports } from './transports';

type IncomingFor<R extends RemoteRole> = R extends 'tablet' ? RemoteCommand : TabletEvent;
type OutgoingFor<R extends RemoteRole> = R extends 'tablet' ? TabletEvent : RemoteCommand;

export type MessageHandler<T extends RemotePayload> = (body: T, envelope: RemoteEnvelope<T>) => void;

/** 기기 간 시계 오차를 감안한 재전송 허용 범위 */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const SEEN_ID_LIMIT = 500;

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 다중 중계(Supabase Realtime + EMQX + HiveMQ) 동시 송수신 클라이언트.
 *
 * - 한 브로커만 고르는 페일오버 방식은 태블릿과 리모컨이 서로 다른 브로커에 붙어 영원히 만나지 못하는
 *   문제가 있었다. 모든 중계에 동시에 붙고 동시에 발행한 뒤, 수신 측에서 메시지 ID로 중복을 제거한다.
 *   양쪽이 공통으로 닿는 중계가 하나라도 있으면 동기화된다.
 * - 페이로드는 PairingSession으로 E2E 암호화되므로 공용 브로커를 사용해도 무방하다.
 */
export class RemoteClient<R extends RemoteRole> {
  private readonly transports: RemoteTransport[];
  private readonly handlers = new Set<MessageHandler<IncomingFor<R>>>();
  private readonly seenIds = new Set<string>();
  private readonly deviceId: string;
  private started = false;
  private readonly onWake = () => this.transports.forEach((t) => t.kick());

  constructor(
    private readonly role: R,
    private readonly session: PairingSession,
    private readonly onStatusChange?: (statuses: TransportStatus[]) => void,
    options?: { transports?: RemoteTransport[]; deviceId?: string }
  ) {
    this.transports = options?.transports ?? createDefaultTransports();
    this.deviceId = options?.deviceId ?? randomId();
  }

  public getDeviceId(): string {
    return this.deviceId;
  }

  public getStatuses(): TransportStatus[] {
    return this.transports.map((t) => ({ id: t.id, label: t.label, connected: t.isConnected() }));
  }

  public isConnected(): boolean {
    return this.transports.some((t) => t.isConnected());
  }

  public connect(): void {
    if (this.started) return;
    this.started = true;

    for (const transport of this.transports) {
      transport.connect(
        this.session.channelId,
        (payload) => {
          void this.handleIncoming(payload);
        },
        () => this.onStatusChange?.(this.getStatuses())
      );
    }
    this.onStatusChange?.(this.getStatuses());

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onWake);
      document.addEventListener('visibilitychange', this.onWake);
    }
  }

  public onMessage(handler: MessageHandler<IncomingFor<R>>): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * @returns 메시지 ID (연결된 중계가 하나도 없으면 null)
   */
  public async send(body: OutgoingFor<R>): Promise<string | null> {
    if (!this.isConnected()) return null;
    const envelope: RemoteEnvelope = {
      v: 2,
      id: randomId(),
      sender: this.role,
      deviceId: this.deviceId,
      ts: Date.now(),
      body,
    };
    this.markSeen(envelope.id);
    const cipher = await this.session.encrypt(JSON.stringify(envelope));
    for (const transport of this.transports) {
      transport.publish(cipher);
    }
    return envelope.id;
  }

  public disconnect(): void {
    if (!this.started) return;
    this.started = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onWake);
      document.removeEventListener('visibilitychange', this.onWake);
    }
    for (const transport of this.transports) {
      transport.disconnect();
    }
    this.onStatusChange?.(this.getStatuses());
  }

  private async handleIncoming(payload: string): Promise<void> {
    // 음성 조각(약 16KB) 이상의 페이로드는 거부
    if (payload.length > 32_768) return;
    const plain = await this.session.decrypt(payload);
    if (plain === null) return; // 키가 다르거나 위·변조된 메시지

    const envelope = parseEnvelope(plain);
    if (!envelope || envelope.sender === this.role) return;
    if (Math.abs(Date.now() - envelope.ts) > MAX_CLOCK_SKEW_MS) return;
    if (this.seenIds.has(envelope.id)) return; // 다중 중계 중복 수신 및 재전송 차단
    this.markSeen(envelope.id);

    if (!this.started) return;
    for (const handler of this.handlers) {
      handler(envelope.body as IncomingFor<R>, envelope as RemoteEnvelope<IncomingFor<R>>);
    }
  }

  private markSeen(id: string): void {
    this.seenIds.add(id);
    if (this.seenIds.size > SEEN_ID_LIMIT) {
      const oldest = this.seenIds.values().next().value;
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
  }
}
