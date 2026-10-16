import { useEffect, useRef, useState, useCallback } from 'react';
import { AudioEngine, AudioEngineError } from '../core/audio/AudioEngine';
import { NoiseStateMachine } from '../core/machine/NoiseStateMachine';
import { StateMachineSnapshot } from '../core/machine/types';
import { SoundPlayer } from '../core/alert/SoundPlayer';
import { CounterRepo } from '../core/storage/counterRepo';
import { SettingsRepo } from '../core/storage/settingsRepo';
import { NoiseConfig } from '../config/defaults';

export function useNoiseMonitor() {
  const [config, setConfig] = useState<NoiseConfig>(() => SettingsRepo.load());
  const [snapshot, setSnapshot] = useState<StateMachineSnapshot>({
    state: 'IDLE',
    baselineDb: null,
    thresholdDb: null,
    currentDb: -100,
    smoothedDb: -100,
    exceedingProgress: 0,
    cooldownRemainingMs: 0,
    calibrationProgress: 0,
  });
  const [dailyAlertCount, setDailyAlertCount] = useState<number>(() => CounterRepo.getTodayCount());
  const [audioError, setAudioError] = useState<AudioEngineError | null>(null);
  const [isAudioRunning, setIsAudioRunning] = useState<boolean>(false);

  // Core references
  const initialConfigRef = useRef(config);
  const machineRef = useRef<NoiseStateMachine | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const playerRef = useRef<SoundPlayer | null>(null);

  // Initialize instances once on mount
  useEffect(() => {
    const initialCfg = initialConfigRef.current;
    const player = new SoundPlayer({
      soundFiles: initialCfg.soundFiles,
      volume: initialCfg.volume,
      onPlaybackStart: () => {
        machineRef.current?.notifyPlaybackStarted();
      },
      onPlaybackEnd: () => {
        machineRef.current?.notifyPlaybackEnded();
      },
    });
    playerRef.current = player;

    const machine = new NoiseStateMachine(
      initialCfg,
      {
        onAlertTriggered: () => {
          const nextCount = CounterRepo.increment();
          setDailyAlertCount(nextCount);
          playerRef.current?.playNextAlert();
        },
        onSnapshot: (snap) => {
          setSnapshot(snap);
        },
      },
      () => Date.now()
    );
    machineRef.current = machine;

    const engine = new AudioEngine(
      {
        onLevelSample: (rawDb, smoothedDb) => {
          machineRef.current?.processSample(rawDb, smoothedDb);
        },
        onError: (err) => {
          setAudioError(err);
          setIsAudioRunning(false);
          machineRef.current?.stop();
        },
      },
      {
        emaAlpha: initialCfg.emaAlpha,
        intervalMs: initialCfg.sampleIntervalMs,
      }
    );
    engineRef.current = engine;

    return () => {
      engine.stop();
      machine.stop();
      player.stop();
    };
  }, []);

  // Update configurations when config changes
  const updateConfig = useCallback((newConfig: Partial<NoiseConfig>) => {
    setConfig((prev) => {
      const merged = { ...prev, ...newConfig };
      SettingsRepo.save(merged);
      machineRef.current?.updateConfig(merged);
      if (newConfig.emaAlpha !== undefined) {
        engineRef.current?.setEmaAlpha(newConfig.emaAlpha);
      }
      if (newConfig.volume !== undefined) {
        playerRef.current?.setVolume(newConfig.volume);
      }
      if (newConfig.soundFiles !== undefined) {
        playerRef.current?.setSoundFiles(newConfig.soundFiles);
      }
      return merged;
    });
  }, []);

  const start = useCallback(async () => {
    setAudioError(null);
    try {
      if (engineRef.current && !engineRef.current.isActive()) {
        await engineRef.current.start();
        setIsAudioRunning(true);
        machineRef.current?.start();
      }
    } catch {
      // AudioEngine onError already handles the state update
    }
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    machineRef.current?.stop();
    playerRef.current?.stop();
    setIsAudioRunning(false);
  }, []);

  const recalibrate = useCallback(() => {
    machineRef.current?.recalibrate();
  }, []);

  const dismissError = useCallback(() => {
    setAudioError(null);
  }, []);

  return {
    config,
    updateConfig,
    snapshot,
    dailyAlertCount,
    audioError,
    isAudioRunning,
    start,
    stop,
    recalibrate,
    dismissError,
  };
}
