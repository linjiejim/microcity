import { describeSlots, rand, type DomainEvent, type WorldState } from '@microcity/sim';
import { config } from '../config.ts';
import type { Store } from '../db.ts';
import { BudgetGuard, cacheKey, newCallId, postJson } from './openrouter.ts';

export interface DialogueLine {
  speaker: string;
  text: string;
}
export interface Dialogue {
  convId: string;
  lines: DialogueLine[];
  model: string;
  validated: boolean;
  source: 'model' | 'template' | 'cache';
}

type Conversation = Extract<DomainEvent, { type: 'conversation' }>;

const SMALLTALK: Record<string, string[]> = {
  residence: ['今天吃什么？', '这两天挺累的。', '明早记得叫我。', '菜快吃完了。'],
  cafe: ['老样子来一杯？', '今天人不少啊。', '这块点心不错。'],
  restaurant: ['今天的汤不错。', '中午挺忙的吧？'],
  park: ['今天天气不错。', '走两圈再回去。'],
  plaza: ['又碰上了！', '最近怎么样？'],
  library: ['在看什么书？', '这边挺安静的。'],
  default: ['最近还好吧？', '忙着呢。', '回头聊。'],
};

/** 模板台词：只复述交换的槽位，不添加细节 */
export function templateDialogue(conv: Conversation, s: WorldState, placeKind: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  const [a, b] = conv.participants;
  const pool = SMALLTALK[placeKind] ?? SMALLTALK.default!;
  lines.push({ speaker: a!, text: pool[Math.floor(rand(1, conv.id, 'st') * pool.length)]! });
  for (const x of conv.exchanges.filter((e) => e.mentioned)) {
    const v = x.versionId ? s.versions[x.versionId] : undefined;
    const fact = v ? describeSlots(v.slots) : '有件事';
    lines.push({ speaker: x.from, text: `对了，${fact}。` });
    const li = s.agents[x.to];
    const skeptic = li && li.trustGov < 0.5;
    lines.push({ speaker: x.to, text: skeptic ? '真的假的？我回头查查。' : '好，我记下了。' });
  }
  if (lines.length === 1) lines.push({ speaker: b!, text: '嗯，是啊。' });
  return lines;
}

const TIME_RE = /(\d{1,2})[:：](\d{2})/g;
/** 口语里的钟点：“两点”“四点半”“下午3点” */
const SPOKEN_TIME_RE = /[0-9一二三四五六七八九十两]+\s*点/;

/** 生成台词不得超出所交换的槽位：出现事实里没有的时刻或“全天”即判无效 */
export function validateLines(lines: DialogueLine[], facts: string[], participants: string[]): boolean {
  if (lines.length === 0 || lines.length > 8) return false;
  const factText = facts.join(' ');
  const allowedTimes = new Set([...factText.matchAll(TIME_RE)].map((m) => `${Number(m[1])}:${m[2]}`));
  const allDayAllowed = /全天|一整天/.test(factText);
  for (const l of lines) {
    if (!participants.includes(l.speaker) || typeof l.text !== 'string' || l.text.length === 0 || l.text.length > 90) return false;
    for (const m of l.text.matchAll(TIME_RE)) if (!allowedTimes.has(`${Number(m[1])}:${m[2]}`)) return false;
    // 事实里没有精确时刻时，不许在口语里凭空说出几点
    if (allowedTimes.size === 0 && SPOKEN_TIME_RE.test(l.text)) return false;
    if (!allDayAllowed && /全天|一整天|整天/.test(l.text)) return false;
  }
  return true;
}

interface ChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
}

/** DeepSeek Flash 台词渲染：只供展示，不回流到世界状态与居民记忆（spec D12） */
export class DialogueRenderer {
  private budget: BudgetGuard;
  private inflight = new Map<string, Promise<Dialogue>>();
  constructor(private store: Store) {
    this.budget = new BudgetGuard(store);
  }

