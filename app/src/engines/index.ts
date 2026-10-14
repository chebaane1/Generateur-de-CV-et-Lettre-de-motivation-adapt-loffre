// The three AI engines behind one function: ask for a JSON object, get it parsed
import type { Content, Engine, ModelRequest, RunArgs, Runner } from '../types';
import { runClaude } from './claude';
import { runGemini } from './gemini';
import { runOllama } from './ollama';

const RUNNERS: Record<Engine, Runner> = { claude: runClaude, gemini: runGemini, local: runOllama };

// One Claude request at a time, so parallel generations don't burn through your Pro limits at once
let claudeQueue: Promise<unknown> = Promise.resolve();
function queued<T>(job: () => Promise<T>): Promise<T> {
  const next = claudeQueue.then(job, job);
  claudeQueue = next.catch(() => undefined);
  return next;
}

/** Valid JSON text from a model answer (strips code fences and text around the object), or throw */
function cleanJson(text: string): string {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('no JSON object found');
  return JSON.stringify(JSON.parse(t.slice(s, e + 1)));
}

/** Ask the model; if the answer isn't valid JSON, ask it to repair it (up to 2 times) */
async function generateJson(args: RunArgs, run: Runner): Promise<string> {
  let text = await run(args);
  for (let attempt = 0; ; attempt++) {
    try { return cleanJson(text); }
    catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (attempt >= 2) throw new Error('model returned invalid JSON after 2 repairs: ' + reason);
      console.log(`invalid JSON (${reason}), asking for repair #${attempt + 1}`);
      text = await run({
        ...args,
        prompt:
          `The following was supposed to be ONE valid JSON object but failed to parse (${reason}).\n` +
          `Fix it: keep all content, correct the syntax (quotes, commas, braces), remove anything outside the object.\n` +
          `Return ONLY the corrected JSON object.\n\n${text}`
      });
    }
  }
}

/** Send a prompt to the chosen engine and return its answer as a JSON object */
export async function askJson(engine: Engine, request: ModelRequest): Promise<Content> {
  const args: RunArgs = { system: request.system, prompt: request.messages.map(m => m.content).join('\n\n'), model: request.model };
  const job = () => generateJson(args, RUNNERS[engine]);
  return JSON.parse(await (engine === 'claude' ? queued(job) : job()));
}
