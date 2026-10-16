import mqtt, { MqttClient } from 'mqtt';
import { RemoteMessage, OutgoingRemoteMessage } from './remoteTypes';

export type MessageHandler = (message: RemoteMessage) => void;
export type BrokerId = 'emqx' | 'hivemq';

export const BROKER_OPTIONS: Record<BrokerId, { name: string; url: string }> = {
  emqx: {
    name: 'EMQX Cloud',
    url: 'wss://broker.emqx.io:8084/mqtt',
  },
  hivemq: {
    name: 'HiveMQ Cloud',
    url: 'wss://broker.hivemq.com:8884/mqtt',
  },
};

export class RemoteClient {
  private client: MqttClient | null = null;
  private roomId: string;
  private role: 'tablet' | 'remote';
  private topic: string;
  private handlers: MessageHandler[] = [];
  private isConnected: boolean = false;
  private onStatusChange?: (connected: boolean, brokerId: BrokerId) => void;
  private currentBrokerId: BrokerId;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private autoFailoverEnabled: boolean = true;

  constructor(
    roomId: string,
    role: 'tablet' | 'remote',
    onStatusChange?: (connected: boolean, brokerId: BrokerId) => void,
    initialBrokerId: BrokerId = 'emqx'
  ) {
    this.roomId = roomId;
    this.role = role;
    this.topic = `studycalm/v1/${roomId}`;
    this.onStatusChange = onStatusChange;
    this.currentBrokerId = initialBrokerId;
  }

  public getBrokerId(): BrokerId {
    return this.currentBrokerId;
  }

  public setBroker(newBroker: BrokerId): void {
    if (this.currentBrokerId === newBroker && this.isConnected) return;
    this.currentBrokerId = newBroker;
    this.autoFailoverEnabled = false;
    this.disconnect();
    this.connect();
  }

  public connect(): void {
    if (this.client) return;

    const brokerUrl = BROKER_OPTIONS[this.currentBrokerId].url;

    // 만약 4초 내에 브로커 연결이 체결되지 않으면 다음 대체 브로커로 자동 페일오버
    if (this.autoFailoverEnabled) {
      if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
      this.fallbackTimer = setTimeout(() => {
        if (!this.isConnected) {
          console.warn(`[RemoteClient] Connection to ${this.currentBrokerId} timed out. Failing over to backup broker...`);
          this.autoFailoverEnabled = false;
          const nextBroker: BrokerId = this.currentBrokerId === 'emqx' ? 'hivemq' : 'emqx';
          this.currentBrokerId = nextBroker;
          this.disconnect();
          this.connect();
        }
      }, 4000);
    }

    const client = mqtt.connect(brokerUrl, {
      clientId: `studycalm_${this.role}_${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      connectTimeout: 4000,
      reconnectPeriod: 2500,
      keepalive: 30, // 모바일 환경 웹소켓 절전/차단 방지 핑퐁 주기
    });

    this.client = client;

    client.on('connect', () => {
      if (this.fallbackTimer) {
        clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
      }
      this.isConnected = true;
      this.onStatusChange?.(true, this.currentBrokerId);

      // 토픽 구독
      client.subscribe(this.topic, { qos: 0 }, (err) => {
        if (err) {
          console.warn('[RemoteClient] Subscribe error:', err);
        }
      });
    });

    client.on('message', (topic, payload) => {
      if (topic !== this.topic) return;

      try {
        const msg = JSON.parse(payload.toString()) as RemoteMessage;
        // 자신이 보낸 메시지는 무시
        if (msg.sender === this.role) return;

        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch (e) {
        console.warn('[RemoteClient] Failed to parse incoming message:', e);
      }
    });

    client.on('error', (err) => {
      console.warn(`[RemoteClient] MQTT error on ${this.currentBrokerId}:`, err);
    });

    client.on('close', () => {
      this.isConnected = false;
      this.onStatusChange?.(false, this.currentBrokerId);
    });
  }

  public onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  public sendMessage(partialMessage: OutgoingRemoteMessage): void {
    if (!this.client || !this.isConnected) {
      console.warn('[RemoteClient] Not connected. Cannot send message.');
      return;
    }

    const fullMessage: RemoteMessage = {
      ...partialMessage,
      roomId: this.roomId,
      sender: this.role,
      timestamp: Date.now(),
    } as RemoteMessage;

    this.client.publish(this.topic, JSON.stringify(fullMessage), { qos: 0 });
  }

  public disconnect(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        // ignore
      }
      this.client = null;
    }
    this.isConnected = false;
    this.handlers = [];
    this.onStatusChange?.(false, this.currentBrokerId);
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }
}
