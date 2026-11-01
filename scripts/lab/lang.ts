// C3 中英模板：从 C2 的真实决策请求里抽 60 条，比较四种问法下 Jev 的回答
// en_zh（现用：英文指令 + 中文内容）、zh_zh（中文指令）、en_en（内容由 DeepSeek 译成英文）、retest（现用问法再问一遍）
// 用法：node --import tsx --no-warnings scripts/lab/lang.ts [run|analyze]（dev 服务要先停；先跑 jev-pairs）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { r3, rand, scoreNotify, scoreReaction, town30, type Agent, type DecisionRequest, type SemanticAnswer } from '@microcity/sim';
import { buildJevPayload } from '../../apps/server/src/providers/jev.ts';
import { ChatClient } from '../../apps/server/src/providers/chat.ts';
import { askJev, pmap, type JevAnswer } from './jev-call.ts';
import { openLab } from './lab-db.ts';
import type { Pair } from './jev-pairs.ts';

const RAW = 'data/lab/c3-lang.json';
const SUMMARY = 'docs/experiments/results/c3-lang.json';
const TPL = 'lang_v1';
const VARIANTS = ['en_zh', 'zh_zh', 'en_en', 'retest'] as const;
type Variant = (typeof VARIANTS)[number];

function sample(): Pair[] {
  const pairs = readFileSync('data/lab/c2-pairs.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Pair).filter((p) => !p.jev.fallback);
  // 去重（同一观察只取一条），再按确定性随机数排序抽取
  const seen = new Set<string>();
  const uniq = pairs.filter((p) => {
    const k = JSON.stringify([p.kind, p.observation]);
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const pick = (kind: string, n: number) => uniq.filter((p) => p.kind === kind && (kind === 'reaction' ? p.candidates.length >= 3 : p.candidates.length >= 2)).map((p, i) => ({ p, u: rand(7, 'lang', kind, i, p.agent, p.t) })).sort((a, b) => a.u - b.u).slice(0, n).map((x) => x.p);
  return [...pick('reaction', 40), ...pick('notify', 20)];
}

/** 中文指令版：与英文版逐句对应 */
function zhQuestions(q: Record<string, any>, p: Pair): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (k === 'concern') out[k] = { ...v, instructions: '根据此人所相信的内容，他/她有多担心这次停电影响自己或亲近之人的安排？', criteria: ['一点也不担心', '有点担心', '比较担心', '相当担心', '非常担心'] };
    else if (k === 'fit') out[k] = { ...v, instructions: '考虑此人的性格、处境和所相信的内容，他/她此刻最自然会选哪一项？只从此人自己的角度判断。' };
    else if (k === 'verify_need') out[k] = { ...v, instructions: '在改变任何安排之前，此人会想先确认具体的时间或细节吗？' };
    else if (k.startsWith('msg_')) {
      const i = Number(k.slice(4));
      const c = p.candidates[i]!;
      const contact = p.observation.contacts?.find((x) => `dm:${x.id}` === c.id);
      out[k] = { ...v, instructions: `此人会主动给${contact?.name ?? '这位联系人'}（${contact?.relation ?? '联系人'}${contact?.livesOrWorksInArea ? '，住在或工作在受影响的区域' : ''}）发消息，告诉对方这件事吗？` };
    } else out[k] = v;
  }
  return out;
}

const CJK = /[一-鿿]/;

/** 只翻译含中文的字符串叶子（结构原样保留），译文按原顺序放回 */
async function translate(chat: ChatClient, obj: unknown): Promise<unknown> {
  const strs: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (CJK.test(v) && !strs.includes(v)) strs.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(obj);
  if (!strs.length) return obj;
  const ok = (d: { out?: unknown } | undefined): d is { out: string[] } => Array.isArray(d?.out) && d.out.length === strs.length && d.out.every((x) => typeof x === 'string' && !CJK.test(x));
  let out: string[] | undefined;
  for (const temperature of [0, 0.3, 0.6]) {
    const r = await chat.json<{ out: string[] }>({
      runId: 'lab:lang',
      purpose: 'lab_translate',
      tpl: 'lab_translate_v2',
      temperature,
      messages: [
        { role: 'system', content: 'Translate each Chinese string in the given JSON array into natural, concise English. Keep names as pinyin, keep time expressions like 14:00–16:00 unchanged. Reply with JSON {"out": [...]} containing exactly the same number of strings, in the same order.' },
        { role: 'user', content: JSON.stringify(strs) },
      ],
      accept: ok,
    });
    if (r.ok && ok(r.data)) {
      out = r.data.out;
      break;
    }
  }
  if (!out) throw new Error('translate failed');
  const map = new Map(strs.map((s, i) => [s, out[i]!]));
  const sub = (v: unknown): unknown => (typeof v === 'string' ? (map.get(v) ?? v) : Array.isArray(v) ? v.map(sub) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)])) : v);
  return sub(obj);
}

