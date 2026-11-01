import { r3, type DecisionRequest, type SemanticAnswer } from '@microcity/sim';
import { config } from '../config.ts';
import type { Store } from '../db.ts';
import { BudgetGuard, cacheKey, newCallId, postJson } from './openrouter.ts';

/** 问题模板版本：改动模板必须升版本，缓存键随之变化 */
export const JEV_TEMPLATE_VERSION = 'jev_tpl_v2';

interface JevAnswer {
  type: 'noul' | 'choice' | 'score';
  noul?: number;
  choice?: string;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}
interface JevResponse {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
  error?: { message?: string };
}

/**
 * Jev 只回答“语义因子”：候选的人格契合度、担心程度、是否想先查证、会不会主动发消息。
 * 选择本身由效用 + 抽样完成（spec D11）。state 只含此人主观可见的信息。
 */
export function buildJevPayload(req: DecisionRequest): { state: unknown; questions: Record<string, unknown>; optionIds: string[] } {
  const obs = req.observation;
  const state = {
    person: obs.person,
    now: obs.now,
    location: obs.location,
    current_activity: obs.activity,
    what_they_believe: obs.belief,
    ...(obs.pastExperience?.length ? { their_past_experience_with_outages: obs.pastExperience } : {}),
    ...(req.kind === 'reaction' ? { their_plans_that_may_be_affected: obs.atRisk } : { contacts_not_nearby: obs.contacts }),
  };
  const questions: Record<string, unknown> = {
    concern: {
      type: 'score',
      instructions: 'Based on what this person believes, how worried are they about the outage affecting their own plans or people close to them?',
      criteria: ['Not worried at all', 'Slightly worried', 'Moderately worried', 'Quite worried', 'Very worried'],
    },
  };
  const optionIds: string[] = [];
  if (req.kind === 'reaction') {
    const criteria: Record<string, string> = {};
    req.candidates.forEach((c, i) => {
      criteria[`o${i + 1}`] = c.label;
      optionIds.push(c.id);
    });
    questions.fit = {
      type: 'choice',
      instructions: 'Given this person’s personality, situation and what they believe, which option would they most naturally take right now? Judge only from the person’s own point of view.',
      criteria,
    };
    questions.verify_need = {
      type: 'noul',
      instructions: 'Would this person want to confirm the exact time or details before changing any plans?',
    };
  } else {
    req.candidates.forEach((c, i) => {
      if (c.kind !== 'dm') return;
      const contact = obs.contacts?.find((x) => `dm:${x.id}` === c.id);
      questions[`msg_${i}`] = {
        type: 'noul',
        instructions: `Would this person proactively send a message to ${contact?.name ?? 'this contact'} (${contact?.relation ?? 'contact'}${contact?.livesOrWorksInArea ? ', who lives or works in the affected area' : ''}) to tell them about this?`,
      };
      optionIds[i] = c.id;
    });
  }
  return { state, questions, optionIds };
}

export class JevProvider {
  private budget: BudgetGuard;
  /** 实验脚本用：每次拿到答案（含缓存命中与回退）后回调，用于逐决策对比 */
  observer?: (req: DecisionRequest, ans: SemanticAnswer, runId: string) => void;
  constructor(private store: Store) {
    this.budget = new BudgetGuard(store);
  }

  async answer(req: DecisionRequest, runId: string, opts: { bypassCache?: boolean } = {}): Promise<SemanticAnswer> {
    const ans = await this.answerRaw(req, runId, opts);
    this.observer?.(req, ans, runId);
    return ans;
  }

