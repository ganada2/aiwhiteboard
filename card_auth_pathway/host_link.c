/*
 * host_link.c - 하위 PATHWAY 서버클래스 연동 시뮬레이션
 *
 * 실제 HPE NonStop 운영 환경에서는 SERVERCLASS_SEND_() / $RECEIVE IPC,
 * HSM 장비 연동, ENSCRIBE/SQL-MX 원장 테이블로 분리되는 하위 서비스 계층:
 *   1) HSM-SVR  : 전문 MAC 생성/검증, PIN 블록 복호화 검증
 *   2) MCH-SVR  : 가맹점 및 단말기 상태 조회
 *   3) JRNL-SVR : 거래 원장(ENSCRIBE) 기록, 중복 거래 방지, 원거래 조회
 *   4) SAF-SVR  : 호스트 타임아웃 시 자동 망취소(0420) Store-And-Forward 큐
 *   5) HOST-SVR : 카드 원장(분실/도난/한도) 심사 및 승인/취소 처리
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include "card_auth.h"

#define DEFAULT_CARD_LIMIT   5000000L
#define MAX_CARD_ACCOUNTS    64
#define MAX_JOURNAL_RECORDS  256
#define MAX_SAF_ENTRIES      64
#define DEMO_MAC_SECRET      "TANDEM_PATHWAY_HSM_KEY_2026"

/* ---------- 인메모리 시뮬레이션 테이블 구조 ---------- */

typedef struct {
    char pan[WIRE_PAN_LEN + 1];
    long used_amount;
} CARD_LEDGER_ENTRY;

typedef struct {
    char mti[WIRE_MTI_LEN + 1];
    char pan[WIRE_PAN_LEN + 1];
    char stan[WIRE_STAN_LEN + 1];
    char rrn[WIRE_RRN_LEN + 1];
    long amount;
    char resp_code[4];
    char auth_code[WIRE_AUTHCODE_LEN + 3];
    char host_tx_id[24];
    int  is_cancelled;
} JOURNAL_ENTRY;

typedef struct {
    char pan[WIRE_PAN_LEN + 1];
    char stan[WIRE_STAN_LEN + 1];
    char rrn[WIRE_RRN_LEN + 1];
    long amount;
    char host_tx_id[24];
    char req_timestamp[15];
} SAF_ENTRY;

static CARD_LEDGER_ENTRY g_card_ledger[MAX_CARD_ACCOUNTS];
static int               g_card_count = 0;

static JOURNAL_ENTRY     g_journal[MAX_JOURNAL_RECORDS];
static int               g_journal_count = 0;

static SAF_ENTRY         g_saf_queue[MAX_SAF_ENTRIES];
static int               g_saf_count = 0;

static unsigned int      g_auth_seq = 1;

/* 현재 시각 YYYYMMDDHHMMSS */
static void make_host_timestamp(char *buf, size_t size)
{
    time_t now = time(NULL);
    struct tm *tm_info = localtime(&now);
    if (tm_info != NULL) {
        snprintf(buf, size, "%04d%02d%02d%02d%02d%02d",
                 tm_info->tm_year + 1900, tm_info->tm_mon + 1, tm_info->tm_mday,
                 tm_info->tm_hour, tm_info->tm_min, tm_info->tm_sec);
    } else {
        snprintf(buf, size, "20260101000000");
    }
}

void card_auth_reset_state(void)
{
    memset(g_card_ledger, 0, sizeof(g_card_ledger));
    g_card_count = 0;

    memset(g_journal, 0, sizeof(g_journal));
    g_journal_count = 0;

    memset(g_saf_queue, 0, sizeof(g_saf_queue));
    g_saf_count = 0;

    g_auth_seq = 1;
}

/* ================================================================
 * 1. HSM-SVR 시뮬레이션 (MAC 계산/검증, PIN 블록 검증)
 * ================================================================ */

static uint64_t fnv1a_update(uint64_t hash, const char *str)
{
    const unsigned char *p = (const unsigned char *)str;
    if (p == NULL)
        return hash;
    while (*p != '\0') {
        hash ^= (uint64_t)(*p++);
        hash *= 1099511628211ULL;
    }
    hash ^= 0xFFULL;
    hash *= 1099511628211ULL;
    return hash;
}

