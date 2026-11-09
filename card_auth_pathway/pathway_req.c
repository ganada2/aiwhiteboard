/*
 * pathway_req.c - PATHWAY 대외 요청 전문 파싱 및 직렬화 (VAN/FEP ↔ CARD_AUTH_REQ)
 */

#include <stdio.h>
#include <string.h>
#include "card_auth.h"

/* 고정길이 필드에서 문자열 추출 후 우측 공백 제거 */
static void extract_field_rtrim(char *dst, size_t dst_size,
                                const char *src, int field_len)
{
    int copy_len = field_len;
    int end;

    if (dst == NULL || dst_size == 0)
        return;

    if (copy_len > (int)dst_size - 1)
        copy_len = (int)dst_size - 1;

    memcpy(dst, src, (size_t)copy_len);
    dst[copy_len] = '\0';

    end = copy_len - 1;
    while (end >= 0 && dst[end] == ' ') {
        dst[end] = '\0';
        end--;
    }
}

/* 문자열을 고정길이 버퍼에 복사하고 남는 공간은 우측 패딩 문자로 채움 */
static void put_padded_right(char *dst, int field_len,
                             const char *src, char pad_char)
{
    size_t slen = (src != NULL) ? strlen(src) : 0;
    if ((int)slen > field_len)
        slen = (size_t)field_len;

    memset(dst, (unsigned char)pad_char, (size_t)field_len);
    if (slen > 0)
        memcpy(dst, src, slen);
}

/* 금액 등 숫자 문자열을 고정길이 좌측 '0' 패딩으로 기록 */
static void put_padded_left_zero(char *dst, int field_len, const char *src)
{
    size_t slen = (src != NULL) ? strlen(src) : 0;
    memset(dst, '0', (size_t)field_len);
    if (slen == 0)
        return;

    if ((int)slen >= field_len) {
        memcpy(dst, src + (slen - (size_t)field_len), (size_t)field_len);
    } else {
        memcpy(dst + ((size_t)field_len - slen), src, slen);
    }
}

/*
 * parse_auth_request
 *
 * 고정길이 요청 전문 레이아웃 (최소 112바이트):
 *   [0..3]     MTI          (4)
 *   [4..22]    PAN          (19, 우측 공백 패딩)
 *   [23..26]   EXPIRY       (4, YYMM)
 *   [27..38]   AMOUNT       (12, 좌측 '0' 패딩)
 *   [39..44]   STAN         (6)
 *   [45..56]   RRN          (12)
 *   [57..64]   TERMINAL_ID  (8, 우측 공백 패딩)
 *   [65..79]   MERCHANT_ID  (15, 우측 공백 패딩)
 *   [80..95]   PIN_BLOCK    (16)
 *   [96..111]  MAC          (16)
 *   [112..]    RESERVED     (0~50)
 *
 * 반환: 0 = 성공, -1 = 길이 부족 또는 MTI 형식 오류
 */
int parse_auth_request(const char *raw, int rawlen, CARD_AUTH_REQ *req)
{
    int offset = 0;

    if (raw == NULL || req == NULL || rawlen < RAW_AUTH_REQ_MIN_LEN)
        return -1;

    memset(req, 0, sizeof(*req));

    extract_field_rtrim(req->mti, sizeof(req->mti), raw + offset, WIRE_MTI_LEN);
    offset += WIRE_MTI_LEN;

    extract_field_rtrim(req->pan, sizeof(req->pan), raw + offset, WIRE_PAN_LEN);
    offset += WIRE_PAN_LEN;

    extract_field_rtrim(req->expiry, sizeof(req->expiry), raw + offset, WIRE_EXPIRY_LEN);
    offset += WIRE_EXPIRY_LEN;

    extract_field_rtrim(req->amount, sizeof(req->amount), raw + offset, WIRE_AMOUNT_LEN);
    offset += WIRE_AMOUNT_LEN;

    extract_field_rtrim(req->stan, sizeof(req->stan), raw + offset, WIRE_STAN_LEN);
    offset += WIRE_STAN_LEN;

    extract_field_rtrim(req->rrn, sizeof(req->rrn), raw + offset, WIRE_RRN_LEN);
    offset += WIRE_RRN_LEN;

    extract_field_rtrim(req->terminal_id, sizeof(req->terminal_id), raw + offset, WIRE_TERMID_LEN);
    offset += WIRE_TERMID_LEN;

    extract_field_rtrim(req->merchant_id, sizeof(req->merchant_id), raw + offset, WIRE_MERCHID_LEN);
    offset += WIRE_MERCHID_LEN;

    extract_field_rtrim(req->pin_block, sizeof(req->pin_block), raw + offset, WIRE_PINBLK_LEN);
    offset += WIRE_PINBLK_LEN;

    extract_field_rtrim(req->mac, sizeof(req->mac), raw + offset, WIRE_MAC_LEN);
    offset += WIRE_MAC_LEN;

    if (offset < rawlen) {
        int rem = rawlen - offset;
        if (rem > WIRE_RESERVED_MAX)
            rem = WIRE_RESERVED_MAX;
        extract_field_rtrim(req->reserved, sizeof(req->reserved), raw + offset, rem);
    }

    /* 허용된 요청 MTI 검증 (0100 승인, 0400 취소, 0800 개시) */
    if (strcmp(req->mti, MTI_AUTH_REQ) != 0 &&
        strcmp(req->mti, MTI_CANCEL_REQ) != 0 &&
        strcmp(req->mti, MTI_ECHO_REQ) != 0)
    {
        return -1;
    }

    return 0;
}

