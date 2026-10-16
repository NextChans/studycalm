/**
 * Screen Wake Lock API를 활용해 태블릿 화면 꺼짐을 방지하는 매니저
 * visibilitychange 시 화면으로 복귀하면 자동으로 락을 재획득합니다.
 */
export class WakeLockManager {
  private wakeLock: WakeLockSentinel | null = null;
  private isRequested: boolean = false;
  private onLockStateChange?: (active: boolean) => void;

  constructor(onLockStateChange?: (active: boolean) => void) {
    this.onLockStateChange = onLockStateChange;
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  public async acquire(): Promise<void> {
    this.isRequested = true;

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    await this.requestWakeLock();
  }

  public async release(): Promise<void> {
    this.isRequested = false;

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch {
        // ignore
      }
      this.wakeLock = null;
      if (this.onLockStateChange) {
        this.onLockStateChange(false);
      }
    }
  }

  private async requestWakeLock(): Promise<void> {
    if (!this.isRequested) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      console.warn('[WakeLockManager] Screen Wake Lock API is not supported in this browser.');
      return;
    }

    try {
      if (document.visibilityState === 'visible') {
        this.wakeLock = await navigator.wakeLock.request('screen');
        if (this.onLockStateChange) {
          this.onLockStateChange(true);
        }

        this.wakeLock.addEventListener('release', () => {
          if (this.onLockStateChange) {
            this.onLockStateChange(false);
          }
        });
      }
    } catch (err) {
      console.warn('[WakeLockManager] Failed to acquire WakeLock:', err);
    }
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState === 'visible' && this.isRequested) {
      this.requestWakeLock();
    }
  }
}
