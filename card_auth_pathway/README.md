# HPE Tandem PATHWAY 카드 승인 서버 (`card_auth_pathway`)

HPE NonStop(Tandem) PATHWAY 서버클래스(`AUTH-SVR`) 아키텍처를 기반으로 대외 VAN/FEP 전문 처리와 하위 서비스 오케스트레이션 흐름을 구현한 카드 승인/취소 서버 예제입니다.

## 프로젝트 구조

| 파일 | 역할 |
|------|------|
| `card_auth.h` | ISO 8583 응답 코드/MTI 상수, 고정길이 전문 규격 상수, 전문 구조체 및 하위 서비스 API 선언 |
| `pathway_main.c` | PATHWAY `AUTH-SVR` 진입점 (`$RECEIVE` 수신 → 파싱 → 오케스트레이션 → `$REPLY` 응답, 로컬 시뮬레이터 포함) |
| `pathway_req.c` | 대외 요청 전문(112B+) 파싱 및 직렬화 (`0100` 승인, `0400` 취소, `0800` 개시 지원) |
| `pathway_resp.c` | 대외 응답 전문(145B) 동적 ISO 8583 비트맵 생성 및 공백 패딩 직렬화/역직렬화 |
| `card_auth.c` | 카드 승인/취소/개시 오케스트레이션 로직 및 PCI-DSS 카드번호 마스킹 |
| `host_link.c` | 하위 PATHWAY 서버클래스(`HSM-SVR`, `MCH-SVR`, `JRNL-SVR`, `SAF-SVR`, `HOST-SVR`) 연동 시뮬레이션 |
| `test_driver.c` | 14개 승인/거절/취소/타임아웃/대외전문 무결성 통합 테스트 드라이버 |
| `Makefile` | Tandem Native C 컴파일러(`cc -D TANDEM_NATIVE`) 빌드 스크립트 |
| `Makefile.test` | 로컬 GCC 테스트 드라이버 빌드 스크립트 |
| `build_oss.cmd` | Windows GCC 서버 시뮬레이터 및 테스트 드라이버 통합 빌드 스크립트 |

## 서비스 호출 흐름 (End-to-End Architecture)

```text
VAN / FEP
  │  ISO 8583 고정길이 전문 (0100 승인 / 0400 취소 / 0800 개시)
  ▼
[AUTH-SVR: pathway_main.c]  ── $RECEIVE 수신 (EOF 수신 시 정상 종료, PAN 마스킹 로깅)
  │
  ├─▶ [pathway_req.c]  parse_auth_request()     : 길이(>=112B) 검증, 공백 제거, MTI 확인
  │
  ├─▶ [card_auth.c]    process_card_auth()      : 하위 서비스 순차 오케스트레이션
  │      ├─ 1) HSM-SVR  (svc_hsm_verify_req_mac)    : 요청 MAC 무결성 검증 (위변조 시 96)
  │      ├─ 2) 0800 분기                            : 네트워크 개시/헬스체크 즉시 응답 (0810/00)
  │      ├─ 3) 자체검증                             : 필수값(96) → Luhn(14) → 유효기간(54) → 금액(13)
  │      ├─ 4) MCH-SVR  (svc_merchant_verify)       : 가맹점/단말기 거래 가능 상태 조회 (정지 시 03)
  │      ├─ 5) HSM-SVR  (svc_hsm_verify_pin)        : PIN 블록 형식(96) 및 비밀번호 검증 (오류 시 55)
  │      ├─ 6) JRNL-SVR (svc_journal_is_duplicate)  : PAN+STAN+RRN 중복 승인 방지 (중복 시 94)
  │      ├─ 7) HOST-SVR (host_link_authorize)       : 분실(41)/도난(43)/한도차감(51)/취소복원(25,00)
  │      │       └─ 타임아웃(-2) 발생 시 ──▶ SAF-SVR (svc_saf_enqueue_reversal): 자동 망취소 큐 적재 후 91 응답
  │      └─ 8) JRNL-SVR & HSM-SVR                   : 거래 원장 기록 및 응답 MAC 생성
  │
  └─▶ [pathway_resp.c] build_auth_response()    : ISO 8583 비트맵 생성 + 145B 직렬화 ($REPLY 전송)
```

## 응답 코드 (ISO 8583 DE39)

| 코드 | 의미 | 코드 | 의미 |
|------|------|------|------|
| `00` | 승인 / 취소 / 개시 정상 완료 | `51` | 한도 초과 (기본 한도 500만 원) |
| `03` | 유효하지 않은(거래정지) 가맹점 | `54` | 유효기간 만료 카드 |
| `13` | 유효하지 않은 거래 금액 | `55` | 비밀번호(PIN) 불일치 |
| `14` | 잘못된 카드 번호 (길이/Luhn 오류) | `91` | 승인 호스트 타임아웃 (SAF 망취소 등록) |
| `25` | 취소 대상 원거래 없음 또는 기취소 | `94` | 중복 거래 요청 (`PAN+STAN+RRN`) |
| `41` | 분실 신고 카드 | `96` | 전문 형식 오류 / 필수값 누락 / MAC 오류 |
| `43` | 도난 신고 카드 | `98` | 시스템/통신 오류 |

## 빌드 및 실행 방법

### Windows / GCC 로컬 검증
```bat
build_oss.cmd
.\test_driver.exe
.\card_auth_server.exe
```

### HPE Tandem Native 배포 빌드
```bash
cc -W all -D TANDEM_NATIVE -c card_auth.c pathway_main.c pathway_req.c pathway_resp.c host_link.c
cc -o card_auth_server *.o -lpathway
```
