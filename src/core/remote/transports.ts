import mqtt, { MqttClient } from 'mqtt';
import { RealtimeClient, RealtimeChannel } from '@supabase/realtime-js';

export type TransportId = 'supabase' | 'emqx' | 'hivemq';

export interface TransportStatus {
  id: TransportId;
  label: string;
  connected: boolean;
}

/**
 * 중계 전송 계층 추상화.
 * 페이로드는 이미 암호화된 불투명 문자열이며, 전송 계층은 내용에 관여하지 않는다.
 */
export interface RemoteTransport {
  readonly id: TransportId;
  readonly label: string;
  connect(channelId: string, onPayload: (payload: string) => void, onStatus: (connected: boolean) => void): void;
  publish(payload: string): void;
  isConnected(): boolean;
  /** 네트워크 복구 / 화면 복귀 시 즉시 재연결 시도 */
  kick(): void;
  disconnect(): void;
}

const MQTT_BROKERS: Record<'emqx' | 'hivemq', { label: string; url: string }> = {
  emqx: { label: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
  hivemq: { label: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
};

function randomClientSuffix(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class MqttTransport implements RemoteTransport {
  public readonly id: 'emqx' | 'hivemq';
  public readonly label: string;
  private readonly url: string;
  private client: MqttClient | null = null;
  private topic = '';
  private connected = false;

  constructor(id: 'emqx' | 'hivemq') {
    this.id = id;
    this.label = MQTT_BROKERS[id].label;
    this.url = MQTT_BROKERS[id].url;
  }

  connect(channelId: string, onPayload: (payload: string) => void, onStatus: (connected: boolean) => void): void {
    if (this.client) return;
    this.topic = `studycalm/v2/${channelId}`;

    const client = mqtt.connect(this.url, {
      // 공용 브로커에서 clientId 충돌 시 서로를 강제 종료하므로 충분히 긴 난수 사용
      clientId: `sc_${randomClientSuffix()}`,
      clean: true,
      connectTimeout: 10_000,
      reconnectPeriod: 3_000,
      keepalive: 30,
    });
    this.client = client;

    client.on('connect', () => {
      client.subscribe(this.topic, { qos: 0 }, (err) => {
        if (err) {
          console.warn(`[MqttTransport:${this.id}] subscribe failed`, err);
          return;
        }
        this.connected = true;
        onStatus(true);
      });
    });
    client.on('message', (topic, payload) => {
      if (topic === this.topic) onPayload(payload.toString());
    });
    client.on('close', () => {
      if (this.connected) {
        this.connected = false;
        onStatus(false);
      }
    });
    client.on('error', (err) => {
      console.warn(`[MqttTransport:${this.id}] error`, err?.message ?? err);
    });
  }

  publish(payload: string): void {
    if (this.client && this.connected) {
      this.client.publish(this.topic, payload, { qos: 0 });
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  kick(): void {
    if (this.client && !this.client.connected && !this.client.reconnecting) {
      this.client.reconnect();
    }
  }

  disconnect(): void {
    this.connected = false;
    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        // ignore
      }
      this.client = null;
    }
  }
}

/**
 * Supabase Realtime Broadcast 전송 계층 (wss 443 포트 → 방화벽/사내망/매장 Wi-Fi 환경에서도 통과)
 * DB 테이블을 사용하지 않는 순수 브로드캐스트이므로 anon(publishable) 키만 필요하다.
 */
export class SupabaseTransport implements RemoteTransport {
  public readonly id = 'supabase' as const;
  public readonly label = 'Supabase';
  private client: RealtimeClient | null = null;
  private channel: RealtimeChannel | null = null;
  private connected = false;

  constructor(
    private readonly supabaseUrl: string,
    private readonly anonKey: string
  ) {}

  static fromEnv(): SupabaseTransport | null {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    return new SupabaseTransport(url.replace(/\/+$/, ''), key);
  }

  connect(channelId: string, onPayload: (payload: string) => void, onStatus: (connected: boolean) => void): void {
    if (this.client) return;

    const client = new RealtimeClient(`${this.supabaseUrl}/realtime/v1`, {
      params: { apikey: this.anonKey, eventsPerSecond: 10 },
    });
    this.client = client;

    const channel = client.channel(`studycalm-${channelId}`, {
      config: { broadcast: { self: false, ack: false } },
    });
    this.channel = channel;

    channel.on('broadcast', { event: 'm' }, (msg) => {
      const data = (msg.payload as { d?: unknown } | undefined)?.d;
      if (typeof data === 'string') onPayload(data);
    });

    channel.subscribe((status) => {
      const nowConnected = status === 'SUBSCRIBED';
      if (nowConnected !== this.connected) {
        this.connected = nowConnected;
        onStatus(nowConnected);
      }
    });
  }

  publish(payload: string): void {
    if (this.channel && this.connected) {
      this.channel.send({ type: 'broadcast', event: 'm', payload: { d: payload } }).catch(() => {});
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  kick(): void {
    // realtime-js가 자체 백오프로 재연결하므로, 소켓이 끊긴 경우에만 즉시 connect 요청
    if (this.client && !this.client.isConnected()) {
      this.client.connect();
    }
  }

  disconnect(): void {
    this.connected = false;
    const { client, channel } = this;
    this.client = null;
    this.channel = null;
    if (client) {
      if (channel) client.removeChannel(channel).catch(() => {});
      client.disconnect().catch(() => {});
    }
  }
}

export function createDefaultTransports(): RemoteTransport[] {
  const transports: RemoteTransport[] = [];
  const supabase = SupabaseTransport.fromEnv();
  if (supabase) transports.push(supabase);
  transports.push(new MqttTransport('emqx'), new MqttTransport('hivemq'));
  return transports;
}
