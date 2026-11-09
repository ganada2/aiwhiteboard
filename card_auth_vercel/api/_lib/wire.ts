/**
 * wire.ts - 고정길이 ISO 8583 유사 대외 전문 파싱 및 직렬화
 * (원본 C 프로젝트의 pathway_req.c & pathway_resp.c 대응)
 */

import { Mti, ResponseCode, WireLength } from './types.js';
import type { CardAuthReq, CardAuthResp } from './types.js';
import { svcHsmComputeReqMac, svcHsmComputeRespMac } from './services.js';

function putPaddedRightBytes(
  target: Buffer,
  offset: number,
  fieldLen: number,
  src: string,
  padByte: number = 0x20,
): number {
  target.fill(padByte, offset, offset + fieldLen);
  if (!src) return offset + fieldLen;

  // UTF-8 멀티바이트 문자가 경계에서 깨지지 않도록 문자 단위로 누적
  const chunks: Buffer[] = [];
  let used = 0;
  for (const ch of src) {
    const b = Buffer.from(ch, 'utf8');
    if (used + b.length > fieldLen) break;
    chunks.push(b);
    used += b.length;
  }
  if (used > 0) {
    Buffer.concat(chunks, used).copy(target, offset);
  }
  return offset + fieldLen;
}

function putPaddedLeftZero(
  target: Buffer,
  offset: number,
  fieldLen: number,
  src: string,
): number {
  target.fill(0x30, offset, offset + fieldLen); // '0'
  if (!src) return offset + fieldLen;

  const raw = Buffer.from(src, 'ascii');
  if (raw.length >= fieldLen) {
    raw.subarray(raw.length - fieldLen).copy(target, offset);
  } else {
    raw.copy(target, offset + (fieldLen - raw.length));
  }
  return offset + fieldLen;
}

function extractTrimmedField(buf: Buffer, offset: number, len: number): string {
  return buf.subarray(offset, offset + len).toString('utf8').replace(/ +$/g, '');
}

/** ISO 8583 Primary Bitmap (64비트 → 16자리 대문자 Hex) 생성 */
export function buildIsoBitmapHex(resp: Partial<CardAuthResp>): string {
  let bm = 0n;
  if (resp.pan) bm |= 1n << (64n - 2n);       // DE2: PAN
  if (resp.stan) bm |= 1n << (64n - 11n);     // DE11: STAN
  if (resp.rrn) bm |= 1n << (64n - 37n);      // DE37: RRN
  if (resp.authCode) bm |= 1n << (64n - 38n); // DE38: Auth Code
  if (resp.respCode) bm |= 1n << (64n - 39n); // DE39: Resp Code
  if (resp.respMsg) bm |= 1n << (64n - 44n);  // DE44: Additional Resp Msg
  bm |= 1n << (64n - 64n);                    // DE64: MAC

  const hi = Number((bm >> 32n) & 0xffffffffn)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');
  const lo = Number(bm & 0xffffffffn)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');
  return `${hi}${lo}`;
}

/**
 * parseAuthRequest
 * 최소 112바이트 요청 전문을 파싱하여 CardAuthReq 반환 (실패 시 null)
 */
export function parseAuthRequest(rawInput: string | Buffer): CardAuthReq | null {
  const buf = typeof rawInput === 'string' ? Buffer.from(rawInput, 'utf8') : rawInput;
  if (buf.length < WireLength.RAW_REQ_MIN) {
    return null;
  }

  let offset = 0;
  const mti = extractTrimmedField(buf, offset, WireLength.MTI);
  offset += WireLength.MTI;

  const pan = extractTrimmedField(buf, offset, WireLength.PAN);
  offset += WireLength.PAN;

  const expiry = extractTrimmedField(buf, offset, WireLength.EXPIRY);
  offset += WireLength.EXPIRY;

  const amount = extractTrimmedField(buf, offset, WireLength.AMOUNT);
  offset += WireLength.AMOUNT;

  const stan = extractTrimmedField(buf, offset, WireLength.STAN);
  offset += WireLength.STAN;

  const rrn = extractTrimmedField(buf, offset, WireLength.RRN);
  offset += WireLength.RRN;

  const terminalId = extractTrimmedField(buf, offset, WireLength.TERMINAL_ID);
  offset += WireLength.TERMINAL_ID;

  const merchantId = extractTrimmedField(buf, offset, WireLength.MERCHANT_ID);
  offset += WireLength.MERCHANT_ID;

  const pinBlock = extractTrimmedField(buf, offset, WireLength.PIN_BLOCK);
  offset += WireLength.PIN_BLOCK;

  const mac = extractTrimmedField(buf, offset, WireLength.MAC);
  offset += WireLength.MAC;

  let reserved = '';
  if (offset < buf.length) {
    const rem = Math.min(buf.length - offset, WireLength.RESERVED_MAX);
    reserved = extractTrimmedField(buf, offset, rem);
  }

  if (mti !== Mti.AUTH_REQ && mti !== Mti.CANCEL_REQ && mti !== Mti.ECHO_REQ) {
    return null;
  }

  return {
    mti,
    pan,
    expiry,
    amount,
    stan,
    rrn,
    terminalId,
    merchantId,
    pinBlock,
    mac,
    reserved,
  };
}

/**
 * buildAuthRequest
 * CardAuthReq를 고정길이(112B + reserved) 바이트열 문자열로 직렬화
 */
