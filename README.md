# CV & Cover Letter Generator

Paste a job offer in a small web page → get a CV and a cover letter tailored to it, as PDFs.

---

## What you get

On **http://localhost:8080**, paste an offer, pick the engine and the mode, click **Generate**:

1. **CV (PDF)** — one page, rewritten for the offer, built to match ATS keywords, technologies in **bold**, your best GitHub projects linked
2. **Cover letter (PDF)**
3. **ATS report** — keywords covered, and the list of things added beyond your real profile
   (read it before an interview: a recruiter can ask about any line of the CV)

Preview both PDFs in the page, download them, and find your last 10 generations in the **History** (kept in your browser).
If a step fails, the page tells you which one and why.

---

## Three AI engines

| Engine | What it is | Cost | Speed |
|---|---|---|---|
| **Claude** | your Claude Pro plan, via Claude Code | included in Pro | ~2 min per document |
| **Gemini** | Google Gemini API (key in `.env`) | free tier | fast (~45 s for both), sometimes "high demand" |
| **Local** | small open-source model (Ollama, runs on your PC) | free, offline | slow on CPU (several minutes) |

You choose which ones run with `./bots.sh` (below). The page only offers those.

**Modes** (chosen on the page, per offer):

- **Aggressive** — job titles and tasks are rewritten to match the offer. Company names, dates, education, certifications and "Intern" status never change. No invented numbers.
- **Strict** — only rephrases and reorders what is really in your profile.

---

## How it works

```
web page ──► claude-bridge ──► AI engine ──► xelatex-api ──► PDFs ──► web page
                                │
                                ├─ Claude  (Claude Code, inside the bridge)
                                ├─ Gemini  (API)
                                └─ ollama  (local model container)
```

**The containers** (`docker-compose.yml`):

- **claude-bridge** — the app (`claude-bridge/server.js`), on http://localhost:8080 (this PC only):
  - serves the **web page** (`web/index.html`)
  - runs the whole pipeline with the **shared prompts** (`prompts/`), calling **Claude** (your Pro login), **Gemini** (`GEMINI_API_KEY`) or **ollama**
  - must always run, whatever the engine
- **xelatex-api** — turns the JSON into PDFs (`main.py`)
- **ollama** — the local model (downloads `qwen2.5:3b`, ~2 GB, on first start)

For each offer: `prompts → AI (CV) → PDF → AI (cover letter) → PDF → page`.
If a step fails, the page shows which one and why.

---

## Files

| File | What it is |
|---|---|
| `bots.sh` | **start the system** with the engines you want |
| `web/index.html` | the web page |
| `prompts/profile.md` | **your profile** (plain text) |
| `prompts/prompts.js` | **all the prompts and settings**, shared by the three engines |
| `claude-bridge/` | the app: web page, pipeline, Claude / Gemini / ollama calls |
| `main.py`, `Dockerfile` | the PDF compiler (LaTeX) |
| `n8n-legacy/` | the old n8n workflows (archived, not used) |
| `docker-compose.yml` | all the containers |
| `.env.example` | settings template → copy to `.env` |

---

## First-time setup

### 1. Settings

```bash
cp .env.example .env
```

Fill in `.env`:

- your contact details (`CV_*`)
- `CLAUDE_CODE_OAUTH_TOKEN` — for Claude:
  ```bash
  npm i -g @anthropic-ai/claude-code
  claude setup-token     # log in with your Pro account, copy the token
  ```
