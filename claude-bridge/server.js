// The app's backend:
//   GET  /              the web page (web/index.html)
//   GET  /api/engines   engines launched with ./bots.sh (web/engines.json)
//   POST /api/generate  {engine, jobOffer, tailoring} -> prompts -> AI (CV) -> PDF -> AI (letter) -> PDF
// AI engines: Claude Code headless (your Pro plan), Gemini API (GEMINI_API_KEY), Ollama (local model).
// PDFs: xelatex-api (main.py).
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8080;
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const TIMEOUT_MS = 5 * 60 * 1000;
const PROMPTS_FILE = process.env.PROMPTS_FILE || '/prompts/prompts.js'; // ./prompts mounted by docker-compose
const WEB_DIR = process.env.WEB_DIR || '/web';                           // ./web mounted by docker-compose
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const XELATEX_URL = process.env.XELATEX_URL || 'http://xelatex-api:8000';
const LOCAL_TIMEOUT_MS = 30 * 60 * 1000;                                 // the local model is slow on CPU
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_FALLBACK = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite';
const ENGINES = ['claude', 'gemini', 'local'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Run one Claude request at a time so parallel generations don't burn through your Pro limits at once
let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));

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

// POST JSON to another container and parse the JSON answer.
// Plain http (not fetch): the local model can take longer than fetch's 5-minute header timeout.
function postJson(url, payload, timeout = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout
    }, res => {
      let out = '';
      res.on('data', c => (out += c));
      res.on('end', () => {
        let data;
        try { data = JSON.parse(out); } catch { return reject(new Error(`HTTP ${res.statusCode}: ${out.slice(0, 300)}`)); }
        if (res.statusCode >= 400) return reject(new Error(String(data.detail || data.error || `HTTP ${res.statusCode}`)));
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

// Ollama (local model), JSON mode
async function runOllama({ system, prompt, model }) {
  const res = await postJson(`${OLLAMA_URL}/api/chat`, {
    model, stream: false, format: 'json',
    options: { num_ctx: 8192, num_predict: 4096, temperature: 0.3 },
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }]
  }, LOCAL_TIMEOUT_MS).catch(e => {
    throw /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(e.message)
      ? new Error('the ollama container is not running (./bots.sh local)') : e;
  });
  if (res.done_reason === 'length') throw new Error('the local model hit its max output tokens');
  return res.message?.content || '';
}

const RUNNERS = { claude: runClaude, gemini: runGemini, local: runOllama };

// Ask the engine for one JSON object (Claude requests are queued one at a time)
async function askJson(engine, request) {
  const args = { system: request.system, prompt: request.messages.map(m => m.content).join('\n\n'), model: request.model };
  const job = () => generateJson(args, RUNNERS[engine]);
  return JSON.parse(await (engine === 'claude' ? serial(job) : job()));
}

// Plain-text keyword report shown on the web page
function atsReport(resume) {
  const matched = resume.ATS_MATCHED || [], missing = resume.ATS_MISSING || [], added = resume.ATS_ADDED || [];
  return [
    `ATS keywords covered: ${matched.length}/${matched.length + missing.length}`,
    missing.length ? `Not in your profile: ${missing.join(', ')}` : 'Every keyword of the offer is covered.',
    added.length ? `\nAdded beyond your profile (prepare to talk about these in interviews):\n- ${added.join('\n- ')}` : ''
  ].filter(Boolean).join('\n');
}

// One offer -> tailored CV + cover letter PDFs. On failure, says which step failed.
async function generate({ engine, jobOffer, tailoring }) {
  let step = 'Prompts';
  try {
    delete require.cache[require.resolve(PROMPTS_FILE)];   // re-read: edits to prompts/ apply on the next offer
    const { resumeRequest, letterRequest } = await require(PROMPTS_FILE).buildPrompts({ jobOffer, engine, tailoring });

    step = 'CV (AI)';
    const resume = await askJson(engine, resumeRequest);
    resume.PROFILE_SUMMARY = resume.PROFILE_SUMMARY || resume.summary || '';
    step = 'CV (PDF)';
    const resumePdf = (await postJson(`${XELATEX_URL}/compile-resume?output=base64`, resume)).pdf;

    step = 'Cover letter (AI)';
    const letter = await askJson(engine, letterRequest);
    step = 'Cover letter (PDF)';
    const letterPdf = (await postJson(`${XELATEX_URL}/compile-cover-letter?output=base64`, letter)).pdf;

    return { ok: true, engine, resumePdf, letterPdf, atsReport: atsReport(resume),
             headline: resume.HEADLINE, company: letter.COMPANY_NAME, jobTitle: letter.JOB_TITLE,
             resume, letter };   // the content, so the page can edit it and recompile
  } catch (e) {
    console.error(`generate failed at ${step}:`, e.message);
    return { ok: false, step, error: e.message };
  }
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
  if (req.method !== 'POST' || !['/api/generate', '/api/compile'].includes(url.pathname)) return send(404, { error: 'not found' });

  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    let data;
    try { data = JSON.parse(body); } catch { return send(400, { error: 'invalid JSON' }); }

    // From the page's editor: rebuild one PDF from edited content (no AI call)
    if (url.pathname === '/api/compile') {
      const kind = data.kind === 'letter' ? 'cover-letter' : 'resume';
      return postJson(`${XELATEX_URL}/compile-${kind}?output=base64`, data.content || {})
        .then(r => send(200, { ok: true, pdf: r.pdf }))
        .catch(e => send(200, { ok: false, error: e.message }));
    }

    const { engine, jobOffer, tailoring } = data;
    if (!launchedEngines().includes(engine)) return send(200, { ok: false, error: `engine "${engine}" is not launched (./bots.sh ${engine})` });
    if (!String(jobOffer || '').trim()) return send(200, { ok: false, error: 'paste a job offer first' });
    console.log(`generate: ${engine}, ${tailoring}, ${String(jobOffer).length} chars`);
    generate({ engine, jobOffer, tailoring }).then(result => send(200, result));
  });
}).listen(PORT, () => console.log(`listening on :${PORT} (web page: http://localhost:${PORT})`));