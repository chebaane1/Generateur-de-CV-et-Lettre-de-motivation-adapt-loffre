// Gemini API (GEMINI_API_KEY): 3 tries on the main model, then 2 on the fallback
// (free keys often get "high demand" 503s or quota 429s)
import { GEMINI_API_KEY, GEMINI_FALLBACK_MODEL, GEMINI_MODEL, TIMEOUT_MS } from '../config';
import { errorMessage } from '../http';
import type { RunArgs } from '../types';

const RETRYABLE_STATUS = [429, 500, 503];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Attempt = { text: string } | { error: Error; retry: boolean };
interface GeminiResponse { candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[] }

async function callOnce(model: string, body: string): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    return { error: new Error(`Gemini ${model}: ${errorMessage(e)}`), retry: true };   // network error
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    return { error: new Error(`Gemini ${model} HTTP ${res.status}: ${detail}`), retry: RETRYABLE_STATUS.includes(res.status) };
  }
  const data = (await res.json()) as GeminiResponse;
  const cand = data.candidates?.[0];
  if (cand?.finishReason === 'MAX_TOKENS') return { error: new Error('Gemini hit its max output tokens'), retry: false };
  const text = (cand?.content?.parts || []).map(p => p.text || '').join('');
  return text ? { text } : { error: new Error(`Gemini ${model} returned no text (${cand?.finishReason || 'unknown'})`), retry: true };
}

export async function runGemini({ system, prompt, model }: RunArgs): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set in .env');
  const body = JSON.stringify({
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' }
  });

  let lastError = new Error('Gemini: no attempt made');
  const plan: [string, number][] = [[model || GEMINI_MODEL, 3], [GEMINI_FALLBACK_MODEL, 2]];
  for (const [m, tries] of plan) {
    for (let i = 0; i < tries; i++) {
      const attempt = await callOnce(m, body);
      if ('text' in attempt) return attempt.text;
      lastError = attempt.error;
      if (!attempt.retry) throw lastError;
      console.log(lastError.message.split('\n')[0], '- retrying');
      await sleep(5000);
    }
  }
  throw lastError;
}
