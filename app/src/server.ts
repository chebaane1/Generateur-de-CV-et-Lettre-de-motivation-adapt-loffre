// HTTP server: the web page and its API
//   GET  /              web page (web/index.html)
//   GET  /app.js        page script (web/app.ts, compiled on the fly)
//   GET  /api/engines   engines launched with ./bots.sh
//   POST /api/generate  {engine, jobOffer, tailoring} -> CV + cover letter
//   POST /api/compile   {kind, content} -> rebuild one PDF after editing on the page (no AI call)
import fs from 'node:fs';
import http from 'node:http';
import { transformSync } from 'esbuild';
import { DATA_DIR, ENGINES, PORT, WEB_DIR } from './config';
import { errorMessage } from './http';
import { compilePdf, generate } from './pipeline';
import type { Engine } from './types';

/** Engines launched with ./bots.sh (it writes data/engines.json); all of them if the file is missing */
function launchedEngines(): Engine[] {
  try {
    const list: string[] = JSON.parse(fs.readFileSync(`${DATA_DIR}/engines.json`, 'utf8'));
    return ENGINES.filter(e => list.includes(e));
  } catch {
    return ENGINES;
  }
}

/** web/app.ts -> JavaScript, recompiled only when the file changes (edit it, refresh the page) */
let pageScript = { mtime: 0, code: '' };
function compiledPageScript(): string {
  const file = `${WEB_DIR}/app.ts`;
  const mtime = fs.statSync(file).mtimeMs;
  if (mtime !== pageScript.mtime) {
    pageScript = { mtime, code: transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', target: 'es2020' }).code };
  }
  return pageScript.code;
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const send = (status: number, body: unknown, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type });
    res.end(typeof body === 'string' && type !== 'application/json' ? body : JSON.stringify(body));
  };
  const route = `${req.method} ${new URL(req.url || '/', 'http://app').pathname}`;

  try {
    switch (route) {
      case 'GET /health':
        return send(200, { ok: true });
      case 'GET /':
      case 'GET /index.html':
        return send(200, fs.readFileSync(`${WEB_DIR}/index.html`, 'utf8'), 'text/html; charset=utf-8');
      case 'GET /app.js':
        return send(200, compiledPageScript(), 'text/javascript; charset=utf-8');
      case 'GET /api/engines':
        return send(200, { engines: launchedEngines() });

      case 'POST /api/generate': {
        const { engine, jobOffer, tailoring } = await readBody(req);
        if (!launchedEngines().includes(engine)) return send(200, { ok: false, error: `engine "${engine}" is not launched (./bots.sh ${engine})` });
        if (!String(jobOffer || '').trim()) return send(200, { ok: false, error: 'paste a job offer first' });
        console.log(`generate: ${engine}, ${tailoring}, ${String(jobOffer).length} chars`);
        return send(200, await generate(engine, jobOffer, tailoring));
      }

      case 'POST /api/compile': {
        const { kind, content } = await readBody(req);
        return send(200, { ok: true, pdf: await compilePdf(kind === 'letter' ? 'letter' : 'resume', content || {}) });
      }

      default:
        return send(404, { ok: false, error: `not found: ${route}` });
    }
  } catch (e) {
    console.error(`${route} failed:`, errorMessage(e));
    return send(200, { ok: false, error: errorMessage(e) });
  }
}).listen(PORT, () => console.log(`listening on :${PORT} (web page: http://localhost:${PORT})`));
