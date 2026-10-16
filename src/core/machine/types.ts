export type MachineState =
  | 'IDLE'
  | 'CALIBRATING'
  | 'MONITORING'
  | 'EXCEEDING'
  | 'ALERTING'
  | 'COOLDOWN';

export interface StateMachineSnapshot {
  state: MachineState;
  baselineDb: number | null;
  thresholdDb: number | null;
  currentDb: number;
  smoothedDb: number;
  exceedingProgress: number; // 0.0 ~ 1.0 (sustain 진행률)
  cooldownRemainingMs: number;
  calibrationProgress: number; // 0.0 ~ 1.0 (보정 진행률)
}

export interface StateMachineListeners {
  onStateChange?: (newState: MachineState, oldState: MachineState) => void;
  onAlertTriggered?: () => void;
  onBaselineUpdated?: (baselineDb: number) => void;
  onSnapshot?: (snapshot: StateMachineSnapshot) => void;
}
