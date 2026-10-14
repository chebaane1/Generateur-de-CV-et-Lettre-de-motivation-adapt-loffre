// Claude Code headless, logged in with your Pro plan (CLAUDE_CODE_OAUTH_TOKEN)
import { spawn } from 'node:child_process';
import { CLAUDE_MODEL, TIMEOUT_MS } from '../config';
import type { RunArgs } from '../types';

export function runClaude({ system, prompt, model }: RunArgs): Promise<string> {
  return new Promise((resolve, reject) => {
    // --tools "": text only. With tools on, the model sometimes tries one and hits --max-turns 1 (an error with no text)
    const args = ['-p', '--output-format', 'json', '--max-turns', '1', '--tools', '', '--no-session-persistence',
      '--model', model || CLAUDE_MODEL];
    if (system) args.push('--system-prompt', system);

    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;   // make sure the subscription is used, not API billing

    const proc = spawn('claude', args, { env });
    let out = '', err = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Claude Code timed out')); }, TIMEOUT_MS);

    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', d => (err += d));
    proc.on('close', code => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(out);
        if (res.is_error) return reject(new Error(`Claude Code returned an error (${res.subtype || 'unknown'}): ${res.result || ''}`.trim()));
        resolve(res.result);
      } catch {
        reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 500)}`));
      }
    });
    proc.stdin.end(prompt);
  });
}
