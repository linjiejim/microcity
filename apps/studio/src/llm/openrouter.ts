import { contentHash } from '@microcity/society';
import { loadLedger, loadPrefs, looksLikeKey, record, saveLedger, type KV } from './prefs.ts';

/**
 * OpenRouter 直连（D71）：浏览器用用户自己的密钥调用，没有服务端中转。
 * 预算闸、答案缓存、逐次记账都在本机。
 */

const BASE = 'https://openrouter.ai/api/v1';
const CACHE_KEY = 'microcity.llm.cache.v1';
const CACHE_MAX = 200;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  purpose: string;
  /** 模板版本：进缓存键，改提示词就升 */
  template: string;
  maxTokens?: number;
  temperature?: number;
  /** 只缓存通过校验的答案 */
  accept?: (text: string) => boolean;
}

export type ChatResult = { ok: true; text: string; cached: boolean; costUsd: number } | { ok: false; reason: 'no_key' | 'budget' | 'http' | 'empty' | 'rejected'; detail: string };

export interface Deps {
  kv: KV;
  fetch: typeof fetch;
  now: () => Date;
}

interface ApiResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string };
}

type Cache = Record<string, string>;

function loadCache(kv: KV): Cache {
  try {
    return JSON.parse(kv.getItem(CACHE_KEY) ?? '{}') as Cache;
  } catch {
    return {};
  }
}

function putCache(kv: KV, key: string, text: string): void {
  const cache = loadCache(kv);
  delete cache[key];
  cache[key] = text;
  const keys = Object.keys(cache);
  for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete cache[k];
  try {
    kv.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 存不下就不缓存
  }
}

const headers = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'MicroCity' });

export async function chat(deps: Deps, req: ChatRequest): Promise<ChatResult> {
  const prefs = loadPrefs(deps.kv);
  const cacheKey = contentHash({ tpl: req.template, model: req.model, messages: req.messages });
  const hit = loadCache(deps.kv)[cacheKey];
  const at = deps.now().toISOString();
  if (hit !== undefined) {
    saveLedger(deps.kv, record(loadLedger(deps.kv), { at, model: req.model, purpose: req.purpose, costUsd: 0, tokens: 0, cached: true }, 0, 0));
    return { ok: true, text: hit, cached: true, costUsd: 0 };
  }
  if (!looksLikeKey(prefs.key)) return { ok: false, reason: 'no_key', detail: '还没有填 OpenRouter 密钥' };
  const ledger = loadLedger(deps.kv);
  if (ledger.costUsd >= prefs.budgetUsd) return { ok: false, reason: 'budget', detail: `本机累计花费 $${ledger.costUsd.toFixed(4)} 已到预算 $${prefs.budgetUsd}` };

  let body: ApiResponse;
  try {
    const res = await deps.fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: headers(prefs.key.trim()),
      body: JSON.stringify({ model: req.model, messages: req.messages, max_tokens: req.maxTokens ?? 200, temperature: req.temperature ?? 0.7, usage: { include: true } }),
    });
    body = (await res.json()) as ApiResponse;
    if (!res.ok) return { ok: false, reason: 'http', detail: `HTTP ${res.status}：${body.error?.message ?? '请求失败'}` };
  } catch (e) {
    return { ok: false, reason: 'http', detail: e instanceof Error ? e.message : String(e) };
  }
  const text = body.choices?.[0]?.message?.content?.trim() ?? '';
  const prompt = body.usage?.prompt_tokens ?? 0;
  const completion = body.usage?.completion_tokens ?? 0;
  const costUsd = body.usage?.cost ?? 0;
  saveLedger(deps.kv, record(loadLedger(deps.kv), { at, model: req.model, purpose: req.purpose, costUsd, tokens: prompt + completion, cached: false }, prompt, completion));
  if (!text) return { ok: false, reason: 'empty', detail: '模型没有返回内容' };
  if (req.accept && !req.accept(text)) return { ok: false, reason: 'rejected', detail: text };
  putCache(deps.kv, cacheKey, text);
  return { ok: true, text, cached: false, costUsd };
}

export interface KeyInfo {
  label: string;
  usage: number;
  limit: number | null;
  remaining: number | null;
}

/** 账户侧的用量与额度（密钥查询接口） */
export async function keyInfo(deps: Pick<Deps, 'fetch'>, key: string): Promise<{ ok: true; info: KeyInfo } | { ok: false; detail: string }> {
  try {
    const res = await deps.fetch(`${BASE}/key`, { headers: headers(key.trim()) });
    const body = (await res.json()) as { data?: { label?: string; usage?: number; limit?: number | null; limit_remaining?: number | null }; error?: { message?: string } };
    if (!res.ok || !body.data) return { ok: false, detail: `HTTP ${res.status}：${body.error?.message ?? '密钥无效'}` };
    return { ok: true, info: { label: body.data.label ?? '', usage: body.data.usage ?? 0, limit: body.data.limit ?? null, remaining: body.data.limit_remaining ?? null } };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** OpenRouter 的模型列表（公开接口，不需要密钥） */
export async function listModels(deps: Pick<Deps, 'fetch'>): Promise<string[]> {
  try {
    const res = await deps.fetch(`${BASE}/models`);
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort();
  } catch {
    return [];
  }
}

export const browserDeps = (): Deps => ({ kv: window.localStorage, fetch: window.fetch.bind(window), now: () => new Date() });
