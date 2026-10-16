# AGENTS.md — StudyCalm 작업 규칙 (AI/개발자 공통)

먼저 **[docs/HANDOFF.md](docs/HANDOFF.md)** 를 읽으세요. 이 문서에는 아키텍처, 프로토콜, 제약, 백로그가 정리되어 있습니다.

## 검증 명령 (CI와 동일)
```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
npm run typecheck && npm run lint && npm test && npm run build
```

## 반드시 지킬 것
- Supabase secret 또는 service_role 키, DB 비밀번호, `postgresql://` 문자열은 사용하지도 커밋하지도 마세요. 공개 config는 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY` 두 개뿐입니다.
- `GOOGLE_TTS_API_KEY`는 서버 전용 secret입니다. `VITE_` 접두사를 붙이지 마세요.
- 원격 명령으로 받은 값은 태블릿에서 **반드시 다시 검증(sanitize)** 하세요.
  - 새 명령을 추가하면 `remoteTypes.ts`의 `COMMAND_TYPES`와 `parseEnvelope`, `useTabletRemote.ts`, `App.tsx`, `RemoteControllerView.tsx`, 테스트를 함께 수정합니다.
- 관리자 PIN 변경과 페어링 키 재발급은 태블릿에서만 하도록 둡니다. 원격 명령으로 추가하지 마세요.
- 소리는 반드시 `SoundPlayer`의 공유 Web Audio 컨텍스트로 재생하세요. 제스처 없이 `new Audio().play()`를 호출하면 iOS와 Android에서 막힙니다.
- 경고 음원을 교체하면 `src/config/defaults.ts`의 `?v=` 값, `public/sw.js`의 precache, `CACHE_NAME`을 함께 올리세요.
- 오디오를 녹음하거나 원격으로 송신하는 기능(실시간 청취 등)은 만들지 마세요. 법적 위험이 있습니다.
- 커밋, PR, 코드에 AI 모델 식별자를 넣지 마세요.

## 작업 흐름
- `origin/main` 기준으로 브랜치를 만들고, 커밋 메시지는 한국어 conventional 형식(`feat(remote): …`, `fix: …`)으로 씁니다.
- PR을 올린 뒤 CI(`build-and-test`)와 Vercel Preview가 통과하면 squash merge합니다. 오너는 main 머지까지 진행하기를 원합니다.
- 배포 확인: `https://studycalm-five.vercel.app/version.json`의 값이 머지 커밋 SHA와 같아야 합니다.
