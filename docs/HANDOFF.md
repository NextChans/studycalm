# StudyCalm 인수인계 문서 (Handoff)

> 다른 개발자나 AI가 이어서 작업할 수 있도록 현재 구조, 결정 사항, 제약, 작업 방식, 남은 과제를 정리한 문서입니다.
> 기준 시점은 2026-10-16, `main` = `38ff9a6` (PR #14)입니다. 배포 주소는 https://studycalm-five.vercel.app/ 입니다.

---

## 1. 제품 개요

스터디카페 **휴게실(라운지)** 에 숨겨 설치한 태블릿이 마이크로 소음 레벨(dBFS)만 측정합니다. 기준 대비 임계치를 일정 시간 넘으면 음성으로 주의 안내를 합니다. 관리자는 휴대폰 **리모컨**으로 여러 태블릿을 원격 관리합니다.

- **오디오는 녹음하거나 전송하지 않습니다.** 메모리 안에서 레벨만 계산합니다.
  - 리모컨으로 실시간 소리를 듣는 기능은 통신비밀보호법 §14 위험 때문에 **의도적으로 만들지 않았습니다.**
- **로그인과 계정이 없습니다.** 태블릿마다 발급한 **페어링 키(QR)** 를 가진 사람이 그 태블릿의 관리자입니다.
  - 다매장 구조(가/나/다 매장)는 매장별로 서로 다른 키를 쓰는 것으로 충분히 분리됩니다. 사용자가 "지금 구조 유지"를 결정했습니다.
- 지원 대상은 Windows, Mac, Android 태블릿·폰, iPhone, iPad입니다. 모두 브라우저(PWA)로 동작합니다.

### 역할별 화면

| URL | 화면 | 설명 |
|---|---|---|
| `/` | 태블릿(측정기) | 마이크 측정, 자동 경고, 설정(PIN), QR 발급 |
| `/?mode=remote#k=<KEY>&n=<NAME>` | 리모컨 | QR을 찍으면 열립니다. 키는 fragment로만 전달되어 서버 로그에 남지 않습니다. |
| `/remote` | 리모컨(레거시 경로) | `vercel.json` rewrite → `/` |

---

## 2. 기술 스택과 인프라

- **프론트엔드**: Vite, React 18, TypeScript(strict), Tailwind v4. 순수 SPA입니다.
- **서버**: Vercel Edge Function 하나뿐입니다(`api/tts.ts`). 백엔드나 DB 서버는 없습니다.
- **원격 중계**:
  - Supabase Realtime Broadcast(무료 플랜, DB와 Data API는 쓰지 않음)
  - 공용 MQTT 브로커 EMQX(`wss:8084`), HiveMQ(`wss:8884`)
- **저장소**: 각 기기의 `localStorage`(설정, PIN 해시, 페어링)와 `IndexedDB`(커스텀 경고음, 안내 녹음)
- **CI**: `.github/workflows/ci.yml`에서 typecheck → lint → test → build를 실행합니다. Vercel이 PR마다 Preview를 배포합니다.

### 환경 변수

| 이름 | 위치 | 성격 | 비고 |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Vercel (등록됨) | 공개 config | 번들에 포함됩니다. 프로젝트 ref는 `fvzzimmrngxxyraztfjm` |
| `VITE_SUPABASE_ANON_KEY` | Vercel (등록됨) | 공개 config (publishable key) | 번들에 포함됩니다. |
| `GOOGLE_TTS_API_KEY` | Vercel (미등록, 선택) | **Secret** | `VITE_` 접두사를 **붙이면 안 됩니다**. Sensitive로 등록합니다. 설정하면 Cloud TTS(ko-KR-Neural2-A)를 사용합니다. |

**보안 규칙 (반드시 지킬 것)**

- Supabase의 `service_role` / secret key, DB 비밀번호, `postgresql://` 접속 문자열은 **절대 사용하거나 커밋하지 않습니다.** 필요하지도 않습니다.
- Supabase 설정 상태:
  - Data API는 비활성화되어 있습니다.
  - RLS 자동 활성화가 켜져 있습니다.
  - Realtime "Allow public access"가 켜져 있습니다. Broadcast 채널을 익명으로 쓰기 때문에 켜 두어야 하며, 보안은 E2E 암호화로 보장합니다.
- 관리자 PIN 변경과 페어링 키 재발급은 **태블릿에서만** 할 수 있습니다(설계 의도). 원격 명령으로 추가하지 마세요.
- 커밋, PR, 코드에 AI 모델 식별자를 넣지 않습니다.

---

## 3. 아키텍처

### 3.1 측정과 판정

```
마이크 → AudioEngine(AnalyserNode) → RmsDetector(dBFS) → EmaFilter → NoiseStateMachine
                                                                  ↓ ALERTING
                                                        SoundPlayer.playNextAlert()
```

- `src/core/machine/NoiseStateMachine.ts`의 상태 흐름: IDLE → CALIBRATING → MONITORING ⇄ EXCEEDING → ALERTING → COOLDOWN
- 기준(baseline)과 임계치
  - 기준: `baselineMode`가 `auto`이면 보정 중앙값, `manual`이면 `manualBaselineDb`
  - 임계치: `thresholdMode`가 `offset`이면 기준 + N, `absolute`이면 `absoluteThresholdDb`
- 스케줄
  - `src/core/schedule/schedule.ts`의 `applySchedule(config, now)`가 **실효 설정(effectiveConfig)** 을 만듭니다.
  - 규칙 모드는 `mute`, `threshold`, `announce`(정시 안내 방송) 세 가지입니다.
  - 자정을 넘는 구간은 시작 요일을 기준으로 판정합니다.
- 음소거(`autoAlertMuted`): 측정과 판정은 계속하고 **자동 경고만** 재생하지 않습니다. 관리자 수동 방송은 재생합니다.

### 3.2 소리 출력 — 가장 사고가 많았던 영역

`src/core/alert/SoundPlayer.ts`

- **모든 재생은 공유 Web Audio AudioContext 하나로** 합니다. 파일을 `decodeAudioData`로 디코딩한 뒤 `AudioBufferSourceNode`로 재생합니다.
  - 이유: iOS와 Android Chrome은 사용자 제스처 밖에서 호출한 `new Audio().play()`를 막습니다. 자동 경고는 제스처가 없는 상황에서 재생되기 때문입니다.
  - AudioContext는 전역 `pointerdown`에서 unlock됩니다(`unlock()`). **iPad는 새로고침한 뒤 화면을 한 번 터치해야 소리가 납니다.** 이 상태는 텔레메트리의 `isAudioUnlocked`로 리모컨에 표시됩니다.
- 폴백 순서: Web Audio → HTMLAudio → `speechSynthesis`(VoiceFallback)
- 재생은 **직렬 큐**로 처리합니다.
  - `run('drop-if-busy' | 'queue')` 두 가지 방식이 있습니다.
  - `stop()`은 generation 카운터를 올려 대기 중인 재생까지 취소합니다.
- 자동 경고 음성(`alertVoiceMode`)
  - `sound`: 경고음 파일 또는 등록된 녹음
  - `fixed`: 특정 멘트를 TTS로 재생
  - `random`: 멘트를 랜덤으로 롤링(직전 멘트는 반복하지 않음)
- TTS
  - 클라이언트는 `GET /api/tts?text=`를 호출하고 결과를 AudioBuffer로 받습니다(LRU 20개 캐시).
  - `api/tts.ts`(Edge)는 same-origin(`Sec-Fetch-Site`)만 허용하고 텍스트는 최대 120자입니다. 응답은 CDN에 캐시됩니다.
  - 키가 없으면 비공식 `translate_tts` 엔드포인트를 쓰므로 언제든 막힐 수 있습니다. **`GOOGLE_TTS_API_KEY` 등록을 권장합니다.**
- 기본 경고음은 `public/sounds/alert-1.wav?v=3`(약 3초, 차임과 음성)입니다.
  - **음원을 바꾸면 `?v=`를 올려야 합니다.** `src/config/defaults.ts`와 `public/sw.js`의 precache 두 곳을 함께 바꿉니다. 그렇지 않으면 구 SW나 브라우저 캐시가 옛 파일을 계속 재생합니다. "차임벨만 나온다"는 버그의 원인이 이것이었습니다.
  - 모든 태블릿이 같은 멘트를 내도록 파일 로테이션은 하지 않습니다. 첫 번째 파일만 사용합니다.

### 3.3 원격 리모컨 (E2E 암호화 다중 중계)

`src/core/remote/`

| 파일 | 역할 |
|---|---|
| `pairing.ts` | 32바이트 키를 생성합니다. `channelId = SHA-256(key)`에서 파생한 값입니다. AES-GCM으로 암호화하며 AAD는 channelId입니다. 그 밖에 fingerprint와 링크 파싱(`#k=&n=`)을 담당합니다. |
| `transports.ts` | `SupabaseTransport`(채널 `studycalm-<channelId>`, 이벤트 `m`, payload `{d}`)와 `MqttTransport`(토픽 `studycalm/v2/<channelId>`)를 정의합니다. Supabase는 env가 있을 때만 사용합니다. |
| `RemoteClient.ts` | 모든 transport에 **동시에 publish(fan-out)** 합니다. 수신 측은 message id로 중복을 제거합니다(최근 500개). 시계 오차는 ±5분까지 허용하고 32KB를 넘는 메시지는 거부합니다. online 또는 visibility 이벤트가 오면 재연결합니다. |
| `remoteTypes.ts` | 명령과 이벤트 타입, 그리고 `parseEnvelope`(복호화 후 런타임 검증)를 정의합니다. |
| `voiceClip.ts` | 리모컨 녹음을 9KB 조각으로 나누어 120ms 간격으로 보냅니다. 최대 40조각(약 360KB, 15초, 32kbps AAC 우선)이고 `VoiceClipAssembler`가 조립합니다. |

봉투 형식은 `{ v: 2, id, sender: 'tablet'|'remote', deviceId, ts, body }`이며 이 봉투 전체가 AES-GCM으로 암호화됩니다.

**리모컨 → 태블릿 명령 (`RemoteCommand`)**

| 명령 | 내용 |
|---|---|
| `ALERT` | 즉시 주의 방송 |
| `TTS {text}` | 맞춤 멘트 방송 |
| `STOP` | 재생 중이거나 대기 중인 방송을 중지 |
| `RECALIBRATE` | 배경소음 재보정 |
| `ADJUST {tuning}` | 기준과 임계치 조정 |
| `SET_DETECTION {settings}` | 지속시간, 쿨다운, 볼륨 등 |
| `SET_ALERT_VOICE {settings}` | 자동 경고 음성 방식 |
| `SET_MUTE {muted}` | 자동 경고 음소거 |
| `SET_STEALTH {enabled}` | 검은 화면 모드 |
| `SET_SCHEDULE {rules}` | 스케줄 전체 교체 |
| `PLAY_ANNOUNCEMENT {ruleId}` | 정시 안내 미리 방송 |
| `START_MONITORING` / `STOP_MONITORING` | 측정 시작과 정지 |
| `SET_TABLET_NAME {name}` | 태블릿 이름 변경 |
| `RESET_ALERT_SOUND` | 커스텀 경고음 삭제 |
| `APPLY_UPDATE` | 새 버전 즉시 적용 |
| `VOICE_CHUNK` | 녹음 조각. `mode`는 `play`(즉시 방송), `save`(경고음 등록), `announce`(`slot` = 정시 안내 규칙 id) |
| `PING` | 리모컨이 보고 있음을 알리고 텔레메트리를 요청 |

**태블릿 → 리모컨 이벤트**

- `TELEMETRY`: `TelemetryData`. 필드는 `remoteTypes.ts`를 참고하세요.
- `BROADCAST_STATUS`: `PLAYING`, `DONE`, `FAILED`, `STOPPED` 중 하나

**텔레메트리 정책**: 최근 15초 안에 PING을 보낸 리모컨이 있을 때만 1Hz로 보냅니다. Supabase 무료 메시지 쿼터를 아끼기 위해서입니다.

**새 명령을 추가할 때 체크리스트**

1. `remoteTypes.ts`의 `RemoteCommand` 유니온, `COMMAND_TYPES` Set, `parseEnvelope` 필드 검증
2. `useTabletRemote.ts`의 `switch` 분기와 `TabletRemoteHandlers`
3. `App.tsx`의 핸들러 구현
4. `RemoteControllerView.tsx`의 UI와 `useRemoteFleet` 송신
5. 태블릿에서 **입력을 다시 검증**합니다(`sanitize*`). 키를 가진 리모컨이라도 값을 신뢰하지 않습니다.
6. `tests/remote.test.ts`에 파싱 테스트를 추가합니다.

### 3.4 보안과 권한

- **관리자 PIN**: 4자리 SHA-256 해시입니다(`src/core/storage/pinAuth.ts`).
  - 5회 틀리면 잠깁니다. 잠금 시간은 1분에서 시작해 2배씩 늘어나 최대 60분입니다.
  - PIN이 필요한 작업: 설정 열기, 리모컨 QR 표시, 측정 정지, 재보정
- **리모컨**: 페어링 키를 가진 것 자체가 관리자 인증입니다. 그래서 원격 정지와 재보정에는 PIN을 묻지 않습니다.
- **키 재발급**: 태블릿 QR 화면에서 재발급하면 기존 리모컨이 모두 차단됩니다.

### 3.5 PWA, 무인 운영, 업데이트

- `public/sw.js`(현재 `studycalm-v5`)
  - `skipWaiting`으로 새 SW를 바로 활성화합니다.
  - 음원은 network-first로 가져옵니다.
  - `/api/`와 `/version.json`은 캐시하지 않습니다.
- 자동 업데이트(`src/hooks/useAppUpdate.ts`)
  - 빌드 시 `vite.config.ts` 플러그인이 `dist/version.json`을 만듭니다. 내용은 `VERCEL_GIT_COMMIT_SHA`입니다.
  - 태블릿은 5분마다 이 파일을 폴링해 자기 `__APP_VERSION__`과 비교합니다.
  - 새 버전이 있으면 리모컨에 "업데이트 있음"을 표시합니다. 새벽 3~5시에는 재생이 끝난 뒤 자동으로 새로고침합니다. 리모컨의 "지금 업데이트"(`APPLY_UPDATE`)로 바로 적용할 수도 있습니다.
  - **PR #14 이전 코드로 돌던 태블릿은 이 장치가 없으므로 한 번 수동으로 새로고침해야 합니다.**
- 무인 운영 장치
  - 측정 자동 재개: `MONITORING_DESIRED` 플래그. 재부팅이나 새로고침 뒤에도 마이크 권한이 이미 허용되어 있으면 측정을 다시 시작합니다.
  - Wake Lock으로 화면을 켜 둡니다.
  - 숨김(Stealth) 오버레이: 터치하면 30초 동안 화면을 보여 줍니다.
  - 배터리 정보는 Battery API를 씁니다. **iPad와 iOS는 지원하지 않으며**, README에 단축어 자동화로 대체하는 방법이 있습니다.
  - 정시 안내: 15초 간격으로 확인합니다. 2분까지 늦게 울릴 수 있고 같은 규칙은 하루에 한 번만 울립니다. 기록은 `ANNOUNCE_FIRED`에 남습니다.
  - `navigator.storage.persist()`를 요청합니다.
- 리모컨 이슈 배너: 오프라인, 측정 정지, 마이크 오류, 오디오 잠김, 구버전, 업데이트 대기, 배터리 부족

---

## 4. 파일 맵

```
api/tts.ts                       Edge TTS 프록시
public/sw.js                     서비스워커 (CACHE_NAME 버전 주의)
public/sounds/alert-1.wav        기본 경고음 (?v=3)
vercel.json                      rewrite, CSP(connect-src에 supabase/emqx/hivemq), 캐시 헤더
vite.config.ts                   __APP_VERSION__ 주입, version.json 생성
src/App.tsx                      mode=remote 분기(리모컨 뷰) + 태블릿 셸: PIN 게이트, 원격 핸들러, 텔레메트리 구성, 정시 안내 타이머
src/config/defaults.ts           NoiseConfig, DEFAULT_CONFIG, sanitizeTuning/AlertVoice/Detection, 범위 상수
src/core/audio/*                 AudioEngine, RmsDetector, EmaFilter, Detector 인터페이스
src/core/machine/*               NoiseStateMachine
src/core/alert/*                 SoundPlayer, ChimeSynthesizer, VoiceFallback
src/core/remote/*                페어링, 암호화, 중계, 프로토콜, 음성 조각
src/core/schedule/schedule.ts    스케줄 규칙, 실효 설정, 정시 안내 판정
src/core/storage/*               storageKeys(모든 키 목록), settingsRepo, pinAuth, pairingRepo, customAudioRepo(IndexedDB), counterRepo
src/hooks/useNoiseMonitor.ts     측정과 재생 통합 훅
src/hooks/useTabletRemote.ts     태블릿 쪽 원격 수신과 처리
src/hooks/useRemoteFleet.ts      리모컨 쪽: 페어링한 태블릿마다 RemoteClient 1개
src/hooks/useAppUpdate.ts        버전 감지와 자동 적용
src/components/RemoteControllerView.tsx  리모컨 대시보드 (빠른 작업 + 접이식 설정 그룹)
src/components/SettingsModal.tsx         태블릿 설정
src/components/RemoteConnectModal.tsx    QR, 이름, 키 재발급
tests/*.test.ts                  vitest 단위 테스트 (64개)
```

**설정 저장 원칙**: `settingsRepo.load()`는 항상 sanitize를 거칩니다. `soundFiles`는 저장값 대신 기본값을 강제합니다. 새 설정 필드를 추가하면 `DEFAULT_CONFIG`, 해당 sanitizer, 텔레메트리, 리모컨 UI를 함께 갱신해야 합니다.

---

## 5. 개발, 검증, 배포 절차

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
npm run typecheck && npm run lint && npm test && npm run build   # CI와 같은 순서
```

### E2E (수동, 저장소에 스크립트 없음)

이전 작업에서는 다음 방식으로 실제 동작을 확인했습니다.

- `puppeteer-core`로 Chromium(`/opt/pw-browsers/chromium`)을 실행합니다. 이때 `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<loud.wav>` 플래그를 씁니다.
- tsx로 띄운 간단한 로컬 서버가 `dist`를 서빙하고 `/api/tts`를 프록시합니다(`.json` content-type 필요).
- 태블릿 탭과 리모컨 탭(`/?mode=remote#k=...`)을 동시에 열어 Supabase 경유 명령과 텔레메트리를 확인했습니다.
- 샌드박스는 8084와 8884 포트를 막으므로 MQTT 경로는 검증하지 못했습니다. 실제 기기에서 확인해야 합니다.
- 백그라운드 탭은 visibility 이벤트가 오지 않으므로 `page.bringToFront()`를 사용합니다.

### 배포 흐름 (지금까지의 관례)

1. 작업 브랜치를 `origin/main` 기준으로 다시 만듭니다. 예: `git checkout -B claude/<name> origin/main`
2. 커밋 메시지는 한국어 conventional 형식입니다(`feat(remote): ...`, `fix: ...`).
3. PR(base `main`)을 만들고 CI(`build-and-test`)와 Vercel Preview가 성공하는지 확인합니다.
4. **squash merge**하면 Vercel이 production에 자동 배포합니다.
5. 배포를 확인합니다. `https://studycalm-five.vercel.app/version.json`의 값이 머지 커밋 SHA와 같아야 합니다.
6. 숨김 태블릿은 새벽 3~5시에 자동으로 적용됩니다. 바로 적용하려면 리모컨 → 기기 → "지금 업데이트"를 누릅니다.

사용자(오너)는 변경을 **main 머지까지** 진행하기를 원합니다.

---

## 6. 알려진 제약

| 항목 | 내용 | 대응 |
|---|---|---|
| iPad 오디오 잠금 | 새로고침한 뒤 터치하기 전까지 소리가 나지 않습니다. | 리모컨에 "오디오 잠김"을 표시합니다. 현장에서 한 번 터치합니다. |
| 원격 측정 시작 | 마이크 권한이 이미 허용된 경우에만 동작합니다. | 처음 한 번은 현장에서 허용합니다. |
| iPad 배터리 | Battery API를 지원하지 않습니다. | README의 단축어 자동화 안내를 따릅니다. |
| Supabase 무료 플랜 | 오랫동안 쓰지 않으면 프로젝트가 일시정지될 수 있습니다. | MQTT로 폴백합니다. 대시보드에서 재개합니다. |
| 비공식 TTS | `translate_tts`는 언제든 막힐 수 있습니다. | `GOOGLE_TTS_API_KEY`를 등록합니다. |
| 공용 MQTT | 가용성을 보장하지 않습니다. 사내망에서 8084와 8884 포트가 막힐 수 있습니다. | Supabase(443)를 주 경로로 씁니다. |
| 번들 크기 | 500KB를 넘는다는 경고가 나옵니다(mqtt, supabase). | 리모컨, mqtt 동적 import로 분할하는 작업이 백로그에 있습니다. |
| 설정 동기화 충돌 | 리모컨 여러 대가 동시에 수정하면 마지막에 보낸 값이 적용됩니다(LWW). | 현재 규모에서는 허용합니다. |

---

## 7. 백로그 아이디어 (우선순위 순, 미착수)

1. **번들 분할**: 태블릿이 아닌 리모컨에서만 필요한 코드와 mqtt를 `import()`로 지연 로딩합니다.
2. **소음 통계와 그래프**: 시간대별 경고 횟수와 평균 dB를 태블릿 로컬에 집계하고 텔레메트리로 요약을 보냅니다. 오디오는 계속 보내지 않습니다.
3. **Web Push 알림**: 태블릿 오프라인, 배터리 부족 등을 알립니다. 다만 서버 측 푸시 발송 주체(Edge 함수와 VAPID 키)가 필요합니다.
4. **E2E 테스트 자동화**: 위 puppeteer 절차를 `scripts/e2e.ts`로 저장소에 넣고 CI에서 선택적으로 실행합니다.
5. **로그인 기반 다매장 계정**: 현재는 필요 없다고 결정했습니다. 도입한다면 Supabase Auth와, RLS를 적용한 `stores`/`tablets` 테이블이 필요합니다. 채널 E2E 키 모델은 그대로 둡니다.
6. **VAD/음성 대역 필터**: `Detector` 인터페이스로 사람 말소리만 판정하도록 바꿉니다(README "확장 지점").

---

## 8. 작업 이력 요약 (PR #1–#14)

- #1–#3: 음성 재생 수정(Web Audio, `/api/tts`), 원격 재설계(E2E, Supabase+MQTT fan-out), `/remote` 404 수정(루트 `?mode=remote`)
- #4: 기기마다 멘트가 달라지던 문제를 해결했습니다. 경고음 로테이션을 제거했습니다.
- #5–#9: 다중 태블릿 리모컨, 수동 기준과 임계치, 원격 STOP, PIN 게이트, 원격 녹음(즉시 방송과 경고음 등록), 음소거, 숨김 설치 5종(stealth, 자동 재개, 이슈 배너, 스케줄, 배터리), 원격 측정 시작과 정지
- #10–#11: 정시 안내 방송(텍스트 수정, 녹음), 리모컨 프리셋 편집, 기본 프리셋 문구 교체
- #12: 자동 경고 음성 방식(기본음, 고정 멘트, 랜덤 롤링)
- #13: 태블릿 설정을 리모컨에서 바꿀 수 있게 하고, 리모컨 설정을 접이식 그룹으로 정리
- #14: 구버전 코드로 계속 돌던 문제를 해결했습니다(version.json 자동 업데이트). "스케줄 추가가 저장되지 않는다"는 버그의 원인이었습니다.
