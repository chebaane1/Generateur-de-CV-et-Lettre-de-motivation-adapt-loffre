// "All CVs" popup: every generation in data/cv.db as a searchable, sortable table.
// CV / Letter open a second popup on top with the PDF; "Open" loads it into the generator (app.ts).

interface Row {
  id: number;
  createdAt: string;
  engine: string;
  tailoring: string | null;
  company: string;
  jobTitle: string;
  ats: string;            // "18/18"
}
type SortKey = keyof Row;

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
// Text may contain LaTeX escapes (\& …); show it as plain text
const plain = (s: unknown) => String(s || '').replace(/\\([&%$#_{}])/g, '$1');

const allDialog = byId<HTMLDialogElement>('allDialog');
const pdfDialog = byId<HTMLDialogElement>('pdfDialog');
let rows: Row[] = [];
let sortKey: SortKey = 'createdAt';
let ascending = false;

async function load() {
  try { rows = (await (await fetch('/api/history')).json()).items || []; } catch { rows = []; }
  render();
}

function render() {
  const q = byId<HTMLInputElement>('allSearch').value.trim().toLowerCase();
  const shown = rows
    .filter(r => !q || [r.company, r.jobTitle, r.engine, r.tailoring].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (ascending ? 1 : -1) * String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), undefined, { numeric: true }));

  byId('allRows').innerHTML = shown.map(r => `
    <tr>
      <td>${esc(new Date(r.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }))}</td>
      <td class="wide">${esc(plain(r.company)) || '—'}</td>
      <td class="wide">${esc(plain(r.jobTitle))}</td>
      <td>${esc(r.engine)}</td>
      <td>${esc(r.tailoring || '')}</td>
      <td>${esc(r.ats)}</td>
      <td><button data-pdf="cv" data-id="${r.id}">CV</button></td>
      <td><button data-pdf="letter" data-id="${r.id}">Letter</button></td>
      <td><button data-open="${r.id}">Open</button></td>
      <td><button class="del" data-del="${r.id}" title="Delete">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="10">Nothing yet — generate a CV first.</td></tr>';

  byId('allCount').textContent = `${shown.length} of ${rows.length} generation(s)`;
  allDialog.querySelectorAll<HTMLElement>('th[data-sort]').forEach(th => {
    const label = th.textContent!.replace(/ [▲▼]$/, '');
    th.textContent = th.dataset.sort === sortKey ? `${label} ${ascending ? '▲' : '▼'}` : label;
  });
}

/** Second popup, on top of the list: one PDF */
function showPdf(id: number, kind: 'cv' | 'letter') {
  const row = rows.find(r => r.id === id);
  const url = `/api/generations/${id}/${kind}.pdf`;
  byId('pdfTitle').textContent = `${kind === 'cv' ? 'CV' : 'Cover letter'} — ${plain(row?.company) || 'offer'}`;
  byId<HTMLIFrameElement>('pdfFrame').src = url;
  const dl = byId<HTMLAnchorElement>('pdfDownload');
  dl.href = url;
  dl.download = `${kind === 'cv' ? 'CV' : 'Lettre'}_${plain(row?.company).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'offer'}.pdf`;
  pdfDialog.showModal();
}

// ---- wiring ----
byId('allBtn').onclick = () => { allDialog.showModal(); load(); };
byId('allSearch').oninput = render;

allDialog.querySelectorAll<HTMLElement>('th[data-sort]').forEach(th => (th.onclick = () => {
  const key = th.dataset.sort as SortKey;
  ascending = key === sortKey ? !ascending : key !== 'createdAt';
  sortKey = key;
  render();
}));

byId('allRows').onclick = async ev => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn) return;
  const d = btn.dataset;
  if (d.pdf) return showPdf(Number(d.id), d.pdf as 'cv' | 'letter');
  if (d.open) {
    // app.ts listens and loads it into the generator
    window.dispatchEvent(new CustomEvent('open-generation', { detail: Number(d.open) }));
    allDialog.close();
    return;
  }
  if (d.del) {
    const row = rows.find(r => r.id === Number(d.del));
    if (!row || !confirm(`Delete the CV for "${plain(row.company) || 'this offer'}"? This can't be undone.`)) return;
    await fetch(`/api/generations/${row.id}`, { method: 'DELETE' });
    load();
  }
};

// close: ✕ button, or a click on the dark background; Esc is handled by the browser
for (const dlg of [allDialog, pdfDialog]) {
  dlg.querySelector<HTMLElement>('[data-close]')!.onclick = () => dlg.close();
  dlg.addEventListener('click', ev => { if (ev.target === dlg) dlg.close(); });
}
pdfDialog.addEventListener('close', () => { byId<HTMLIFrameElement>('pdfFrame').src = 'about:blank'; });

export {};   // each page script is its own module (loaded with type="module")
