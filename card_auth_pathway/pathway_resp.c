/*
 * pathway_resp.c - PATHWAY 송신 전문 생성 및 파싱 (CARD_AUTH_RESP ↔ VAN/FEP)
 */

#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "card_auth.h"

static void put_padded_space(char *dst, int field_len, const char *src)
{
    size_t slen = (src != NULL) ? strlen(src) : 0;
    if ((int)slen > field_len)
        slen = (size_t)field_len;

    memset(dst, ' ', (size_t)field_len);
    if (slen > 0)
        memcpy(dst, src, slen);
}

static void extract_rtrim(char *dst, size_t dst_size, const char *src, int field_len)
{
    int copy_len = field_len;
    int end;

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

/* ISO 8583 Primary Bitmap (64비트 → 16자리 Hex) 생성 */
static void build_iso_bitmap_hex(const CARD_AUTH_RESP *resp, char out_hex[WIRE_BITMAP_LEN + 1])
{
    uint64_t bm = 0;

    /* ISO 8583 비트 번호: MSB(비트 1) = (1ULL << 63), 비트 N = (1ULL << (64 - N)) */
    if (resp->pan[0] != '\0')       bm |= (1ULL << (64 - 2));   /* DE2:  PAN */
    if (resp->stan[0] != '\0')      bm |= (1ULL << (64 - 11));  /* DE11: STAN */
    if (resp->rrn[0] != '\0')       bm |= (1ULL << (64 - 37));  /* DE37: RRN */
    if (resp->auth_code[0] != '\0') bm |= (1ULL << (64 - 38));  /* DE38: Auth Code */
    if (resp->resp_code[0] != '\0') bm |= (1ULL << (64 - 39));  /* DE39: Resp Code */
    if (resp->resp_msg[0] != '\0')  bm |= (1ULL << (64 - 44));  /* DE44: Additional Resp */
    bm |= (1ULL << (64 - 64));                                  /* DE64: MAC */

    snprintf(out_hex, WIRE_BITMAP_LEN + 1, "%08X%08X",
             (unsigned int)(bm >> 32), (unsigned int)(bm & 0xFFFFFFFFU));
}

/*
 * build_auth_response
 *
 * 고정길이 응답 전문 레이아웃 (총 145바이트):
 *   [0..3]     MTI        (4)
 *   [4..19]    BITMAP     (16, ISO 8583 Hex Bitmap)
 *   [20..38]   PAN        (19, 우측 공백 패딩)
 *   [39..40]   RESP_CODE  (2)
 *   [41..46]   AUTH_CODE  (6, 우측 공백 패딩)
 *   [47..52]   STAN       (6, 우측 공백 패딩)
 *   [53..64]   RRN        (12, 우측 공백 패딩)
 *   [65..128]  RESP_MSG   (64, 우측 공백 패딩)
 *   [129..144] MAC        (16, Hex)
 *
 * outlen: 입력 시 송신 버퍼 용량(*outlen >= 145 필요), 출력 시 145 설정
 * 반환: 0 = 성공, -1 = 실패
 */
int build_auth_response(const CARD_AUTH_RESP *resp,
                        char *out, int *outlen)
{
    char *p;
    char  bitmap_hex[WIRE_BITMAP_LEN + 1];
    char  auto_mac[WIRE_MAC_LEN + 1];
    const char *mac_src;

    if (resp == NULL || out == NULL || outlen == NULL)
        return -1;

    if (*outlen < RAW_AUTH_RESP_LEN)
        return -1;

    build_iso_bitmap_hex(resp, bitmap_hex);

    if (resp->mac[0] != '\0') {
        mac_src = resp->mac;
    } else {
        svc_hsm_compute_resp_mac(resp, auto_mac);
        mac_src = auto_mac;
    }

    p = out;

    /* MTI (기본값 0110 보장) */
    put_padded_space(p, WIRE_MTI_LEN, resp->mti[0] ? resp->mti : MTI_AUTH_RESP);
    p += WIRE_MTI_LEN;

    /* ISO 8583 비트맵 (16바이트 Hex) */
    memcpy(p, bitmap_hex, WIRE_BITMAP_LEN);
    p += WIRE_BITMAP_LEN;

    /* PAN (19바이트) */
    put_padded_space(p, WIRE_PAN_LEN, resp->pan);
    p += WIRE_PAN_LEN;

    /* 응답 코드 (2바이트) */
    put_padded_space(p, WIRE_RESPCODE_LEN, resp->resp_code[0] ? resp->resp_code : RC_SYSTEM_ERROR);
    p += WIRE_RESPCODE_LEN;

    /* 승인 번호 (6바이트) */
    put_padded_space(p, WIRE_AUTHCODE_LEN, resp->auth_code);
    p += WIRE_AUTHCODE_LEN;

    /* STAN (6바이트) */
    put_padded_space(p, WIRE_STAN_LEN, resp->stan);
    p += WIRE_STAN_LEN;

    /* RRN (12바이트) */
    put_padded_space(p, WIRE_RRN_LEN, resp->rrn);
    p += WIRE_RRN_LEN;

    /* 응답 메시지 (64바이트, 내부 '\0' 혼입 없이 공백 패딩) */
    put_padded_space(p, WIRE_RESPMSG_LEN, resp->resp_msg);
    p += WIRE_RESPMSG_LEN;

    /* MAC (16바이트) */
    put_padded_space(p, WIRE_MAC_LEN, mac_src);
    p += WIRE_MAC_LEN;

    *outlen = (int)(p - out);
    return 0;
}

/*
 * parse_auth_response
 *
 * 직렬화된 145바이트 응답 전문을 CARD_AUTH_RESP 구조체로 역직렬화.
 */
int parse_auth_response(const char *raw, int rawlen, CARD_AUTH_RESP *resp)
{
    int offset = 0;

    if (raw == NULL || resp == NULL || rawlen < RAW_AUTH_RESP_LEN)
        return -1;

    memset(resp, 0, sizeof(*resp));

    extract_rtrim(resp->mti, sizeof(resp->mti), raw + offset, WIRE_MTI_LEN);
    offset += WIRE_MTI_LEN;

    /* 비트맵(16바이트) 건너뜀 */
    offset += WIRE_BITMAP_LEN;

    extract_rtrim(resp->pan, sizeof(resp->pan), raw + offset, WIRE_PAN_LEN);
    offset += WIRE_PAN_LEN;

    extract_rtrim(resp->resp_code, sizeof(resp->resp_code), raw + offset, WIRE_RESPCODE_LEN);
    offset += WIRE_RESPCODE_LEN;

    extract_rtrim(resp->auth_code, sizeof(resp->auth_code), raw + offset, WIRE_AUTHCODE_LEN);
    offset += WIRE_AUTHCODE_LEN;

    extract_rtrim(resp->stan, sizeof(resp->stan), raw + offset, WIRE_STAN_LEN);
    offset += WIRE_STAN_LEN;

    extract_rtrim(resp->rrn, sizeof(resp->rrn), raw + offset, WIRE_RRN_LEN);
    offset += WIRE_RRN_LEN;

    extract_rtrim(resp->resp_msg, sizeof(resp->resp_msg), raw + offset, WIRE_RESPMSG_LEN);
    offset += WIRE_RESPMSG_LEN;

    extract_rtrim(resp->mac, sizeof(resp->mac), raw + offset, WIRE_MAC_LEN);

    return 0;
}
