import { config } from '../config.ts';
import type { Store } from '../db.ts';
import { BudgetGuard, cacheKey, newCallId, postJson } from './openrouter.ts';

interface ChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
}

export type ChatResult<T> =
  | { ok: true; data: T; model: string; cost: number; callId: string; cached: boolean; latencyMs: number }
  | { ok: false; error: string; model: string; cost: number; callId: string; latencyMs: number };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 生成模型（DeepSeek Flash）的 JSON 调用：预算闸 → 答案缓存 → 请求 → 解析 → 记账。
 * 用于建镇对话、实验报告、独白。模型只产出文字/补丁，校验与落地由调用方负责。
 */
export class ChatClient {
  private budget: BudgetGuard;
  constructor(private store: Store) {
    this.budget = new BudgetGuard(store);
  }

  /** accept：调用方的校验；只有通过校验的答案才进缓存（校验失败的答案下次会重新请求） */
  async json<T>(p: { runId: string | null; purpose: string; tpl: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number; cache?: boolean; accept?: (data: T) => boolean }): Promise<ChatResult<T>> {
    const payload = {
      model: config.genModel,
      temperature: p.temperature ?? 0.4,
      max_tokens: p.maxTokens ?? 1600,
      reasoning: { enabled: false },
      usage: { include: true },
      response_format: { type: 'json_object' },
      messages: p.messages,
    };
    const key = cacheKey({ provider: 'deepseek', tpl: p.tpl, payload });
    const callId = newCallId('gen');
    if (p.cache !== false) {
      const hit = this.store.cacheGet(key);
      if (hit) {
        const parsed = parseContent<T>(hit);
        if (parsed.ok && (!p.accept || p.accept(parsed.data))) {
          this.store.logModelCall({ id: callId, run_id: p.runId, provider: 'deepseek', model: config.genModel, purpose: p.purpose, cache_key: key, request: JSON.stringify(payload), response: hit, cost_usd: 0, latency_ms: 0, cached: 1, error: null });
          return { ok: true, data: parsed.data, model: config.genModel, cost: 0, callId, cached: true, latencyMs: 0 };
        }
      }
    }
    const b = this.budget.check(p.runId);
    if (!b.ok) return { ok: false, error: b.reason, model: config.genModel, cost: 0, callId, latencyMs: 0 };
    const res = await postJson<ChatResponse>('/v1/chat/completions', payload, 60_000);
    const cost = res.body?.usage?.cost ?? 0;
    const model = res.body?.model ?? config.genModel;
    const content = res.body?.choices?.[0]?.message?.content ?? '';
    let error: string | null = res.ok ? null : (res.error ?? 'error');
    let data: T | undefined;
    if (res.ok) {
      const parsed = parseContent<T>(content);
      if (parsed.ok) data = parsed.data;
      else error = parsed.error;
    }
    this.store.logModelCall({ id: callId, run_id: p.runId, provider: 'deepseek', model, purpose: p.purpose, cache_key: key, request: JSON.stringify(payload), response: res.body ? JSON.stringify(res.body) : null, cost_usd: cost, latency_ms: res.latencyMs, cached: 0, error });
    if (data === undefined) return { ok: false, error: error ?? 'empty', model, cost, callId, latencyMs: res.latencyMs };
    if (p.cache !== false && (!p.accept || p.accept(data))) this.store.cachePut(key, 'deepseek', model, content);
    return { ok: true, data, model, cost, callId, cached: false, latencyMs: res.latencyMs };
  }
}

function parseContent<T>(content: string): { ok: true; data: T } | { ok: false; error: string } {
  try {
    const trimmed = content.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    return { ok: true, data: JSON.parse(trimmed) as T };
  } catch (e) {
    return { ok: false, error: `parse: ${(e as Error).message}` };
  }
}