interface Cell {
  i: number;
  variant: Variant;
  answers?: Record<string, JevAnswer>;
  error?: string;
}

async function run(): Promise<void> {
  const { store } = openLab();
  const chat = new ChatClient(store);
  const S = sample();
  const spend0 = store.spend();
  const payloads = await pmap(S, 6, async (p) => {
    const req = { kind: p.kind, candidates: p.candidates, observation: p.observation } as unknown as DecisionRequest;
    const base = buildJevPayload(req);
    const en = { state: await translate(chat, base.state), questions: await translate(chat, base.questions) };
    return { base, zh: { state: base.state, questions: zhQuestions(base.questions, p) }, en };
  });
  // 已有答案的格子不再问（重测格子尤其不能重问，否则又多花一次）
  const prev: Cell[] = existsSync(RAW) ? (JSON.parse(readFileSync(RAW, 'utf8')) as { cells: Cell[] }).cells : [];
  const cells: Cell[] = S.flatMap((_, i) => VARIANTS.map((variant) => prev.find((c) => c.i === i && c.variant === variant && c.answers) ?? { i, variant }));
  let n = 0;
  await pmap(cells.filter((c) => !c.answers), 8, async (c) => {
    const pl = payloads[c.i]!;
    const src = c.variant === 'zh_zh' ? pl.zh : c.variant === 'en_en' ? pl.en : { state: pl.base.state, questions: pl.base.questions };
    const r = await askJev(store, { tpl: TPL, purpose: 'lang', state: src.state, questions: src.questions as Record<string, unknown>, ...(c.variant === 'retest' ? { bypass: true } : {}) });
    if ('error' in r) c.error = r.error;
    else c.answers = r.answers;
    if (++n % 20 === 0) process.stderr.write(`\rlang ${n}/${cells.length}`);
  });
  process.stderr.write('\n');
  mkdirSync('data/lab', { recursive: true });
  writeFileSync(RAW, JSON.stringify({ sample: S, cells, optionIds: payloads.map((x) => x.base.optionIds) }));
  console.log('lang spend $', (store.spend() - spend0).toFixed(4), 'errors', cells.filter((c) => c.error).length);
}

// ---------------------------------------------------------------- 分析

const people = new Map(town30().people.map((p) => [p.id, p]));
function toSem(p: Pair, a: Record<string, JevAnswer> | undefined, optionIds: string[]): SemanticAnswer | undefined {
  if (!a) return undefined;
  const out: SemanticAnswer = { provider: 'jev', model: 'jev', callIds: [] };
  out.concern = typeof a.concern?.score === 'number' ? r3(Math.max(0, Math.min(1, a.concern.score / 4))) : undefined;
  if (p.kind === 'reaction') {
    const probs = a.fit?.probabilities ?? {};
    let sum = 0;
    const fit: Record<string, number> = {};
    optionIds.forEach((cid, i) => {
      const v = Math.max(0, Number(probs[`o${i + 1}`] ?? 0));
      fit[cid] = v;
      sum += v;
    });
    for (const cid of optionIds) fit[cid] = r3(sum > 0 ? (fit[cid]! + 0.01) / (sum + 0.01 * optionIds.length) : 1 / optionIds.length);
    out.fit = fit;
    out.verifyNeed = typeof a.verify_need?.noul === 'number' ? r3(a.verify_need.noul) : undefined;
  } else {
    const wm: Record<string, number> = {};
    optionIds.forEach((cid, i) => {
      if (!cid) return;
      const v = a[`msg_${i}`]?.noul;
      if (typeof v === 'number') wm[cid] = r3(v);
    });
    out.wouldMessage = wm;
  }
  return out;
}

