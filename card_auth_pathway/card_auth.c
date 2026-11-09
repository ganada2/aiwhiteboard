/*
 * card_auth.c - HPE Tandem PATHWAY 카드 승인 오케스트레이션 로직 (AUTH-SVR)
 *
 * 서비스 호출 흐름:
 *   1) MTI 분기 (0800 개시 / 0100 승인 / 0400 취소)
 *   2) HSM-SVR  : 요청 전문 MAC 무결성 검증
 *   3) 자체검증 : 필수 필드 → 카드번호(Luhn) → 유효기간(YYMM) → 거래금액 검증
 *   4) MCH-SVR  : 가맹점 및 단말기 유효성 조회
 *   5) HSM-SVR  : PIN 블록 포맷 및 비밀번호 일치 검증 (0100 승인 시)
 *   6) JRNL-SVR : 동일 거래(PAN+STAN+RRN) 중복 승인 방지 조회 (0100 승인 시)
 *   7) HOST-SVR : 승인/취소 원장 연동 (타임아웃 시 SAF-SVR에 자동 망취소 등록)
 *   8) JRNL-SVR : 거래 결과 원장 기록 및 응답 MAC 생성
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "card_auth.h"

/* ---------- 내부 유틸리티 ---------- */

static int is_numeric(const char *s, int len)
{
    int i;
    if (s == NULL || len <= 0)
        return 0;
    for (i = 0; i < len; i++) {
        if (s[i] < '0' || s[i] > '9')
            return 0;
    }
    return 1;
}

/* Luhn 알고리즘 카드 번호 검증 */
static int luhn_check(const char *pan)
{
    int len = (int)strlen(pan);
    int sum = 0;
    int alternate = 0;
    int i;

    for (i = len - 1; i >= 0; i--) {
        int n;
        if (pan[i] < '0' || pan[i] > '9')
            return 0;

        n = pan[i] - '0';
        if (alternate) {
            n *= 2;
            if (n > 9)
                n -= 9;
        }
        sum += n;
        alternate = !alternate;
    }
    return (sum % 10 == 0);
}

/* 현재 시간 문자열 생성 (YYYYMMDDHHMMSS) */
static void get_timestamp(char *buf, size_t size)
{
    time_t t = time(NULL);
    struct tm *tm_info = localtime(&t);
    if (tm_info != NULL) {
        snprintf(buf, size, "%04d%02d%02d%02d%02d%02d",
                 tm_info->tm_year + 1900, tm_info->tm_mon + 1, tm_info->tm_mday,
                 tm_info->tm_hour, tm_info->tm_min, tm_info->tm_sec);
    } else {
        snprintf(buf, size, "20260101000000");
    }
}

/* PCI-DSS 준수 로그용 카드번호 마스킹 (앞 6자리 + '*' + 뒤 4자리) */
void mask_pan(const char *pan, char *out, size_t out_size)
{
    size_t len;
    size_t i;

    if (out == NULL || out_size == 0)
        return;

    if (pan == NULL || pan[0] == '\0') {
        snprintf(out, out_size, "(EMPTY)");
        return;
    }

    len = strlen(pan);
    if (len < 10) {
        snprintf(out, out_size, "****");
        return;
    }

    if (len >= out_size)
        len = out_size - 1;

    for (i = 0; i < len; i++) {
        if (i < 6 || i >= len - 4)
            out[i] = pan[i];
        else
            out[i] = '*';
    }
    out[len] = '\0';
}

/* 카드 번호 유효성 (길이 13~19자리, 숫자, Luhn 체크섬) */
static int validate_card(const char *pan)
{
    int len;
    if (pan == NULL)
        return 0;

    len = (int)strlen(pan);
    if (len < 13 || len > 19)
        return 0;

    if (!is_numeric(pan, len))
        return 0;

    return luhn_check(pan);
}

/*
 * validate_expiry
 * 반환: 1 = 정상, 0 = 만료(RC_EXPIRED_CARD), -1 = 형식 오류(RC_FORMAT_ERROR)
 */
static int validate_expiry(const char *expiry)
{
    int yy, mm, exp_yyyymm, cur_yyyymm;
    time_t now;
    struct tm *tm_info;

    if (expiry == NULL || strlen(expiry) != WIRE_EXPIRY_LEN)
        return -1;

    if (!is_numeric(expiry, WIRE_EXPIRY_LEN))
        return -1;

    yy = (expiry[0] - '0') * 10 + (expiry[1] - '0');
    mm = (expiry[2] - '0') * 10 + (expiry[3] - '0');
    if (mm < 1 || mm > 12)
        return -1;

    exp_yyyymm = (2000 + yy) * 100 + mm;

    now = time(NULL);
    tm_info = localtime(&now);
    if (tm_info != NULL) {
        cur_yyyymm = (tm_info->tm_year + 1900) * 100 + (tm_info->tm_mon + 1);
        if (exp_yyyymm < cur_yyyymm)
            return 0;
    }

    return 1;
}

