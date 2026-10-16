import { STORAGE_KEYS } from './storageKeys';

export class CounterRepo {
  private static getDateKey(dateObj: Date): string {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 오늘 날짜의 경고 횟수 조회 (날짜가 바뀌었으면 0으로 자동 리셋)
   */
  public static getTodayCount(nowDate: Date = new Date()): number {
    if (typeof localStorage === 'undefined') return 0;

    const todayStr = this.getDateKey(nowDate);
    const lastDate = localStorage.getItem(STORAGE_KEYS.LAST_ALERT_DATE);

    if (lastDate !== todayStr) {
      // 자정이 지났으므로 리셋
      localStorage.setItem(STORAGE_KEYS.LAST_ALERT_DATE, todayStr);
      localStorage.setItem(STORAGE_KEYS.DAILY_ALERT_COUNT, '0');
      return 0;
    }

    const countStr = localStorage.getItem(STORAGE_KEYS.DAILY_ALERT_COUNT);
    return countStr ? parseInt(countStr, 10) || 0 : 0;
  }

  /**
   * 경고 발생 시 카운터 1 증가
   */
  public static increment(nowDate: Date = new Date()): number {
    if (typeof localStorage === 'undefined') return 1;

    const current = this.getTodayCount(nowDate);
    const nextCount = current + 1;
    const todayStr = this.getDateKey(nowDate);

    localStorage.setItem(STORAGE_KEYS.LAST_ALERT_DATE, todayStr);
    localStorage.setItem(STORAGE_KEYS.DAILY_ALERT_COUNT, String(nextCount));
    return nextCount;
  }

  /**
   * 카운터 수동 초기화
   */
  public static reset(nowDate: Date = new Date()): void {
    if (typeof localStorage === 'undefined') return;
    const todayStr = this.getDateKey(nowDate);
    localStorage.setItem(STORAGE_KEYS.LAST_ALERT_DATE, todayStr);
    localStorage.setItem(STORAGE_KEYS.DAILY_ALERT_COUNT, '0');
  }
}
