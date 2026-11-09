/*
 * test_driver.c - 카드 승인 서비스 흐름 통합 테스트 드라이버
 * Windows/GCC 로컬 환경에서 단위 및 대외 전문 End-to-End 흐름 검증용
 */

#include <stdio.h>
#include <string.h>
#include "card_auth.h"

static void check_test(const char *test_name, int condition,
                       int *pass_count, int *total_count)
{
    (*total_count)++;
    if (condition) {
        (*pass_count)++;
        printf("[PASS] %2d. %s\n", *total_count, test_name);
    } else {
        printf("[FAIL] %2d. %s\n", *total_count, test_name);
    }
}

static void init_valid_auth_req(CARD_AUTH_REQ *req,
                                const char *pan,
                                const char *amount,
                                const char *stan,
                                const char *rrn)
{
    memset(req, 0, sizeof(*req));
    snprintf(req->mti, sizeof(req->mti), "%s", MTI_AUTH_REQ);
    snprintf(req->pan, sizeof(req->pan), "%s", pan);
    snprintf(req->expiry, sizeof(req->expiry), "2912");
    snprintf(req->amount, sizeof(req->amount), "%s", amount);
    snprintf(req->stan, sizeof(req->stan), "%s", stan);
    snprintf(req->rrn, sizeof(req->rrn), "%s", rrn);
    snprintf(req->terminal_id, sizeof(req->terminal_id), "T0000001");
    snprintf(req->merchant_id, sizeof(req->merchant_id), "MCH000001");
    snprintf(req->pin_block, sizeof(req->pin_block), "1234567890ABCDEF");
}

