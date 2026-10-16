import { describe, it, expect } from 'vitest';
import { sanitizeAlertVoice } from '../src/config/defaults';
import { SoundPlayer } from '../src/core/alert/SoundPlayer';
import { parseEnvelope } from '../src/core/remote/remoteTypes';

describe('sanitizeAlertVoice', () => {
  it('멘트 정리·중복 제거·최대 6개, 잘못된 모드는 기본 경고음', () => {
    const out = sanitizeAlertVoice({
      alertVoiceMode: 'random',
      alertPhrases: [' 조용히   해주세요. ', '조용히 해주세요.', '', 1, 'a', 'b', 'c', 'd', 'e', 'f'],
      alertFixedPhrase: '   ',
    });
    expect(out.alertVoiceMode).toBe('random');
    expect(out.alertPhrases).toEqual(['조용히 해주세요.', 'a', 'b', 'c', 'd', 'e']);
    expect(out.alertFixedPhrase).toBe('조용히 해주세요.'); // 빈 고정 멘트는 기본값
    expect(sanitizeAlertVoice({ alertVoiceMode: 'hack' }).alertVoiceMode).toBe('sound');
  });

  it('랜덤인데 멘트가 없으면 기본 경고음으로 되돌린다', () => {
    expect(sanitizeAlertVoice({ alertVoiceMode: 'random', alertPhrases: [] }).alertVoiceMode).toBe('sound');
  });
});

describe('SoundPlayer 경고 멘트 선택', () => {
  const pick = (p: SoundPlayer) => (p as unknown as { pickAlertPhrase: () => string | null }).pickAlertPhrase();

  it('기본 경고음 모드에서는 멘트를 쓰지 않는다', () => {
    const p = new SoundPlayer({ soundFiles: ['/x.wav'], volume: 0.5 });
    expect(pick(p)).toBeNull();
  });

  it('특정 멘트 모드는 항상 같은 멘트', () => {
    const p = new SoundPlayer({ soundFiles: ['/x.wav'], volume: 0.5 });
    p.setAlertVoice({ mode: 'fixed', fixed: '조용히 해주세요.', phrases: ['a', 'b'] });
    expect(new Set(Array.from({ length: 20 }, () => pick(p)))).toEqual(new Set(['조용히 해주세요.']));
  });

  it('랜덤 롤링은 선택한 멘트만, 같은 멘트를 연속으로 내지 않는다', () => {
    const p = new SoundPlayer({ soundFiles: ['/x.wav'], volume: 0.5 });
    const phrases = ['a', 'b', 'c'];
    p.setAlertVoice({ mode: 'random', fixed: 'x', phrases });
    const seq = Array.from({ length: 200 }, () => pick(p));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(new Set(seq)).toEqual(new Set(phrases)); // 모든 멘트가 고르게 등장
  });
});

describe('SET_ALERT_VOICE 명령 검증', () => {
  it('settings 객체가 없으면 거부', () => {
    const env = (body: object) =>
      JSON.stringify({ v: 2, id: 'x', sender: 'remote', deviceId: 'd', ts: Date.now(), body });
    expect(parseEnvelope(env({ type: 'SET_ALERT_VOICE', settings: { alertVoiceMode: 'fixed' } }))).not.toBeNull();
    expect(parseEnvelope(env({ type: 'SET_ALERT_VOICE' }))).toBeNull();
  });
});

describe('sanitizeDetection / SET_DETECTION / SET_TABLET_NAME', () => {
  it('범위 밖 값은 경계로, 단위(step)에 맞춰 보정하고 형식이 틀린 값은 버린다', async () => {
    const { sanitizeDetection } = await import('../src/config/defaults');
    expect(
      sanitizeDetection({ sustainMs: 99999, cooldownMs: 12_345, volume: 0.333, emaAlpha: 'x', postPlaybackMuteMs: -1 })
    ).toEqual({ sustainMs: 5000, cooldownMs: 10_000, volume: 0.35, postPlaybackMuteMs: 500 });
  });

  it('명령 형식 검증', () => {
    const env = (body: object) =>
      JSON.stringify({ v: 2, id: 'x', sender: 'remote', deviceId: 'd', ts: Date.now(), body });
    expect(parseEnvelope(env({ type: 'SET_DETECTION', settings: { sustainMs: 1000 } }))).not.toBeNull();
    expect(parseEnvelope(env({ type: 'SET_DETECTION' }))).toBeNull();
    expect(parseEnvelope(env({ type: 'SET_TABLET_NAME', name: '1층 휴게실' }))).not.toBeNull();
    expect(parseEnvelope(env({ type: 'SET_TABLET_NAME', name: '   ' }))).toBeNull();
    expect(parseEnvelope(env({ type: 'SET_TABLET_NAME', name: 'x'.repeat(100) }))).toBeNull();
  });
});
