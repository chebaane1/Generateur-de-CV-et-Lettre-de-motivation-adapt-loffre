// Settings, from .env through docker-compose
import type { Engine } from './types';

const env = process.env;

export const PORT = Number(env.PORT) || 8080;
export const ENGINES: Engine[] = ['claude', 'gemini', 'local'];

// Folders mounted by docker-compose: edits apply without a rebuild
export const PROMPTS_FILE = env.PROMPTS_FILE || '/prompts/prompts.ts';
export const WEB_DIR = env.WEB_DIR || '/app/web';
export const DATA_DIR = env.DATA_DIR || '/data';        // bots.sh writes engines.json here

// Other containers
export const PDF_URL = env.PDF_URL || 'http://pdf:8000';
export const OLLAMA_URL = env.OLLAMA_URL || 'http://ollama:11434';

// Engines
export const CLAUDE_MODEL = env.CLAUDE_MODEL || 'sonnet';
export const GEMINI_API_KEY = env.GEMINI_API_KEY || '';
export const GEMINI_MODEL = env.GEMINI_MODEL || 'gemini-3.6-flash';
export const GEMINI_FALLBACK_MODEL = env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite';

// Timeouts
export const TIMEOUT_MS = 5 * 60 * 1000;
export const LOCAL_TIMEOUT_MS = 30 * 60 * 1000;          // the local model is slow on CPU