int main(void)
{
    CARD_AUTH_REQ  req, parsed_req;
    CARD_AUTH_RESP resp, parsed_resp;
    char           raw_req[256];
    char           raw_resp[256];
    int            raw_req_len;
    int            raw_resp_len;
    int            rc;
    int            pass_count = 0;
    int            total_count = 0;

    card_auth_reset_state();
    printf("===== HPE Tandem PATHWAY 카드 승인 서비스 통합 테스트 =====\n\n");

    /* 1. 정상 승인 (0100 -> 0110, 10만원) */
    init_valid_auth_req(&req, "4000000000000010", "000000100000", "000001", "202611020001");
    rc = process_card_auth(&req, &resp);
    check_test("정상 승인 (4000000000000010, 10만원)",
               rc == 0 &&
               strcmp(resp.mti, MTI_AUTH_RESP) == 0 &&
               strcmp(resp.resp_code, RC_SUCCESS) == 0 &&
               resp.auth_code[0] != '\0',
               &pass_count, &total_count);
    printf("       -> MTI=%s, RC=%s, AUTH=%s, MSG=%s\n",
           resp.mti, resp.resp_code, resp.auth_code, resp.resp_msg);

    /* 2. 중복 승인 방지 (동일 PAN + STAN + RRN 재요청 -> 94) */
    rc = process_card_auth(&req, &resp);
    check_test("중복 승인 요청 거절 (동일 STAN/RRN -> 94)",
               rc == 0 && strcmp(resp.resp_code, RC_DUPLICATE_TX) == 0,
               &pass_count, &total_count);

    /* 3. 분실 카드 거절 (4000000000000002 -> 41) */
    init_valid_auth_req(&req, "4000000000000002", "000000010000", "000002", "202611020002");
    rc = process_card_auth(&req, &resp);
    check_test("분실 카드 거절 (4000000000000002 -> 41)",
               rc == 0 && strcmp(resp.resp_code, RC_LOST_CARD) == 0,
               &pass_count, &total_count);

    /* 4. 도난 카드 거절 (4000000000000028 -> 43) */
    init_valid_auth_req(&req, "4000000000000028", "000000010000", "000003", "202611020003");
    rc = process_card_auth(&req, &resp);
    check_test("도난 카드 거절 (4000000000000028 -> 43)",
               rc == 0 && strcmp(resp.resp_code, RC_STOLEN_CARD) == 0,
               &pass_count, &total_count);

    /* 5. 한도 초과 거절 (600만원 > 500만원 한도 -> 51) */
    init_valid_auth_req(&req, "4000000000000010", "000006000000", "000004", "202611020004");
    rc = process_card_auth(&req, &resp);
    check_test("한도 초과 거절 (600만원 -> 51)",
               rc == 0 && strcmp(resp.resp_code, RC_INSUFF_FUNDS) == 0,
               &pass_count, &total_count);

    /* 6. 잘못된 카드 번호 길이 거절 (123 -> 14) */
    init_valid_auth_req(&req, "123", "000000010000", "000005", "202611020005");
    rc = process_card_auth(&req, &resp);
    check_test("잘못된 카드 번호 길이 거절 (123 -> 14)",
               rc == 0 &&
               strcmp(resp.mti, MTI_AUTH_RESP) == 0 &&
               strcmp(resp.resp_code, RC_INVALID_CARD) == 0,
               &pass_count, &total_count);

    /* 7. Luhn 체크섬 무효 거절 (4000000000000000 -> 14) */
    init_valid_auth_req(&req, "4000000000000000", "000000010000", "000006", "202611020006");
    rc = process_card_auth(&req, &resp);
    check_test("Luhn 알고리즘 무효 거절 (4000000000000000 -> 14)",
               rc == 0 && strcmp(resp.resp_code, RC_INVALID_CARD) == 0,
               &pass_count, &total_count);

    /* 8. 필수 필드 누락 거절 (-> 96) */
    memset(&req, 0, sizeof(req));
    snprintf(req.mti, sizeof(req.mti), "%s", MTI_AUTH_REQ);
    rc = process_card_auth(&req, &resp);
    check_test("필수 필드 누락 거절 (-> 96)",
               rc == 0 &&
               strcmp(resp.mti, MTI_AUTH_RESP) == 0 &&
               strcmp(resp.resp_code, RC_FORMAT_ERROR) == 0,
               &pass_count, &total_count);

    /* 9. 유효기간 만료 카드 거절 (2301 -> 54) */
    init_valid_auth_req(&req, "4000000000000010", "000000010000", "000007", "202611020007");
    snprintf(req.expiry, sizeof(req.expiry), "2301");
    rc = process_card_auth(&req, &resp);
    check_test("유효기간 만료 카드 거절 (YYMM=2301 -> 54)",
               rc == 0 && strcmp(resp.resp_code, RC_EXPIRED_CARD) == 0,
               &pass_count, &total_count);

    /* 10. 정지 가맹점 거절 (MCH_STOP001 -> 03) */
    init_valid_auth_req(&req, "4000000000000010", "000000010000", "000008", "202611020008");
    snprintf(req.merchant_id, sizeof(req.merchant_id), "MCH_STOP001");
    rc = process_card_auth(&req, &resp);
    check_test("거래정지 가맹점 거절 (MCH_STOP001 -> 03)",
               rc == 0 && strcmp(resp.resp_code, RC_INVALID_MERCHANT) == 0,
               &pass_count, &total_count);

    /* 11. 비밀번호(PIN) 불일치 거절 (FFFFFFFFFFFFFFFF -> 55) */
    init_valid_auth_req(&req, "4000000000000010", "000000010000", "000009", "202611020009");
    snprintf(req.pin_block, sizeof(req.pin_block), "FFFFFFFFFFFFFFFF");
    rc = process_card_auth(&req, &resp);
    check_test("HSM PIN 불일치 거절 (-> 55)",
               rc == 0 && strcmp(resp.resp_code, RC_INVALID_PIN) == 0,
               &pass_count, &total_count);

    /* 12. 승인 취소(0400 -> 0410) 성공 및 중복 취소 방지(-> 25) */
    memset(&req, 0, sizeof(req));
    snprintf(req.mti, sizeof(req.mti), "%s", MTI_CANCEL_REQ);
    snprintf(req.pan, sizeof(req.pan), "4000000000000010");
    snprintf(req.amount, sizeof(req.amount), "000000100000");
    snprintf(req.stan, sizeof(req.stan), "000010");
    snprintf(req.rrn, sizeof(req.rrn), "202611020001"); /* 테스트 1의 원거래 RRN */
    snprintf(req.terminal_id, sizeof(req.terminal_id), "T0000001");
    snprintf(req.merchant_id, sizeof(req.merchant_id), "MCH000001");
    rc = process_card_auth(&req, &resp);
    {
        int first_cancel_ok = (rc == 0 &&
                               strcmp(resp.mti, MTI_CANCEL_RESP) == 0 &&
                               strcmp(resp.resp_code, RC_SUCCESS) == 0);
        /* 동일 원거래 재취소 시 25(원거래 없음/기취소) 반환 확인 */
        snprintf(req.stan, sizeof(req.stan), "000011");
        rc = process_card_auth(&req, &resp);
        check_test("승인 취소(0400->0410) 한도 복원 및 기취소 거래 재취소 거절(25)",
                   first_cancel_ok && rc == 0 && strcmp(resp.resp_code, RC_ORIG_NOT_FOUND) == 0,
                   &pass_count, &total_count);
    }

    /* 13. 승인 호스트 타임아웃(91) 및 SAF 자동 망취소 큐 적재 검증 */
    init_valid_auth_req(&req, "4000000000000093", "000000050000", "000012", "202611020012");
    rc = process_card_auth(&req, &resp);
    check_test("호스트 타임아웃(91) 및 SAF 자동 망취소 큐 등록",
               rc == 0 &&
               strcmp(resp.resp_code, RC_HOST_TIMEOUT) == 0 &&
               svc_saf_pending_count() == 1,
               &pass_count, &total_count);

    /* 14. 대외 전문 Wire 직렬화/파싱/MAC 무결성 & 버퍼 경계 방어 End-to-End 검증 */
    init_valid_auth_req(&req, "4000000000000010", "000000025000", "000013", "202611020013");
    raw_req_len = (int)sizeof(raw_req);
    rc = build_auth_request(&req, raw_req, &raw_req_len);
    {
        int short_parse_rejected = (parse_auth_request(raw_req, 50, &parsed_req) == -1);
        int parse_ok = (rc == 0 && parse_auth_request(raw_req, raw_req_len, &parsed_req) == 0);
        int proc_ok = (parse_ok && process_card_auth(&parsed_req, &resp) == 0 &&
                       strcmp(resp.resp_code, RC_SUCCESS) == 0);
        raw_resp_len = (int)sizeof(raw_resp);
        int resp_wire_ok = (proc_ok &&
                            build_auth_response(&resp, raw_resp, &raw_resp_len) == 0 &&
                            raw_resp_len == RAW_AUTH_RESP_LEN &&
                            parse_auth_response(raw_resp, raw_resp_len, &parsed_resp) == 0 &&
                            strcmp(parsed_resp.resp_code, RC_SUCCESS) == 0 &&
                            strcmp(parsed_resp.rrn, "202611020013") == 0);

        /* MAC 위변조 시 96 거절 확인 */
        parsed_req.mac[0] = (parsed_req.mac[0] == 'A') ? 'B' : 'A';
        int mac_tamper_rejected = (process_card_auth(&parsed_req, &resp) == 0 &&
                                   strcmp(resp.resp_code, RC_FORMAT_ERROR) == 0);

        /* 0800 Echo 개시 전문 Wire 왕복 확인 */
        CARD_AUTH_REQ echo_req;
        memset(&echo_req, 0, sizeof(echo_req));
        snprintf(echo_req.mti, sizeof(echo_req.mti), "%s", MTI_ECHO_REQ);
        snprintf(echo_req.stan, sizeof(echo_req.stan), "000014");
        snprintf(echo_req.rrn, sizeof(echo_req.rrn), "202611020014");
        raw_req_len = (int)sizeof(raw_req);
        int echo_ok = (build_auth_request(&echo_req, raw_req, &raw_req_len) == 0 &&
                       parse_auth_request(raw_req, raw_req_len, &parsed_req) == 0 &&
                       process_card_auth(&parsed_req, &resp) == 0 &&
                       strcmp(resp.mti, MTI_ECHO_RESP) == 0 &&
                       strcmp(resp.resp_code, RC_SUCCESS) == 0);

        check_test("대외 전문 직렬화/역직렬화/0800 개시/MAC 위변조 탐지/버퍼 방어",
                   short_parse_rejected && resp_wire_ok && mac_tamper_rejected && echo_ok,
                   &pass_count, &total_count);
    }

    printf("\n===== 테스트 결과: %d/%d 통과 (원장 기록=%d건, SAF 대기=%d건) =====\n",
           pass_count, total_count, svc_journal_count(), svc_saf_pending_count());

    if (pass_count == total_count) {
        printf("모든 테스트가 성공했습니다.\n");
        return 0;
    }

    printf("일부 테스트가 실패했습니다.\n");
    return 1;
}
