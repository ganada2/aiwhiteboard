/**
 * tests/cardAuth.test.ts - TypeScript Serverless 카드 승인 통합 테스트 (15개 시나리오)
 * 실행: node --test tests/cardAuth.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Mti, ResponseCode, WireLength } from '../api/_lib/types.js';
import type { CardAuthReq } from '../api/_lib/types.js';
import { processCardAuth } from '../api/_lib/orchestrator.js';
import {
  buildAuthRequest,
  buildAuthResponse,
  parseAuthRequest,
  parseAuthResponse,
} from '../api/_lib/wire.js';
import {
  resetCardAuthState,
  svcJournalCount,
  svcSafPendingCount,
} from '../api/_lib/services.js';
import apiHandler from '../api/index.js';

function validReq(overrides: Partial<CardAuthReq> = {}): Partial<CardAuthReq> {
  return {
    mti: Mti.AUTH_REQ,
    pan: '4000000000000010',
    expiry: '2912',
    amount: '000000100000',
    stan: '000001',
    rrn: '202611020001',
    terminalId: 'T0000001',
    merchantId: 'MCH000001',
    pinBlock: '1234567890ABCDEF',
    ...overrides,
  };
}

describe('card_auth_vercel (PATHWAY -> TypeScript Serverless)', () => {
  beforeEach(() => {
    resetCardAuthState();
  });

  it('1. 정상 승인 (0100 -> 0110, 10만원 차감 및 승인번호 발급)', () => {
    const { response, trace } = processCardAuth(validReq());
    assert.equal(response.mti, Mti.AUTH_RESP);
    assert.equal(response.respCode, ResponseCode.SUCCESS);
    assert.match(response.authCode, /^A\d{5}$/);
    assert.equal(response.availableBalance, 4_900_000);
    assert.ok(trace.length >= 8);
  });

  it('2. 중복 승인 차단 (동일 PAN + STAN + RRN -> 94)', () => {
    const req = validReq();
    assert.equal(processCardAuth(req).response.respCode, ResponseCode.SUCCESS);
    assert.equal(processCardAuth(req).response.respCode, ResponseCode.DUPLICATE_TX);
  });

  it('3. 분실 신고 카드 거절 (4000000000000002 -> 41)', () => {
    const { response } = processCardAuth(validReq({ pan: '4000000000000002', stan: '000002', rrn: '202611020002' }));
    assert.equal(response.respCode, ResponseCode.LOST_CARD);
  });

  it('4. 도난 신고 카드 거절 (4000000000000028 -> 43)', () => {
    const { response } = processCardAuth(validReq({ pan: '4000000000000028', stan: '000003', rrn: '202611020003' }));
    assert.equal(response.respCode, ResponseCode.STOLEN_CARD);
  });

  it('5. 한도 초과 거절 (600만원 > 500만원 기본한도 -> 51)', () => {
    const { response } = processCardAuth(validReq({ amount: '000006000000', stan: '000004', rrn: '202611020004' }));
    assert.equal(response.respCode, ResponseCode.INSUFF_FUNDS);
  });

  it('6. 잘못된 카드 번호 길이 및 Luhn 무효 거절 (-> 14)', () => {
    assert.equal(processCardAuth(validReq({ pan: '123' })).response.respCode, ResponseCode.INVALID_CARD);
    assert.equal(
      processCardAuth(validReq({ pan: '4000000000000000' })).response.respCode,
      ResponseCode.INVALID_CARD,
    );
  });

  it('7. 필수 필드 누락 거절 (-> 96)', () => {
    const { response } = processCardAuth({ mti: Mti.AUTH_REQ });
    assert.equal(response.mti, Mti.AUTH_RESP);
    assert.equal(response.respCode, ResponseCode.FORMAT_ERROR);
  });

  it('8. 유효기간 만료 카드 거절 (2301 -> 54)', () => {
    const { response } = processCardAuth(validReq({ expiry: '2301' }));
    assert.equal(response.respCode, ResponseCode.EXPIRED_CARD);
  });

  it('9. 거래정지 가맹점 거절 (MCH_STOP001 -> 03)', () => {
    const { response } = processCardAuth(validReq({ merchantId: 'MCH_STOP001' }));
    assert.equal(response.respCode, ResponseCode.INVALID_MERCHANT);
  });

  it('10. HSM PIN 불일치 거절 (FFFFFFFFFFFFFFFF -> 55)', () => {
    const { response } = processCardAuth(validReq({ pinBlock: 'FFFFFFFFFFFFFFFF' }));
    assert.equal(response.respCode, ResponseCode.INVALID_PIN);
  });

  it('11. 승인 취소(0400->0410) 한도 복원 및 기취소 건 재취소 거절(25)', () => {
    assert.equal(processCardAuth(validReq()).response.respCode, ResponseCode.SUCCESS);

    const cancelReq: Partial<CardAuthReq> = {
      mti: Mti.CANCEL_REQ,
      pan: '4000000000000010',
      amount: '000000100000',
      stan: '000010',
      rrn: '202611020001',
      terminalId: 'T0000001',
      merchantId: 'MCH000001',
    };

    const firstCancel = processCardAuth(cancelReq);
    assert.equal(firstCancel.response.mti, Mti.CANCEL_RESP);
    assert.equal(firstCancel.response.respCode, ResponseCode.SUCCESS);
    assert.equal(firstCancel.response.availableBalance, 5_000_000);

    const secondCancel = processCardAuth({ ...cancelReq, stan: '000011' });
    assert.equal(secondCancel.response.respCode, ResponseCode.ORIG_NOT_FOUND);
  });

  it('12. 승인 호스트 타임아웃(91) 및 SAF 자동 망취소 큐 적재', () => {
    const { response } = processCardAuth(
      validReq({ pan: '4000000000000093', stan: '000012', rrn: '202611020012' }),
    );
    assert.equal(response.respCode, ResponseCode.HOST_TIMEOUT);
    assert.equal(svcSafPendingCount(), 1);
    assert.equal(svcJournalCount(), 1);
  });

  it('13. 112B/145B 대외 전문 직렬화·역직렬화·0800 개시·MAC 위변조 탐지', () => {
    assert.equal(parseAuthRequest('0100SHORT'), null);

    const builtReq = buildAuthRequest(validReq({ stan: '000013', rrn: '202611020013' }));
    assert.equal(builtReq.byteLength, WireLength.RAW_REQ_MIN);

    const parsedReq = parseAuthRequest(builtReq.raw);
    assert.ok(parsedReq);

    const { response } = processCardAuth(parsedReq);
    assert.equal(response.respCode, ResponseCode.SUCCESS);

    const builtResp = buildAuthResponse(response);
    assert.equal(builtResp.byteLength, WireLength.RAW_RESP);

    const parsedResp = parseAuthResponse(builtResp.raw);
    assert.ok(parsedResp);
    assert.equal(parsedResp.respCode, ResponseCode.SUCCESS);
    assert.equal(parsedResp.rrn, '202611020013');

    // MAC 위변조 검증
    const tampered = {
      ...parsedReq,
      mac: (parsedReq.mac[0] === 'A' ? 'B' : 'A') + parsedReq.mac.slice(1),
    };
    assert.equal(processCardAuth(tampered).response.respCode, ResponseCode.FORMAT_ERROR);

    // 0800 개시 전문 왕복
    const echoWire = buildAuthRequest({ mti: Mti.ECHO_REQ, stan: '000014', rrn: '202611020014' });
    const parsedEcho = parseAuthRequest(echoWire.raw);
    assert.ok(parsedEcho);
    const echoRes = processCardAuth(parsedEcho);
    assert.equal(echoRes.response.mti, Mti.ECHO_RESP);
    assert.equal(echoRes.response.respCode, ResponseCode.SUCCESS);
  });

  it('14. Vercel Serverless Fetch API (/api/auth, /api/state, /api/health) 통합 동작', async () => {
    const healthRes = await apiHandler.fetch(new Request('https://example.vercel.app/api/health'));
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { ok: boolean };
    assert.equal(healthJson.ok, true);

    const authRes = await apiHandler.fetch(
      new Request('https://example.vercel.app/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validReq({ stan: '000020', rrn: '202611020020' })),
      }),
    );
    assert.equal(authRes.status, 200);
    const authJson = (await authRes.json()) as {
      approved: boolean;
      maskedPan: string;
      wire: { requestBytes: number; responseBytes: number };
    };
    assert.equal(authJson.approved, true);
    assert.equal(authJson.maskedPan, '400000******0010');
    assert.equal(authJson.wire.requestBytes, 112);
    assert.equal(authJson.wire.responseBytes, 145);

    const stateRes = await apiHandler.fetch(new Request('https://example.vercel.app/api/state'));
    const stateJson = (await stateRes.json()) as { state: { journalCount: number } };
    assert.equal(stateJson.state.journalCount, 1);
  });
});

