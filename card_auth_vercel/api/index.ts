/**
 * api/index.ts - Vercel Serverless Function 통합 엔드포인트 (Web Standard Fetch API)
 * (원본 C 프로젝트의 pathway_main.c 역할 수행: HTTP Gateway ↔ AUTH-SVR 오케스트레이터)
 */

import { Mti, ResponseCode } from './_lib/types.js';
import type { CardAuthReq, CardAuthResp } from './_lib/types.js';
import {
  buildAuthRequest,
  buildAuthResponse,
  parseAuthRequest,
  parseAuthResponse,
} from './_lib/wire.js';
import { processCardAuth } from './_lib/orchestrator.js';
import {
  formatTimestamp,
  getSystemStateSnapshot,
  maskPan,
  resetCardAuthState,
  svcHsmComputeRespMac,
} from './_lib/services.js';

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

export async function handleApiRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return jsonResponse({ ok: true }, 200);
  }

  const url = new URL(request.url);
  const routeParam = url.searchParams.get('route');
  const pathname = routeParam ? `/api/${routeParam}` : url.pathname.replace(/\/+$/, '');

  try {
    // 1. GET /api/health - 0800 Echo 헬스체크 수행
    if (pathname === '/api/health' && request.method === 'GET') {
      const echoResult = processCardAuth({
        mti: Mti.ECHO_REQ,
        stan: '000001',
        rrn: `${formatTimestamp().slice(0, 8)}0001`,
      });
      return jsonResponse({
        ok: echoResult.response.respCode === ResponseCode.SUCCESS,
        service: 'AUTH-SVR (Vercel Serverless TypeScript)',
        timestamp: formatTimestamp(),
        echo: echoResult.response,
        stateSummary: {
          journalCount: getSystemStateSnapshot().journalCount,
          safPendingCount: getSystemStateSnapshot().safPendingCount,
        },
      });
    }

    // 2. GET / DELETE / POST /api/state - 원장·저널·SAF 상태 조회 및 초기화
    if (pathname === '/api/state') {
      if (request.method === 'GET') {
        return jsonResponse({
          ok: true,
          state: getSystemStateSnapshot(),
        });
      }

      if (request.method === 'DELETE' || request.method === 'POST') {
        resetCardAuthState();
        return jsonResponse({
          ok: true,
          message: '카드 한도 원장, 거래 저널, SAF 망취소 큐가 초기화되었습니다.',
          state: getSystemStateSnapshot(),
        });
      }
    }

    // 3. POST /api/wire - 대외 고정길이 전문 생성/파싱 도구
    if (pathname === '/api/wire' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const mode = String(body.mode ?? 'build_req');

      if (mode === 'build_req') {
        const reqInput = (body.request ?? {}) as Partial<CardAuthReq>;
        const built = buildAuthRequest(reqInput);
        return jsonResponse({ ok: true, ...built });
      }
      if (mode === 'parse_req') {
        const parsed = parseAuthRequest(String(body.raw ?? ''));
        if (!parsed) {
          return jsonResponse({ ok: false, error: '요청 전문 파싱 실패 (최소 112B 및 유효 MTI 필요)' }, 400);
        }
        return jsonResponse({ ok: true, parsed });
      }
      if (mode === 'parse_resp') {
        const parsed = parseAuthResponse(String(body.raw ?? ''));
        if (!parsed) {
          return jsonResponse({ ok: false, error: '응답 전문 파싱 실패 (최소 145B 필요)' }, 400);
        }
        return jsonResponse({ ok: true, parsed });
      }

      return jsonResponse({ ok: false, error: `알 수 없는 mode: ${mode}` }, 400);
    }

    // 4. POST /api/auth - 메인 카드 승인 / 취소 / 개시 처리
    if ((pathname === '/api/auth' || pathname === '/api' || pathname === '/api/index') && request.method === 'POST') {
      const body = await readJsonBody(request);

      let requestRaw = '';
      let requestBytes = 0;
      let parsedReq: CardAuthReq | null = null;

      if (typeof body.rawWire === 'string' && body.rawWire.length > 0) {
        // [모드 A] Raw 고정길이 전문 직접 수신 ($RECEIVE 동일 경로)
        requestRaw = body.rawWire;
        requestBytes = Buffer.byteLength(requestRaw, 'utf8');
        parsedReq = parseAuthRequest(requestRaw);

        if (!parsedReq) {
          const errResp: CardAuthResp = {
            mti: Mti.AUTH_RESP,
            pan: '',
            respCode: ResponseCode.FORMAT_ERROR,
            authCode: '',
            stan: '',
            rrn: '',
            respMsg: '전문 형식 오류 (길이 부족 또는 잘못된 MTI)',
            mac: '',
          };
          errResp.mac = svcHsmComputeRespMac(errResp);
          const wireResp = buildAuthResponse(errResp);

          return jsonResponse({
            approved: false,
            response: errResp,
            wire: {
              requestRaw,
              requestBytes,
              responseRaw: wireResp.raw,
              responseBytes: wireResp.byteLength,
              bitmapHex: wireResp.bitmapHex,
            },
            trace: [
              {
                order: 1,
                service: 'AUTH-SVR',
                action: 'parseAuthRequest()',
                status: 'REJECT',
                detail: `수신 전문 파싱 실패 (${requestBytes}B < 112B 또는 MTI 오류)`,
              },
            ],
            state: getSystemStateSnapshot(),
          });
        }
      } else {
        // [모드 B] JSON 입력 → 112B 대외 전문 생성 → 파싱 → 오케스트레이션 수행
        const inputReq: Partial<CardAuthReq> = {
          mti: String(body.mti ?? Mti.AUTH_REQ),
          pan: String(body.pan ?? ''),
          expiry: String(body.expiry ?? ''),
          amount: String(body.amount ?? ''),
          stan: String(body.stan ?? ''),
          rrn: String(body.rrn ?? ''),
          terminalId: String(body.terminalId ?? ''),
          merchantId: String(body.merchantId ?? ''),
          pinBlock: String(body.pinBlock ?? ''),
          mac: typeof body.mac === 'string' ? body.mac : '',
          reserved: typeof body.reserved === 'string' ? body.reserved : '',
        };

        // 지원되는 MTI이며 필수 길이를 넘지 않는 경우 Wire 직렬화 왕복 수행
        const builtReq = buildAuthRequest(inputReq);
        requestRaw = builtReq.raw;
        requestBytes = builtReq.byteLength;

        const reparsed = parseAuthRequest(requestRaw);
        parsedReq = reparsed ?? (inputReq as CardAuthReq);
      }

      const result = processCardAuth(parsedReq);
      const wireResp = buildAuthResponse(result.response);

      return jsonResponse({
        approved: result.response.respCode === ResponseCode.SUCCESS,
        maskedPan: maskPan(parsedReq.pan),
        request: parsedReq,
        response: result.response,
        wire: {
          requestRaw,
          requestBytes,
          responseRaw: wireResp.raw,
          responseBytes: wireResp.byteLength,
          bitmapHex: wireResp.bitmapHex,
        },
        trace: result.trace,
        state: getSystemStateSnapshot(),
      });
    }

    return jsonResponse(
      {
        ok: false,
        error: `지원하지 않는 경로 또는 메서드입니다: ${request.method} ${pathname}`,
        endpoints: [
          'POST   /api/auth',
          'GET    /api/state',
          'DELETE /api/state',
          'POST   /api/wire',
          'GET    /api/health',
        ],
      },
      404,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 서버 오류';
    return jsonResponse(
      {
        ok: false,
        respCode: ResponseCode.SYSTEM_ERROR,
        error: message,
      },
      500,
    );
  }
}

export default {
  fetch: handleApiRequest,
};

