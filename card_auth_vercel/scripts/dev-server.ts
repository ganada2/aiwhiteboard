/**
 * scripts/dev-server.ts - Vercel CLI 없이도 로컬에서 즉시 구동 가능한 개발 서버
 * 실행: node scripts/dev-server.ts
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiHandler from '../api/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT ?? 3000);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `localhost:${PORT}`;
    const urlObj = new URL(req.url ?? '/', `http://${host}`);

    // /api/* 요청은 Vercel Serverless Web Standard fetch 핸들러로 직접 전달
    if (urlObj.pathname.startsWith('/api')) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyBuf = Buffer.concat(chunks);

      const webReq = new Request(urlObj.toString(), {
        method: req.method ?? 'GET',
        headers: req.headers as Record<string, string>,
        body:
          req.method !== 'GET' && req.method !== 'HEAD' && bodyBuf.length > 0
            ? bodyBuf
            : undefined,
      });

      const webRes = await apiHandler.fetch(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const outBuf = Buffer.from(await webRes.arrayBuffer());
      res.end(outBuf);
      return;
    }

    // 정적 파일 서빙 (public/)
    const relPath = urlObj.pathname === '/' ? '/index.html' : urlObj.pathname;
    const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(PUBLIC_DIR, safePath);

    const data = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`[card_auth_vercel] 로컬 서버 실행 중: http://localhost:${PORT}`);
});

