# Apps in Toss (앱인토스) 포팅 및 바이브코딩 가이드 (`AGENTS.md`)

이 워크스페이스는 **Apps in Toss (앱인토스)** 미니앱 **`aiboard` (AI 칠판)** 개발 및 포팅을 위한 프로젝트 공간입니다. VSCode + Google Antigravity 환경에서 에이전트는 코드를 작성하거나 수정할 때 반드시 아래 규칙과 공식 레퍼런스(`toss/apps-in-toss-examples`)를 따릅니다.

---

## 1. 앱인토스 프로젝트 설정 정보 (`aiboard`)

- **App Name (`appName`)**: `aiboard` ([`apps-in-toss.config.ts`](apps-in-toss.config.ts))
- **산출물 번들 (`.ait`)**: `aiboard.ait` (`npm.cmd run build` 실행 시 `dist/` 및 루트에 `aiboard.ait` 자동 생성)
- **배포 명령 (`ait deploy`)**:
  - `npm.cmd run deploy` (API 키가 설정되어 있어 즉시 배포 가능)
  - 또는 로컬 프로필 저장: `npm.cmd run token:add` (`~/.ait/credentials`의 `default` 프로필에 저장)

---

## 2. 필수 기술 스택 및 최신 SDK 규칙 (`@apps-in-toss/web-framework` 3.x 기준)

1. **설정 파일 ([`apps-in-toss.config.ts`](apps-in-toss.config.ts))**
   - 구버전의 `granite.config.ts`나 `granite` CLI 명령어를 사용하지 않습니다.
   - 반드시 `@apps-in-toss/web-framework/config`의 `defineConfig`를 사용하는 **`apps-in-toss.config.ts`**와 `ait` CLI(`vite build && ait build`, `ait deploy`)를 사용합니다.
2. **프론트엔드 및 토스 디자인 시스템 (TDS)**
   - 엔트리 포인트([`src/main.tsx`](src/main.tsx))는 `@toss/tds-mobile-ait`의 `<TDSMobileAITProvider brandPrimaryColor={config.brand.primaryColor}>`로 감싸야 합니다.
   - WebView 미니앱은 `@apps-in-toss/web-framework`와 토스 디자인 시스템(`@toss/tds-mobile`, `@toss/tds-mobile-ait`, `@toss/tds-colors`)을 우선 사용합니다.
   - 로컬 개발 시 `@apps-in-toss/devtools`가 [`vite.config.ts`](vite.config.ts)에 연결되어 있으므로 `npm.cmd run dev`로 브라우저 및 Devtools 환경에서 즉시 확인합니다.
3. **공식 예제 (`toss/apps-in-toss-examples`) 및 MCP 우선 참조**
   - 브릿지 연동 코드([`src/utils/aitBridge.ts`](src/utils/aitBridge.ts))는 공식 레포지토리 https://github.com/toss/apps-in-toss-examples 의 모듈 패턴을 따릅니다:
     - `common-apis`: `share`, `setClipboardText`, `getOperationalEnvironment`, `openURL`
     - `device-apis`: `generateHapticFeedback`, 권한 요청(`getPermission`, `openPermissionDialog`)
     - `in-app-ads`: `GoogleAdMob`, `TossAds`
     - `in-app-payments`: `IAP.getProductItemList`, `IAP.createOneTimePurchaseOrder`, `IAP.getPendingOrders`, `IAP.completeProductGrant`
     - `toss-login` / `user-identification`: `appLogin`, `getAnonymousKey`
   - SDK API 시그니처가 불확실할 때는 추측하지 말고 `apps-in-toss` MCP 서버(`search_docs`, `get_doc`, `search_tds_web_docs`, `get_tds_web_doc`)를 먼저 조회합니다.

---

## 3. AI 칠판 (`aiboard`) 2단계 호출 및 서버 체크리스트 7대 원칙

1. **1차 호출 (`TASK=SOLVE`)**: Step별 판서 풀이 JSON 생성 (`status: "ok" | "clarify" | "unsupported"`)
2. **2차 호출 (`TASK=VIDEO`)**: 비용 절약을 위해 사용자가 **[상세 설명 영상 재생]** 버튼을 누를 때만 호출하여 4~10개 장면의 칠판 판서 액션(`write`, `underline`, `circle`, `arrow`, `highlight`, `erase`) 생성
3. **서버 구현 7대 체크리스트 ([`src/server/`](src/server/))**:
   - JSON 파싱 및 스키마 외 키 엄격 차단 (실패 시 최대 2회 자동 재요청)
   - `verify` 배열의 수식을 서버(`mathjs`)에서 계산해 `expected`와 비교 검증
   - `clarify` 되묻기 UI 및 `unsupported` 안내 UI 분기
   - `VIDEO` 생성 시 `SOLVE` 결과의 숫자·수식 일치 여부 비교 검증
   - 앱 UI 하단에 `"AI가 생성한 설명이에요"` 문구 상시 고정 노출
   - AI 호출 전 이름·연락처·이메일·주민번호·학교정보 사전 마스킹 및 `kid` 모드 원문 미저장
   - 개인정보 처리방침에 맞춘 질문 원문 보관 여부 및 만료 기간 관리

---

## 4. Windows + VSCode + Antigravity 실행 및 빌드 명령어

```powershell
# 1. 개발 서버 실행 (Vite + Apps in Toss Devtools + /api/solve, /api/video 서버)
npm.cmd run dev

# 2. 서버 체크리스트 7대 검증 테스트
npm.cmd test

# 3. 프로덕션 빌드 및 aiboard.ait 패키징
npm.cmd run build

# 4. 앱인토스 콘솔 배포
npm.cmd run deploy
```
