/**
 * GET /api/tts?text=... → audio/mpeg (한국어 음성)
 *
 * 브라우저에서 외부 TTS를 직접 부르면 CSP(media-src/connect-src 'self')와 CORS에 막히고,
 * 기기 내장 speechSynthesis는 OS/보이스 설치 여부에 따라 무음이 되므로
 * 같은 출처의 서버리스 함수에서 음성을 합성해 모든 기기가 동일한 mp3를 받도록 한다.
 *
 * - GOOGLE_TTS_API_KEY 환경변수가 있으면 Google Cloud Text-to-Speech(공식, 권장)를 사용
 * - 없으면 Google Translate TTS 엔드포인트로 폴백 (비공식 — 운영 시 공식 API 키 설정 권장)
 * - 동일 문구는 Vercel CDN에 캐시되어 외부 호출이 반복되지 않는다.
 */
export const config = { runtime: 'edge' };

const MAX_TEXT_LENGTH = 120;

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function synthesizeWithCloudTts(text: string, apiKey: string): Promise<ArrayBuffer> {
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-A' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
    }),
  });
  if (!res.ok) throw new Error(`Cloud TTS HTTP ${res.status}`);
  const json = (await res.json()) as { audioContent?: string };
  if (!json.audioContent) throw new Error('Cloud TTS returned no audio');
  const bin = atob(json.audioContent);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function synthesizeWithTranslateTts(text: string): Promise<ArrayBuffer> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ko&client=tw-ob&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (StudyCalm TTS proxy)' },
  });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('audio')) throw new Error(`Translate TTS HTTP ${res.status} (${type})`);
  return res.arrayBuffer();
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return errorResponse(405, 'Method Not Allowed');

  // 다른 사이트에서 이 함수를 무료 TTS 프록시로 악용하는 것을 차단 (브라우저가 붙이는 위조 불가 헤더)
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return errorResponse(403, 'Forbidden');
  }

  const text = (new URL(req.url).searchParams.get('text') ?? '').trim();
  if (!text) return errorResponse(400, 'text is required');
  if (text.length > MAX_TEXT_LENGTH) return errorResponse(413, 'text too long');

  try {
    const apiKey = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.GOOGLE_TTS_API_KEY;
    const audio = apiKey ? await synthesizeWithCloudTts(text, apiKey) : await synthesizeWithTranslateTts(text);
    return new Response(audio, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        // 같은 문구는 CDN에서 1년 캐시 (문구 → 음성은 결정적)
        'cache-control': 'public, max-age=86400, s-maxage=31536000, immutable',
      },
    });
  } catch (err) {
    console.error('[api/tts] synthesis failed', err);
    return errorResponse(502, 'TTS synthesis failed');
  }
}
