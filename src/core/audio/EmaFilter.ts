/**
 * 지수이동평균(Exponential Moving Average) 필터
 * S_t = alpha * X_t + (1 - alpha) * S_{t-1}
 */
export class EmaFilter {
  private alpha: number;
  private currentValue: number | null = null;

  /**
   * @param alpha 스무딩 가중치 (0 < alpha <= 1). 값이 작을수록 이전 평균의 반영 비율이 높아져 스무딩이 강해짐
   */
  constructor(alpha: number = 0.15) {
    this.alpha = Math.max(0.001, Math.min(1.0, alpha));
  }

  public setAlpha(alpha: number): void {
    this.alpha = Math.max(0.001, Math.min(1.0, alpha));
  }

  public getAlpha(): number {
    return this.alpha;
  }

  /**
   * 새로운 샘플 값을 받아 EMA를 계산하고 갱신된 값을 반환
   */
  public next(value: number): number {
    if (this.currentValue === null) {
      this.currentValue = value;
      return value;
    }
    this.currentValue = this.alpha * value + (1 - this.alpha) * this.currentValue;
    return this.currentValue;
  }

  /**
   * 현재 EMA 값 조회
   */
  public current(): number | null {
    return this.currentValue;
  }

  /**
   * 필터 리셋
   */
  public reset(initialValue: number | null = null): void {
    this.currentValue = initialValue;
  }
}
