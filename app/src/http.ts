import http from 'node:http';
import { TIMEOUT_MS } from './config';

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * POST JSON to another container and parse the JSON answer.
 * Plain http (not fetch): the local model can take longer than fetch's 5-minute header timeout.
 */
export function postJson<T = any>(url: string, payload: unknown, timeout = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout
    }, res => {
      let out = '';
      res.on('data', chunk => (out += chunk));
      res.on('end', () => {
        let data: any;
        try { data = JSON.parse(out); } catch { return reject(new Error(`HTTP ${res.statusCode}: ${out.slice(0, 300)}`)); }
        if ((res.statusCode ?? 500) >= 400) return reject(new Error(String(data.detail || data.error || `HTTP ${res.statusCode}`)));
        resolve(data as T);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(body);
  });
}
