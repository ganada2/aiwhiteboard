/**
 * orchestrator.ts - 카드 승인/취소/개시 오케스트레이션 엔진 (AUTH-SVR)
 * (원본 C 프로젝트의 card_auth.c 대응 + 실시간 서비스 호출 트레이스 반환)
 */

import {
  HostStatus,
  Mti,
  ResponseCode,
  TxCode,
  WireLength,
} from './types.js';
import type {
  CardAuthReq,
  CardAuthResp,
  InnerAuthReq,
  ProcessAuthResult,
  ServiceTraceStatus,
  ServiceTraceStep,
} from './types.js';
import {
  formatTimestamp,
  hostLinkAuthorize,
  maskPan,
  svcHsmComputeRespMac,
  svcHsmVerifyPin,
  svcHsmVerifyReqMac,
  svcJournalIsDuplicate,
  svcJournalRecord,
  svcMerchantVerify,
  svcSafEnqueueReversal,
} from './services.js';

function isNumeric(str: string): boolean {
  return str.length > 0 && /^[0-9]+$/.test(str);
}

/** Luhn 체크섬 검증 */
export function luhnCheck(pan: string): boolean {
  if (!isNumeric(pan)) return false;
  let sum = 0;
  let alternate = false;

  for (let i = pan.length - 1; i >= 0; i--) {
    let n = pan.charCodeAt(i) - 48;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function validateCard(pan: string): boolean {
  if (!pan || pan.length < 13 || pan.length > 19) return false;
  return luhnCheck(pan);
}

/**
 * 반환: 1 = 정상, 0 = 만료(RC_EXPIRED_CARD), -1 = 포맷 오류(RC_FORMAT_ERROR)
 */
export function validateExpiry(expiry: string, now: Date = new Date()): 1 | 0 | -1 {
  if (!expiry || expiry.length !== WireLength.EXPIRY || !isNumeric(expiry)) {
    return -1;
  }
  const yy = Number.parseInt(expiry.slice(0, 2), 10);
  const mm = Number.parseInt(expiry.slice(2, 4), 10);
  if (mm < 1 || mm > 12) {
    return -1;
  }
  const expYyyyMm = (2000 + yy) * 100 + mm;
  const curYyyyMm = now.getFullYear() * 100 + (now.getMonth() + 1);
  return expYyyyMm < curYyyyMm ? 0 : 1;
}

function parseValidAmount(amountStr: string): number | null {
  if (!amountStr || amountStr.length > WireLength.AMOUNT || !isNumeric(amountStr)) {
    return null;
  }
  const val = Number.parseInt(amountStr, 10);
  if (!Number.isSafeInteger(val) || val <= 0) {
    return null;
  }
  return val;
}

export function processCardAuth(rawReq: Partial<CardAuthReq>): ProcessAuthResult {
  const req: CardAuthReq = {
    mti: (rawReq.mti ?? '').trim() || Mti.AUTH_REQ,
    pan: (rawReq.pan ?? '').trim(),
    expiry: (rawReq.expiry ?? '').trim(),
    amount: (rawReq.amount ?? '').trim(),
    stan: (rawReq.stan ?? '').trim(),
    rrn: (rawReq.rrn ?? '').trim(),
    terminalId: (rawReq.terminalId ?? '').trim(),
    merchantId: (rawReq.merchantId ?? '').trim(),
    pinBlock: (rawReq.pinBlock ?? '').trim(),
    mac: (rawReq.mac ?? '').trim(),
    reserved: rawReq.reserved ?? '',
  };

  const trace: ServiceTraceStep[] = [];
  const pushTrace = (
    service: string,
    action: string,
    status: ServiceTraceStatus,
    detail: string,
  ): void => {
    trace.push({
      order: trace.length + 1,
      service,
      action,
      status,
      detail,
    });
  };

  let respMti: string = Mti.AUTH_RESP;
  let isCancel = false;

  if (req.mti === Mti.AUTH_REQ) {
    respMti = Mti.AUTH_RESP;
  } else if (req.mti === Mti.CANCEL_REQ) {
    respMti = Mti.CANCEL_RESP;
    isCancel = true;
  } else if (req.mti === Mti.ECHO_REQ) {
    respMti = Mti.ECHO_RESP;
  } else {
    const errResp: CardAuthResp = {
      mti: Mti.AUTH_RESP,
      pan: req.pan,
      respCode: ResponseCode.FORMAT_ERROR,
      authCode: '',
      stan: req.stan,
      rrn: req.rrn,
      respMsg: '지원하지 않는 MTI',
      mac: '',
    };
    errResp.mac = svcHsmComputeRespMac(errResp);
    pushTrace('AUTH-SVR', 'MTI 라우팅', 'REJECT', `지원하지 않는 MTI (${req.mti})`);
    return { response: errResp, trace };
  }

  pushTrace(
    'AUTH-SVR',
    'MTI 수신 및 라우팅',
    'PASS',
    `요청 MTI=${req.mti} → 응답 MTI=${respMti}, PAN=${maskPan(req.pan)}`,
  );

  const finalize = (
    respCode: string,
    respMsg: string,
    options?: {
      authCode?: string;
      availableBalance?: number;
      hostTxId?: string;
      recordJournal?: boolean;
    },
  ): ProcessAuthResult => {
    const resp: CardAuthResp = {
      mti: respMti,
      pan: req.pan,
      respCode,
      authCode: options?.authCode ?? '',
      stan: req.stan,
      rrn: req.rrn,
      respMsg,
      mac: '',
      availableBalance: options?.availableBalance,
    };

    if (options?.recordJournal) {
      svcJournalRecord(req, resp, options.hostTxId);
      pushTrace(
        'JRNL-SVR',
        '거래 원장 기록',
        'PASS',
        `RC=${respCode}, AUTH=${resp.authCode || '-'}, RRN=${req.rrn || '-'}`,
      );
    }

    resp.mac = svcHsmComputeRespMac(resp);
    pushTrace('HSM-SVR', '응답 전문 MAC 생성', 'PASS', `MAC=${resp.mac}`);
    return { response: resp, trace, hostTxId: options?.hostTxId };
  };

  // 1. 요청 MAC 무결성 검증
  if (!svcHsmVerifyReqMac(req)) {
    pushTrace('HSM-SVR', '요청 전문 MAC 검증', 'REJECT', '전문 MAC 불일치 (위변조 의심)');
    return finalize(ResponseCode.FORMAT_ERROR, '전문 MAC 검증 실패');
  }
  pushTrace(
    'HSM-SVR',
    '요청 전문 MAC 검증',
    req.mac ? 'PASS' : 'SKIP',
    req.mac ? `MAC 일치 (${req.mac})` : 'JSON 직접 호출 (요청 MAC 생략)',
  );

  // [분기] 0800 개시/Echo 전문
  if (req.mti === Mti.ECHO_REQ) {
    pushTrace('AUTH-SVR', '네트워크 개시(Echo) 응답', 'PASS', '서버클래스 상태 정상');
    return finalize(ResponseCode.SUCCESS, '네트워크 개시/점검 정상');
  }

  // 2. 필수 필드 확인
  if (
    !req.pan ||
    !req.amount ||
    !req.merchantId ||
    !req.terminalId ||
    (isCancel && !req.rrn)
  ) {
    pushTrace('AUTH-SVR', '필수 필드 검증', 'REJECT', 'PAN/금액/가맹점/단말기(취소 시 RRN) 누락');
    return finalize(ResponseCode.FORMAT_ERROR, '필수 필드 누락');
  }

  // 3. 카드 번호(PAN) 길이 및 Luhn 체크섬 검증
  if (!validateCard(req.pan)) {
    pushTrace('AUTH-SVR', '카드번호(Luhn) 검증', 'REJECT', `유효하지 않은 카드번호 (${maskPan(req.pan)})`);
    return finalize(ResponseCode.INVALID_CARD, '잘못된 카드 번호');
  }
  pushTrace('AUTH-SVR', '카드번호(Luhn) 검증', 'PASS', `Luhn 체크섬 통과 (${maskPan(req.pan)})`);

  // 4. 유효기간 검증 (0100 승인 시)
  if (!isCancel) {
    const expCheck = validateExpiry(req.expiry);
    if (expCheck < 0) {
      pushTrace('AUTH-SVR', '유효기간(YYMM) 검증', 'REJECT', `형식 오류 (${req.expiry || 'EMPTY'})`);
      return finalize(ResponseCode.FORMAT_ERROR, '유효기간 형식 오류');
    }
    if (expCheck === 0) {
      pushTrace('AUTH-SVR', '유효기간(YYMM) 검증', 'REJECT', `만료된 카드 (YYMM=${req.expiry})`);
      return finalize(ResponseCode.EXPIRED_CARD, '유효기간 만료 카드', { recordJournal: true });
    }
    pushTrace('AUTH-SVR', '유효기간(YYMM) 검증', 'PASS', `유효기간 정상 (YYMM=${req.expiry})`);
  }

  // 5. 거래 금액 검증
  const parsedAmount = parseValidAmount(req.amount);
  if (parsedAmount === null) {
    pushTrace('AUTH-SVR', '거래금액 검증', 'REJECT', `유효하지 않은 금액 (${req.amount})`);
    return finalize(ResponseCode.INVALID_AMOUNT, '유효하지 않은 거래 금액');
  }
  pushTrace('AUTH-SVR', '거래금액 검증', 'PASS', `${parsedAmount.toLocaleString('ko-KR')}원`);

  // 6. 가맹점/단말기 상태 검증 (MCH-SVR)
  if (!svcMerchantVerify(req.merchantId, req.terminalId)) {
    pushTrace('MCH-SVR', '가맹점/단말기 조회', 'REJECT', `거래불가 가맹점 (${req.merchantId})`);
    return finalize(ResponseCode.INVALID_MERCHANT, '유효하지 않은 가맹점', { recordJournal: true });
  }
  pushTrace('MCH-SVR', '가맹점/단말기 조회', 'PASS', `정상 가맹점 (${req.merchantId} / ${req.terminalId})`);

  // 7. PIN 블록 검증 (HSM-SVR, 0100 승인 시)
  if (!isCancel) {
    const pinCheck = svcHsmVerifyPin(req.pan, req.pinBlock);
    if (pinCheck < 0) {
      pushTrace('HSM-SVR', 'PIN 블록 검증', 'REJECT', '16자리 Hex 포맷 오류');
      return finalize(ResponseCode.FORMAT_ERROR, 'PIN 블록 형식 오류');
    }
    if (pinCheck === 0) {
      pushTrace('HSM-SVR', 'PIN 블록 검증', 'REJECT', '비밀번호(PIN) 불일치');
      return finalize(ResponseCode.INVALID_PIN, '비밀번호(PIN) 오류', { recordJournal: true });
    }
    pushTrace('HSM-SVR', 'PIN 블록 검증', 'PASS', 'HSM PIN 복호화 및 검증 완료');
  }

  // 8. 중복 거래 체크 (JRNL-SVR, 0100 승인 시)
  if (!isCancel && svcJournalIsDuplicate(req.pan, req.stan, req.rrn)) {
    pushTrace(
      'JRNL-SVR',
      '중복 거래 조회',
      'REJECT',
      `동일 거래 기승인 존재 (STAN=${req.stan}, RRN=${req.rrn})`,
    );
    return finalize(ResponseCode.DUPLICATE_TX, '중복 승인 요청');
  }
  if (!isCancel) {
    pushTrace('JRNL-SVR', '중복 거래 조회', 'PASS', '신규 거래 확인');
  }

  // 9. 내부 승인 호스트 요청 생성 및 연동 (HOST-SVR)
  const reqTimestamp = formatTimestamp();
  const hostTxId = `H${reqTimestamp.slice(0, 8)}${req.stan || '000000'}`;
  const innerReq: InnerAuthReq = {
    txCode: isCancel ? TxCode.CANCEL : TxCode.AUTH,
    pan: req.pan,
    expiry: req.expiry,
    amount: parsedAmount,
    stan: req.stan,
    rrn: req.rrn,
    terminalId: req.terminalId,
    merchantId: req.merchantId,
    pinBlock: req.pinBlock,
    hostTxId,
    reqTimestamp,
  };

  const { status: hostStatus, resp: innerResp } = hostLinkAuthorize(innerReq);

  if (hostStatus === HostStatus.ERR_TIMEOUT) {
    pushTrace('HOST-SVR', '승인 호스트 연동', 'ALERT', `호스트 응답 타임아웃 (${hostTxId})`);
    if (!isCancel) {
      svcSafEnqueueReversal(innerReq);
      pushTrace(
        'SAF-SVR',
        '자동 망취소(0420) 큐 적재',
        'ALERT',
        `Store-And-Forward 망취소 등록 완료 (${hostTxId})`,
      );
    }
    return finalize(ResponseCode.HOST_TIMEOUT, '승인 호스트 응답 시간 초과', {
      hostTxId,
      recordJournal: true,
    });
  }

  if (hostStatus !== HostStatus.OK) {
    pushTrace('HOST-SVR', '승인 호스트 연동', 'REJECT', '호스트 통신 장애');
    return finalize(ResponseCode.SYSTEM_ERROR, '승인 호스트 통신 실패', {
      hostTxId,
      recordJournal: true,
    });
  }

  const approved = innerResp.respCode === ResponseCode.SUCCESS;
  pushTrace(
    'HOST-SVR',
    isCancel ? '원거래 취소 및 한도 복원' : '카드 원장 심사 및 한도 차감',
    approved ? 'PASS' : 'REJECT',
    `RC=${innerResp.respCode} (${innerResp.respMsg})` +
      (approved
        ? `, 승인번호=${innerResp.authCode}, 잔여한도=${innerResp.availableBalance.toLocaleString('ko-KR')}원`
        : ''),
  );

  return finalize(innerResp.respCode, innerResp.respMsg, {
    authCode: innerResp.authCode,
    availableBalance: innerResp.availableBalance,
    hostTxId,
    recordJournal: true,
  });
}

