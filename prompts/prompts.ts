// Prompts shared by the three engines (Claude, Gemini, local).
// Loaded by the app and re-read on every offer: edit, save, generate. No restart needed.
import fs from 'node:fs';
import path from 'node:path';

type Engine = 'claude' | 'gemini' | 'local';
type Tailoring = 'aggressive' | 'strict';
interface Repo { name: string; tags: string; about: string; url: string }
interface GithubRepo { name: string; fork: boolean; language: string | null; topics?: string[]; description: string | null; html_url: string; default_branch: string }

// ===== SETTINGS =====

// 'aggressive': job titles and tasks are rewritten to match the offer (companies, dates, education stay real)
// 'strict'    : only selects and rephrases what is in the profile
const TAILORING: Tailoring = 'aggressive';

// Model per engine
const MODELS: Record<Engine, string> = {
  claude: 'sonnet',                                  // 'sonnet' or 'haiku' (lighter on your Pro limits)
  gemini: process.env.GEMINI_MODEL || 'gemini-3.6-flash', // set GEMINI_MODEL in .env (fallback: GEMINI_FALLBACK_MODEL)
  local: process.env.OLLAMA_MODEL || 'qwen2.5:3b'    // set OLLAMA_MODEL in .env
};

// First words of the CV headline, under your name (the job title from the offer is added after)
const HEADLINE_INTRO = {
  fr: "Cherche un stage de fin d'études",
  en: 'Looking for an end-of-studies internship'
};

// One-page CV: keep every relevant experience (up to MAX_EXPERIENCES) and fill the page.
// The PDF engine adjusts the font size so it always fits on one page.
const MAX_EXPERIENCES = 6;
const TARGET_WORDS = '400-480';

// Your profile: prompts/profile.md (plain text, the AI only starts from this)
const PROFILE_FILE = path.join(__dirname, 'profile.md');

// Your GitHub: public repos are read and the AI picks the ones that fit the offer for the PROJECTS section.
// Set to '' to disable. Refreshed every GITHUB_CACHE_HOURS (forks are skipped).
const GITHUB_USER = 'rayenamer';
const GITHUB_CACHE_HOURS = 12;
const PROJECTS_COUNT = '2-3';

// ====================

// --- GitHub projects -------------------------------------------------------
// The repo list comes from the GitHub API (1 request); README excerpts come from raw.githubusercontent.com,
// which is not rate-limited like the API. Set GITHUB_TOKEN in .env to raise the API limit if needed.
const GH_HEADERS: Record<string, string> = {
  'User-Agent': 'cv-generator',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
};

// Markdown README -> a short plain-text excerpt
function readmeExcerpt(md: string, max = 350): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')            // code blocks
    .replace(/<[^>]+>/g, ' ')                   // HTML tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')      // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links -> text
    .replace(/[#>*_`|~-]+/g, ' ')               // markdown symbols
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function fetchReadme(repo: GithubRepo): Promise<string> {
  for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.MD', 'README']) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${GITHUB_USER}/${repo.name}/${repo.default_branch}/${name}`,
        { signal: AbortSignal.timeout(8000) });
      if (res.ok) return readmeExcerpt(await res.text());
    } catch { /* try the next name */ }
  }
  return '';
}

// Kept on globalThis because this file is re-loaded on every offer
const store = globalThis as typeof globalThis & { __githubCache?: { user: string; at: number; repos: Repo[] } };

