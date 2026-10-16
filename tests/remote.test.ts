import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPairingSession,
  generatePairingKey,
  isValidPairingKey,
  parsePairingLink,
} from '../src/core/remote/pairing';
import { RemoteClient } from '../src/core/remote/RemoteClient';
import { RemoteTransport, TransportId } from '../src/core/remote/transports';
import { parseEnvelope } from '../src/core/remote/remoteTypes';
import { PairingRepo } from '../src/core/storage/pairingRepo';

/** 같은 채널의 모든 구독자에게 전달하는 인메모리 브로커 */
class FakeBroker {
  subscribers = new Map<string, Set<(p: string) => void>>();
  published: string[] = [];
  publish(channel: string, payload: string) {
    this.published.push(payload);
    for (const fn of this.subscribers.get(channel) ?? []) fn(payload);
  }
}

class FakeTransport implements RemoteTransport {
  readonly label: string;
  private channel = '';
  private onPayload: ((p: string) => void) | null = null;
  private connected = false;
  constructor(
    readonly id: TransportId,
    private broker: FakeBroker
  ) {
    this.label = id;
  }
  connect(channelId: string, onPayload: (p: string) => void, onStatus: (c: boolean) => void) {
    this.channel = channelId;
    this.onPayload = onPayload;
    const set = this.broker.subscribers.get(channelId) ?? new Set();
    set.add(onPayload);
    this.broker.subscribers.set(channelId, set);
    this.connected = true;
    onStatus(true);
  }
  publish(payload: string) {
    if (this.connected) this.broker.publish(this.channel, payload);
  }
  isConnected() {
    return this.connected;
  }
  kick() {}
  disconnect() {
    this.connected = false;
    if (this.onPayload) this.broker.subscribers.get(this.channel)?.delete(this.onPayload);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('pairing', () => {
  it('키 생성/검증 및 링크 파싱', () => {
    const key = generatePairingKey();
    expect(isValidPairingKey(key)).toBe(true);
    expect(isValidPairingKey('sc-abc123')).toBe(false);
    const parsed = parsePairingLink(`https://x.app/?mode=remote#k=${key}&n=${encodeURIComponent('1층 열람실')}`);
    expect(parsed).toEqual({ key, name: '1층 열람실' });
    expect(parsePairingLink('https://x.app/?room=sc-abc123')).toBeNull();
  });

  it('같은 키는 복호화되고, 다른 키나 변조된 암호문은 거부된다', async () => {
    const key = generatePairingKey();
    const a = await createPairingSession(key);
    const b = await createPairingSession(key);
    const other = await createPairingSession(generatePairingKey());

    expect(a.channelId).toBe(b.channelId);
    expect(a.channelId).not.toBe(other.channelId);

    const cipher = await a.encrypt('{"hello":1}');
    expect(await b.decrypt(cipher)).toBe('{"hello":1}');
    expect(await other.decrypt(cipher)).toBeNull();

    const tampered = cipher.slice(0, -2) + (cipher.endsWith('A') ? 'BB' : 'AA');
    expect(await b.decrypt(tampered)).toBeNull();
  });
});

describe('parseEnvelope', () => {
  const base = { v: 2, id: 'x', deviceId: 'd', ts: Date.now() };
  it('리모컨이 보낼 수 없는 타입(TELEMETRY)과 과도한 TTS 길이를 거부한다', () => {
    expect(parseEnvelope(JSON.stringify({ ...base, sender: 'remote', body: { type: 'TELEMETRY' } }))).toBeNull();
    expect(
      parseEnvelope(JSON.stringify({ ...base, sender: 'remote', body: { type: 'TTS', text: 'a'.repeat(500) } }))
    ).toBeNull();
    expect(parseEnvelope(JSON.stringify({ ...base, sender: 'remote', body: { type: 'STOP' } }))).not.toBeNull();
  });
});

describe('RemoteClient (다중 중계)', () => {
  let brokerA: FakeBroker;
  let brokerB: FakeBroker;

  beforeEach(() => {
    brokerA = new FakeBroker();
    brokerB = new FakeBroker();
  });

  it('두 중계로 동시에 전달된 메시지를 한 번만 처리한다', async () => {
    const key = generatePairingKey();
    const tablet = new RemoteClient('tablet', await createPairingSession(key), undefined, {
      transports: [new FakeTransport('emqx', brokerA), new FakeTransport('hivemq', brokerB)],
    });
    const remote = new RemoteClient('remote', await createPairingSession(key), undefined, {
      transports: [new FakeTransport('emqx', brokerA), new FakeTransport('hivemq', brokerB)],
    });
    const received: string[] = [];
    tablet.onMessage((body) => received.push(body.type));
    tablet.connect();
    remote.connect();

    await remote.send({ type: 'ALERT' });
    await flush();
    expect(received).toEqual(['ALERT']);
  });

  it('한쪽 중계만 공통으로 닿아도 동기화된다 (기존 페일오버 불일치 문제)', async () => {
    const key = generatePairingKey();
    const tablet = new RemoteClient('tablet', await createPairingSession(key), undefined, {
      transports: [new FakeTransport('emqx', new FakeBroker()), new FakeTransport('hivemq', brokerB)],
    });
    const remote = new RemoteClient('remote', await createPairingSession(key), undefined, {
      transports: [new FakeTransport('emqx', brokerA), new FakeTransport('hivemq', brokerB)],
    });
    const received: string[] = [];
    tablet.onMessage((body) => received.push(body.type));
    tablet.connect();
    remote.connect();

    await remote.send({ type: 'TTS', text: '조용히 해주세요.' });
    await flush();
    expect(received).toEqual(['TTS']);
  });

  it('키가 다른 리모컨의 명령과 재전송(replay)은 무시한다', async () => {
    const tablet = new RemoteClient('tablet', await createPairingSession(generatePairingKey()), undefined, {
      transports: [new FakeTransport('emqx', brokerA)],
    });
    const received: string[] = [];
    tablet.onMessage((body) => received.push(body.type));
    tablet.connect();

    // 공격자: 같은 채널에 다른 키로 암호화한 메시지 주입
    const attackerSession = await createPairingSession(generatePairingKey());
    brokerA.publish(
      [...brokerA.subscribers.keys()][0],
      await attackerSession.encrypt(
        JSON.stringify({ v: 2, id: 'evil', sender: 'remote', deviceId: 'x', ts: Date.now(), body: { type: 'ALERT' } })
      )
    );
    await flush();
    expect(received).toEqual([]);
  });

  it('정상 메시지를 그대로 다시 보내도(replay) 한 번만 처리한다', async () => {
    const key = generatePairingKey();
    const tablet = new RemoteClient('tablet', await createPairingSession(key), undefined, {
      transports: [new FakeTransport('emqx', brokerA)],
    });
    const remote = new RemoteClient('remote', await createPairingSession(key), undefined, {
      transports: [new FakeTransport('emqx', brokerA)],
    });
    const received: string[] = [];
    tablet.onMessage((body) => received.push(body.type));
    tablet.connect();
    remote.connect();

    await remote.send({ type: 'ALERT' });
    await flush();
    const captured = brokerA.published[brokerA.published.length - 1];
    brokerA.publish([...brokerA.subscribers.keys()][0], captured);
    await flush();
    expect(received).toEqual(['ALERT']);
  });
});

describe('PairingRepo (다중 태블릿)', () => {
  beforeEach(() => localStorage.clear());

  it('여러 태블릿을 추가/이름 갱신/삭제한다', () => {
    const k1 = generatePairingKey();
    const k2 = generatePairingKey();
    PairingRepo.upsertRemotePairing(k1, '1층');
    PairingRepo.upsertRemotePairing(k2, '2층');
    PairingRepo.upsertRemotePairing(k1, '1층 열람실');
    expect(PairingRepo.getRemotePairings().map((p) => p.name)).toEqual(['1층 열람실', '2층']);
    PairingRepo.removeRemotePairing(k1);
    expect(PairingRepo.getRemotePairings().map((p) => p.key)).toEqual([k2]);
  });

  it('태블릿 키 재발급 시 이전 키와 달라진다', () => {
    const before = PairingRepo.getOrCreateTabletKey();
    expect(PairingRepo.getOrCreateTabletKey()).toBe(before);
    expect(PairingRepo.rotateTabletKey()).not.toBe(before);
  });
});

describe('SET_MUTE 명령 검증', () => {
  it('muted가 boolean이 아니면 거부한다', () => {
    const env = (body: object) =>
      JSON.stringify({ v: 2, id: 'x', sender: 'remote', deviceId: 'd', ts: Date.now(), body });
    expect(parseEnvelope(env({ type: 'SET_MUTE', muted: true }))).not.toBeNull();
    expect(parseEnvelope(env({ type: 'SET_MUTE', muted: 'true' }))).toBeNull();
  });
});

describe('SET_STEALTH / SET_SCHEDULE 명령 검증', () => {
  const env = (body: object) =>
    JSON.stringify({ v: 2, id: 'x', sender: 'remote', deviceId: 'd', ts: Date.now(), body });
  it('형식이 틀리면 거부한다', () => {
    expect(parseEnvelope(env({ type: 'SET_STEALTH', enabled: true }))).not.toBeNull();
    expect(parseEnvelope(env({ type: 'SET_STEALTH', enabled: 1 }))).toBeNull();
    expect(parseEnvelope(env({ type: 'SET_SCHEDULE', rules: [] }))).not.toBeNull();
    expect(parseEnvelope(env({ type: 'SET_SCHEDULE', rules: 'x' }))).toBeNull();
  });
});

describe('START_MONITORING / STOP_MONITORING 명령', () => {
  it('리모컨이 보낸 측정 시작/정지 명령을 허용하고, 태블릿이 보낸 경우는 거부한다', () => {
    const env = (sender: string, body: object) =>
      JSON.stringify({ v: 2, id: 'x', sender, deviceId: 'd', ts: Date.now(), body });
    expect(parseEnvelope(env('remote', { type: 'START_MONITORING' }))).not.toBeNull();
    expect(parseEnvelope(env('remote', { type: 'STOP_MONITORING' }))).not.toBeNull();
    expect(parseEnvelope(env('tablet', { type: 'STOP_MONITORING' }))).toBeNull();
  });
});

describe('PLAY_ANNOUNCEMENT 명령 검증', () => {
  it('규칙 id 형식이 틀리면 거부한다', () => {
    const env = (body: object) =>
      JSON.stringify({ v: 2, id: 'x', sender: 'remote', deviceId: 'd', ts: Date.now(), body });
    expect(parseEnvelope(env({ type: 'PLAY_ANNOUNCEMENT', ruleId: 'abc123' }))).not.toBeNull();
    expect(parseEnvelope(env({ type: 'PLAY_ANNOUNCEMENT', ruleId: '<script>' }))).toBeNull();
    expect(parseEnvelope(env({ type: 'PLAY_ANNOUNCEMENT' }))).toBeNull();
  });
});
