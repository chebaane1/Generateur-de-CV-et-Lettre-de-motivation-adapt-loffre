export type Engine = 'claude' | 'gemini' | 'local';
export type Tailoring = 'aggressive' | 'strict';

/** A JSON object written by the AI (CV or cover letter). Its shape is described in prompts/prompts.ts. */
export type Content = Record<string, any>;

/** Messages-API-style request built by prompts/prompts.ts */
export interface ModelRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: 'user'; content: string }[];
}

export interface Prompts {
  resumeRequest: ModelRequest;
  letterRequest: ModelRequest;
}

/** What prompts/prompts.ts exports */
export interface PromptsModule {
  buildPrompts(args: { jobOffer: string; engine: Engine; tailoring?: Tailoring }): Promise<Prompts>;
}

/** One call to an AI engine; returns the raw text answer */
export interface RunArgs {
  system: string;
  prompt: string;
  model: string;
}
export type Runner = (args: RunArgs) => Promise<string>;

export type GenerateResult =
  | {
      ok: true;
      engine: Engine;
      resumePdf: string;      // base64
      letterPdf: string;      // base64
      atsReport: string;
      headline: string;
      company: string;
      jobTitle: string;
      resume: Content;        // the content, so the page can edit it and rebuild the PDF
      letter: Content;
    }
  | { ok: false; step: string; error: string };
