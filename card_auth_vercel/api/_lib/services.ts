/**
 * services.ts - 하위 PATHWAY 서버클래스 시뮬레이션 계층
 * (원본 C 프로젝트의 host_link.c 및 마스킹 유틸리티 대응)
 *
 *   - HSM-SVR  : FNV-1a 64-bit MAC 생성/검증, PIN 블록 복호화 검증
 *   - MCH-SVR  : 가맹점 및 단말기 거래 가능 상태 조회
 *   - JRNL-SVR : 거래 원장(Journal) 기록, 중복 거래 방지, 취소 원거래 조회
 *   - SAF-SVR  : 승인 호스트 타임아웃 시 자동 망취소(0420) Store-And-Forward 큐
 *   - HOST-SVR : 카드 한도 원장(500만원) 및 분실/도난/승인/취소 심사
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
  CardLedgerSnapshot,
  InnerAuthReq,
  InnerAuthResp,
  JournalSnapshot,
  SafReversalSnapshot,
} from './types.js';

export const DEFAULT_CARD_LIMIT = 5_000_000;
const MAX_JOURNAL_HISTORY = 200;
const MAX_SAF_HISTORY = 100;
const DEMO_MAC_SECRET = 'TANDEM_PATHWAY_HSM_KEY_2026';
const FNV_OFFSET_BASIS = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK_64 = 0xffffffffffffffffn;

interface InternalLedgerEntry {
  pan: string;
  usedAmount: number;
}

interface InternalJournalEntry {
  seq: number;
  mti: string;
  pan: string;
  stan: string;
  rrn: string;
  amount: number;
  respCode: string;
  authCode: string;
  hostTxId: string;
  isCancelled: boolean;
  recordedAt: string;
}

interface InternalSafEntry {
  seq: number;
  pan: string;
  stan: string;
  rrn: string;
  amount: number;
  hostTxId: string;
  reqTimestamp: string;
}

const cardLedger = new Map<string, InternalLedgerEntry>();
const journal: InternalJournalEntry[] = [];
const safQueue: InternalSafEntry[] = [];
let journalSeq = 0;
let safSeq = 0;
let authSeq = 1;

export function formatTimestamp(date: Date = new Date()): string {
  const yyyy = String(date.getFullYear()).padStart(4, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

/** PCI-DSS 준수 카드번호 마스킹 (앞 6자리 + '*' + 뒤 4자리) */
export function maskPan(pan: string): string {
  if (!pan) return '(EMPTY)';
  if (pan.length < 10) return '****';
  const head = pan.slice(0, 6);
  const tail = pan.slice(-4);
  return `${head}${'*'.repeat(pan.length - 10)}${tail}`;
}

export function resetCardAuthState(): void {
  cardLedger.clear();
  journal.length = 0;
  safQueue.length = 0;
  journalSeq = 0;
  safSeq = 0;
  authSeq = 1;
}

/* ================================================================
 * 1. HSM-SVR (전문 MAC 생성/검증 & PIN 검증)
 * ================================================================ */

function fnv1aUpdate(hash: bigint, str: string): bigint {
  let h = hash;
  const bytes = Buffer.from(str ?? '', 'utf8');
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * FNV_PRIME) & MASK_64;
  }
  h ^= 0xffn;
  h = (h * FNV_PRIME) & MASK_64;
  return h;
}

function toHex16(hash: bigint): string {
  const hi = Number((hash >> 32n) & 0xffffffffn)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');
  const lo = Number(hash & 0xffffffffn)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');
  return `${hi}${lo}`;
}

export function svcHsmComputeReqMac(req: Partial<CardAuthReq>): string {
  let h = FNV_OFFSET_BASIS;
  const mti = req.mti && req.mti.length > 0 ? req.mti : Mti.AUTH_REQ;
  h = fnv1aUpdate(h, DEMO_MAC_SECRET);
  h = fnv1aUpdate(h, mti);
  h = fnv1aUpdate(h, req.pan ?? '');
  h = fnv1aUpdate(h, req.amount ?? '');
  h = fnv1aUpdate(h, req.stan ?? '');
  h = fnv1aUpdate(h, req.rrn ?? '');
  return toHex16(h);
}

export function svcHsmComputeRespMac(resp: Partial<CardAuthResp>): string {
  let h = FNV_OFFSET_BASIS;
  const mti = resp.mti && resp.mti.length > 0 ? resp.mti : Mti.AUTH_RESP;
  h = fnv1aUpdate(h, DEMO_MAC_SECRET);
  h = fnv1aUpdate(h, mti);
  h = fnv1aUpdate(h, resp.pan ?? '');
  h = fnv1aUpdate(h, resp.respCode ?? '');
  h = fnv1aUpdate(h, resp.authCode ?? '');
  h = fnv1aUpdate(h, resp.stan ?? '');
  h = fnv1aUpdate(h, resp.rrn ?? '');
  return toHex16(h);
}

