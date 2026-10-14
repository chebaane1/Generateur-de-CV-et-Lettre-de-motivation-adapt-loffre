# CV & Cover Letter Generator

Paste a job offer in a small web page → get a CV and a cover letter tailored to it, as PDFs.

---

## What you get

On **http://localhost:8080**, paste an offer, pick the engine and the mode, click **Generate**:

1. **CV (PDF)** — one full page, rewritten for the offer, built to match ATS keywords, technologies in **bold**, your best GitHub projects linked
2. **Cover letter (PDF)**
3. **ATS report** — keywords covered, and the list of things added beyond your real profile
   (read it before an interview: a recruiter can ask about any line of the CV)

Then:

- **Preview** both PDFs in the page and **download** them
- **Edit** any text (headline, bullets, paragraphs…) and click **Update PDF** — rebuilt in a few seconds, no AI call
- Find your last 10 generations in the **History** (kept in your browser)

If a step fails, the page tells you which one and why.

---

## Three AI engines

| Engine | What it is | Cost | Speed |
|---|---|---|---|
| **Claude** | your Claude Pro plan, via Claude Code | included in Pro | ~2 min per document |
| **Gemini** | Google Gemini API (key in `.env`) | free tier | ~45 s for both, sometimes "high demand" |
| **Local** | small open-source model (Ollama, on your PC) | free, offline | slow on CPU (several minutes) |

You choose which ones run with `./bots.sh`. The page only offers those.

**Modes** (chosen on the page, per offer):

- **Aggressive** — job titles and tasks are rewritten to match the offer. Company names, dates, education, certifications and "Intern" status never change. No invented numbers.
- **Strict** — only rephrases and reorders what is really in your profile.

---

## How it works

```
web page ──► app ──► AI engine ──► pdf ──► web page
              │         ├─ Claude  (Claude Code, inside the app container)
              │         ├─ Gemini  (API)
              │         └─ ollama  (local model container)
              └─ prompts/ (your profile + the prompts) + your GitHub repos
```

For each offer: `prompts → AI (CV) → PDF → AI (cover letter) → PDF → page`.

**Containers** (`docker-compose.yml`):

| Service | Container | What it does |
|---|---|---|
| `app` | `cv-app` | web page + pipeline (TypeScript), on http://localhost:8080 (this PC only) |
| `pdf` | `cv-pdf` | turns the AI's JSON into PDFs (Python + XeLaTeX), only reachable by `app` |
| `ollama` | `cv-ollama` | the local model (downloads `qwen2.5:3b`, ~2 GB, on first start) — only with `local` |

---

## Project structure

```
.
├── bots.sh                  start the system with the engines you want
├── docker-compose.yml
├── .env.example             settings template → copy to .env
├── prompts/                 ✏️ YOUR files — edits apply on the next offer
│   ├── profile.md           you: contact block at the top + your real profile (plain text)
│   └── prompts.ts           settings + all the prompts, shared by the three engines
├── app/                     web page + pipeline (TypeScript, run with tsx)
│   ├── src/
│   │   ├── server.ts        HTTP routes
│   │   ├── profile.ts       reads prompts/profile.md (contact block + text)
│   │   ├── pipeline.ts      offer → CV → letter, PDF rebuilds
│   │   ├── engines/         claude.ts, gemini.ts, ollama.ts, index.ts (JSON check + repair)
│   │   ├── config.ts        settings from .env
│   │   ├── http.ts          JSON calls between containers
│   │   └── types.ts
│   ├── web/
│   │   ├── index.html       the page
│   │   └── app.ts           the page's script (compiled on the fly) — edits apply on refresh
│   └── package.json, tsconfig.json, Dockerfile
├── pdf/                     PDF service (Python, FastAPI + XeLaTeX)
│   ├── app/
│   │   ├── main.py          HTTP routes
│   │   ├── resume.py        CV layout, fitted on exactly one page
│   │   ├── letter.py        cover letter layout
│   │   ├── latex.py         LaTeX blocks + compiler
│   │   └── text.py          escaping, tolerant JSON readers
│   └── requirements.txt, Dockerfile
└── data/                    runtime state written by bots.sh (git-ignored)
```

---

## First-time setup

### 1. Settings

```bash
cp .env.example .env
```

Fill in `.env` (only keys and technical settings):

- `CLAUDE_CODE_OAUTH_TOKEN` — for Claude:
  ```bash
  npm i -g @anthropic-ai/claude-code
  claude setup-token     # log in with your Pro account, copy the token
  ```