/* 거래 금액 검증: 숫자 문자열이며 1원 이상 */
static int parse_valid_amount(const char *amount_str, long *out_amount)
{
    int len;
    long val;
    char *endptr = NULL;

    if (amount_str == NULL || out_amount == NULL)
        return 0;

    len = (int)strlen(amount_str);
    if (len <= 0 || len > WIRE_AMOUNT_LEN || !is_numeric(amount_str, len))
        return 0;

    val = strtol(amount_str, &endptr, 10);
    if (endptr == NULL || *endptr != '\0' || val <= 0L)
        return 0;

    *out_amount = val;
    return 1;
}

/* 공통 응답 마감: 응답 코드/메시지 설정, 원장 기록(선택), 응답 MAC 생성 */
static int finalize_response(const CARD_AUTH_REQ *req,
                             CARD_AUTH_RESP *resp,
                             const char *resp_code,
                             const char *resp_msg,
                             const char *host_tx_id,
                             int record_journal)
{
    snprintf(resp->resp_code, sizeof(resp->resp_code), "%s", resp_code);
    snprintf(resp->resp_msg, sizeof(resp->resp_msg), "%s", resp_msg);

    if (record_journal) {
        svc_journal_record(req, resp, host_tx_id);
    }

    svc_hsm_compute_resp_mac(resp, resp->mac);
    return 0;
}

/* ---------- 메인 승인/취소/개시 오케스트레이션 ---------- */

/*
 * process_card_auth
 *
 * req:  수신 전문 (0100 승인 / 0400 취소 / 0800 개시)
 * resp: 송신 전문 (0110 / 0410 / 0810)
 *
 * 반환:
 *   0  = 정상적으로 업무 응답(승인 또는 업무 거절 코드)이 resp에 생성됨
 *  -1  = NULL 인자 등 호출 자체가 불가능한 치명적 오류
 */
