import { contentHash, type OptionTrace } from '@microcity/society';
import { loadLedger, loadPrefs, looksLikeKey, record, saveLedger } from './prefs.ts';
import type { Deps } from './openrouter.ts';

/** 改提问的写法就升版本（进缓存键） */
export const SECOND_TEMPLATE_VERSION = 'studio_second_v1';
const CACHE_KEY = 'microcity.llm.second.v1';
const ENDPOINT = 'https://openrouter.ai/api/v1/systemone';

export interface SecondFacts {
  /** 年龄、身份、小传 */
  person: string;
  /** 例如 “周三 18:42，晴” */
  now: string;
  /** 此刻在哪 */
  location: string;
  /** 例如 ['有点饿', '想找人聊聊'] */
  feelings: string[];
}

interface Answer {
  choice?: string;
  probabilities?: Record<string, number>;
}
interface Response {
  answers?: { fit?: Answer };
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
  error?: { message?: string };
}

export type Second = { ok: true; probs: Record<string, number>; top: string; cached: boolean } | { ok: false; detail: string };

/** 决策模型给出的分布可能缺选项：缺的用极小值兜底再归一化 */
export function normalizeProbs(ids: string[], raw: Record<string, number> | undefined): Record<string, number> {
  const p = ids.map((_, i) => Math.max(0, Number(raw?.[`o${i + 1}`] ?? 0)) + 0.005);
  const sum = p.reduce((a, b) => a + b, 0);
  return Object.fromEntries(ids.map((id, i) => [id, Math.round((p[i]! / sum) * 1000) / 1000]));
}

/**
 * 第二意见（D92）：把同一次选择的候选交给决策模型，问“这个人此刻最自然会做哪一个”。
 * 只拿来和规则的概率并排比较，不改世界。决策模型只回答判断，不生成文字。
 */
export async function secondOpinion(deps: Deps, facts: SecondFacts, options: OptionTrace[]): Promise<Second> {
  const prefs = loadPrefs(deps.kv);
  const ids = options.map((o) => o.id);
  const payload = {
    model: prefs.decisionModel,
    state: { person: facts.person, now: facts.now, location: facts.location, how_they_feel: facts.feelings.length ? facts.feelings : ['没有特别缺什么'] },
    questions: {
      fit: {
        type: 'choice',
        instructions: 'Given this person’s age, situation, how they feel right now and the time of day, which option would they most naturally do next? Judge only from the person’s own point of view.',
        criteria: Object.fromEntries(options.map((o, i) => [`o${i + 1}`, o.label])),
      },
    },
  };
  const key = contentHash({ tpl: SECOND_TEMPLATE_VERSION, payload });
  let cache: Record<string, Record<string, number>> = {};
  try {
    cache = JSON.parse(deps.kv.getItem(CACHE_KEY) ?? '{}') as typeof cache;
  } catch {
    cache = {};
  }
  const at = deps.now().toISOString();
  const done = (probs: Record<string, number>, cached: boolean): Second => ({ ok: true, probs, top: ids.reduce((a, b) => (probs[b]! > probs[a]! ? b : a)), cached });
  if (cache[key]) {
    saveLedger(deps.kv, record(loadLedger(deps.kv), { at, model: prefs.decisionModel, purpose: '第二意见', costUsd: 0, tokens: 0, cached: true }, 0, 0));
    return done(cache[key], true);
  }
  if (!looksLikeKey(prefs.key)) return { ok: false, detail: '还没有填 OpenRouter 密钥' };
  const ledger = loadLedger(deps.kv);
  if (ledger.costUsd >= prefs.budgetUsd) return { ok: false, detail: `本机累计花费 $${ledger.costUsd.toFixed(4)} 已到预算 $${prefs.budgetUsd}` };
  let body: Response;
  try {
    const res = await deps.fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${prefs.key.trim()}`, 'Content-Type': 'application/json', 'X-Title': 'MicroCity' }, body: JSON.stringify(payload) });
    body = (await res.json()) as Response;
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}：${body.error?.message ?? '请求失败'}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  const input = body.usage?.input_tokens ?? 0;
  const output = body.usage?.output_tokens ?? 0;
  saveLedger(deps.kv, record(loadLedger(deps.kv), { at, model: prefs.decisionModel, purpose: '第二意见', costUsd: body.usage?.cost ?? 0, tokens: input + output, cached: false }, input, output));
  if (!body.answers?.fit) return { ok: false, detail: '决策模型没有给出判断' };
  const probs = normalizeProbs(ids, body.answers.fit.probabilities);
  const keys = Object.keys(cache);
  for (const k of keys.slice(0, Math.max(0, keys.length - 150))) delete cache[k];
  cache[key] = probs;
  try {
    deps.kv.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 存不下就不缓存
  }
  return done(probs, false);
}
