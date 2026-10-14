// Tiny bridge: accepts a Messages-API-style request from n8n, runs Claude Code
// headless (logged in with your Pro plan) and returns a Messages-API-style reply.
// Also serves the web page (GET /), runs the n8n workflow chosen on it (POST /api/generate)
// and calls Gemini with GEMINI_API_KEY from .env (POST /gemini/v1/messages).
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8080;
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const TIMEOUT_MS = 5 * 60 * 1000;
const PROMPTS_FILE = process.env.PROMPTS_FILE || '/prompts/prompts.js'; // ./prompts mounted by docker-compose
const WEB_DIR = process.env.WEB_DIR || '/web';                           // ./web mounted by docker-compose
const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';
const GENERATE_TIMEOUT_MS = 40 * 60 * 1000;                              // the local model is slow on CPU
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_FALLBACK = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite';
const ENGINES = ['claude', 'gemini', 'local'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Run one request at a time so parallel executions don't burn through limits at once
let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));

// Job locks (one per bot, ?key=claude / gemini / local): n8n takes one before reading Telegram and
// releases it after both PDFs are sent, so each bot handles one offer at a time.
// A lock expires on its own if a run crashes midway.
const LOCK_TTL_MS = Number(process.env.LOCK_TTL_MS) || 30 * 60 * 1000;
const locks = new Map(); // key -> expiry timestamp

// Return clean, valid JSON text or throw
function cleanJson(text) {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('no JSON object found');
  return JSON.stringify(JSON.parse(t.slice(s, e + 1)));
}

// Ask the model (runClaude or runGemini), validate JSON, and ask it to repair its own output if invalid (up to 2 times)
async function generateJson({ system, prompt, model }, run = runClaude) {
  let text = await run({ system, prompt, model });
  for (let attempt = 0; ; attempt++) {
    try { return cleanJson(text); }
    catch (e) {
      if (attempt >= 2) throw new Error('model returned invalid JSON after 2 repairs: ' + e.message);
      console.log(`invalid JSON (${e.message}), asking for repair #${attempt + 1}`);
      text = await run({
        system,
        model,
        prompt:
          `The following was supposed to be ONE valid JSON object but failed to parse (${e.message}).\n` +
          `Fix it: keep all content, correct the syntax (quotes, commas, braces), remove anything outside the object.\n` +
          `Return ONLY the corrected JSON object.\n\n${text}`
      });
    }
  }
}

