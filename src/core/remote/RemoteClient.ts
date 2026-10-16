import mqtt, { MqttClient } from 'mqtt';
import { RemoteMessage, OutgoingRemoteMessage } from './remoteTypes';

export type MessageHandler = (message: RemoteMessage) => void;

export class RemoteClient {
  private client: MqttClient | null = null;
  private roomId: string;
  private role: 'tablet' | 'remote';
  private topic: string;
  private handlers: MessageHandler[] = [];
  private isConnected: boolean = false;
  private onStatusChange?: (connected: boolean) => void;

  constructor(
    roomId: string,
    role: 'tablet' | 'remote',
    onStatusChange?: (connected: boolean) => void
  ) {
    this.roomId = roomId;
    this.role = role;
    this.topic = `studycalm/v1/${roomId}`;
    this.onStatusChange = onStatusChange;
  }

  public connect(): void {
    if (this.client) return;

    // EMQX 무료 WSS 브로커 엔드포인트
    const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';

    const client = mqtt.connect(brokerUrl, {
      clientId: `studycalm_${this.role}_${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 2000,
      keepalive: 30, // 모바일 환경 웹소켓 절전/차단 방지 핑퐁 주기
    });

    this.client = client;

    client.on('connect', () => {
      this.isConnected = true;
      this.onStatusChange?.(true);

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
      console.warn('[RemoteClient] MQTT error:', err);
    });

    client.on('close', () => {
      this.isConnected = false;
      this.onStatusChange?.(false);
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
    this.onStatusChange?.(false);
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }
}
