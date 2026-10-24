// Ollama: the local open-source model (OLLAMA_MODEL), JSON mode
import { LOCAL_TIMEOUT_MS, OLLAMA_URL } from '../config';
import { postJson } from '../http';
import type { RunArgs } from '../types';

interface OllamaChat { message?: { content?: string }; done_reason?: string }

export async function runOllama({ system, prompt, model }: RunArgs): Promise<string> {
  const res = await postJson<OllamaChat>(`${OLLAMA_URL}/api/chat`, {
    model, stream: false, format: 'json',
    options: { num_ctx: 8192, num_predict: 4096, temperature: 0.3 },
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }]
  }, LOCAL_TIMEOUT_MS).catch((e: Error) => {
    throw /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(e.message)
      ? new Error('the ollama container is not running (./bots.sh local)') : e;
  });
  if (res.done_reason === 'length') throw new Error('the local model hit its max output tokens');
  return res.message?.content || '';
}