- `GEMINI_API_KEY` — for Gemini (key from https://aistudio.google.com). `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` are optional.
- `OLLAMA_MODEL` — for the local model (default `qwen2.5:3b`)

Then fill in **`prompts/profile.md`** — everything about you, in one place (see [Customize](#customize)).

### 2. Build

```bash
docker-compose build
```

The `app` build also type-checks the TypeScript: a type error stops the build.

### 3. Launch

```bash
./bots.sh all        # or: ./bots.sh claude gemini
```

Open **http://localhost:8080**.

> First start with `local`: `ollama` downloads its model (~2 GB). Follow it with `docker-compose logs -f ollama`.

---

## Daily use

### Start with the engines you want

`bots.sh` starts the containers the chosen engines need and tells the page which engines to offer:

| I want | Command |
|---|---|
| Only Claude | `./bots.sh claude` |
| Only Gemini | `./bots.sh gemini` |
| Only the local model | `./bots.sh local` |
| Two of them | `./bots.sh claude gemini` (any combination) |
| All three | `./bots.sh all` |
| Stop everything | `docker-compose down` |

- `ollama` only runs when `local` is chosen (it frees ~2–3 GB of RAM otherwise).
- `app` and `pdf` always run — no Claude usage unless you generate with Claude.

### Other commands

| Do | Command |
|---|---|
| Follow the logs | `docker-compose logs -f app` |
| After editing `prompts/`, `app/web/index.html` or `app/web/app.ts` | nothing — next offer / page refresh |
| After editing `app/src/` | `docker-compose up -d --build app` |
| After editing `pdf/app/` | `docker-compose up -d --build pdf` |
| After changing `.env` | `docker-compose up -d` |
| Type-check locally (optional) | `cd app && npm install && npm run typecheck` |

---

## RAM usage

Idle (nothing being generated), measured:

| Container | RAM |
|---|---|
| app | ~55 MB |
| pdf | ~35 MB |
| ollama (only with `local`, model not loaded) | ~190 MB |
| **Total** | **~90 MB** (~280 MB with `local`) |

While generating, on top of that (estimates):

| Activity | Extra RAM |
|---|---|
| Claude (Claude Code runs in `app`) | +200–400 MB |
| PDF compilation (LaTeX) | +100–300 MB, a few seconds |
| Gemini | ~0 (runs on Google's servers) |
| **Local model (`qwen2.5:3b`)** | **+2.5 GB** |

- Ollama keeps the model in RAM for 15 min after the last offer, then frees it.
- Claude and/or Gemini only: **under 1 GB**.
- With the local model: **~3–3.5 GB** while generating. Fine on 8 GB, but close other heavy apps.
- `qwen2.5:7b` needs ~5–6 GB on its own: avoid it on an 8 GB machine.

---

## Customize

**`prompts/profile.md`** — everything about you, in one place:

```markdown
---
name: Rayen Ameur
email: rayen.ameur@outlook.com
phone: +216 92 164 742
location: Tunis, Tunisia
github: github.com/rayenamer
linkedin: linkedin.com/in/…
---

Your real profile in plain text: experience, skills, education…
```

- The **contact block** (between the `---` lines) is printed as-is on the CV and the cover letter — the AI never rewrites it. Remove a line to leave it out (e.g. `phone`).
- The **text below** is what the AI works from.

**`prompts/prompts.ts`** — settings at the top:

- **`TAILORING`** — default mode (`'aggressive'` / `'strict'`), when none is chosen on the page.
- **`HEADLINE_INTRO`** — first words of the line under your name: *"Cherche un stage de fin d'études"* (French offers) / *"Looking for an end-of-studies internship"* (English). The job title from the offer is added after it.
- **`MAX_EXPERIENCES`** (6) and **`TARGET_WORDS`** (`400-480`) — every experience relevant to the offer is kept, and the CV fills **one page**.
- **`GITHUB_USER`** (`rayenamer`) — your public repos are read (README excerpts included, cached 12 h) and the AI picks the **2–3 most relevant to the offer** for the Projects section, linked to the repo. `''` to disable. `GITHUB_TOKEN` in `.env` if GitHub rate-limits you.
- **`MODELS`**
  - `claude`: `'sonnet'` or `'haiku'` (lighter on your Pro limits)
  - `gemini`: from `GEMINI_MODEL` in `.env` (after 3 failures, `GEMINI_FALLBACK_MODEL` is used)
  - `local`: from `OLLAMA_MODEL` in `.env`

Below the settings: `system` (general rules), `experienceRules`, `resumeTask` (the CV steps) and `letterTask` (the cover letter).

**CV layout** — `pdf/app/resume.py`: one page, one column, serif font (TeX Gyre Termes), sections Profil → Compétences → Formation → Expérience → Projets, technologies in **bold**.
This is the style of the CV that got interviews. The font size is chosen automatically (9 → 12.5 pt) so the content **fills exactly one page**.

**The pipeline** — `app/src/pipeline.ts`. **An engine** — `app/src/engines/`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Page: *engine "x" is not launched* | `./bots.sh x` (or `./bots.sh all`) |
| ❌ *Profile* | `prompts/profile.md` is empty or has no `name:` in its contact block |
| ❌ *Prompts* | Error in `prompts/prompts.ts` — see `docker-compose logs app` |
| Gemini: *"high demand"* / HTTP 503 / 429 quota | Google is overloaded or your free daily quota is used. The fallback model is tried automatically; otherwise use Claude or retry tomorrow |
| Gemini: *GEMINI_API_KEY is not set* | Add it to `.env`, then `docker-compose up -d` |
| Claude: error 429 / limit | Your Pro usage limit is reached (shared with claude.ai). Wait, or set `claude: 'haiku'` in `MODELS` |
| Local: *the ollama container is not running* | `./bots.sh local` |
| Local: *model not found* | Ollama is still downloading the model: `docker-compose logs -f ollama` |
| Page doesn't open | `docker ps` must show `cv-app`; check `docker-compose logs app` |
| `KeyError: 'ContainerConfig'` | Old docker-compose bug: `docker-compose down` then `./bots.sh …` again |

---

## Good to know

- **Claude Pro limits are shared** with your normal Claude use. Each offer = 2 generations.
- **Never set `ANTHROPIC_API_KEY`**: you would be billed API prices.
- **The page is private**: it only listens on this PC (`127.0.0.1:8080`). Don't expose it — it uses your personal subscription and keys.
- **You** are in `prompts/profile.md`, the **machine** settings and keys in `.env` (git-ignored). Remove the profile before publishing the repo.
