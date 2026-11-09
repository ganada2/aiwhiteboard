# HPE Tandem PATHWAY 카드 승인 서버 — Vercel Serverless (TypeScript)

`card_auth_pathway`(C 기반 Tandem NonStop PATHWAY 서버)의 전문 규격과 하위 서비스 오케스트레이션 흐름을 **Vercel 단독 서버리스 배포(Node.js / TypeScript Web Standard Fetch API + 정적 대시보드 UI)** 환경으로 변환한 프로젝트입니다.

## 디렉터리 구조

```text
card_auth_vercel/
├── api/
│   ├── index.ts              # Vercel Serverless Function 통합 엔드포인트 (/api/*)
│   └── _lib/                 # 내부 도메인 모듈 (라우트 비노출)
│       ├── types.ts          # ISO 8583 상수, 응답 코드, MTI, 전문 규격 타입 (card_auth.h 대응)
│       ├── wire.ts           # 112B 요청 / 145B 응답 직렬화·역직렬화·비트맵 생성 (pathway_req/resp.c 대응)
│       ├── services.ts       # HSM-SVR, MCH-SVR, JRNL-SVR, SAF-SVR, HOST-SVR 시뮬레이션 (host_link.c 대응)
│       └── orchestrator.ts   # 8단계 승인/취소/개시 오케스트레이션 및 호출 트레이스 (card_auth.c 대응)
├── public/                   # Vercel 정적 호스팅 웹 시뮬레이션 콘솔
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── scripts/
│   └── dev-server.ts         # 로컬 즉시 실행용 개발 서버
├── tests/
│   └── cardAuth.test.ts      # 14개 통합 시나리오 자동화 테스트
├── vercel.json               # /api/* 단일 함수 리라이트 설정
├── tsconfig.json
└── package.json
```

## API 명세

| 메서드 & 경로 | 설명 |
| :--- | :--- |
| `POST /api/auth` | JSON 필드 또는 `rawWire`(112B 전문)를 받아 승인(`0100`), 취소(`0400`), 개시(`0800`) 처리 및 서비스 호출 트레이스/Wire 패킷 반환 |
| `GET /api/state` | 카드 한도 원장(500만 원 기준), 거래 원장 저널(PAN 마스킹), SAF 자동 망취소 대기 큐 스냅샷 조회 |
| `DELETE /api/state` | 시뮬레이션 원장·저널·SAF 큐 상태 초기화 |
| `POST /api/wire` | 대외 전문 생성(`build_req`) 및 파싱(`parse_req`, `parse_resp`) 유틸리티 |
| `GET /api/health` | 내부 `0800 → 0810` Echo 헬스체크 수행 |

> **참고 (Serverless 상태 유지 특성)**: Vercel Serverless 환경에서는 동일 인스턴스가 Warm 상태일 때 인메모리 원장/저널/SAF 큐가 공유되며, Cold Start 시 초기화됩니다. 영구 보관이 필요한 운영 전환 시 `services.ts`의 저장소를 Vercel KV(Upstash Redis) 또는 Neon Postgres로 교체할 수 있습니다.

## 로컬 테스트 및 실행

Node.js 22.6+ (현재 환경 Node 26 지원)에서는 별도 패키지 설치 없이도 즉시 테스트와 로컬 웹 콘솔 구동이 가능합니다.

```bash
cd card_auth_vercel

# 통합 테스트 실행
node --test tests/cardAuth.test.ts

# 로컬 웹 콘솔 + API 서버 실행 (http://localhost:3000)
node scripts/dev-server.ts
```

## Vercel 배포 방법

1. **Git 저장소 연결 배포**: GitHub에 푸시한 뒤 Vercel 대시보드에서 Root Directory를 `card_auth_vercel`로 지정하여 Import하면 별도 빌드 설정 없이 자동 배포됩니다.
2. **Vercel CLI 배포**:
   ```bash
   cd card_auth_vercel
   npx vercel
   npx vercel --prod
   ```