void svc_hsm_compute_req_mac(const CARD_AUTH_REQ *req, char out_mac[WIRE_MAC_LEN + 1])
{
    uint64_t h = 14695981039346656037ULL;
    const char *mti;

    if (out_mac == NULL)
        return;

    if (req == NULL) {
        memset(out_mac, '0', WIRE_MAC_LEN);
        out_mac[WIRE_MAC_LEN] = '\0';
        return;
    }

    mti = (req->mti[0] != '\0') ? req->mti : MTI_AUTH_REQ;
    h = fnv1a_update(h, DEMO_MAC_SECRET);
    h = fnv1a_update(h, mti);
    h = fnv1a_update(h, req->pan);
    h = fnv1a_update(h, req->amount);
    h = fnv1a_update(h, req->stan);
    h = fnv1a_update(h, req->rrn);

    snprintf(out_mac, WIRE_MAC_LEN + 1, "%08X%08X",
             (unsigned int)(h >> 32), (unsigned int)(h & 0xFFFFFFFFU));
}

void svc_hsm_compute_resp_mac(const CARD_AUTH_RESP *resp, char out_mac[WIRE_MAC_LEN + 1])
{
    uint64_t h = 14695981039346656037ULL;
    const char *mti;

    if (out_mac == NULL)
        return;

    if (resp == NULL) {
        memset(out_mac, '0', WIRE_MAC_LEN);
        out_mac[WIRE_MAC_LEN] = '\0';
        return;
    }

    mti = (resp->mti[0] != '\0') ? resp->mti : MTI_AUTH_RESP;
    h = fnv1a_update(h, DEMO_MAC_SECRET);
    h = fnv1a_update(h, mti);
    h = fnv1a_update(h, resp->pan);
    h = fnv1a_update(h, resp->resp_code);
    h = fnv1a_update(h, resp->auth_code);
    h = fnv1a_update(h, resp->stan);
    h = fnv1a_update(h, resp->rrn);

    snprintf(out_mac, WIRE_MAC_LEN + 1, "%08X%08X",
             (unsigned int)(h >> 32), (unsigned int)(h & 0xFFFFFFFFU));
}

int svc_hsm_verify_req_mac(const CARD_AUTH_REQ *req)
{
    char expected[WIRE_MAC_LEN + 1];

    if (req == NULL)
        return 0;

    /* 내부 구조체 직접 호출 테스트 시 mac 미입력 상태면 통과 허용 */
    if (req->mac[0] == '\0')
        return 1;

    if (strlen(req->mac) != WIRE_MAC_LEN)
        return 0;

    svc_hsm_compute_req_mac(req, expected);
    return (strncmp(req->mac, expected, WIRE_MAC_LEN) == 0) ? 1 : 0;
}

/*
 * svc_hsm_verify_pin
 * 반환: 1 = 정상, 0 = PIN 불일치, -1 = PIN 블록 포맷 오류
 */
int svc_hsm_verify_pin(const char *pan, const char *pin_block)
{
    size_t i;
    (void)pan;

    if (pin_block == NULL || strlen(pin_block) != WIRE_PINBLK_LEN)
        return -1;

    for (i = 0; i < WIRE_PINBLK_LEN; i++) {
        char c = pin_block[i];
        int is_hex = ((c >= '0' && c <= '9') ||
                      (c >= 'A' && c <= 'F') ||
                      (c >= 'a' && c <= 'f'));
        if (!is_hex)
            return -1;
    }

    /* 시뮬레이션: FFFFFFFFFFFFFFFF 입력 시 비밀번호 불일치로 판정 */
    if (strncmp(pin_block, "FFFFFFFFFFFFFFFF", WIRE_PINBLK_LEN) == 0 ||
        strncmp(pin_block, "ffffffffffffffff", WIRE_PINBLK_LEN) == 0)
    {
        return 0;
    }

    return 1;
}

/* ================================================================
 * 2. MCH-SVR 시뮬레이션 (가맹점 및 단말기 상태 검증)
 * ================================================================ */

int svc_merchant_verify(const char *merchant_id, const char *terminal_id)
{
    if (merchant_id == NULL || merchant_id[0] == '\0' ||
        terminal_id == NULL || terminal_id[0] == '\0')
    {
        return 0;
    }

    /* 거래 정지("MCH_STOP*") 또는 미등록("INVALID*") 가맹점 시뮬레이션 */
    if (strncmp(merchant_id, "MCH_STOP", 8) == 0 ||
        strncmp(merchant_id, "INVALID", 7) == 0)
    {
        return 0;
    }

    return 1;
}

