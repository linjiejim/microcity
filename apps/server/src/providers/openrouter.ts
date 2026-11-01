import { createHash, randomUUID } from 'node:crypto';
import { canonical } from '@microcity/sim';
import { config, hasModelAccess } from '../config.ts';
import type { Store } from '../db.ts';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const cacheKey = (parts: unknown): string => sha256(canonical(parts));
export const newCallId = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 12)}`;

export class BudgetGuard {
  constructor(private store: Store) {}

  check(runId: string | null): { ok: true } | { ok: false; reason: string } {
    if (!hasModelAccess()) return { ok: false, reason: 'no_key' };
    const global = this.store.spend();
    if (global >= config.globalBudgetUsd) return { ok: false, reason: `global_budget(${global.toFixed(3)})` };
    if (runId) {
      const run = this.store.spend(runId);
      if (run >= config.runBudgetUsd) return { ok: false, reason: `run_budget(${run.toFixed(3)})` };
    }
    return { ok: true };
  }
}

export interface PostResult<T> {
  ok: boolean;
  status: number;
  body?: T;
  error?: string;
  latencyMs: number;
}

/** 带超时与一次重试（429/5xx）的 POST */
export async function postJson<T>(path: string, payload: unknown, timeoutMs: number): Promise<PostResult<T>> {
  const t0 = performance.now();
  let last: PostResult<T> = { ok: false, status: 0, error: 'not_started', latencyMs: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${config.openrouterBase}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost/microcity',
          'X-Title': 'MicroCity',
        },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
      const text = await res.text();
      let body: T | undefined;
      try {
        body = JSON.parse(text) as T;
      } catch {
        body = undefined;
      }
      last = { ok: res.ok && body !== undefined, status: res.status, ...(body !== undefined ? { body } : {}), ...(res.ok && body !== undefined ? {} : { error: `HTTP ${res.status}: ${text.slice(0, 200)}` }), latencyMs: Math.round(performance.now() - t0) };
      if (last.ok || (res.status < 500 && res.status !== 429)) return last;
    } catch (e) {
      last = { ok: false, status: 0, error: (e as Error).name === 'AbortError' ? 'timeout' : String((e as Error).message), latencyMs: Math.round(performance.now() - t0) };
      if (last.error === 'timeout') return last;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  return last;
}
