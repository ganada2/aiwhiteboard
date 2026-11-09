/**
 * types.ts - HPE Tandem PATHWAY 카드 승인 전문 규격 및 타입 정의
 * (원본 C 프로젝트의 card_auth.h 대응)
 */

export const ResponseCode = {
  SUCCESS: '00',          // 승인/처리 완료
  INVALID_MERCHANT: '03', // 유효하지 않은(거래정지) 가맹점
  INVALID_AMOUNT: '13',   // 유효하지 않은 거래 금액
  INVALID_CARD: '14',     // 잘못된 카드 번호 (길이/Luhn 오류)
  ORIG_NOT_FOUND: '25',   // 원거래 없음 또는 기취소
  LOST_CARD: '41',        // 분실 신고 카드
  STOLEN_CARD: '43',      // 도난 신고 카드
  INSUFF_FUNDS: '51',     // 한도 초과
  EXPIRED_CARD: '54',     // 유효기간 만료 카드
  INVALID_PIN: '55',      // 비밀번호(PIN) 오류
  HOST_TIMEOUT: '91',     // 승인 호스트 응답 시간 초과 (SAF 망취소 대상)
  DUPLICATE_TX: '94',     // 중복 거래 요청
  FORMAT_ERROR: '96',     // 전문 형식 오류 / 필수 필드 누락 / MAC 불일치
  SYSTEM_ERROR: '98',     // 시스템 오류
} as const;

export type ResponseCodeValue = (typeof ResponseCode)[keyof typeof ResponseCode];

export const Mti = {
  AUTH_REQ: '0100',
  AUTH_RESP: '0110',
  CANCEL_REQ: '0400',
  CANCEL_RESP: '0410',
  ECHO_REQ: '0800',
  ECHO_RESP: '0810',
} as const;

export const TxCode = {
  AUTH: 'CARD_AUTH',
  CANCEL: 'CARD_CNCL',
} as const;

export const HostStatus = {
  OK: 0,
  ERR_SYS: -1,
  ERR_TIMEOUT: -2,
} as const;

export const WireLength = {
  MTI: 4,
  BITMAP: 16,
  PAN: 19,
  EXPIRY: 4,
  AMOUNT: 12,
  STAN: 6,
  RRN: 12,
  TERMINAL_ID: 8,
  MERCHANT_ID: 15,
  PIN_BLOCK: 16,
  MAC: 16,
  RESP_CODE: 2,
  AUTH_CODE: 6,
  RESP_MSG: 64,
  RESERVED_MAX: 50,
  RAW_REQ_MIN: 112,
  RAW_RESP: 145,
} as const;

export interface CardAuthReq {
  mti: string;
  pan: string;
  expiry: string;
  amount: string;
  stan: string;
  rrn: string;
  terminalId: string;
  merchantId: string;
  pinBlock: string;
  mac: string;
  reserved?: string;
}

export interface InnerAuthReq {
  txCode: string;
  pan: string;
  expiry: string;
  amount: number;
  stan: string;
  rrn: string;
  terminalId: string;
  merchantId: string;
  pinBlock: string;
  hostTxId: string;
  reqTimestamp: string;
}

export interface InnerAuthResp {
  respCode: string;
  authCode: string;
  respMsg: string;
  hostTxId: string;
  availableBalance: number;
  hostRespTimestamp: string;
}

export interface CardAuthResp {
  mti: string;
  pan: string;
  respCode: string;
  authCode: string;
  stan: string;
  rrn: string;
  respMsg: string;
  mac: string;
  availableBalance?: number;
  reserved?: string;
}

export type ServiceTraceStatus = 'PASS' | 'REJECT' | 'ALERT' | 'SKIP';

export interface ServiceTraceStep {
  order: number;
  service: string;
  action: string;
  status: ServiceTraceStatus;
  detail: string;
}

export interface ProcessAuthResult {
  response: CardAuthResp;
  trace: ServiceTraceStep[];
  hostTxId?: string;
}

export interface CardLedgerSnapshot {
  maskedPan: string;
  limitAmount: number;
  usedAmount: number;
  availableBalance: number;
}

export interface JournalSnapshot {
  seq: number;
  mti: string;
  maskedPan: string;
  stan: string;
  rrn: string;
  amount: number;
  respCode: string;
  authCode: string;
  hostTxId: string;
  isCancelled: boolean;
  recordedAt: string;
}

export interface SafReversalSnapshot {
  seq: number;
  maskedPan: string;
  stan: string;
  rrn: string;
  amount: number;
  hostTxId: string;
  reqTimestamp: string;
}