export function svcHsmVerifyReqMac(req: CardAuthReq): boolean {
  if (!req.mac) {
    // JSON/내부 직접 호출 시 MAC 생략 허용 (전달된 경우 엄격 검증)
    return true;
  }
  if (req.mac.length !== WireLength.MAC) {
    return false;
  }
  return req.mac.toUpperCase() === svcHsmComputeReqMac(req);
}

/**
 * 반환: 1 = 정상, 0 = PIN 불일치, -1 = PIN 블록 포맷 오류
 */
export function svcHsmVerifyPin(_pan: string, pinBlock: string): 1 | 0 | -1 {
  if (!pinBlock || pinBlock.length !== WireLength.PIN_BLOCK) {
    return -1;
  }
  if (!/^[0-9A-Fa-f]{16}$/.test(pinBlock)) {
    return -1;
  }
  if (pinBlock.toUpperCase() === 'FFFFFFFFFFFFFFFF') {
    return 0;
  }
  return 1;
}

/* ================================================================
 * 2. MCH-SVR (가맹점 및 단말기 검증)
 * ================================================================ */

export function svcMerchantVerify(merchantId: string, terminalId: string): boolean {
  if (!merchantId || !terminalId) {
    return false;
  }
  if (merchantId.startsWith('MCH_STOP') || merchantId.startsWith('INVALID')) {
    return false;
  }
  return true;
}

/* ================================================================
 * 3. JRNL-SVR & SAF-SVR (거래 원장 및 자동 망취소 큐)
 * ================================================================ */

export function svcJournalIsDuplicate(pan: string, stan: string, rrn: string): boolean {
  if (!pan || !stan || !rrn) return false;
  return journal.some(
    (j) =>
      j.mti === Mti.AUTH_REQ &&
      j.respCode === ResponseCode.SUCCESS &&
      !j.isCancelled &&
      j.pan === pan &&
      j.stan === stan &&
      j.rrn === rrn,
  );
}

export function svcJournalRecord(
  req: CardAuthReq,
  resp: CardAuthResp,
  hostTxId?: string,
): void {
  const parsedAmt = Number.parseInt(req.amount || '0', 10);
  journalSeq += 1;
  journal.push({
    seq: journalSeq,
    mti: req.mti || Mti.AUTH_REQ,
    pan: req.pan,
    stan: req.stan,
    rrn: req.rrn,
    amount: Number.isNaN(parsedAmt) ? 0 : parsedAmt,
    respCode: resp.respCode,
    authCode: resp.authCode,
    hostTxId: hostTxId ?? '',
    isCancelled: false,
    recordedAt: formatTimestamp(),
  });
  if (journal.length > MAX_JOURNAL_HISTORY) {
    journal.shift();
  }
}

export function svcJournalCount(): number {
  return journalSeq;
}

export function svcSafEnqueueReversal(req: InnerAuthReq): void {
  safSeq += 1;
  safQueue.push({
    seq: safSeq,
    pan: req.pan,
    stan: req.stan,
    rrn: req.rrn,
    amount: req.amount,
    hostTxId: req.hostTxId,
    reqTimestamp: req.reqTimestamp,
  });
  if (safQueue.length > MAX_SAF_HISTORY) {
    safQueue.shift();
  }
}

export function svcSafPendingCount(): number {
  return safSeq;
}

export function getSystemStateSnapshot(): {
  defaultCardLimit: number;
  journalCount: number;
  safPendingCount: number;
  ledger: CardLedgerSnapshot[];
  journal: JournalSnapshot[];
  safQueue: SafReversalSnapshot[];
} {
  const ledgerList: CardLedgerSnapshot[] = Array.from(cardLedger.values()).map((c) => ({
    maskedPan: maskPan(c.pan),
    limitAmount: DEFAULT_CARD_LIMIT,
    usedAmount: c.usedAmount,
    availableBalance: DEFAULT_CARD_LIMIT - c.usedAmount,
  }));

  const journalList: JournalSnapshot[] = journal
    .slice()
    .reverse()
    .map((j) => ({
      seq: j.seq,
      mti: j.mti,
      maskedPan: maskPan(j.pan),
      stan: j.stan,
      rrn: j.rrn,
      amount: j.amount,
      respCode: j.respCode,
      authCode: j.authCode,
      hostTxId: j.hostTxId,
      isCancelled: j.isCancelled,
      recordedAt: j.recordedAt,
    }));

  const safList: SafReversalSnapshot[] = safQueue
    .slice()
    .reverse()
    .map((s) => ({
      seq: s.seq,
      maskedPan: maskPan(s.pan),
      stan: s.stan,
      rrn: s.rrn,
      amount: s.amount,
      hostTxId: s.hostTxId,
      reqTimestamp: s.reqTimestamp,
    }));

  return {
    defaultCardLimit: DEFAULT_CARD_LIMIT,
    journalCount: journalSeq,
    safPendingCount: safSeq,
    ledger: ledgerList,
    journal: journalList.slice(0, 30),
    safQueue: safList.slice(0, 20),
  };
}

