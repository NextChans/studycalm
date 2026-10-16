import { useEffect, useState } from 'react';
import { VisibilityWatcher } from '../core/stability/VisibilityWatcher';

export function useVisibility() {
  const [isBackground, setIsBackground] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return document.hidden;
  });

  useEffect(() => {
    const watcher = new VisibilityWatcher((hidden) => {
      setIsBackground(hidden);
    });
    watcher.start();

    return () => {
      watcher.stop();
    };
  }, []);

  return { isBackground };
}
