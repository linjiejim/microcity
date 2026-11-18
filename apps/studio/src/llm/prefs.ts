/**
 * 模型设置与本机用量（D71–D73）。
 * 密钥只存在本机浏览器的 localStorage，只发往 openrouter.ai。
 */

export const MODEL_PRESETS = {
  /** 决策模型：只回答语义因子，不生成文本；M4 接入选择点 */
  decision: 'typesafe/jev-1.13',
  /** 语言模型：只负责表达（独白、对话、报告） */
  language: 'deepseek/deepseek-v4-flash',
} as const;

export interface LlmPrefs {
  key: string;
  decisionModel: string;
  languageModel: string;
  /** 本机预算闸（美元）：累计花费超过它就不再调用 */
  budgetUsd: number;
}

export interface LedgerEntry {
  at: string;
  model: string;
  purpose: string;
  costUsd: number;
  tokens: number;
  cached: boolean;
}

export interface Ledger {
  calls: number;
  cacheHits: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  recent: LedgerEntry[];
}

const PREFS_KEY = 'microcity.llm.prefs.v1';
const LEDGER_KEY = 'microcity.llm.ledger.v1';

export const DEFAULT_PREFS: LlmPrefs = { key: '', decisionModel: MODEL_PRESETS.decision, languageModel: MODEL_PRESETS.language, budgetUsd: 0.5 };
export const EMPTY_LEDGER: Ledger = { calls: 0, cacheHits: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, recent: [] };

/** 存储可以替换（测试用内存实现） */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function read<T>(kv: KV, key: string, fallback: T): T {
  try {
    const raw = kv.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

export const loadPrefs = (kv: KV): LlmPrefs => read(kv, PREFS_KEY, DEFAULT_PREFS);
export const savePrefs = (kv: KV, p: LlmPrefs): void => kv.setItem(PREFS_KEY, JSON.stringify(p));
export const loadLedger = (kv: KV): Ledger => read(kv, LEDGER_KEY, EMPTY_LEDGER);
export const saveLedger = (kv: KV, l: Ledger): void => kv.setItem(LEDGER_KEY, JSON.stringify(l));
export const clearLedger = (kv: KV): void => kv.removeItem(LEDGER_KEY);

export function record(l: Ledger, e: LedgerEntry, prompt: number, completion: number): Ledger {
  return {
    calls: l.calls + (e.cached ? 0 : 1),
    cacheHits: l.cacheHits + (e.cached ? 1 : 0),
    promptTokens: l.promptTokens + prompt,
    completionTokens: l.completionTokens + completion,
    costUsd: Math.round((l.costUsd + e.costUsd) * 1e6) / 1e6,
    recent: [e, ...l.recent].slice(0, 30),
  };
}

/** 密钥的样子对不对（OpenRouter 的密钥以 sk-or- 开头） */
export const looksLikeKey = (key: string): boolean => /^sk-or-[A-Za-z0-9_-]{16,}$/.test(key.trim());
export const maskKey = (key: string): string => (key.length > 14 ? `${key.slice(0, 9)}…${key.slice(-4)}` : key ? '…' : '');
