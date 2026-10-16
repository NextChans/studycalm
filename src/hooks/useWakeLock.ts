import { useEffect, useRef, useState, useCallback } from 'react';
import { WakeLockManager } from '../core/stability/WakeLockManager';

export function useWakeLock() {
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const managerRef = useRef<WakeLockManager | null>(null);

  useEffect(() => {
    const manager = new WakeLockManager((active) => {
      setIsLocked(active);
    });
    managerRef.current = manager;

    return () => {
      manager.release();
    };
  }, []);

  const requestLock = useCallback(async () => {
    await managerRef.current?.acquire();
  }, []);

  const releaseLock = useCallback(async () => {
    await managerRef.current?.release();
  }, []);

  return { isLocked, requestLock, releaseLock };
}