  render(runId: string, conv: Conversation, s: WorldState, placeKind: string, placeName: string, timeLabel: string): Promise<Dialogue> {
    const k = `${runId}:${conv.id}`;
    const existing = this.inflight.get(k);
    if (existing) return existing;
    const p = this.doRender(runId, conv, s, placeKind, placeName, timeLabel).finally(() => this.inflight.delete(k));
    this.inflight.set(k, p);
    return p;
  }

  private async doRender(runId: string, conv: Conversation, s: WorldState, placeKind: string, placeName: string, timeLabel: string): Promise<Dialogue> {
    const cached = this.store.dialogue(runId, conv.id);
    if (cached) return { convId: conv.id, lines: cached.lines as DialogueLine[], model: cached.model, validated: cached.validated, source: 'cache' };
    const template = templateDialogue(conv, s, placeKind);
    const facts = conv.exchanges.filter((e) => e.mentioned).map((e) => {
      const v = e.versionId ? s.versions[e.versionId] : undefined;
      return v ? describeSlots(v.slots, { withSource: true }) : '';
    });
    const b = this.budget.check(runId);
    if (!b.ok) {
      this.store.saveDialogue(runId, conv.id, template, 'template', 0, true);
      return { convId: conv.id, lines: template, model: 'template', validated: true, source: 'template' };
    }
    const people = conv.participants.map((id) => {
      const a = s.agents[id]!;
      return { id, name: a.name, age: a.age, role: a.roleLabel, speech: a.speech };
    });
    const exchanges = conv.exchanges
      .filter((e) => e.mentioned)
      .map((e, i) => ({ from: e.from, to: e.to, fact: facts[i] }));
    const system =
      '你是像素小镇里的“台词渲染器”。根据人物、地点和要交流的事实，写 2–6 句自然的中文对话。' +
      '严格规则：1) 只能说出“事实”里给出的信息，不得新增时间、地点、原因、数字等任何细节；2) 没有事实时只写一两句日常寒暄；' +
      '3) 贴合每个人的口语风格，每句不超过 40 字；4) 只输出 JSON：{"lines":[{"speaker":"<人物id>","text":"..."}]}。';
    const user = JSON.stringify({ 地点: placeName, 时间: timeLabel, 人物: people, 事实: exchanges.length ? exchanges : '无（只是闲聊）' });
    const payload = {
      model: config.genModel,
      temperature: 0.8,
      max_tokens: 400,
      reasoning: { enabled: false },
      usage: { include: true },
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    const key = cacheKey({ provider: 'deepseek', payload });
    const callId = newCallId('gen');
    const res = await postJson<ChatResponse>('/v1/chat/completions', payload, 30_000);
    const cost = res.body?.usage?.cost ?? 0;
    let lines: DialogueLine[] = template;
    let validated = false;
    let error: string | null = res.ok ? null : res.error ?? 'error';
    if (res.ok) {
      try {
        const content = res.body?.choices?.[0]?.message?.content ?? '';
        const json = JSON.parse(content.replace(/^```(?:json)?|```$/g, '').trim()) as { lines?: DialogueLine[] };
        const candidate = (json.lines ?? []).map((l) => ({ speaker: String(l.speaker), text: String(l.text).trim() }));
        if (validateLines(candidate, facts, conv.participants)) {
          lines = candidate;
          validated = true;
        } else error = 'validation_failed';
      } catch (e) {
        error = `parse: ${(e as Error).message}`;
      }
    }
    this.store.logModelCall({ id: callId, run_id: runId, provider: 'deepseek', model: res.body?.model ?? config.genModel, purpose: 'dialogue', cache_key: key, request: JSON.stringify(payload), response: res.body ? JSON.stringify(res.body) : null, cost_usd: cost, latency_ms: res.latencyMs, cached: 0, error });
    const model = validated ? res.body?.model ?? config.genModel : 'template';
    this.store.saveDialogue(runId, conv.id, lines, model, cost, true);
    return { convId: conv.id, lines, model, validated: true, source: validated ? 'model' : 'template' };
  }
}