  private async answerRaw(req: DecisionRequest, runId: string, opts: { bypassCache?: boolean }): Promise<SemanticAnswer> {
    const { state, questions, optionIds } = buildJevPayload(req);
    const payload = { model: config.jevModel, state, questions };
    const key = cacheKey({ provider: 'jev', model: config.jevModel, tpl: JEV_TEMPLATE_VERSION, payload });
    const callId = newCallId('jev');
    const fallback = (reason: string, cost = 0, latencyMs = 0): SemanticAnswer => ({ ...req.semanticRule, provider: 'jev', model: 'rule-fallback', callIds: [callId], fallback: reason, cost, latencyMs });

    if (!opts.bypassCache) {
      const hit = this.store.cacheGet(key);
      if (hit) {
        const parsed = this.parse(req, JSON.parse(hit) as JevResponse, optionIds);
        this.store.logModelCall({ id: callId, run_id: runId, provider: 'jev', model: parsed.model, purpose: req.kind, cache_key: key, request: JSON.stringify(payload), response: hit, cost_usd: 0, latency_ms: 0, cached: 1, error: null });
        return { ...parsed, callIds: [callId], cached: true, cost: 0, latencyMs: 0 };
      }
    }
    const b = this.budget.check(runId);
    if (!b.ok) {
      this.store.logModelCall({ id: callId, run_id: runId, provider: 'jev', model: config.jevModel, purpose: req.kind, cache_key: key, request: JSON.stringify(payload), response: null, cost_usd: 0, latency_ms: 0, cached: 0, error: b.reason });
      return fallback(b.reason);
    }
    const res = await postJson<JevResponse>('/v1/systemone', payload, config.jevTimeoutMs);
    const cost = res.body?.usage?.cost ?? 0;
    if (!res.ok || !res.body?.answers) {
      const err = res.error ?? res.body?.error?.message ?? 'bad_response';
      this.store.logModelCall({ id: callId, run_id: runId, provider: 'jev', model: config.jevModel, purpose: req.kind, cache_key: key, request: JSON.stringify(payload), response: res.body ? JSON.stringify(res.body) : null, cost_usd: cost, latency_ms: res.latencyMs, cached: 0, error: err });
      return fallback(err.startsWith('timeout') ? 'timeout' : 'error', cost, res.latencyMs);
    }
    const raw = JSON.stringify(res.body);
    this.store.cachePut(key, 'jev', res.body.model ?? config.jevModel, raw);
    const parsed = this.parse(req, res.body, optionIds);
    this.store.logModelCall({ id: callId, run_id: runId, provider: 'jev', model: parsed.model, purpose: req.kind, cache_key: key, request: JSON.stringify(payload), response: raw, cost_usd: cost, latency_ms: res.latencyMs, cached: 0, error: null });
    return { ...parsed, callIds: [callId], cached: false, cost, latencyMs: res.latencyMs };
  }

  private parse(req: DecisionRequest, body: JevResponse, optionIds: string[]): SemanticAnswer {
    const a = body.answers ?? {};
    const out: SemanticAnswer = { provider: 'jev', model: body.model ?? config.jevModel, callIds: [] };
    const concern = a.concern?.score;
    out.concern = typeof concern === 'number' ? r3(Math.max(0, Math.min(1, concern / 4))) : req.semanticRule.concern ?? 0.4;
    if (req.kind === 'reaction') {
      const probs = a.fit?.probabilities ?? {};
      const fit: Record<string, number> = {};
      let sum = 0;
      optionIds.forEach((cid, i) => {
        const p = Math.max(0, Number(probs[`o${i + 1}`] ?? 0));
        fit[cid] = p;
        sum += p;
      });
      // Jev 给出的分布可能不含全部选项：缺失者用极小值兜底，再归一化
      for (const cid of optionIds) fit[cid] = r3(sum > 0 ? (fit[cid]! + 0.01) / (sum + 0.01 * optionIds.length) : 1 / optionIds.length);
      out.fit = fit;
      out.verifyNeed = typeof a.verify_need?.noul === 'number' ? r3(a.verify_need.noul) : req.semanticRule.verifyNeed ?? 0.3;
    } else {
      const wm: Record<string, number> = {};
      optionIds.forEach((cid, i) => {
        if (!cid) return;
        const v = a[`msg_${i}`]?.noul;
        wm[cid] = typeof v === 'number' ? r3(v) : req.semanticRule.wouldMessage?.[cid] ?? 0.5;
      });
      out.wouldMessage = wm;
    }
    return out;
  }
}
