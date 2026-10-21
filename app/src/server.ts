// HTTP server: the web pages and their API
//   GET  /                              the page (web/index.html), with the "All CVs" popup
//   GET  /<name>.js                     page scripts (web/<name>.ts, compiled on the fly)
//   GET  /api/engines                   engines launched with ./bots.sh
//   POST /api/generate                  {engine, jobOffer, tailoring} -> CV + cover letter, saved in data/cv.db
//   POST /api/compile                   {kind, content, id?} -> rebuild one PDF after editing (no AI call)
//   GET  /api/history                   all generations, newest first (no PDFs)
//   GET  /api/history.csv               the same, as a CSV file
//   GET  /api/generations/:id           one generation, with its PDFs and editable content
//   GET  /api/generations/:id/cv.pdf    download (also letter.pdf)
//   DELETE /api/generations/:id
//   POST /api/import                    {entries} -> old history from a browser's localStorage, into the database
import fs from 'node:fs';
import http from 'node:http';
import { transformSync } from 'esbuild';
import { DATA_DIR, ENGINES, PORT, WEB_DIR } from './config';
import { deleteGeneration, getGeneration, getPdf, historyCsv, listGenerations, saveGeneration, updateDocument } from './db';
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

/** web/<name>.ts -> JavaScript, recompiled only when the file changes (edit it, refresh the page) */
const scripts = new Map<string, { mtime: number; code: string }>();
function pageScript(name: string): string | null {
  const file = `${WEB_DIR}/${name}.ts`;
  if (!/^[a-z-]+$/.test(name) || !fs.existsSync(file)) return null;
  const mtime = fs.statSync(file).mtimeMs;
  const cached = scripts.get(name);
  if (cached?.mtime === mtime) return cached.code;
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', target: 'es2020' }).code;
  scripts.set(name, { mtime, code });
  return code;
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'offer';

http.createServer(async (req, res) => {
  const send = (status: number, body: unknown, type = 'application/json', headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': type, ...headers });
    res.end(type === 'application/json' ? JSON.stringify(body) : (body as string | Buffer));
  };
  const path = new URL(req.url || '/', 'http://app').pathname;
  const route = `${req.method} ${path}`;
  const generation = path.match(/^\/api\/generations\/(\d+)(?:\/(cv|letter)\.pdf)?$/);

  try {
    // ---- pages ----
    if (route === 'GET /' || route === 'GET /index.html')
      return send(200, fs.readFileSync(`${WEB_DIR}/index.html`, 'utf8'), 'text/html; charset=utf-8');
    const script = req.method === 'GET' && path.match(/^\/([a-z-]+)\.js$/);
    if (script) {
      const code = pageScript(script[1]);
      return code === null ? send(404, { ok: false, error: 'not found' }) : send(200, code, 'text/javascript; charset=utf-8');
    }

    // ---- one past generation ----
    if (generation) {
      const id = Number(generation[1]);
      if (req.method === 'GET' && generation[2]) {
        const kind = generation[2] === 'cv' ? 'resume' : 'letter';
        const pdf = getPdf(id, kind);
        if (!pdf) return send(404, { ok: false, error: 'not found' });
        const file = `${kind === 'resume' ? 'CV' : 'Lettre'}_${safeName(pdf.company)}.pdf`;
        return send(200, pdf.bytes, 'application/pdf', { 'content-disposition': `inline; filename="${file}"` });
      }
      if (req.method === 'GET') {
        const g = getGeneration(id);
        return g ? send(200, { ok: true, ...g }) : send(404, { ok: false, error: 'not found' });
      }
      if (req.method === 'DELETE') return send(200, { ok: deleteGeneration(id) });
    }

    switch (route) {
      case 'GET /health':
        return send(200, { ok: true });
      case 'GET /api/engines':
        return send(200, { engines: launchedEngines() });
      case 'GET /api/history':
        return send(200, { ok: true, items: listGenerations() });
      case 'GET /api/history.csv':
        return send(200, historyCsv(), 'text/csv; charset=utf-8',
          { 'content-disposition': `attachment; filename="cv-history-${new Date().toISOString().slice(0, 10)}.csv"` });

      case 'POST /api/generate': {
        const { engine, jobOffer, tailoring } = await readBody(req);
        if (!launchedEngines().includes(engine)) return send(200, { ok: false, error: `engine "${engine}" is not launched (./bots.sh ${engine})` });
        if (!String(jobOffer || '').trim()) return send(200, { ok: false, error: 'paste a job offer first' });
        console.log(`generate: ${engine}, ${tailoring}, ${String(jobOffer).length} chars`);
        const result = await generate(engine, jobOffer, tailoring);
        if (result.ok) result.id = saveGeneration({ ...result, tailoring, jobOffer }) ?? undefined;
        return send(200, result);
      }

      case 'POST /api/compile': {
        const { kind, content, id } = await readBody(req);
        const k = kind === 'letter' ? 'letter' : 'resume';
        const pdf = await compilePdf(k, content || {});
        if (id) updateDocument(Number(id), k, content, pdf);     // keep the edit in the database
        return send(200, { ok: true, pdf });
      }

      case 'POST /api/import': {
        // entries saved by older versions of the page in the browser (localStorage)
        const { entries } = await readBody(req);
        let imported = 0, skipped = 0;
        for (const e of Array.isArray(entries) ? entries : []) {
          if (!e?.resumePdf || !e?.letterPdf || !e?.engine) { skipped++; continue; }
          const id = saveGeneration({
            createdAt: new Date(Number(e.date) || Date.now()).toISOString(),
            engine: e.engine, company: e.company, jobTitle: e.jobTitle, headline: e.headline, atsReport: e.atsReport,
            resume: e.resume, letter: e.letter, resumePdf: e.resumePdf, letterPdf: e.letterPdf
          });
          if (id) imported++; else skipped++;                       // skipped: already in the database
        }
        console.log(`import: ${imported} imported, ${skipped} skipped`);
        return send(200, { ok: true, imported, skipped });
      }

      default:
        return send(404, { ok: false, error: `not found: ${route}` });
    }
  } catch (e) {
    console.error(`${route} failed:`, errorMessage(e));
    return send(200, { ok: false, error: errorMessage(e) });
  }
}).listen(PORT, () => console.log(`listening on :${PORT} (web page: http://localhost:${PORT})`));
