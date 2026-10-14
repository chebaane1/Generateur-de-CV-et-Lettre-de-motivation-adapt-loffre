// The web page: generate, preview, edit and download. Served compiled as /app.js by the app server.

type Engine = 'claude' | 'gemini' | 'local';
type Tab = 'cv' | 'letter' | 'ats';
type Content = Record<string, any>;

interface Entry {
  engine: Engine;
  date: number;
  resumePdf: string;          // base64
  letterPdf: string;          // base64
  atsReport: string;
  headline: string;
  company: string;
  jobTitle: string;
  resume?: Content;           // missing for entries generated before editing existed
  letter?: Content;
}

const ENGINE_NAMES: Record<Engine, string> = { claude: 'Claude (Pro plan)', gemini: 'Gemini', local: 'Local model (slow)' };
const HISTORY_KEY = 'cv-history';
const MAX_HISTORY = 10;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let current: Entry | null = null;
let tab: Tab = 'cv';
let urls: Partial<Record<Tab, string>> = {};

// Text may contain LaTeX escapes (\& …); show it as plain text
const plain = (s: unknown) => String(s || '').replace(/\\textbackslash\{\}/g, '\\').replace(/\\textasciitilde\{\}/g, '~')
  .replace(/\\textasciicircum\{\}/g, '^').replace(/\\([&%$#_{}])/g, '$1');

// ---- browser storage (may be unavailable: private window, blocked storage) ----
const store = {
  get(): Entry[] {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  },
  set(list: Entry[]) {
    // PDFs are big: drop the oldest entries until it fits
    for (let l = list.slice(0, MAX_HISTORY); l.length; l.pop()) {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(l)); return; } catch { /* too big, drop one */ }
    }
  }
};
const getPref = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function setStatus(text: string, cls = '') {
  $('status').textContent = text;
  $('status').className = 'status ' + cls;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

// ---- engines launched with ./bots.sh ----
async function loadEngines() {
  let engines: Engine[] = ['claude', 'gemini', 'local'];
  try { engines = (await (await fetch('/api/engines')).json()).engines; } catch { /* keep all */ }
  $('engine').innerHTML = engines.map(e => `<option value="${e}">${ENGINE_NAMES[e] || e}</option>`).join('');
  if (!engines.length) setStatus('No engine launched: run ./bots.sh claude|gemini|local', 'err');
  const saved = getPref('cv-engine') as Engine | null;
  if (saved && engines.includes(saved)) $<HTMLSelectElement>('engine').value = saved;
  $<HTMLSelectElement>('mode').value = getPref('cv-mode') || 'aggressive';
}

// ---- result view ----
function pdfUrl(b64: string) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

function show(entry: Entry, t: Tab = 'cv') {
  current = entry;
  Object.values(urls).forEach(u => u && URL.revokeObjectURL(u));
  urls = { cv: pdfUrl(entry.resumePdf), letter: pdfUrl(entry.letterPdf) };
  $('ats').textContent = [plain(entry.headline), '', plain(entry.atsReport)].join('\n').trim();
  $('empty').hidden = true;
  $('view').hidden = false;
  setTab(t);
}

function setTab(t: Tab) {
  if (!current) return;
  tab = t;
  document.querySelectorAll<HTMLButtonElement>('.tabs button[data-tab]')
    .forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  const isPdf = t !== 'ats';
  const content = t === 'ats' ? undefined : current[t === 'cv' ? 'resume' : 'letter'];
  $('editor').hidden = true;
  $('pdf').hidden = !isPdf;
  $('ats').hidden = isPdf;
  $('dl').hidden = !isPdf;
  $('editBtn').hidden = !isPdf;
  $<HTMLButtonElement>('editBtn').disabled = isPdf && !content;
  $('editBtn').title = content ? 'Edit the text, then rebuild the PDF' : 'Not editable (generated before editing existed)';
  if (isPdf) {
    const url = urls[t] || '';
    $<HTMLIFrameElement>('pdf').src = url;
    const company = plain(current.company).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'offer';
    const dl = $<HTMLAnchorElement>('dl');
    dl.href = url;
    dl.download = `${t === 'cv' ? 'CV' : 'Lettre'}_${company}.pdf`;
    dl.textContent = `Download ${t === 'cv' ? 'CV' : 'letter'}`;
  }
}

function renderHistory() {
  const list = store.get();
  const ul = $('history');
  ul.innerHTML = list.length ? '' : '<li style="cursor:default"><small>Nothing yet</small></li>';
  list.forEach(e => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    const meta = document.createElement('small');
    title.textContent = `${plain(e.company) || '—'} · ${plain(e.jobTitle) || ''}`;
    meta.textContent = `${e.engine} · ${new Date(e.date).toLocaleDateString()}`;
    li.append(title, meta);
    li.onclick = () => show(e);
    ul.appendChild(li);
  });
}

// ---- generate ----
async function generate() {
  const jobOffer = $<HTMLTextAreaElement>('offer').value.trim();
  if (!jobOffer) return setStatus('Paste a job offer first.', 'err');
  const engine = $<HTMLSelectElement>('engine').value as Engine;
  const tailoring = $<HTMLSelectElement>('mode').value;
  setPref('cv-engine', engine);
  setPref('cv-mode', tailoring);
  $<HTMLButtonElement>('go').disabled = true;
  const start = Date.now();
  const seconds = () => Math.round((Date.now() - start) / 1000);
  const timer = setInterval(() => setStatus(`Generating with ${ENGINE_NAMES[engine]}… ${seconds()}s`), 1000);
  try {
    const res = await postJson<any>('/api/generate', { engine, tailoring, jobOffer });
    if (!res.ok) throw new Error((res.step ? `${res.step}: ` : '') + (res.error || 'generation failed'));
    const entry: Entry = { ...res, engine, date: Date.now() };
    show(entry);
    store.set([entry, ...store.get()]);
    renderHistory();
    setStatus(`Done in ${seconds()}s.`, 'ok');
  } catch (e) {
    setStatus('❌ ' + (e instanceof Error ? e.message : String(e)), 'err');
  } finally {
    clearInterval(timer);
    $<HTMLButtonElement>('go').disabled = false;
  }
}

// ---- editor: the content behind the PDF as a form, then rebuild the PDF (no AI call) ----
const HIDDEN = /^(ATS_|TECH_KEYWORDS$|SECTION_LANG$|LETTER_LANG$)/;   // internal fields, not shown
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
// "PROFILE_SUMMARY" -> "Profile summary"; keys that are already labels ("Cloud & IA") stay as they are
const human = (k: string) => /[a-z]/.test(k) && /[A-Z]/.test(k[0]) && k.includes(' ') ? k
  : k.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
const rows = (text: string) => Math.min(12, Math.max(1, Math.ceil(text.length / 90) + text.split('\n').length - 1));

function field(path: (string | number)[], value: unknown, label: string): string {
  const attr = `data-path="${esc(JSON.stringify(path))}"`;
  if (value === null || typeof value !== 'object')
    return `<label>${esc(label)}</label><textarea ${attr} data-type="text" rows="${rows(plain(value))}">${esc(plain(value))}</textarea>`;
  if (Array.isArray(value) && value.every(v => v === null || typeof v !== 'object')) {
    const text = value.map(plain).join('\n');
    return `<label>${esc(label)} <small>(one per line)</small></label><textarea ${attr} data-type="lines" rows="${rows(text) + 1}">${esc(text)}</textarea>`;
  }
  if (Array.isArray(value))
    return value.map((v, i) => `<fieldset><legend>${esc(label)} ${i + 1}</legend>${fields(v, [...path, i])}</fieldset>`).join('');
  return `<fieldset><legend>${esc(label)}</legend>${fields(value as Content, path)}</fieldset>`;
}

function fields(obj: Content, path: (string | number)[] = []): string {
  return Object.entries(obj)
    .filter(([k]) => path.length || !HIDDEN.test(k))
    .map(([k, v]) => field([...path, k], v, human(k)))
    .join('');
}

const contentKey = () => (tab === 'cv' ? 'resume' : 'letter') as 'resume' | 'letter';

function openEditor() {
  const content = current?.[contentKey()];
  if (!content) return;
  $('fields').innerHTML = fields(content);
  $('pdf').hidden = true;
  $('editor').hidden = false;
}

async function saveEditor(ev: Event) {
  ev.preventDefault();
  if (!current) return;
  const key = contentKey();
  const content: Content = JSON.parse(JSON.stringify(current[key]));
  $('fields').querySelectorAll<HTMLTextAreaElement>('textarea').forEach(el => {
    const path: (string | number)[] = JSON.parse(el.dataset.path || '[]');
    const last = path.pop()!;
    const target = path.reduce<any>((o, k) => o[k], content);
    target[last] = el.dataset.type === 'lines'
      ? el.value.split('\n').map(x => x.trim()).filter(Boolean)
      : el.value.trim();
  });
  $<HTMLButtonElement>('saveBtn').disabled = true;
  setStatus('Rebuilding the PDF…');
  try {
    const res = await postJson<{ ok: boolean; pdf?: string; error?: string }>('/api/compile', { kind: key, content });
    if (!res.ok || !res.pdf) throw new Error(res.error || 'compile failed');
    const entry = current;
    entry[key] = content;
    if (key === 'resume') { entry.resumePdf = res.pdf; entry.headline = content.HEADLINE; }
    else { entry.letterPdf = res.pdf; entry.company = content.COMPANY_NAME; entry.jobTitle = content.JOB_TITLE; }
    store.set(store.get().map(e => (e.date === entry.date ? entry : e)));   // keep the edit in the history
    renderHistory();
    show(entry, tab);
    setStatus('PDF updated.', 'ok');
  } catch (e) {
    setStatus('❌ ' + (e instanceof Error ? e.message : String(e)), 'err');
  } finally {
    $<HTMLButtonElement>('saveBtn').disabled = false;
  }
}

// ---- wiring ----
$('go').onclick = generate;
$('editBtn').onclick = openEditor;
$('cancelBtn').onclick = () => setTab(tab);
$<HTMLFormElement>('editor').onsubmit = saveEditor;
// only the real tabs (the Edit button is in the same bar)
document.querySelectorAll<HTMLButtonElement>('.tabs button[data-tab]')
  .forEach(b => (b.onclick = () => setTab(b.dataset.tab as Tab)));
loadEngines();
renderHistory();