function analyze(): void {
  const { sample: S, cells, optionIds } = JSON.parse(readFileSync(RAW, 'utf8')) as { sample: Pair[]; cells: Cell[]; optionIds: string[][] };
  const sem = (i: number, v: Variant) => toSem(S[i]!, cells.find((c) => c.i === i && c.variant === v)?.answers, optionIds[i]!);
  const probs = (i: number, s: SemanticAnswer) => {
    const p = S[i]!;
    const a = { traits: people.get(p.agent)!.traits } as unknown as Agent;
    return p.kind === 'reaction' ? scoreReaction(a, p.belief, p.candidates, p.ruleFactors, s, false).probabilities : scoreNotify(a, p.candidates, p.ruleFactors, s).probabilities;
  };
  const top = (x: Record<string, number>) => Object.entries(x).sort((a, b) => b[1] - a[1])[0]![0];
  const cmp = (va: Variant | 'rule', vb: Variant) => {
    let agreeFit = 0;
    let agreeChoice = 0;
    let tv = 0;
    let nr = 0;
    const dc: number[] = [];
    const dv: number[] = [];
    const dm: number[] = [];
    S.forEach((p, i) => {
      const a = va === 'rule' ? p.rule : sem(i, va);
      const b = sem(i, vb);
      if (!a || !b) return;
      if (a.concern !== undefined && b.concern !== undefined) dc.push(Math.abs(a.concern - b.concern));
      if (p.kind === 'reaction') {
        nr++;
        if (top(a.fit ?? {}) === top(b.fit ?? {})) agreeFit++;
        const pa = probs(i, a);
        const pb = probs(i, b);
        if (top(pa) === top(pb)) agreeChoice++;
        tv += 0.5 * p.candidates.reduce((acc, c) => acc + Math.abs((pa[c.id] ?? 0) - (pb[c.id] ?? 0)), 0);
        if (a.verifyNeed !== undefined && b.verifyNeed !== undefined) dv.push(Math.abs(a.verifyNeed - b.verifyNeed));
      } else {
        for (const [k, v] of Object.entries(b.wouldMessage ?? {})) {
          const w = a.wouldMessage?.[k];
          if (w !== undefined) dm.push(Math.abs(v - w));
        }
      }
    });
    const mean = (xs: number[]) => r3(xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length));
    return { reactions: nr, fitTopAgree: r3(agreeFit / nr), choiceTopAgree: r3(agreeChoice / nr), choiceTV: r3(tv / nr), concernAbsDiff: mean(dc), verifyAbsDiff: mean(dv), messageAbsDiff: mean(dm) };
  };
  const out = {
    n: S.length,
    errors: cells.filter((c) => c.error).length,
    'retest（Jev 自身波动）': cmp('en_zh', 'retest'),
    'zh_zh vs 现用（换指令语言）': cmp('en_zh', 'zh_zh'),
    'en_en vs 现用（换内容语言）': cmp('en_zh', 'en_en'),
    'zh_zh vs en_en（全中文 vs 全英文）': cmp('en_en', 'zh_zh'),
    '规则 vs 现用（参照：心智差异）': cmp('rule', 'en_zh'),
    '规则 vs en_en': cmp('rule', 'en_en'),
  };
  mkdirSync('docs/experiments/results', { recursive: true });
  writeFileSync(SUMMARY, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

const cmd = process.argv[2] ?? 'run';
if (cmd === 'run') await run();
if (cmd === 'run' || cmd === 'analyze') analyze();
