import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { LearnAction, LearnMode, SolveResponse } from '../shared/schema';
import { executeSolvePipeline, executeVideoPipeline } from './aiService';
import { getPrivacyPolicySummary } from './privacy';

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function aiWhiteboardApiPlugin(): Plugin {
  const handleApiRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = req.url?.split('?')[0];
    if (!url || !url.startsWith('/api/')) {
      next();
      return;
    }

    try {
      if (url === '/api/privacy-policy' && req.method === 'GET') {
        sendJson(res, 200, getPrivacyPolicySummary());
        return;
      }

      if (url === '/api/solve' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const mode = (body.mode as LearnMode) || 'high';
        const action = (body.action as LearnAction) || 'solve';
        const question = String(body.question ?? '');

        const result = await executeSolvePipeline({ mode, action, question });
        sendJson(res, 200, result);
        return;
      }

      if (url === '/api/video' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const mode = (body.mode as LearnMode) || 'high';
        const solveResult = body.solve_result as SolveResponse;

        if (!solveResult || typeof solveResult !== 'object') {
          sendJson(res, 400, { error: '유효한 solve_result가 필요합니다.' });
          return;
        }

        const result = await executeVideoPipeline({ mode, solveResult });
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: '존재하지 않는 API 경로입니다.' });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : '서버 내부 오류가 발생했습니다.',
      });
    }
  };

  return {
    name: 'ai-whiteboard-api-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleApiRequest(req, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleApiRequest(req, res, next);
      });
    },
  };
}
