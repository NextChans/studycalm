import { describe, it, expect } from 'vitest';
import { RmsDetector } from '../src/core/audio/RmsDetector';

describe('RmsDetector', () => {
  it('완전한 무음(0으로 채워진 버퍼)에 대해 minDb (-100 dBFS)를 반환한다', () => {
    const detector = new RmsDetector(-100);
    const silence = new Float32Array(1024);
    const db = detector.process(silence);
    expect(db).toBe(-100);
  });

  it('빈 버퍼(길이 0)에 대해 minDb를 반환한다', () => {
    const detector = new RmsDetector(-100);
    const empty = new Float32Array(0);
    expect(detector.process(empty)).toBe(-100);
  });

  it('최대 진폭의 사각파(1.0 및 -1.0)에 대해 0 dBFS를 반환한다', () => {
    const detector = new RmsDetector();
    const squareWave = new Float32Array(1000);
    for (let i = 0; i < squareWave.length; i++) {
      squareWave[i] = i % 2 === 0 ? 1.0 : -1.0;
    }
    // RMS = 1.0 => 20 * log10(1.0) = 0 dBFS
    const db = detector.process(squareWave);
    expect(Math.abs(db)).toBeLessThan(0.001);
  });

  it('최대 진폭 1.0의 사인파에 대해 약 -3.01 dBFS (RMS ≈ 1/√2)를 반환한다', () => {
    const detector = new RmsDetector();
    const sampleRate = 48000;
    const freq = 1000;
    const sineWave = new Float32Array(4800);
    for (let i = 0; i < sineWave.length; i++) {
      sineWave[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
    const db = detector.process(sineWave);
    // 20 * log10(1 / sqrt(2)) ≈ -3.0103 dBFS
    expect(db).toBeCloseTo(-3.01, 1);
  });
});
