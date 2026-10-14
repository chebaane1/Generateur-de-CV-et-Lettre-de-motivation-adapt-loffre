// One job offer -> tailored CV + cover letter (PDFs), and PDF rebuilds after edits on the page
import { PDF_URL, PROMPTS_FILE } from './config';
import { askJson } from './engines';
import { errorMessage, postJson } from './http';
import { readProfile } from './profile';
import type { Content, Engine, GenerateResult, PromptsModule, Tailoring } from './types';

/** prompts/prompts.ts, re-read on every offer so edits apply without a restart */
function loadPrompts(): PromptsModule {
  delete require.cache[require.resolve(PROMPTS_FILE)];
  return require(PROMPTS_FILE) as PromptsModule;
}

/** Ask the PDF service to compile a CV or a cover letter; returns the PDF in base64 */
export async function compilePdf(kind: 'resume' | 'letter', content: Content): Promise<string> {
  const route = kind === 'letter' ? 'compile-cover-letter' : 'compile-resume';
  return (await postJson<{ pdf: string }>(`${PDF_URL}/${route}?output=base64`, content)).pdf;
}

/** Plain-text keyword report shown on the page */
function atsReport(resume: Content): string {
  const matched: string[] = resume.ATS_MATCHED || [];
  const missing: string[] = resume.ATS_MISSING || [];
  const added: string[] = resume.ATS_ADDED || [];
  return [
    `ATS keywords covered: ${matched.length}/${matched.length + missing.length}`,
    missing.length ? `Not in your profile: ${missing.join(', ')}` : 'Every keyword of the offer is covered.',
    added.length ? `\nAdded beyond your profile (prepare to talk about these in interviews):\n- ${added.join('\n- ')}` : ''
  ].filter(Boolean).join('\n');
}

/** The whole pipeline. On failure, says which step failed. */
export async function generate(engine: Engine, jobOffer: string, tailoring?: Tailoring): Promise<GenerateResult> {
  let step = 'Profile';
  try {
    const { contact, text: profile } = readProfile();
    step = 'Prompts';
    const { resumeRequest, letterRequest } = await loadPrompts().buildPrompts({ jobOffer, engine, tailoring, profile });

    step = 'CV (AI)';
    const resume = await askJson(engine, resumeRequest);
    resume.PROFILE_SUMMARY = resume.PROFILE_SUMMARY || resume.summary || '';
    resume.personal_information = contact;      // your details from profile.md, never the AI's
    step = 'CV (PDF)';
    const resumePdf = await compilePdf('resume', resume);

    step = 'Cover letter (AI)';
    const letter = await askJson(engine, letterRequest);
    letter.personal_information = contact;      // the sender
    step = 'Cover letter (PDF)';
    const letterPdf = await compilePdf('letter', letter);

    return {
      ok: true, engine, resumePdf, letterPdf, atsReport: atsReport(resume),
      headline: resume.HEADLINE, company: letter.COMPANY_NAME, jobTitle: letter.JOB_TITLE,
      resume, letter
    };
  } catch (e) {
    console.error(`generate failed at ${step}:`, errorMessage(e));
    return { ok: false, step, error: errorMessage(e) };
  }
}