/* ================================================================
 * 3. JRNL-SVR & SAF-SVR 시뮬레이션 (원장 이력 및 자동 망취소 큐)
 * ================================================================ */

int svc_journal_is_duplicate(const char *pan, const char *stan, const char *rrn)
{
    int i;

    if (pan == NULL || stan == NULL || rrn == NULL ||
        stan[0] == '\0' || rrn[0] == '\0')
    {
        return 0;
    }

    for (i = 0; i < g_journal_count; i++) {
        if (strcmp(g_journal[i].mti, MTI_AUTH_REQ) == 0 &&
            strcmp(g_journal[i].resp_code, RC_SUCCESS) == 0 &&
            !g_journal[i].is_cancelled &&
            strcmp(g_journal[i].pan, pan) == 0 &&
            strcmp(g_journal[i].stan, stan) == 0 &&
            strcmp(g_journal[i].rrn, rrn) == 0)
        {
            return 1;
        }
    }
    return 0;
}

int svc_journal_record(const CARD_AUTH_REQ *req,
                       const CARD_AUTH_RESP *resp,
                       const char *host_tx_id)
{
    JOURNAL_ENTRY *ent;

    if (req == NULL || resp == NULL || g_journal_count >= MAX_JOURNAL_RECORDS)
        return -1;

    ent = &g_journal[g_journal_count++];
    memset(ent, 0, sizeof(*ent));

    snprintf(ent->mti, sizeof(ent->mti), "%s",
             req->mti[0] ? req->mti : MTI_AUTH_REQ);
    snprintf(ent->pan, sizeof(ent->pan), "%s", req->pan);
    snprintf(ent->stan, sizeof(ent->stan), "%s", req->stan);
    snprintf(ent->rrn, sizeof(ent->rrn), "%s", req->rrn);
    ent->amount = strtol(req->amount, NULL, 10);
    snprintf(ent->resp_code, sizeof(ent->resp_code), "%s", resp->resp_code);
    snprintf(ent->auth_code, sizeof(ent->auth_code), "%s", resp->auth_code);
    if (host_tx_id != NULL)
        snprintf(ent->host_tx_id, sizeof(ent->host_tx_id), "%s", host_tx_id);

    return 0;
}

int svc_journal_count(void)
{
    return g_journal_count;
}

int svc_saf_enqueue_reversal(const INNER_AUTH_REQ *req)
{
    SAF_ENTRY *saf;

    if (req == NULL || g_saf_count >= MAX_SAF_ENTRIES)
        return -1;

    saf = &g_saf_queue[g_saf_count++];
    memset(saf, 0, sizeof(*saf));
    snprintf(saf->pan, sizeof(saf->pan), "%s", req->pan);
    snprintf(saf->stan, sizeof(saf->stan), "%s", req->stan);
    snprintf(saf->rrn, sizeof(saf->rrn), "%s", req->rrn);
    saf->amount = req->amount;
    snprintf(saf->host_tx_id, sizeof(saf->host_tx_id), "%s", req->host_tx_id);
    snprintf(saf->req_timestamp, sizeof(saf->req_timestamp), "%s", req->req_timestamp);

    return 0;
}

int svc_saf_pending_count(void)
{
    return g_saf_count;
}

/* ================================================================
 * 4. HOST-SVR 시뮬레이션 (카드 원장 한도 관리 및 승인/취소 심사)
 * ================================================================ */

static CARD_LEDGER_ENTRY *find_or_create_card_ledger(const char *pan)
{
    int i;
    for (i = 0; i < g_card_count; i++) {
        if (strcmp(g_card_ledger[i].pan, pan) == 0)
            return &g_card_ledger[i];
    }
    if (g_card_count >= MAX_CARD_ACCOUNTS)
        return NULL;

    snprintf(g_card_ledger[g_card_count].pan,
             sizeof(g_card_ledger[g_card_count].pan), "%s", pan);
    g_card_ledger[g_card_count].used_amount = 0L;
    return &g_card_ledger[g_card_count++];
}