- `GEMINI_API_KEY` — for Gemini (key from https://aistudio.google.com). `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` are optional.
- `OLLAMA_MODEL` — for the local model (default `qwen2.5:3b`)

Put your profile in `prompts/profile.md`.

### 2. Build

```bash
docker-compose up -d --build
```

> First start: `ollama` downloads its model (~2 GB) in the background. Follow it with `docker-compose logs -f ollama`.

### 3. Launch

```bash
./bots.sh all        # or: ./bots.sh claude gemini
```

Open **http://localhost:8080**.

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
- `claude-bridge` always runs (web page, prompts) — no Claude usage unless you generate with Claude.

Then open **http://localhost:8080**, paste the offer, **Generate**.

### Other commands

| Do | Command |
|---|---|
| Follow the logs | `docker-compose logs -f claude-bridge` |
| After changing `main.py` or `claude-bridge/server.js` | `docker-compose up -d --build` |
| After changing `.env` | `docker-compose up -d` |
| After editing `prompts/` or `web/index.html` | nothing, it applies on the next offer / page refresh |

---

## RAM usage

Idle (nothing being generated), measured:

| Container | RAM |
|---|---|
| claude-bridge | ~65 MB |
| xelatex-api | ~25 MB |
| ollama (only with `local`, model not loaded) | ~190 MB |
| **Total** | **~90 MB** (~280 MB with `local`) |

While generating, on top of that (estimates):

| Activity | Extra RAM |
|---|---|
| Claude (Claude Code runs in the bridge) | +200–400 MB |
| PDF compilation (LaTeX) | +100–300 MB, a few seconds |
| Gemini | ~0 (runs on Google's servers) |
| **Local model (`qwen2.5:3b`)** | **+2.5 GB** |

- Ollama keeps the model in RAM for 15 min after the last offer, then frees it.
- Claude and/or Gemini only: **under 1 GB**.
- With the local model: **~3–3.5 GB** while generating. Fine on 8 GB, but close other heavy apps.
- `qwen2.5:7b` needs ~5–6 GB on its own: avoid it on an 8 GB machine.
- Not using the local model? `./bots.sh claude gemini` stops `ollama` and frees its RAM.

---

## Customize

Everything is in the **`prompts/`** folder, shared by the three engines.
Edit, save, generate: changes apply right away (no restart, no re-import).

**`prompts/profile.md`** — your real profile (experience, skills, education…). The AI only starts from this.

**`prompts/prompts.js`** — settings at the top:

- **`TAILORING`** — default mode (`'aggressive'` / `'strict'`), used when none is chosen on the page.
- **`HEADLINE_INTRO`** — first words of the line under your name: *"Cherche un stage de fin d'études"* (French offers) / *"Looking for an end-of-studies internship"* (English). The job title from the offer is added after it.
- **`MAX_EXPERIENCES`** (6) and **`TARGET_WORDS`** (`400-480`) — the AI keeps every experience relevant to the offer and fills **one page**.
- **`GITHUB_USER`** (`rayenamer`) — your public repos are read (README excerpts included, cached 12 h) and the AI picks the **2–3 most relevant to the offer** for the Projects section, linked to the repo. `''` to disable. Optional `GITHUB_TOKEN` in `.env` if GitHub rate-limits you.
- **`MODELS`**
  - `claude`: `'sonnet'` or `'haiku'` (lighter on your Pro limits)
  - `gemini`: from `GEMINI_MODEL` in `.env` (if it fails 3 times, `GEMINI_FALLBACK_MODEL` is used)
  - `local`: from `OLLAMA_MODEL` in `.env`, e.g. `qwen2.5:7b` (better, but see [RAM usage](#ram-usage))

Below the settings: `system` (general rules), `experienceRules`, `resumeTask` (the CV steps) and `letterTask` (the cover letter).

**CV layout** — `main.py`: one page, one column, serif font, sections Profil → Compétences → Formation → Expérience → Projets, technologies in **bold**.
This is the style of the CV that got interviews. The font size is chosen automatically (9 → 12.5 pt) so the content **fills exactly one page**.
After editing `main.py`: `docker-compose up -d --build xelatex-api`.

**The pipeline itself** — `generate()` in `claude-bridge/server.js`. After editing: `docker-compose up -d --build claude-bridge`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Page: *engine "x" is not launched* | Launch it: `./bots.sh x` (or `./bots.sh all`) |
| Local: *the ollama container is not running* | `./bots.sh local` (or `./bots.sh all`) |
| ❌ *Build Prompts* | Syntax error in `prompts/prompts.js`, or `prompts/profile.md` is empty |
| Gemini: *"high demand"* / HTTP 503 | Google is overloaded (common on free keys). The fallback model is tried automatically; otherwise retry later |
| Gemini: *GEMINI_API_KEY is not set* | Add it to `.env`, then `docker-compose up -d` |
| Claude: error 429 / limit | Your Pro usage limit is reached (shared with claude.ai). Wait, or set `claude: 'haiku'` in `MODELS` |
| Local: *model not found* / *connection refused* | Ollama is still downloading the model, or isn't running: `docker-compose logs -f ollama` |
| Local very slow | Normal on CPU. Use a smaller model (`qwen2.5:1.5b`), or Claude/Gemini |
| Page doesn't open | `docker ps` must show `claude-bridge`; check `docker-compose logs claude-bridge` |
| `KeyError: 'ContainerConfig'` | Old docker-compose bug: `docker-compose down` then `docker-compose up -d` |

---

## Good to know

- **Claude Pro limits are shared** with your normal Claude use. Each offer = 2 generations.
- **Never set `ANTHROPIC_API_KEY`** in the bridge: you would be billed API prices.
- **The page is private**: it only listens on this PC (`127.0.0.1:8080`). Don't expose it — it uses your personal subscription and keys.
- **Your profile is in `prompts/profile.md`** and your keys in `.env` (git-ignored). Remove the profile before publishing the repo.
