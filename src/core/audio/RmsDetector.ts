import { Detector } from './Detector';

export class RmsDetector implements Detector {
  private readonly minDb: number;
  private readonly epsilon: number;

  constructor(minDb: number = -100) {
    this.minDb = minDb;
    this.epsilon = 1e-7;
  }

  /**
   * 시간영역 데이터를 기반으로 RMS를 구하고 dBFS 값으로 변환
   * @param buffer 시간 영역 Float32Array (-1.0 ~ 1.0)
   * @returns dBFS (보통 -100 dBFS ~ 0 dBFS)
   */
  public process(buffer: Float32Array): number {
    const len = buffer.length;
    if (len === 0) {
      return this.minDb;
    }

    let sumSquares = 0;
    for (let i = 0; i < len; i++) {
      const val = buffer[i];
      sumSquares += val * val;
    }

    const rms = Math.sqrt(sumSquares / len);

    // RMS가 0에 수렴할 경우 minDb 클램핑
    if (rms <= this.epsilon) {
      return this.minDb;
    }

    // dBFS = 20 * log10(RMS)
    const db = 20 * Math.log10(rms);
    return Math.max(this.minDb, Math.min(0, db));
  }
}