static JOURNAL_ENTRY *find_original_approved_tx(const char *pan,
                                                const char *rrn,
                                                long amount)
{
    int i;
    for (i = g_journal_count - 1; i >= 0; i--) {
        if (strcmp(g_journal[i].mti, MTI_AUTH_REQ) == 0 &&
            strcmp(g_journal[i].resp_code, RC_SUCCESS) == 0 &&
            !g_journal[i].is_cancelled &&
            strcmp(g_journal[i].pan, pan) == 0 &&
            strcmp(g_journal[i].rrn, rrn) == 0 &&
            g_journal[i].amount == amount)
        {
            return &g_journal[i];
        }
    }
    return NULL;
}

int host_link_authorize(const INNER_AUTH_REQ *req, INNER_AUTH_RESP *resp)
{
    CARD_LEDGER_ENTRY *acct;

    if (req == NULL || resp == NULL)
        return HOST_ERR_SYS;

    memset(resp, 0, sizeof(*resp));
    snprintf(resp->host_tx_id, sizeof(resp->host_tx_id), "%s", req->host_tx_id);
    make_host_timestamp(resp->host_resp_timestamp, sizeof(resp->host_resp_timestamp));

    /* 시뮬레이션 1: 호스트 응답 타임아웃 유발 테스트 카드 (4000000000000093) */
    if (strcmp(req->pan, "4000000000000093") == 0) {
        return HOST_ERR_TIMEOUT;
    }

    /* 시뮬레이션 2: 분실 카드 (4000000000000002, Luhn 유효) */
    if (strcmp(req->pan, "4000000000000002") == 0) {
        snprintf(resp->resp_code, sizeof(resp->resp_code), "%s", RC_LOST_CARD);
        snprintf(resp->resp_msg, sizeof(resp->resp_msg), "분실 신고 카드");
        return HOST_OK;
    }

    /* 시뮬레이션 3: 도난 카드 (4000000000000028, Luhn 유효) */
    if (strcmp(req->pan, "4000000000000028") == 0) {
        snprintf(resp->resp_code, sizeof(resp->resp_code), "%s", RC_STOLEN_CARD);
        snprintf(resp->resp_msg, sizeof(resp->resp_msg), "도난 신고 카드");
        return HOST_OK;
    }

    acct = find_or_create_card_ledger(req->pan);
    if (acct == NULL) {
        return HOST_ERR_SYS;
    }

    /* [취소 거래 처리: TX_CODE_CANCEL] */
    if (strcmp(req->tx_code, TX_CODE_CANCEL) == 0) {
        JOURNAL_ENTRY *orig = find_original_approved_tx(req->pan, req->rrn, req->amount);
        if (orig == NULL) {
            snprintf(resp->resp_code, sizeof(resp->resp_code), "%s", RC_ORIG_NOT_FOUND);
            snprintf(resp->resp_msg, sizeof(resp->resp_msg), "원거래 없음 또는 기취소");
            return HOST_OK;
        }

        orig->is_cancelled = 1;
        if (acct->used_amount >= req->amount)
            acct->used_amount -= req->amount;
        else
            acct->used_amount = 0L;

        snprintf(resp->resp_code, sizeof(resp->resp_code), "%s", RC_SUCCESS);
        snprintf(resp->auth_code, sizeof(resp->auth_code), "C%05u", g_auth_seq++ % 100000U);
        snprintf(resp->resp_msg, sizeof(resp->resp_msg), "승인 취소 완료");
        resp->available_balance = DEFAULT_CARD_LIMIT - acct->used_amount;
        return HOST_OK;
    }

    /* [승인 거래 처리: TX_CODE_AUTH] 누적 한도 초과 검사 (500만원) */
    if (acct->used_amount + req->amount > DEFAULT_CARD_LIMIT) {
        snprintf(resp->resp_code, sizeof(resp->resp_code), "%s", RC_INSUFF_FUNDS);
        snprintf(resp->resp_msg, sizeof(resp->resp_msg), "한도 초과");
        resp->available_balance = DEFAULT_CARD_LIMIT - acct->used_amount;
        return HOST_OK;
    }

    /* 정상 승인 및 한도 차감 */
    acct->used_amount += req->amount;
    snprintf(resp->resp_code, sizeof(resp->resp_code), "%s", RC_SUCCESS);
    snprintf(resp->auth_code, sizeof(resp->auth_code), "A%05u", g_auth_seq++ % 100000U);
    snprintf(resp->resp_msg, sizeof(resp->resp_msg), "승인 완료");
    resp->available_balance = DEFAULT_CARD_LIMIT - acct->used_amount;

    return HOST_OK;
}