function runClaude({ system, prompt, model }) {
  return new Promise((resolve, reject) => {
    // --tools "": text only. With tools on, the model sometimes tries one and hits --max-turns 1 (an error with no text)
    const args = ['-p', '--output-format', 'json', '--max-turns', '1', '--tools', '', '--no-session-persistence',
      '--model', model || DEFAULT_MODEL];
    if (system) args.push('--system-prompt', system);

    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // make sure the subscription is used, not API billing

    const proc = spawn('claude', args, { env });
    let out = '', err = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Claude Code timed out')); }, TIMEOUT_MS);

    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', d => (err += d));
    proc.on('close', code => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(out);
        if (res.is_error) return reject(new Error(`Claude Code returned an error (${res.subtype || 'unknown'}): ${res.result || ''}`.trim()));
        resolve(res.result);
      } catch {
        reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
    proc.stdin.end(prompt);
  });
}

// Gemini: 3 tries on the main model, then 2 on the fallback (free keys often get "high demand" 503s)
async function runGemini({ system, prompt, model }) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY is not set in .env');
  const body = JSON.stringify({
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' }
  });
  let lastError;
  for (const [m, tries] of [[model || GEMINI_MODEL, 3], [GEMINI_FALLBACK, 2]]) {
    for (let i = 0; i < tries; i++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      }).catch(e => ({ ok: false, status: 0, text: async () => e.message }));
      if (res.ok) {
        const cand = (await res.json()).candidates?.[0];
        if (cand?.finishReason === 'MAX_TOKENS') throw new Error('Gemini hit its max output tokens');
        const text = (cand?.content?.parts || []).map(p => p.text || '').join('');
        if (text) return text;
        lastError = new Error(`Gemini ${m} returned no text (${cand?.finishReason || 'unknown'})`);
      } else {
        lastError = new Error(`Gemini ${m} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        if (![0, 429, 500, 503].includes(res.status)) throw lastError;   // not worth retrying
      }
      console.log(lastError.message, '- retrying');
      await sleep(5000);
    }
  }
  throw lastError;
}

// POST the offer to the n8n workflow of the chosen engine and wait for the PDFs.
// Plain http (not fetch): generation can take longer than fetch's 5-minute header timeout.
function runWorkflow(engine, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(`${N8N_URL}/webhook/cv-${engine}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout: GENERATE_TIMEOUT_MS
    }, res => {
      let out = '';
      res.on('data', c => (out += c));
      res.on('end', () => {
        if (res.statusCode === 404) return reject(new Error(`the ${engine} workflow is not active in n8n (launch it with ./bots.sh ${engine})`));
        try { resolve(JSON.parse(out)); }
        catch { reject(new Error(`n8n answered ${res.statusCode}: ${out.slice(0, 300)}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('generation timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

// Engines launched with ./bots.sh (it writes web/engines.json)
function launchedEngines() {
  try { return JSON.parse(fs.readFileSync(`${WEB_DIR}/engines.json`, 'utf8')).filter(e => ENGINES.includes(e)); }
  catch { return ENGINES; }
}

http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url, 'http://bridge');
  const key = url.searchParams.get('key') || 'default';
  if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/engines') return send(200, { engines: launchedEngines() });
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    // re-read on every request: edit web/index.html, refresh the page
    return fs.readFile(`${WEB_DIR}/index.html`, (err, html) => {
      if (err) return send(500, { error: 'web/index.html not found' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  }
  if (req.method === 'POST' && url.pathname === '/lock') {
    if (Date.now() < (locks.get(key) || 0)) return send(200, { acquired: false });
    locks.set(key, Date.now() + LOCK_TTL_MS);
    return send(200, { acquired: true });
  }
  if (req.method === 'POST' && url.pathname === '/unlock') {
    locks.delete(key);
    return send(200, { released: true });
  }
  const routes = ['/v1/messages', '/gemini/v1/messages', '/prompts', '/api/generate'];
  if (req.method !== 'POST' || !routes.includes(url.pathname)) return send(404, { error: 'not found' });

  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    let data;
    try { data = JSON.parse(body); } catch { return send(400, { error: 'invalid JSON' }); }

    // From the web page: run the chosen engine's n8n workflow, answer {ok, resumePdf, letterPdf, atsReport, …}
    if (url.pathname === '/api/generate') {
      const engine = data.engine;
      if (!launchedEngines().includes(engine)) return send(200, { ok: false, error: `engine "${engine}" is not launched (./bots.sh ${engine})` });
      if (!String(data.jobOffer || '').trim()) return send(200, { ok: false, error: 'paste a job offer first' });
      console.log(`generate: ${engine}, ${data.tailoring}, ${String(data.jobOffer).length} chars`);
      return runWorkflow(engine, { jobOffer: data.jobOffer, tailoring: data.tailoring })
        .then(result => send(200, result))
        .catch(e => { console.error('generate failed:', e.message); send(200, { ok: false, error: e.message }); });
    }

    // Shared prompts for all bots, re-read on every call so edits apply without a restart
    if (url.pathname === '/prompts') {
      return Promise.resolve()
        .then(() => {
          delete require.cache[require.resolve(PROMPTS_FILE)];
          return require(PROMPTS_FILE).buildPrompts(data);   // async: may fetch your GitHub projects
        })
        .then(prompts => send(200, { chatId: data.chatId, jobOffer: data.jobOffer, ...prompts }))
        .catch(e => {
          console.error('prompts failed:', e.message);
          send(500, { error: 'prompts/prompts.js: ' + e.message });
        });
    }

    const prompt = (data.messages || [])
      .filter(m => m.role === 'user')
      .map(m => typeof m.content === 'string' ? m.content
        : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'))
      .join('\n\n');
    if (!prompt) return send(400, { error: 'no user message' });

    const args = { system: data.system, prompt, model: data.model };
    const job = url.pathname === '/gemini/v1/messages'
      ? generateJson(args, runGemini)                                     // Gemini runs in parallel
      : serial(data.expect_json === false ? () => runClaude(args) : () => generateJson(args));
    job
      .then(text => send(200, { content: [{ type: 'text', text }], stop_reason: 'end_turn' }))
      .catch(e => {
        console.error('request failed:', e.message);
        const limited = /limit|rate|quota/i.test(e.message);
        send(limited ? 429 : 502, { error: e.message });
      });
  });
}).listen(PORT, () => console.log(`claude-bridge listening on :${PORT}`));