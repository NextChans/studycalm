/**
 * 탭의 가시성 상태 변화(포그라운드/백그라운드)를 감시하는 유틸리티
 */
export class VisibilityWatcher {
  private isListening: boolean = false;
  private onChange: (isHidden: boolean) => void;

  constructor(onChange: (isHidden: boolean) => void) {
    this.onChange = onChange;
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  public start(): void {
    if (this.isListening || typeof document === 'undefined') return;
    this.isListening = true;
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.onChange(document.hidden);
  }

  public stop(): void {
    if (!this.isListening || typeof document === 'undefined') return;
    this.isListening = false;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleVisibilityChange(): void {
    this.onChange(document.hidden);
  }

  public isHidden(): boolean {
    if (typeof document === 'undefined') return false;
    return document.hidden;
  }
}
