/*
 * card_auth.h - HPE Tandem PATHWAY 카드 승인 전문 및 서비스 인터페이스 정의
 * 프로젝트: card_auth_pathway
 */

#ifndef CARD_AUTH_H
#define CARD_AUTH_H

#include <stddef.h>

/* ---------- 응답 코드 (ISO 8583 DE39 기반) ---------- */
#define RC_SUCCESS           "00"   /* 승인/처리 완료 */
#define RC_INVALID_MERCHANT  "03"   /* 유효하지 않은 가맹점 */
#define RC_INVALID_AMOUNT    "13"   /* 유효하지 않은 거래 금액 */
#define RC_INVALID_CARD      "14"   /* 잘못된 카드 번호 (Luhn/길이 오류) */
#define RC_ORIG_NOT_FOUND    "25"   /* 원거래 없음 또는 기취소 */
#define RC_LOST_CARD         "41"   /* 분실 카드 */
#define RC_STOLEN_CARD       "43"   /* 도난 카드 */
#define RC_INSUFF_FUNDS      "51"   /* 한도 초과 */
#define RC_EXPIRED_CARD      "54"   /* 유효기간 만료 카드 */
#define RC_INVALID_PIN       "55"   /* 비밀번호(PIN) 오류 */
#define RC_HOST_TIMEOUT      "91"   /* 승인 호스트 응답 시간 초과 (망취소 대상) */
#define RC_DUPLICATE_TX      "94"   /* 중복 거래 요청 */
#define RC_FORMAT_ERROR      "96"   /* 전문 형식 오류 / 필수 필드 누락 / MAC 불일치 */
#define RC_SYSTEM_ERROR      "98"   /* 시스템 오류 */

/* ---------- 메시지 타입 (ISO 8583 MTI) ---------- */
#define MTI_AUTH_REQ         "0100" /* 승인 요청 */
#define MTI_AUTH_RESP        "0110" /* 승인 응답 */
#define MTI_CANCEL_REQ       "0400" /* 승인 취소 / 망취소 요청 */
#define MTI_CANCEL_RESP      "0410" /* 승인 취소 / 망취소 응답 */
#define MTI_ECHO_REQ         "0800" /* 네트워크 관리(개시/Echo) 요청 */
#define MTI_ECHO_RESP        "0810" /* 네트워크 관리(개시/Echo) 응답 */

/* ---------- 내부 트랜잭션 코드 ---------- */
#define TX_CODE_AUTH         "CARD_AUTH"
#define TX_CODE_CANCEL       "CARD_CNCL"

/* ---------- 호스트 연동 반환 코드 ---------- */
#define HOST_OK               0     /* 정상 응답 수신 (승인/거절 포함) */
#define HOST_ERR_SYS         -1     /* 통신/시스템 오류 */
#define HOST_ERR_TIMEOUT     -2     /* 응답 타임아웃 (SAF 망취소 등록 대상) */

/* ---------- 고정길이 대외 전문 규격 상수 (바이트) ---------- */
#define WIRE_MTI_LEN          4
#define WIRE_BITMAP_LEN      16
#define WIRE_PAN_LEN         19
#define WIRE_EXPIRY_LEN       4
#define WIRE_AMOUNT_LEN      12
#define WIRE_STAN_LEN         6
#define WIRE_RRN_LEN         12
#define WIRE_TERMID_LEN       8
#define WIRE_MERCHID_LEN     15
#define WIRE_PINBLK_LEN      16
#define WIRE_MAC_LEN         16
#define WIRE_RESPCODE_LEN     2
#define WIRE_AUTHCODE_LEN     6
#define WIRE_RESPMSG_LEN     64
#define WIRE_RESERVED_MAX    50

/* 요청 최소 길이: 4+19+4+12+6+12+8+15+16+16 = 112 바이트 */
#define RAW_AUTH_REQ_MIN_LEN 112
/* 응답 고정 길이: 4+16+19+2+6+6+12+64+16 = 145 바이트 */
#define RAW_AUTH_RESP_LEN    145

/* ---------- 수신 전문 (VAN/FEP → PATHWAY 서버) ---------- */
typedef struct {
    char   mti[WIRE_MTI_LEN + 1];               /* 메시지 타입: "0100", "0400", "0800" */
    char   pan[WIRE_PAN_LEN + 1];               /* 카드 번호 (13~19자리) */
    char   expiry[WIRE_EXPIRY_LEN + 1];         /* 유효기간 YYMM (4자리) */
    char   amount[WIRE_AMOUNT_LEN + 1];         /* 거래 금액 (12자리, 왼쪽 0 채움) */
    char   stan[WIRE_STAN_LEN + 1];             /* 시스템 추적 번호 (6자리) */
    char   rrn[WIRE_RRN_LEN + 1];               /* 검색 참조 번호 (12자리) */
    char   terminal_id[WIRE_TERMID_LEN + 1];    /* 단말기 번호 (8자리) */
    char   merchant_id[WIRE_MERCHID_LEN + 1];   /* 가맹점 번호 (15자리) */
    char   pin_block[WIRE_PINBLK_LEN + 1];      /* PIN 블록 (16자리 Hex) */
    char   mac[WIRE_MAC_LEN + 1];               /* 메시지 인증 코드 (16자리 Hex) */
    char   reserved[WIRE_RESERVED_MAX + 1];     /* 예약 필드 (최대 50바이트) */
} CARD_AUTH_REQ;

