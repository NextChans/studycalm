export type RemoteActionType =
  | 'ALERT'
  | 'TTS'
  | 'RECALIBRATE'
  | 'TELEMETRY'
  | 'PING'
  | 'PONG'
  | 'BROADCAST_STATUS';

export interface BaseRemoteMessage {
  type: RemoteActionType;
  roomId: string;
  sender: 'tablet' | 'remote';
  timestamp: number;
}

export interface AlertMessage extends BaseRemoteMessage {
  type: 'ALERT';
}

export interface TtsMessage extends BaseRemoteMessage {
  type: 'TTS';
  text: string;
}

export interface RecalibrateMessage extends BaseRemoteMessage {
  type: 'RECALIBRATE';
}

export interface TelemetryData {
  currentDb: number;
  smoothedDb: number;
  baselineDb: number | null;
  thresholdDb: number | null;
  state: string;
  dailyAlertCount: number;
  isAudioRunning?: boolean;
}

export interface TelemetryMessage extends BaseRemoteMessage {
  type: 'TELEMETRY';
  data: TelemetryData;
}

export interface PingMessage extends BaseRemoteMessage {
  type: 'PING' | 'PONG';
}

export interface BroadcastStatusMessage extends BaseRemoteMessage {
  type: 'BROADCAST_STATUS';
  status: 'PLAYING' | 'DONE';
  text: string;
}

export type RemoteMessage =
  | AlertMessage
  | TtsMessage
  | RecalibrateMessage
  | TelemetryMessage
  | PingMessage
  | BroadcastStatusMessage;

export type OutgoingRemoteMessage =
  | { type: 'ALERT' }
  | { type: 'TTS'; text: string }
  | { type: 'RECALIBRATE' }
  | { type: 'TELEMETRY'; data: TelemetryData }
  | { type: 'PING' | 'PONG' }
  | { type: 'BROADCAST_STATUS'; status: 'PLAYING' | 'DONE'; text: string };