/* ================================================================
 * 4. HOST-SVR (승인/취소 원장 연동)
 * ================================================================ */

function getOrCreateCardAccount(pan: string): InternalLedgerEntry {
  let acct = cardLedger.get(pan);
  if (!acct) {
    acct = { pan, usedAmount: 0 };
    cardLedger.set(pan, acct);
  }
  return acct;
}

function findOriginalApprovedTx(
  pan: string,
  rrn: string,
  amount: number,
): InternalJournalEntry | undefined {
  for (let i = journal.length - 1; i >= 0; i--) {
    const entry = journal[i];
    if (
      entry.mti === Mti.AUTH_REQ &&
      entry.respCode === ResponseCode.SUCCESS &&
      !entry.isCancelled &&
      entry.pan === pan &&
      entry.rrn === rrn &&
      entry.amount === amount
    ) {
      return entry;
    }
  }
  return undefined;
}

export function hostLinkAuthorize(req: InnerAuthReq): {
  status: number;
  resp: InnerAuthResp;
} {
  const baseResp: InnerAuthResp = {
    respCode: '',
    authCode: '',
    respMsg: '',
    hostTxId: req.hostTxId,
    availableBalance: 0,
    hostRespTimestamp: formatTimestamp(),
  };

  // 1) 호스트 응답 타임아웃 시뮬레이션 카드
  if (req.pan === '4000000000000093') {
    return { status: HostStatus.ERR_TIMEOUT, resp: baseResp };
  }

  // 2) 분실 신고 카드
  if (req.pan === '4000000000000002') {
    baseResp.respCode = ResponseCode.LOST_CARD;
    baseResp.respMsg = '분실 신고 카드';
    return { status: HostStatus.OK, resp: baseResp };
  }

  // 3) 도난 신고 카드
  if (req.pan === '4000000000000028') {
    baseResp.respCode = ResponseCode.STOLEN_CARD;
    baseResp.respMsg = '도난 신고 카드';
    return { status: HostStatus.OK, resp: baseResp };
  }

  const acct = getOrCreateCardAccount(req.pan);

  // [취소 요청 처리]
  if (req.txCode === TxCode.CANCEL) {
    const orig = findOriginalApprovedTx(req.pan, req.rrn, req.amount);
    if (!orig) {
      baseResp.respCode = ResponseCode.ORIG_NOT_FOUND;
      baseResp.respMsg = '원거래 없음 또는 기취소';
      baseResp.availableBalance = DEFAULT_CARD_LIMIT - acct.usedAmount;
      return { status: HostStatus.OK, resp: baseResp };
    }

    orig.isCancelled = true;
    acct.usedAmount = Math.max(0, acct.usedAmount - req.amount);
    const seqStr = String(authSeq++ % 100000).padStart(5, '0');
    baseResp.respCode = ResponseCode.SUCCESS;
    baseResp.authCode = `C${seqStr}`;
    baseResp.respMsg = '승인 취소 완료';
    baseResp.availableBalance = DEFAULT_CARD_LIMIT - acct.usedAmount;
    return { status: HostStatus.OK, resp: baseResp };
  }

  // [승인 요청 처리] 누적 한도 초과 검사
  if (acct.usedAmount + req.amount > DEFAULT_CARD_LIMIT) {
    baseResp.respCode = ResponseCode.INSUFF_FUNDS;
    baseResp.respMsg = '한도 초과';
    baseResp.availableBalance = DEFAULT_CARD_LIMIT - acct.usedAmount;
    return { status: HostStatus.OK, resp: baseResp };
  }

  acct.usedAmount += req.amount;
  const seqStr = String(authSeq++ % 100000).padStart(5, '0');
  baseResp.respCode = ResponseCode.SUCCESS;
  baseResp.authCode = `A${seqStr}`;
  baseResp.respMsg = '승인 완료';
  baseResp.availableBalance = DEFAULT_CARD_LIMIT - acct.usedAmount;
  return { status: HostStatus.OK, resp: baseResp };
}

