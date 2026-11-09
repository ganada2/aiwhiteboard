/*
 * pathway_main.c - HPE Tandem PATHWAY 서버 메인 루프 (AUTH-SVR)
 *
 * PATHWAY 서버클래스로 기동되어 $RECEIVE에서 대외 전문을 수신하고,
 * 하위 서비스(HSM/가맹점/원장/승인호스트/SAF) 오케스트레이션 후 $REPLY로 응답 전송.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "card_auth.h"

#define RECV_BUF_SIZE       4096
#define MAX_CONSEC_RECV_ERR 5

#ifdef TANDEM_NATIVE
#include <tal.h>
#else
int msg_receive(void *buf, int buflen, int flags);
int msg_reply(void *buf, int buflen, int flags);
#endif

/*
 * server_main
 *
 * PATHWAY 서버 진입점.
 */
int server_main(int argc, char *argv[])
{
    char           recv_buf[RECV_BUF_SIZE];
    char           send_buf[RECV_BUF_SIZE];
    char           masked_pan[WIRE_PAN_LEN + 1];
    int            recv_len;
    int            send_len;
    int            err_streak = 0;

    CARD_AUTH_REQ  req;
    CARD_AUTH_RESP resp;

    (void)argc;
    (void)argv;

    fprintf(stderr, "[AUTH-SVR] PATHWAY 카드 승인 서버 시작\n");

    while (1) {
        /* 1. $RECEIVE에서 대외 전문 수신 (블로킹) */
        recv_len = msg_receive(recv_buf, (int)sizeof(recv_buf), 0);

        /* PATHWAY 시스템 종료 메시지(EOF) 수신 시 정상 종료 */
        if (recv_len == 0) {
            fprintf(stderr, "[AUTH-SVR] $RECEIVE 종료 신호 수신 - 서버 정상 종료 "
                            "(원장=%d건, SAF대기=%d건)\n",
                    svc_journal_count(), svc_saf_pending_count());
            break;
        }

        if (recv_len < 0) {
            err_streak++;
            fprintf(stderr, "[AUTH-SVR] $RECEIVE 수신 오류 (%d/%d): %d\n",
                    err_streak, MAX_CONSEC_RECV_ERR, recv_len);
            if (err_streak >= MAX_CONSEC_RECV_ERR) {
                fprintf(stderr, "[AUTH-SVR] 연속 수신 오류 한도 초과로 서버 중단\n");
                return 1;
            }
            continue;
        }
        err_streak = 0;

        /* 2. 수신 전문 파싱 */
        if (parse_auth_request(recv_buf, recv_len, &req) != 0) {
            memset(&resp, 0, sizeof(resp));
            snprintf(resp.mti, sizeof(resp.mti), "%s", MTI_AUTH_RESP);
            snprintf(resp.resp_code, sizeof(resp.resp_code), "%s", RC_FORMAT_ERROR);
            snprintf(resp.resp_msg, sizeof(resp.resp_msg), "전문 형식 오류");
            svc_hsm_compute_resp_mac(&resp, resp.mac);

            send_len = (int)sizeof(send_buf);
            if (build_auth_response(&resp, send_buf, &send_len) == 0) {
                msg_reply(send_buf, send_len, 0);
            }
            continue;
        }

        mask_pan(req.pan, masked_pan, sizeof(masked_pan));
        fprintf(stderr, "[AUTH-SVR] 요청 수신: MTI=%s PAN=%s STAN=%s RRN=%s AMT=%s\n",
                req.mti, masked_pan, req.stan, req.rrn, req.amount);

        /* 3. 승인/취소/개시 서비스 오케스트레이션 */
        if (process_card_auth(&req, &resp) != 0) {
            memset(&resp, 0, sizeof(resp));
            snprintf(resp.mti, sizeof(resp.mti), "%s", MTI_AUTH_RESP);
            snprintf(resp.resp_code, sizeof(resp.resp_code), "%s", RC_SYSTEM_ERROR);
            snprintf(resp.resp_msg, sizeof(resp.resp_msg), "내부 처리 오류");
            svc_hsm_compute_resp_mac(&resp, resp.mac);
        }

        fprintf(stderr, "[AUTH-SVR] 처리 결과: MTI=%s RC=%s AUTH=%s MSG=%s\n",
                resp.mti, resp.resp_code,
                resp.auth_code[0] ? resp.auth_code : "-",
                resp.resp_msg);

        /* 4. 송신 전문 직렬화 */
        send_len = (int)sizeof(send_buf);
        if (build_auth_response(&resp, send_buf, &send_len) != 0) {
            fprintf(stderr, "[AUTH-SVR] 송신 전문 직렬화 실패\n");
            continue;
        }

        /* 5. $REPLY로 응답 전송 */
        if (msg_reply(send_buf, send_len, 0) < 0) {
            fprintf(stderr, "[AUTH-SVR] $REPLY 응답 전송 실패\n");
        }
    }

    return 0;
}