/*
 * build_auth_request
 *
 * CARD_AUTH_REQ 구조체를 고정길이 대외 요청 전문(112바이트+)으로 직렬화.
 * req->mac이 비어 있으면 HSM MAC 계산 함수를 호출하여 자동 채움.
 *
 * outlen: 입력 시 버퍼 크기, 출력 시 기록된 바이트 수
 */
int build_auth_request(const CARD_AUTH_REQ *req, char *out, int *outlen)
{
    char *p;
    char  auto_mac[WIRE_MAC_LEN + 1];
    const char *mac_to_write;
    int   res_len;
    int   total_len;

    if (req == NULL || out == NULL || outlen == NULL)
        return -1;

    res_len = (int)strlen(req->reserved);
    if (res_len > WIRE_RESERVED_MAX)
        res_len = WIRE_RESERVED_MAX;

    total_len = RAW_AUTH_REQ_MIN_LEN + res_len;
    if (*outlen < total_len)
        return -1;

    if (req->mac[0] != '\0') {
        mac_to_write = req->mac;
    } else {
        CARD_AUTH_REQ norm_req = *req;
        if (norm_req.mti[0] == '\0')
            snprintf(norm_req.mti, sizeof(norm_req.mti), "%s", MTI_AUTH_REQ);
        put_padded_left_zero(norm_req.amount, WIRE_AMOUNT_LEN, req->amount);
        norm_req.amount[WIRE_AMOUNT_LEN] = '\0';
        svc_hsm_compute_req_mac(&norm_req, auto_mac);
        mac_to_write = auto_mac;
    }

    p = out;
    put_padded_right(p, WIRE_MTI_LEN, req->mti[0] ? req->mti : MTI_AUTH_REQ, ' ');
    p += WIRE_MTI_LEN;

    put_padded_right(p, WIRE_PAN_LEN, req->pan, ' ');
    p += WIRE_PAN_LEN;

    put_padded_right(p, WIRE_EXPIRY_LEN, req->expiry, ' ');
    p += WIRE_EXPIRY_LEN;

    put_padded_left_zero(p, WIRE_AMOUNT_LEN, req->amount);
    p += WIRE_AMOUNT_LEN;

    put_padded_right(p, WIRE_STAN_LEN, req->stan, ' ');
    p += WIRE_STAN_LEN;

    put_padded_right(p, WIRE_RRN_LEN, req->rrn, ' ');
    p += WIRE_RRN_LEN;

    put_padded_right(p, WIRE_TERMID_LEN, req->terminal_id, ' ');
    p += WIRE_TERMID_LEN;

    put_padded_right(p, WIRE_MERCHID_LEN, req->merchant_id, ' ');
    p += WIRE_MERCHID_LEN;

    put_padded_right(p, WIRE_PINBLK_LEN, req->pin_block, ' ');
    p += WIRE_PINBLK_LEN;

    put_padded_right(p, WIRE_MAC_LEN, mac_to_write, ' ');
    p += WIRE_MAC_LEN;

    if (res_len > 0) {
        memcpy(p, req->reserved, (size_t)res_len);
    }

    *outlen = total_len;
    return 0;
}
