// 实验脚本直接问 Jev / DeepSeek：走主库的缓存、预算闸与记账（与服务端同一套）
import { config } from '../../apps/server/src/config.ts';
import type { Store } from '../../apps/server/src/db.ts';
import { BudgetGuard, cacheKey, newCallId, postJson } from '../../apps/server/src/providers/openrouter.ts';

export interface JevAnswer {
  type: 'noul' | 'choice' | 'score';
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
}
interface JevResponse {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: { cost?: number };
  error?: { message?: string };
}

/** 一次 Jev 调用；tpl 是这套实验问题的版本（进缓存键）。bypass = 不读缓存（测 Jev 自身波动） */
export async function askJev(store: Store, p: { tpl: string; purpose: string; state: unknown; questions: Record<string, unknown>; bypass?: boolean; tag?: string }): Promise<{ answers: Record<string, JevAnswer>; cost: number; cached: boolean } | { error: string }> {
  const payload = { model: config.jevModel, state: p.state, questions: p.questions };
  const key = cacheKey({ provider: 'jev', model: config.jevModel, tpl: p.tpl, payload, ...(p.tag ? { tag: p.tag } : {}) });
  const id = newCallId('jev');
  const runId = `lab:${p.purpose}`;
  if (!p.bypass) {
    const hit = store.cacheGet(key);
    if (hit) {
      store.logModelCall({ id, run_id: runId, provider: 'jev', model: config.jevModel, purpose: p.purpose, cache_key: key, request: JSON.stringify(payload), response: hit, cost_usd: 0, latency_ms: 0, cached: 1, error: null });
      return { answers: (JSON.parse(hit) as JevResponse).answers ?? {}, cost: 0, cached: true };
    }
  }
  const b = new BudgetGuard(store).check(null);
  if (!b.ok) return { error: b.reason };
  const res = await postJson<JevResponse>('/v1/systemone', payload, config.jevTimeoutMs);
  const cost = res.body?.usage?.cost ?? 0;
  const err = !res.ok || !res.body?.answers ? (res.error ?? res.body?.error?.message ?? 'bad_response') : null;
  store.logModelCall({ id, run_id: runId, provider: 'jev', model: res.body?.model ?? config.jevModel, purpose: p.purpose, cache_key: key, request: JSON.stringify(payload), response: res.body ? JSON.stringify(res.body) : null, cost_usd: cost, latency_ms: res.latencyMs, cached: 0, error: err });
  if (err) return { error: err };
  if (!p.bypass) store.cachePut(key, 'jev', res.body!.model ?? config.jevModel, JSON.stringify(res.body));
  return { answers: res.body!.answers!, cost, cached: false };
}

/** 并发上限内跑一批异步任务 */
export async function pmap<T, R>(xs: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= xs.length) return;
        out[i] = await f(xs[i]!, i);
      }
    }),
  );
  return out;
}
