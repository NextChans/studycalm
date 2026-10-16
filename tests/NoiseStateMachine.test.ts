import { describe, it, expect, vi } from 'vitest';
import { NoiseStateMachine } from '../src/core/machine/NoiseStateMachine';
import { NoiseConfig } from '../src/config/defaults';

describe('NoiseStateMachine', () => {
  const createMockConfig = (overrides: Partial<NoiseConfig> = {}): Partial<NoiseConfig> => ({
    calibrationDurationMs: 1000, // 1초로 단축하여 테스트
    thresholdOffsetDb: 15,
    sustainMs: 1000, // 1초 지속 시 알림
    hysteresisMs: 200, // 200ms 이하 드롭 허용
    postPlaybackMuteMs: 500, // 500ms 뮤트
    cooldownMs: 2000, // 2초 쿨다운
    volume: 0.8,
    emaAlpha: 0.2,
    sampleIntervalMs: 50,
    ...overrides,
  });

  it('1. 보정 단계에서 샘플들의 중앙값(Median)을 baseline으로 설정하고 MONITORING으로 전환한다', () => {
    let mockTime = 1000;
    const timeProvider = () => mockTime;

    const onBaselineUpdated = vi.fn();
    const machine = new NoiseStateMachine(
      createMockConfig(),
      { onBaselineUpdated },
      timeProvider
    );

    machine.start();
    expect(machine.getState()).toBe('CALIBRATING');

    // 샘플 주입: -50, -40, -60, -45, -35 dB
    // 정렬 시: -60, -50, -45, -40, -35 => 중앙값: -45 dB
    machine.processSample(-50, -50);
    mockTime += 200;
    machine.processSample(-40, -40);
    mockTime += 200;
    machine.processSample(-60, -60);
    mockTime += 200;
    machine.processSample(-45, -45);
    mockTime += 200;
    machine.processSample(-35, -35);
    mockTime += 200; // 총 1000ms 경과 (calibrationDurationMs 도달)

    machine.processSample(-45, -45);

    expect(machine.getState()).toBe('MONITORING');
    expect(machine.getBaseline()).toBe(-45);
    expect(machine.getThreshold()).toBe(-45 + 15); // -30 dB
    expect(onBaselineUpdated).toHaveBeenCalledWith(-45);
  });

  it('2. 순간적인 피크 소음(sustainMs 미만)은 무시하고 경고를 울리지 않는다', () => {
    let mockTime = 0;
    const timeProvider = () => mockTime;

    const onAlertTriggered = vi.fn();
    const machine = new NoiseStateMachine(
      createMockConfig(),
      { onAlertTriggered },
      timeProvider
    );

    // Baseline 수동 세팅: -50 dB, 임계치: -35 dB
    machine.setBaseline(-50);
    machine.start();
    // 강제로 MONITORING 상태로 만들기 위해 보정 완료 시뮬레이션
    mockTime += 1000;
    machine.processSample(-50, -50);
    expect(machine.getState()).toBe('MONITORING');

    // 순간 소음 발생 (-20 dB > -35 dB 임계치)
    machine.processSample(-20, -20);
    expect(machine.getState()).toBe('EXCEEDING');

    // 500ms 동안만 유지 (sustainMs = 1000ms 보다 작음)
    mockTime += 500;
    machine.processSample(-20, -20);
    expect(machine.getState()).toBe('EXCEEDING');

    // 소음이 다시 정상 수준(-45 dB)으로 떨어짐
    mockTime += 50;
    machine.processSample(-45, -45);
    // hysteresis(200ms) 경과 후
    mockTime += 250;
    machine.processSample(-45, -45);

    expect(machine.getState()).toBe('MONITORING');
    expect(onAlertTriggered).not.toHaveBeenCalled();
  });

  it('3. sustainMs 이상 연속으로 임계치를 초과하면 ALERTING 상태로 전이하고 경고를 트리거한다', () => {
    let mockTime = 0;
    const timeProvider = () => mockTime;

    const onAlertTriggered = vi.fn();
    const machine = new NoiseStateMachine(
      createMockConfig(),
      { onAlertTriggered },
      timeProvider
    );

    machine.setBaseline(-50); // 임계치: -35 dB
    machine.start();
    mockTime += 1000;
    machine.processSample(-50, -50); // MONITORING 진입

    // 지속 소음 시작 (-25 dB)
    mockTime += 50;
    machine.processSample(-25, -25);
    expect(machine.getState()).toBe('EXCEEDING');

    // 1000ms 지속 (sustainMs 도달)
    mockTime += 1000;
    machine.processSample(-25, -25);

    expect(machine.getState()).toBe('ALERTING');
    expect(onAlertTriggered).toHaveBeenCalledTimes(1);
  });

  it('4. 임계치 하강 시 hysteresisMs 이내의 짧은 딥(dip)은 누적 시간을 리셋하지 않는다', () => {
    let mockTime = 0;
    const timeProvider = () => mockTime;

    const onAlertTriggered = vi.fn();
    const machine = new NoiseStateMachine(
      createMockConfig({ sustainMs: 1000, hysteresisMs: 200 }),
      { onAlertTriggered },
      timeProvider
    );

    machine.setBaseline(-50);
    machine.start();
    mockTime += 1000;
    machine.processSample(-50, -50);

    // 0ms: 초과 시작
    machine.processSample(-20, -20);
    expect(machine.getState()).toBe('EXCEEDING');

    // 600ms 동안 초과 유지
    mockTime += 600;
    machine.processSample(-20, -20);

    // 100ms 동안만 잠시 임계치 아래로 떨어짐 (hysteresisMs = 200ms 이내)
    mockTime += 100;
    machine.processSample(-40, -40);
    expect(machine.getState()).toBe('EXCEEDING');

    // 다시 소음 발생
    mockTime += 50;
    machine.processSample(-20, -20);

    // 추가 300ms 경과 (초과 누적 합계 1000ms 이상)
    mockTime += 300;
    machine.processSample(-20, -20);

    expect(machine.getState()).toBe('ALERTING');
    expect(onAlertTriggered).toHaveBeenCalledTimes(1);
  });

  it('5. 경고 재생 중 및 postPlaybackMuteMs 동안은 소음이 들어와도 측정을 무시한다 (피드백 루프 방지)', () => {
    let mockTime = 0;
    const timeProvider = () => mockTime;

    const onAlertTriggered = vi.fn();
    const machine = new NoiseStateMachine(
      createMockConfig({ postPlaybackMuteMs: 500, cooldownMs: 2000 }),
      { onAlertTriggered },
      timeProvider
    );

    machine.setBaseline(-50);
    machine.start();
    mockTime += 1000;
    machine.processSample(-50, -50);

    // ALERTING 트리거
    mockTime += 1000;
    machine.processSample(-20, -20);
    mockTime += 1000;
    machine.processSample(-20, -20);
    expect(machine.getState()).toBe('ALERTING');

    // 오디오 재생 중 시뮬레이션
    machine.notifyPlaybackStarted();

    // 스피커 소리가 마이크로 재유입되는 강한 소음 (+5 dB) 발생
    mockTime += 500;
    machine.processSample(5, 5);
    expect(machine.getState()).toBe('ALERTING');

    // 오디오 재생 완료
    machine.notifyPlaybackEnded();

    // postPlaybackMuteMs (500ms) 동안 여전히 큰 소음이 유입됨
    mockTime += 200;
    machine.processSample(0, 0);
    expect(machine.getState()).toBe('ALERTING');

    // 500ms 지난 후 쿨다운으로 전이
    mockTime += 350;
    machine.processSample(-40, -40);
    expect(machine.getState()).toBe('COOLDOWN');
  });

  it('6. 쿨다운(cooldownMs) 동안에는 소음이 임계치를 넘어도 재경고를 발생시키지 않으며, 시간이 지나면 MONITORING으로 복귀한다', () => {
    let mockTime = 0;
    const timeProvider = () => mockTime;

    const onAlertTriggered = vi.fn();
    const machine = new NoiseStateMachine(
      createMockConfig({ postPlaybackMuteMs: 500, cooldownMs: 2000 }),
      { onAlertTriggered },
      timeProvider
    );

    machine.setBaseline(-50);
    machine.start();
    mockTime += 1000;
    machine.processSample(-50, -50);

    // 1회 경고 발동
    machine.processSample(-20, -20);
    mockTime += 1000;
    machine.processSample(-20, -20);
    expect(machine.getState()).toBe('ALERTING');

    machine.notifyPlaybackStarted();
    mockTime += 500;
    machine.notifyPlaybackEnded();
    mockTime += 600; // mute 시간 경과
    machine.processSample(-40, -40);
    expect(machine.getState()).toBe('COOLDOWN');
    expect(onAlertTriggered).toHaveBeenCalledTimes(1);

    // 쿨다운 기간(2000ms) 중 강한 소음 지속 발생
    mockTime += 500;
    machine.processSample(-10, -10);
    mockTime += 1000;
    machine.processSample(-10, -10);
    expect(machine.getState()).toBe('COOLDOWN');
    expect(onAlertTriggered).toHaveBeenCalledTimes(1); // 여전히 1회

    // 쿨다운(2000ms) 완전 종료
    mockTime += 600;
    machine.processSample(-45, -45);
    expect(machine.getState()).toBe('MONITORING');
  });

  it('7. 수동 재보정(recalibrate) 호출 시 CALIBRATING으로 즉시 복귀하고 baseline을 갱신한다', () => {
    let mockTime = 0;
    const timeProvider = () => mockTime;

    const machine = new NoiseStateMachine(
      createMockConfig({ calibrationDurationMs: 1000 }),
      {},
      timeProvider
    );

    machine.setBaseline(-50);
    machine.start();
    mockTime += 1000;
    machine.processSample(-50, -50);
    expect(machine.getState()).toBe('MONITORING');
    expect(machine.getBaseline()).toBe(-50);

    // 재보정 요청
    machine.recalibrate();
    expect(machine.getState()).toBe('CALIBRATING');

    // 새 환경 샘플 (-30 dB)
    mockTime += 500;
    machine.processSample(-30, -30);
    mockTime += 500;
    machine.processSample(-30, -30);
    mockTime += 50;
    machine.processSample(-30, -30);

    expect(machine.getState()).toBe('MONITORING');
    expect(machine.getBaseline()).toBe(-30);
  });
});