async function githubProjects(): Promise<Repo[]> {
  if (!GITHUB_USER) return [];
  const cache = store.__githubCache;
  if (cache && cache.user === GITHUB_USER && Date.now() - cache.at < GITHUB_CACHE_HOURS * 3600e3) return cache.repos;
  try {
    const res = await fetch(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=pushed`,
      { headers: GH_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const repos = ((await res.json()) as GithubRepo[]).filter(r => !r.fork && r.name.toLowerCase() !== GITHUB_USER.toLowerCase());
    const list: Repo[] = await Promise.all(repos.map(async r => ({
      name: r.name,
      tags: [r.language, ...(r.topics || [])].filter(Boolean).join(', '),
      about: r.description || await fetchReadme(r),
      url: r.html_url
    })));
    store.__githubCache = { user: GITHUB_USER, at: Date.now(), repos: list };
    console.log(`github: ${list.length} repos loaded for ${GITHUB_USER}`);
    return list;
  } catch (e) {
    console.error('github: could not load repos:', e instanceof Error ? e.message : e);
    return cache ? cache.repos : [];   // keep the last good list, or go on without GitHub projects
  }
}

// One line per repo; the local model gets shorter excerpts to fit its small context window
const formatRepos = (repos: Repo[], max: number): string => repos
  .map(r => `- ${r.name}${r.tags ? ` (${r.tags})` : ''}: ${(r.about || 'no description').slice(0, max)} | ${r.url}`)
  .join('\n');

// Must match what the PDF service (pdf/app/resume.py) expects. ATS_* and TECH_KEYWORDS: report and bold technologies
const RESUME_SCHEMA = {
  SECTION_LANG: '"en" or "fr" (language of the offer)',
  HEADLINE: '<headline intro> | <job title from the offer> | <1-2 key domains of the offer>',
  personal_information: { full_name: '', email: '', phone: '', github: '', linkedin: '' },
  PROFILE_SUMMARY: '3-4 sentences',
  skills: { '<category named with the offer vocabulary>': ['skill', 'skill'] },
  education: [{ degree: '', institution: '', dates: 'Mon YYYY – Mon YYYY', details: 'optional, a few words' }],
  experience: [{ title: '', company: '', dates: 'Mon YYYY – Mon YYYY', responsibilities: ['one-line bullet'] }],
  PROJECTS: [{ name: 'readable project name', description: 'one line: what it does + key tools', url: 'GitHub repo URL, or empty' }],
  certifications: ['at most 3, only if relevant to the offer, else empty'],
  TECH_KEYWORDS: ['every technology named in the resume: languages, frameworks, libraries, tools, cloud services, databases (exact spelling used in the resume)'],
  ATS_MATCHED: ['offer keyword present in the resume'],
  ATS_MISSING: ['offer keyword the resume does not cover'],
  ATS_ADDED: ['title, task or skill written in the resume that is NOT in the candidate profile']
};

// Must match what the PDF service (pdf/app/letter.py) expects
const LETTER_SCHEMA = {
  COMPANY_NAME: '', JOB_TITLE: 'exactly as written in the offer', RECIPIENT_NAME: 'use "Madame, Monsieur" / "Hiring Manager" if unknown',
  PARAGRAPH_HOOK: '', PARAGRAPH_VALUE: '', PARAGRAPH_ALIGNMENT: '', PARAGRAPH_CTA: ''
};

// tailoring: chosen on the web page per offer; TAILORING above is the default
export async function buildPrompts({ jobOffer, engine, tailoring }: { jobOffer: string; engine: Engine; tailoring?: Tailoring }) {
  const profile = fs.readFileSync(PROFILE_FILE, 'utf8').trim();
  const repos = formatRepos(await githubProjects(), engine === 'local' ? 120 : 350);
  if (!profile) throw new Error('prompts/profile.md is empty: paste your profile in it.');
  const aggressive = (tailoring || TAILORING) === 'aggressive';
  const model = MODELS[engine] || '';

  const system = [
    'You are an expert ATS (Applicant Tracking System) resume writer and recruiter.',
    'Your goal: the highest possible ATS keyword match for the job offer.',
    ...(aggressive ? [
      'The candidate authorizes you to rewrite job titles, responsibilities and skills so the resume matches the offer as closely as possible.',
      'Never change (keep them exactly as in the profile): company names, employment dates, locations, education, degrees, certifications, contact details.',
      'Internships stay internships: keep "Intern" (or "Stagiaire") in those titles.',
      'Rewritten tasks must stay plausible for that company\'s business, the role\'s duration and level. Never invent numbers or metrics.'
    ] : [
      'Truth rules (never break them): use ONLY facts from the candidate profile. Never invent employers, job titles, seniority, dates, degrees, certifications, metrics, tools or skills.',
      'You may select, reorder and rephrase content, and you must reuse the exact wording of the offer whenever the profile supports it.'
    ]),
    'Write in the same language as the job offer.',
    'Output plain text only inside JSON values: no LaTeX, no Markdown, no HTML.',
    'Respond with ONE valid JSON object and nothing else: no code fences, no commentary.'
  ].join('\n');

  const experienceRules = aggressive
    ? `5. EXPERIENCE: include EVERY experience that is relevant to the offer (up to ${MAX_EXPERIENCES}) — don't be shy:
   an experience is relevant if its tasks, tools or domain can support the offer. Leave out only clearly unrelated ones.
   Keep their real company and dates, reverse-chronological order.
   - Title: rename each role to the offer's job title, or the closest variant that fits that company (keep "Intern" / "Stagiaire" for internships).
   - Bullets: 2-3 per role, ONE line each (max ~18 words), describing tasks taken from the offer's responsibilities, adapted to that company's business.
     Name the tools, reuse the offer's exact keywords, show production concerns (robustness, tests, monitoring, scalability). No invented numbers.
   - List in ATS_ADDED every title, task or skill you wrote that the profile does not support.`
    : `5. EXPERIENCE: include EVERY experience that is relevant to the offer (up to ${MAX_EXPERIENCES}) — don't be shy:
   an experience is relevant if its tasks, tools or domain can support the offer. Leave out only clearly unrelated ones.
   Keep their real employer, title and date, reverse-chronological order.
   - Title: keep the real title. You may add a short focus in the offer's vocabulary after " – " when that role's description supports it
     (e.g. "Software Engineer Intern – Backend .NET"). Never change the role itself or its seniority.
   - Bullets: 2-3 per role, ONE line each (max ~18 words): for each offer requirement, find the experience that proves it and write it there.
     Name the tools used, reuse the offer's exact keywords. No invented numbers.
   - ATS_ADDED must be an empty list.`;

  const resumeTask = `Tailor the resume to this offer, step by step:

1. KEYWORDS: read the offer and list for yourself every ATS keyword: exact job title, hard skills, tools, languages, frameworks, methodologies, domain terms, certifications, soft skills.
   ${aggressive
     ? 'Put ALL of them in ATS_MATCHED (the resume must cover every one) and leave ATS_MISSING empty.'
     : 'Split them into those the candidate profile supports (ATS_MATCHED) and those it does not (ATS_MISSING).'}

2. HEADLINE: one line, "<intro> | <job title> | <1-2 key domains of the offer>".
   <intro> is exactly "${HEADLINE_INTRO.fr}" if the offer is in French, "${HEADLINE_INTRO.en}" otherwise.
   <job title> is written as in the offer${aggressive ? '' : ' (drop "Senior", "Lead", "Head of" or similar if the profile does not support that seniority)'}.

3. PROFILE_SUMMARY: 3-4 dense sentences: who the candidate is for THIS role (exact job title), the core ${aggressive ? '' : 'matched '}keywords and tools,
   one concrete achievement, and a last sentence saying the candidate is looking for an end-of-studies internship in this field.

4. SKILLS: exactly 4 categories (e.g. "Langages & Frameworks", "Cloud & IA", "Patterns IA", "Stack complet"), names in the offer's vocabulary, 4-7 items each.
   In each category, list first the ${aggressive ? 'offer' : 'matched'} keywords using the offer's exact spelling, then other profile skills relevant to the role. Omit irrelevant skills.
   Write important acronyms once in both forms, e.g. "Value at Risk (VaR)", "Continuous Integration/Continuous Delivery (CI/CD)".

${experienceRules}

6. KEYWORD REPETITION: the 5-8 core keywords of the offer must each appear in several sections (summary, skills, experience, projects),
   2-4 times in total. Every other ATS_MATCHED keyword appears at least once. Fix gaps before answering.

7. EDUCATION: copy from the profile, most recent first, short (degree • school, dates).

8. PROJECTS: ${PROJECTS_COUNT} projects, one line each, the most relevant to the offer${repos ? `, chosen from <github_projects>:
   - pick by tools, domain and problem solved; prefer repos with a real description
   - name: readable (e.g. "AssisTech — RAG assistant for technicians"), url: the repo URL
   - description: what it does + key tools, rephrased in the offer's vocabulary${aggressive
       ? `; you may add a few offer keywords that fit what the project does (list them in ATS_ADDED)`
       : ', using only facts from the repo description'}
   - if no repo fits the offer, ${aggressive ? 'derive projects from the work described in the profile (url empty)' : 'use projects from the profile, else leave empty'}` : (aggressive
       ? ' (taken or derived from the work described in the profile, url empty)'
       : ' (only projects described in the profile, else empty)')}.

9. TECH_KEYWORDS: list every technology you named anywhere in the resume (Python, FastAPI, Azure OpenAI, Docker…), spelled exactly as in the resume.
   They are printed in bold so a recruiter sees the stack at a glance: name tools explicitly in every bullet.

10. ONE FULL PAGE: the whole resume is ${TARGET_WORDS} words, enough to fill one page without overflowing.
   Compact phrasing ("FastAPI API + LangChain for X", not long sentences). No location fields.

Return JSON with EXACTLY these keys and structure (values shown are descriptions, replace them):
${JSON.stringify(RESUME_SCHEMA, null, 2)}`;

  const letterTask = `Write a concise cover letter for this offer (each paragraph 2-4 sentences), consistent with the tailored resume.
- JOB_TITLE and COMPANY_NAME exactly as written in the offer.
- PARAGRAPH_HOOK: why this role at this company, naming the job title.
- PARAGRAPH_VALUE: the 2-3 experiences that best prove the offer's main requirements, using the offer's exact keywords.
- PARAGRAPH_ALIGNMENT: how the candidate's skills match the team's tools, domain and mission described in the offer.
- PARAGRAPH_CTA: a short, confident call to action.
Return JSON with EXACTLY these keys:
${JSON.stringify(LETTER_SCHEMA, null, 2)}`;

  const userContent = (task: string, extra = '') =>
    `<job_offer>\n${jobOffer}\n</job_offer>\n\n<candidate_profile>\n${profile}\n</candidate_profile>\n\n${extra}${task}`;
  const githubBlock = repos ? `<github_projects>\n${repos}\n</github_projects>\n\n` : '';

  return {
    resumeRequest: { model, max_tokens: 8192, system, messages: [{ role: 'user', content: userContent(resumeTask, githubBlock) }] },
    letterRequest: { model, max_tokens: 2048, system, messages: [{ role: 'user', content: userContent(letterTask) }] }
  };
}