export function buildAuthRequest(req: Partial<CardAuthReq>): {
  raw: string;
  byteLength: number;
  mac: string;
} {
  const mti = req.mti && req.mti.length > 0 ? req.mti : Mti.AUTH_REQ;
  const amountBuf = Buffer.alloc(WireLength.AMOUNT);
  putPaddedLeftZero(amountBuf, 0, WireLength.AMOUNT, req.amount ?? '');
  const normalizedAmount = amountBuf.toString('ascii');

  const macToWrite =
    req.mac && req.mac.length > 0
      ? req.mac
      : svcHsmComputeReqMac({
          mti,
          pan: req.pan ?? '',
          amount: normalizedAmount,
          stan: req.stan ?? '',
          rrn: req.rrn ?? '',
        });

  const reservedBytes = req.reserved
    ? Buffer.from(req.reserved, 'utf8').subarray(0, WireLength.RESERVED_MAX)
    : Buffer.alloc(0);

  const totalLen = WireLength.RAW_REQ_MIN + reservedBytes.length;
  const out = Buffer.alloc(totalLen, 0x20);

  let offset = 0;
  offset = putPaddedRightBytes(out, offset, WireLength.MTI, mti);
  offset = putPaddedRightBytes(out, offset, WireLength.PAN, req.pan ?? '');
  offset = putPaddedRightBytes(out, offset, WireLength.EXPIRY, req.expiry ?? '');
  offset = putPaddedLeftZero(out, offset, WireLength.AMOUNT, req.amount ?? '');
  offset = putPaddedRightBytes(out, offset, WireLength.STAN, req.stan ?? '');
  offset = putPaddedRightBytes(out, offset, WireLength.RRN, req.rrn ?? '');
  offset = putPaddedRightBytes(out, offset, WireLength.TERMINAL_ID, req.terminalId ?? '');
  offset = putPaddedRightBytes(out, offset, WireLength.MERCHANT_ID, req.merchantId ?? '');
  offset = putPaddedRightBytes(out, offset, WireLength.PIN_BLOCK, req.pinBlock ?? '');
  offset = putPaddedRightBytes(out, offset, WireLength.MAC, macToWrite);

  if (reservedBytes.length > 0) {
    reservedBytes.copy(out, offset);
  }

  return {
    raw: out.toString('utf8'),
    byteLength: out.length,
    mac: macToWrite,
  };
}

/**
 * buildAuthResponse
 * CardAuthResp를 145바이트 고정길이 응답 전문으로 직렬화
 */
export function buildAuthResponse(resp: CardAuthResp): {
  raw: string;
  byteLength: number;
  bitmapHex: string;
  mac: string;
} {
  const bitmapHex = buildIsoBitmapHex(resp);
  const mac = resp.mac && resp.mac.length > 0 ? resp.mac : svcHsmComputeRespMac(resp);

  const out = Buffer.alloc(WireLength.RAW_RESP, 0x20);
  let offset = 0;

  offset = putPaddedRightBytes(out, offset, WireLength.MTI, resp.mti || Mti.AUTH_RESP);
  Buffer.from(bitmapHex, 'ascii').copy(out, offset, 0, WireLength.BITMAP);
  offset += WireLength.BITMAP;

  offset = putPaddedRightBytes(out, offset, WireLength.PAN, resp.pan);
  offset = putPaddedRightBytes(
    out,
    offset,
    WireLength.RESP_CODE,
    resp.respCode || ResponseCode.SYSTEM_ERROR,
  );
  offset = putPaddedRightBytes(out, offset, WireLength.AUTH_CODE, resp.authCode);
  offset = putPaddedRightBytes(out, offset, WireLength.STAN, resp.stan);
  offset = putPaddedRightBytes(out, offset, WireLength.RRN, resp.rrn);
  offset = putPaddedRightBytes(out, offset, WireLength.RESP_MSG, resp.respMsg);
  putPaddedRightBytes(out, offset, WireLength.MAC, mac);

  return {
    raw: out.toString('utf8'),
    byteLength: out.length,
    bitmapHex,
    mac,
  };
}

/**
 * parseAuthResponse
 * 145바이트 응답 전문을 역직렬화하여 CardAuthResp 반환
 */
export function parseAuthResponse(rawInput: string | Buffer): (CardAuthResp & { bitmapHex: string }) | null {
  const buf = typeof rawInput === 'string' ? Buffer.from(rawInput, 'utf8') : rawInput;
  if (buf.length < WireLength.RAW_RESP) {
    return null;
  }

  let offset = 0;
  const mti = extractTrimmedField(buf, offset, WireLength.MTI);
  offset += WireLength.MTI;

  const bitmapHex = extractTrimmedField(buf, offset, WireLength.BITMAP);
  offset += WireLength.BITMAP;

  const pan = extractTrimmedField(buf, offset, WireLength.PAN);
  offset += WireLength.PAN;

  const respCode = extractTrimmedField(buf, offset, WireLength.RESP_CODE);
  offset += WireLength.RESP_CODE;

  const authCode = extractTrimmedField(buf, offset, WireLength.AUTH_CODE);
  offset += WireLength.AUTH_CODE;

  const stan = extractTrimmedField(buf, offset, WireLength.STAN);
  offset += WireLength.STAN;

  const rrn = extractTrimmedField(buf, offset, WireLength.RRN);
  offset += WireLength.RRN;

  const respMsg = extractTrimmedField(buf, offset, WireLength.RESP_MSG);
  offset += WireLength.RESP_MSG;

  const mac = extractTrimmedField(buf, offset, WireLength.MAC);

  return {
    mti,
    bitmapHex,
    pan,
    respCode,
    authCode,
    stan,
    rrn,
    respMsg,
    mac,
  };
}