/* ---------------------------------------------------------------
 * 로컬(Windows/Linux GCC) 단독 실행 시뮬레이션 스텁
 * (실제 Tandem 배포 시 -D TANDEM_NATIVE 컴파일로 제외됨)
 * --------------------------------------------------------------- */
#ifndef TANDEM_NATIVE

static int g_sim_step = 0;

int msg_receive(void *buf, int buflen, int flags)
{
    CARD_AUTH_REQ sim_req;
    int outlen = buflen;
    (void)flags;

    memset(&sim_req, 0, sizeof(sim_req));
    g_sim_step++;

    switch (g_sim_step) {
    case 1: /* 1) 0800 네트워크 개시 전문 */
        snprintf(sim_req.mti, sizeof(sim_req.mti), "%s", MTI_ECHO_REQ);
        snprintf(sim_req.stan, sizeof(sim_req.stan), "000001");
        snprintf(sim_req.rrn, sizeof(sim_req.rrn), "202611020001");
        break;

    case 2: /* 2) 0100 정상 카드 승인 요청 (50,000원) */
        snprintf(sim_req.mti, sizeof(sim_req.mti), "%s", MTI_AUTH_REQ);
        snprintf(sim_req.pan, sizeof(sim_req.pan), "4000000000000010");
        snprintf(sim_req.expiry, sizeof(sim_req.expiry), "2912");
        snprintf(sim_req.amount, sizeof(sim_req.amount), "000000050000");
        snprintf(sim_req.stan, sizeof(sim_req.stan), "000002");
        snprintf(sim_req.rrn, sizeof(sim_req.rrn), "202611020002");
        snprintf(sim_req.terminal_id, sizeof(sim_req.terminal_id), "T0000001");
        snprintf(sim_req.merchant_id, sizeof(sim_req.merchant_id), "MCH000001");
        snprintf(sim_req.pin_block, sizeof(sim_req.pin_block), "1234567890ABCDEF");
        break;

    case 3: /* 3) 0400 직전 승인 건 취소 요청 (50,000원) */
        snprintf(sim_req.mti, sizeof(sim_req.mti), "%s", MTI_CANCEL_REQ);
        snprintf(sim_req.pan, sizeof(sim_req.pan), "4000000000000010");
        snprintf(sim_req.amount, sizeof(sim_req.amount), "000000050000");
        snprintf(sim_req.stan, sizeof(sim_req.stan), "000003");
        snprintf(sim_req.rrn, sizeof(sim_req.rrn), "202611020002");
        snprintf(sim_req.terminal_id, sizeof(sim_req.terminal_id), "T0000001");
        snprintf(sim_req.merchant_id, sizeof(sim_req.merchant_id), "MCH000001");
        break;

    case 4: /* 4) 0100 호스트 타임아웃 시뮬레이션 → SAF 자동 망취소 큐 적재 */
        snprintf(sim_req.mti, sizeof(sim_req.mti), "%s", MTI_AUTH_REQ);
        snprintf(sim_req.pan, sizeof(sim_req.pan), "4000000000000093");
        snprintf(sim_req.expiry, sizeof(sim_req.expiry), "2912");
        snprintf(sim_req.amount, sizeof(sim_req.amount), "000000030000");
        snprintf(sim_req.stan, sizeof(sim_req.stan), "000004");
        snprintf(sim_req.rrn, sizeof(sim_req.rrn), "202611020004");
        snprintf(sim_req.terminal_id, sizeof(sim_req.terminal_id), "T0000001");
        snprintf(sim_req.merchant_id, sizeof(sim_req.merchant_id), "MCH000001");
        snprintf(sim_req.pin_block, sizeof(sim_req.pin_block), "1234567890ABCDEF");
        break;

    default: /* 5) 종료 신호 (EOF) */
        return 0;
    }

    if (build_auth_request(&sim_req, (char *)buf, &outlen) != 0)
        return -1;
    return outlen;
}

int msg_reply(void *buf, int buflen, int flags)
{
    CARD_AUTH_RESP parsed;
    (void)flags;

    if (parse_auth_response((const char *)buf, buflen, &parsed) == 0) {
        printf("[FEP-SIM] $REPLY 수신 (%dB): MTI=%s RC=%s AUTH=%s STAN=%s MAC=%s\n",
               buflen, parsed.mti, parsed.resp_code,
               parsed.auth_code[0] ? parsed.auth_code : "-",
               parsed.stan, parsed.mac);
    }
    return buflen;
}

int main(int argc, char *argv[])
{
    return server_main(argc, argv);
}
#endif