int process_card_auth(CARD_AUTH_REQ *req, CARD_AUTH_RESP *resp)
{
    INNER_AUTH_REQ  inner_req;
    INNER_AUTH_RESP inner_resp;
    const char     *req_mti;
    int             is_cancel = 0;
    long            parsed_amount = 0L;
    int             exp_rc;
    int             pin_rc;
    int             host_rc;

    if (req == NULL || resp == NULL)
        return -1;

    memset(resp, 0, sizeof(*resp));

    /* 요청 MTI 기본값 보정 및 응답 MTI 선결정 (에러 응답 시에도 MTI 보장) */
    req_mti = (req->mti[0] != '\0') ? req->mti : MTI_AUTH_REQ;

    if (strcmp(req_mti, MTI_AUTH_REQ) == 0) {
        snprintf(resp->mti, sizeof(resp->mti), "%s", MTI_AUTH_RESP);
    } else if (strcmp(req_mti, MTI_CANCEL_REQ) == 0) {
        snprintf(resp->mti, sizeof(resp->mti), "%s", MTI_CANCEL_RESP);
        is_cancel = 1;
    } else if (strcmp(req_mti, MTI_ECHO_REQ) == 0) {
        snprintf(resp->mti, sizeof(resp->mti), "%s", MTI_ECHO_RESP);
    } else {
        snprintf(resp->mti, sizeof(resp->mti), "%s", MTI_AUTH_RESP);
        return finalize_response(req, resp, RC_FORMAT_ERROR, "지원하지 않는 MTI", NULL, 0);
    }

    /* 추적용 기본 필드 복사 */
    snprintf(resp->pan, sizeof(resp->pan), "%s", req->pan);
    snprintf(resp->stan, sizeof(resp->stan), "%s", req->stan);
    snprintf(resp->rrn, sizeof(resp->rrn), "%s", req->rrn);

    /* 1. [HSM-SVR] 요청 전문 MAC 무결성 검증 */
    if (!svc_hsm_verify_req_mac(req)) {
        return finalize_response(req, resp, RC_FORMAT_ERROR, "전문 MAC 검증 실패", NULL, 0);
    }

    /* [분기] 0800 네트워크 관리(Echo) 전문은 즉시 정상 응답 반환 */
    if (strcmp(req_mti, MTI_ECHO_REQ) == 0) {
        return finalize_response(req, resp, RC_SUCCESS, "네트워크 개시/점검 정상", NULL, 0);
    }

    /* 2. 필수 필드 존재 여부 검증 */
    if (req->pan[0] == '\0' ||
        req->amount[0] == '\0' ||
        req->merchant_id[0] == '\0' ||
        req->terminal_id[0] == '\0' ||
        (is_cancel && req->rrn[0] == '\0'))
    {
        return finalize_response(req, resp, RC_FORMAT_ERROR, "필수 필드 누락", NULL, 0);
    }

    /* 3. 카드 번호 검증 (길이, 숫자, Luhn 체크섬) */
    if (!validate_card(req->pan)) {
        return finalize_response(req, resp, RC_INVALID_CARD, "잘못된 카드 번호", NULL, 0);
    }

    /* 4. 유효기간 검증 (0100 승인 거래 시) */
    if (!is_cancel) {
        exp_rc = validate_expiry(req->expiry);
        if (exp_rc < 0) {
            return finalize_response(req, resp, RC_FORMAT_ERROR, "유효기간 형식 오류", NULL, 0);
        }
        if (exp_rc == 0) {
            return finalize_response(req, resp, RC_EXPIRED_CARD, "유효기간 만료 카드", NULL, 1);
        }
    }

    /* 5. 거래 금액 숫자/범위 검증 */
    if (!parse_valid_amount(req->amount, &parsed_amount)) {
        return finalize_response(req, resp, RC_INVALID_AMOUNT, "유효하지 않은 거래 금액", NULL, 0);
    }

    /* 6. [MCH-SVR] 가맹점 및 단말기 상태 검증 */
    if (!svc_merchant_verify(req->merchant_id, req->terminal_id)) {
        return finalize_response(req, resp, RC_INVALID_MERCHANT, "유효하지 않은 가맹점", NULL, 1);
    }

    /* 7. [HSM-SVR] PIN 블록 포맷 및 비밀번호 검증 (0100 승인 거래 시) */
    if (!is_cancel) {
        pin_rc = svc_hsm_verify_pin(req->pan, req->pin_block);
        if (pin_rc < 0) {
            return finalize_response(req, resp, RC_FORMAT_ERROR, "PIN 블록 형식 오류", NULL, 0);
        }
        if (pin_rc == 0) {
            return finalize_response(req, resp, RC_INVALID_PIN, "비밀번호(PIN) 오류", NULL, 1);
        }
    }

    /* 8. [JRNL-SVR] 중복 승인 요청 방지 조회 (0100 승인 거래 시) */
    if (!is_cancel && svc_journal_is_duplicate(req->pan, req->stan, req->rrn)) {
        return finalize_response(req, resp, RC_DUPLICATE_TX, "중복 승인 요청", NULL, 0);
    }

    /* 9. 내부 승인/취소 호스트 전문 매핑 */
    memset(&inner_req, 0, sizeof(inner_req));
    snprintf(inner_req.tx_code, sizeof(inner_req.tx_code), "%s",
             is_cancel ? TX_CODE_CANCEL : TX_CODE_AUTH);
    snprintf(inner_req.pan, sizeof(inner_req.pan), "%s", req->pan);
    snprintf(inner_req.expiry, sizeof(inner_req.expiry), "%s", req->expiry);
    inner_req.amount = parsed_amount;
    snprintf(inner_req.stan, sizeof(inner_req.stan), "%s", req->stan);
    snprintf(inner_req.rrn, sizeof(inner_req.rrn), "%s", req->rrn);
    snprintf(inner_req.terminal_id, sizeof(inner_req.terminal_id), "%s", req->terminal_id);
    snprintf(inner_req.merchant_id, sizeof(inner_req.merchant_id), "%s", req->merchant_id);
    snprintf(inner_req.pin_block, sizeof(inner_req.pin_block), "%s", req->pin_block);

    get_timestamp(inner_req.req_timestamp, sizeof(inner_req.req_timestamp));
    snprintf(inner_req.host_tx_id, sizeof(inner_req.host_tx_id),
             "H%.8s%s", inner_req.req_timestamp,
             req->stan[0] ? req->stan : "000000");

    /* 10. [HOST-SVR] 승인 호스트 연동 */
    host_rc = host_link_authorize(&inner_req, &inner_resp);
    if (host_rc == HOST_ERR_TIMEOUT) {
        /* 승인 요청 중 호스트 타임아웃 발생 시 SAF 자동 망취소(0420) 큐 등록 */
        if (!is_cancel) {
            svc_saf_enqueue_reversal(&inner_req);
        }
        return finalize_response(req, resp, RC_HOST_TIMEOUT,
                                 "승인 호스트 응답 시간 초과", inner_req.host_tx_id, 1);
    }
    if (host_rc != HOST_OK) {
        return finalize_response(req, resp, RC_SYSTEM_ERROR,
                                 "승인 호스트 통신 실패", inner_req.host_tx_id, 1);
    }

    /* 11. 호스트 응답 매핑 및 원장 기록 */
    snprintf(resp->auth_code, sizeof(resp->auth_code), "%s", inner_resp.auth_code);
    return finalize_response(req, resp, inner_resp.resp_code,
                             inner_resp.resp_msg, inner_resp.host_tx_id, 1);
}
