# AI 칠판 (Apps in Toss) — 1타 강사 단계별 판서 & 온디맨드 강의 영상

전달해주신 **AI 칠판 시스템 프롬프트 및 서버 구현 체크리스트 7대 원칙**을 바탕으로 구축한 앱인토스(Apps in Toss) 웹 프레임워크(`@apps-in-toss/web-framework`) + Node/Vite API 통합 프로젝트입니다.

---

## 주요 구조 및 파일

- **프롬프트 및 스키마 정의**
  - [`docs/PROMPT_SPEC.md`](docs/PROMPT_SPEC.md): 시스템 프롬프트(SYSTEM), `TASK=SOLVE`, `TASK=VIDEO` 명세 및 서버 체크리스트 문서
  - [`src/shared/schema.ts`](src/shared/schema.ts): `SolveResponse`, `VideoResponse` 타입 및 엄격한 런타임 JSON 스키마 검증기 (`validateSolveResponse`, `validateVideoResponse`, `parseStrictJson`)
  - [`src/server/prompts.ts`](src/server/prompts.ts): 공통 `SYSTEM` 프롬프트, `TASK=VIDEO` 추가 프롬프트, 1·2차 사용자 메시지 템플릿 빌더
- **서버 파이프라인 & 체크리스트 7대 검증**
  - [`src/server/privacy.ts`](src/server/privacy.ts): AI 호출 전 이름·연락처·이메일·주민번호·학교정보 자동 마스킹 및 `kid` 모드 원문 미저장 정책
  - [`src/server/verifier.ts`](src/server/verifier.ts): `verify` 배열 수식의 서버 측 계산(`mathjs` 기호·수치 평가) 및 `SOLVE` ↔ `VIDEO` 수식·숫자 일치 검증
  - [`src/server/aiService.ts`](src/server/aiService.ts): 1차(`TASK=SOLVE`)·2차(`TASK=VIDEO`) 호출 오케스트레이터 (실패 시 최대 2회 자동 재요청 + 외부 OpenAI/Gemini API 연동 및 내장 1타 강사 엔진 지원)
  - [`src/server/apiPlugin.ts`](src/server/apiPlugin.ts): `/api/solve`, `/api/video`, `/api/privacy-policy` 엔드포인트 제공
- **프론트엔드 UI 컴포넌트**
  - [`src/App.tsx`](src/App.tsx): 모드(`kid` / `high` / `adult`) 및 액션(`solve` / `explain`) 선택, 하단 `"AI가 생성한 설명이에요"` 고정 배지
  - [`src/components/ChalkboardStepView.tsx`](src/components/ChalkboardStepView.tsx): 1차 호출(`TASK=SOLVE`) Step별 칠판 판서 화면, `status="clarify"` 되묻기 UI, `status="unsupported"` 안내 UI, 확인문제 채점기
  - [`src/components/VideoChalkboardPlayer.tsx`](src/components/VideoChalkboardPlayer.tsx): 사용자가 **[상세 설명 영상 재생]** 버튼을 누를 때만 2차 호출(`TASK=VIDEO`)을 수행하여 재생하는 실시간 판서 애니메이션(`write`, `underline`, `circle`, `arrow`, `highlight`, `erase`) + 한국어 음성(TTS) 플레이어
  - [`src/components/PromptInspectorModal.tsx`](src/components/PromptInspectorModal.tsx): 7대 체크리스트 통과 상태 및 1·2차 호출 JSON 입출력을 실시간으로 확인하는 인스펙터 모달

---

## 실행 방법

```bash
# 개발 서버 실행 (프론트엔드 + /api/solve, /api/video 서버 동시 구동)
npm run dev

# 서버 체크리스트 7대 자동 검증 테스트 실행
npm test

# 프로덕션 빌드 (웹 및 앱인토스 .ait 번들)
npm run build
```
