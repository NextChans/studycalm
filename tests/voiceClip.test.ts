import { describe, it, expect } from 'vitest';
import { VoiceClipAssembler, splitVoiceClip, VOICE_CHUNK_BYTES, MAX_VOICE_BYTES } from '../src/core/remote/voiceClip';
import { parseEnvelope } from '../src/core/remote/remoteTypes';

const makeBlob = (size: number) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31) % 256;
  return new Blob([bytes], { type: 'audio/mp4' });
};

describe('voiceClip 분할/재조립', () => {
  it('순서가 뒤섞이고 중복된 조각도 원본과 동일하게 복원한다', async () => {
    const original = makeBlob(VOICE_CHUNK_BYTES * 2 + 123);
    const chunks = await splitVoiceClip(original, 'play', 'abcdef0123456789');
    expect(chunks).toHaveLength(3);

    const asm = new VoiceClipAssembler();
    expect(asm.push(chunks[2], 'dev1')).toBeNull();
    expect(asm.push(chunks[2], 'dev1')).toBeNull(); // 중복
    expect(asm.push(chunks[0], 'dev1')).toBeNull();
    const done = asm.push(chunks[1], 'dev1');
    expect(done).not.toBeNull();
    expect(done!.mode).toBe('play');
    expect(done!.blob.type).toBe('audio/mp4');
    expect(new Uint8Array(await done!.blob.arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()));
  });

  it('다른 기기가 같은 clipId로 조각을 끼워넣으면 무시한다', async () => {
    const chunks = await splitVoiceClip(makeBlob(VOICE_CHUNK_BYTES + 1), 'save', 'aaaaaaaabbbbbbbb');
    const asm = new VoiceClipAssembler();
    asm.push(chunks[0], 'owner');
    expect(asm.push(chunks[1], 'attacker')).toBeNull();
    expect(asm.push(chunks[1], 'owner')).not.toBeNull();
  });

  it('제한 시간 안에 조각이 다 오지 않으면 폐기한다', async () => {
    let t = 0;
    const chunks = await splitVoiceClip(makeBlob(VOICE_CHUNK_BYTES + 1), 'play', 'cccccccc11111111');
    const asm = new VoiceClipAssembler(() => t);
    asm.push(chunks[0], 'd');
    t += 31_000;
    expect(asm.pendingCount()).toBe(0);
    expect(asm.push(chunks[1], 'd')).toBeNull(); // 새 클립으로 시작되어 미완성
  });

  it('너무 큰 녹음은 분할을 거부한다', async () => {
    await expect(splitVoiceClip(makeBlob(MAX_VOICE_BYTES + 1), 'play')).rejects.toThrow();
  });

  it('조각 메시지 형식을 검증한다 (잘못된 mime/범위 거부)', async () => {
    const [chunk] = await splitVoiceClip(makeBlob(100), 'play', 'dddddddd22222222');
    const env = (body: object) =>
      JSON.stringify({ v: 2, id: 'x', sender: 'remote', deviceId: 'd', ts: Date.now(), body });
    expect(parseEnvelope(env(chunk))).not.toBeNull();
    expect(parseEnvelope(env({ ...chunk, mime: 'text/html' }))).toBeNull();
    expect(parseEnvelope(env({ ...chunk, seq: 5, total: 1 }))).toBeNull();
    expect(parseEnvelope(env({ ...chunk, mode: 'exec' }))).toBeNull();
    expect(parseEnvelope(env({ ...chunk, data: 'A'.repeat(20_000) }))).toBeNull();
  });
});

describe('voiceClip 정시 안내(announce) 조각', () => {
  it('slot(규칙 id)을 보존해 재조립하고, 형식 검증한다', async () => {
    const chunks = await splitVoiceClip(makeBlob(VOICE_CHUNK_BYTES + 5), 'announce', 'eeeeeeee33333333', 'rule01');
    const asm = new VoiceClipAssembler();
    asm.push(chunks[0], 'd');
    const done = asm.push(chunks[1], 'd');
    expect(done?.mode).toBe('announce');
    expect(done?.slot).toBe('rule01');

    const env = (body: object) =>
      JSON.stringify({ v: 2, id: 'x', sender: 'remote', deviceId: 'd', ts: Date.now(), body });
    expect(parseEnvelope(env(chunks[0]))).not.toBeNull();
    expect(parseEnvelope(env({ ...chunks[0], slot: undefined }))).toBeNull(); // announce인데 slot 없음
    expect(parseEnvelope(env({ ...chunks[0], slot: '../x' }))).toBeNull();
    expect(parseEnvelope(env({ ...chunks[0], mode: 'play' }))).toBeNull(); // play인데 slot 있음
  });
});