/* ---------- 내부 승인 요청 (PATHWAY 서버 → 승인 호스트) ---------- */
typedef struct {
    char   tx_code[12];                         /* 내부 트랜잭션 코드: "CARD_AUTH" / "CARD_CNCL" */
    char   pan[WIRE_PAN_LEN + 1];
    char   expiry[WIRE_EXPIRY_LEN + 1];
    long   amount;                              /* 숫자형 금액 */
    char   stan[WIRE_STAN_LEN + 1];
    char   rrn[WIRE_RRN_LEN + 1];
    char   terminal_id[WIRE_TERMID_LEN + 1];
    char   merchant_id[WIRE_MERCHID_LEN + 1];
    char   pin_block[WIRE_PINBLK_LEN + 1];
    char   host_tx_id[24];                      /* 호스트 고유 트랜잭션 ID */
    char   req_timestamp[15];                   /* 요청 일시 YYYYMMDDHHMMSS */
} INNER_AUTH_REQ;

/* ---------- 내부 승인 응답 (승인 호스트 → PATHWAY 서버) ---------- */
typedef struct {
    char   resp_code[4];                        /* 2자리 응답 코드 + NUL */
    char   auth_code[WIRE_AUTHCODE_LEN + 3];    /* 6자리 승인 번호 + 여유 공간 */
    char   resp_msg[WIRE_RESPMSG_LEN + 1];
    char   host_tx_id[24];
    long   available_balance;                   /* 잔여 사용 가능 한도 */
    char   host_resp_timestamp[15];             /* 응답 일시 YYYYMMDDHHMMSS */
} INNER_AUTH_RESP;

/* ---------- 송신 전문 (PATHWAY 서버 → VAN/FEP) ---------- */
typedef struct {
    char   mti[WIRE_MTI_LEN + 1];               /* "0110", "0410", "0810" */
    char   pan[WIRE_PAN_LEN + 1];
    char   resp_code[4];
    char   auth_code[WIRE_AUTHCODE_LEN + 3];
    char   stan[WIRE_STAN_LEN + 1];
    char   rrn[WIRE_RRN_LEN + 1];
    char   resp_msg[WIRE_RESPMSG_LEN + 1];
    char   mac[WIRE_MAC_LEN + 1];
    char   reserved[WIRE_RESERVED_MAX + 1];
} CARD_AUTH_RESP;

/* ---------- 전문 파싱 / 직렬화 API ---------- */
int parse_auth_request(const char *raw, int rawlen, CARD_AUTH_REQ *req);
int build_auth_request(const CARD_AUTH_REQ *req, char *out, int *outlen);
int build_auth_response(const CARD_AUTH_RESP *resp, char *out, int *outlen);
int parse_auth_response(const char *raw, int rawlen, CARD_AUTH_RESP *resp);

/* ---------- 승인 오케스트레이션 및 하위 서비스 API ---------- */
int  process_card_auth(CARD_AUTH_REQ *req, CARD_AUTH_RESP *resp);
int  host_link_authorize(const INNER_AUTH_REQ *req, INNER_AUTH_RESP *resp);

/* HSM 보안 서비스 시뮬레이션 (MAC 계산/검증, PIN 검증) */
void svc_hsm_compute_req_mac(const CARD_AUTH_REQ *req, char out_mac[WIRE_MAC_LEN + 1]);
void svc_hsm_compute_resp_mac(const CARD_AUTH_RESP *resp, char out_mac[WIRE_MAC_LEN + 1]);
int  svc_hsm_verify_req_mac(const CARD_AUTH_REQ *req);
int  svc_hsm_verify_pin(const char *pan, const char *pin_block);

/* 가맹점 검증 서비스 시뮬레이션 */
int  svc_merchant_verify(const char *merchant_id, const char *terminal_id);

/* 거래 원장(Journal) 및 SAF(자동 망취소) 큐 서비스 시뮬레이션 */
int  svc_journal_is_duplicate(const char *pan, const char *stan, const char *rrn);
int  svc_journal_record(const CARD_AUTH_REQ *req, const CARD_AUTH_RESP *resp, const char *host_tx_id);
int  svc_journal_count(void);
int  svc_saf_enqueue_reversal(const INNER_AUTH_REQ *req);
int  svc_saf_pending_count(void);
void card_auth_reset_state(void);

/* 로그 출력용 카드번호 마스킹 유틸리티 (PCI-DSS 준수) */
void mask_pan(const char *pan, char *out, size_t out_size);

#endif /* CARD_AUTH_H */
