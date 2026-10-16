import { useEffect, useRef, useState, useCallback } from 'react';
import { AudioEngine, AudioEngineError } from '../core/audio/AudioEngine';
import { NoiseStateMachine } from '../core/machine/NoiseStateMachine';
import { StateMachineSnapshot } from '../core/machine/types';
import { SoundPlayer } from '../core/alert/SoundPlayer';
import { CounterRepo } from '../core/storage/counterRepo';
import { SettingsRepo } from '../core/storage/settingsRepo';
import { CustomAudioRepo, CustomAudioItem } from '../core/storage/customAudioRepo';
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
  const [customAudio, setCustomAudio] = useState<CustomAudioItem | null>(null);
  const [customAudioUrl, setCustomAudioUrl] = useState<string | null>(null);

  // Core references
  const initialConfigRef = useRef(config);
  const machineRef = useRef<NoiseStateMachine | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const playerRef = useRef<SoundPlayer | null>(null);

  // Load custom audio from IndexedDB on mount
  useEffect(() => {
    let activeUrl: string | null = null;
    CustomAudioRepo.getAudio()
      .then((item) => {
        if (item) {
          setCustomAudio(item);
          activeUrl = URL.createObjectURL(item.blob);
          setCustomAudioUrl(activeUrl);
          playerRef.current?.setCustomAudio(item.blob, activeUrl);
        }
      })
      .catch((e) => {
        console.warn('[useNoiseMonitor] Failed to load custom audio:', e);
      });

    return () => {
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
      }
    };
  }, []);

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
          void playerRef.current?.playNextAlert();
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

  // Save new custom audio
  const saveCustomAudio = useCallback(async (blob: Blob, name: string) => {
    const item = await CustomAudioRepo.saveAudio(blob, name);
    setCustomAudio(item);

    setCustomAudioUrl((prevUrl) => {
      if (prevUrl) {
        URL.revokeObjectURL(prevUrl);
      }
      const newUrl = URL.createObjectURL(item.blob);
      playerRef.current?.setCustomAudio(item.blob, newUrl);
      return newUrl;
    });
  }, []);

  // Delete custom audio (revert to default)
  const deleteCustomAudio = useCallback(async () => {
    await CustomAudioRepo.deleteAudio();
    setCustomAudio(null);
    setCustomAudioUrl((prevUrl) => {
      if (prevUrl) {
        URL.revokeObjectURL(prevUrl);
      }
      playerRef.current?.setCustomAudio(null, null);
      return null;
    });
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
    // 터치 제스처의 동기 구간 안에서 먼저 오디오 출력 잠금 해제 (getUserMedia await 이후엔 제스처가 소멸될 수 있음)
    playerRef.current?.unlock();
    try {
      if (engineRef.current && !engineRef.current.isActive()) {
        await engineRef.current.start();
        setIsAudioRunning(true);
        machineRef.current?.start();
      }
      // 측정용 AudioContext가 새로 생성되었으므로 해당 컨텍스트도 잠금 해제
      playerRef.current?.unlock();
    } catch {
      // AudioEngine onError already handles the state update
    }
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    machineRef.current?.stop();
    playerRef.current?.stop();
    // 측정 컨텍스트가 닫혔으므로, 정지 버튼 터치 제스처 안에서 출력 전용 컨텍스트를 다시 활성화
    // (측정 정지 상태에서도 원격 안내 방송이 출력되도록)
    playerRef.current?.unlock();
    setIsAudioRunning(false);
  }, []);

  const recalibrate = useCallback(() => {
    machineRef.current?.recalibrate();
  }, []);

  /** @returns 실제로 재생되었는지 (이미 재생 중이면 false, 카운트도 올리지 않음) */
  const triggerManualAlert = useCallback(async (): Promise<boolean> => {
    const player = playerRef.current;
    if (!player || player.getIsPlaying()) return false;
    const nextCount = CounterRepo.increment();
    setDailyAlertCount(nextCount);
    return player.playNextAlert();
  }, []);

  /** 원격 맞춤 안내 방송 (딩동 차임 → 음성). 재생 중이면 대기열에서 순서대로 재생 */
  const speakTts = useCallback(async (text: string): Promise<boolean> => {
    return (await playerRef.current?.playAnnouncement(text)) ?? false;
  }, []);

  /** 리모컨 녹음 음성 즉시 방송 */
  const playRemoteVoice = useCallback(async (blob: Blob): Promise<boolean> => {
    return (await playerRef.current?.playVoiceClip(blob)) ?? false;
  }, []);

  const previewAlert = useCallback(async (volume?: number): Promise<void> => {
    playerRef.current?.unlock();
    await playerRef.current?.playPreview(volume);
  }, []);

  const stopPlayback = useCallback(() => {
    playerRef.current?.stop();
  }, []);

  const isOutputReady = useCallback(() => playerRef.current?.isOutputReady() ?? false, []);
  const isPlaybackActive = useCallback(() => playerRef.current?.getIsPlaying() ?? false, []);

  const dismissError = useCallback(() => {
    setAudioError(null);
  }, []);

  const unlockAudio = useCallback(() => {
    playerRef.current?.unlock();
  }, []);

  return {
    config,
    updateConfig,
    snapshot,
    dailyAlertCount,
    audioError,
    isAudioRunning,
    customAudio,
    customAudioUrl,
    saveCustomAudio,
    deleteCustomAudio,
    start,
    stop,
    recalibrate,
    triggerManualAlert,
    speakTts,
    playRemoteVoice,
    previewAlert,
    stopPlayback,
    isOutputReady,
    isPlaybackActive,
    dismissError,
    unlockAudio,
  };
}
