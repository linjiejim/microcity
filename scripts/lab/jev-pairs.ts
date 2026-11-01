// C2 Jev 对规则：经典小镇 A–E × seed 42–51，两种心智各跑一遍；记下每个 Jev 决策请求与答案，逐决策对比
// 用法：node --import tsx --no-warnings scripts/lab/jev-pairs.ts [run|analyze]（dev 服务要先停）
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { formatTime, forkTimeFor, r3, scoreNotify, scoreReaction, town30, untilFor, type Agent, type BranchSpec, type Candidate, type DecisionRequest, type ExperimentManifest, type SemanticAnswer } from '@microcity/sim';
import { hasModelAccess } from '../../apps/server/src/config.ts';
import type { ExperimentResult } from '../../apps/server/src/experiments.ts';
import { openLab, runManifest } from './lab-db.ts';

const PAIRS = 'data/lab/c2-pairs.jsonl';
const SUMMARY = 'docs/experiments/results/c2-jev-vs-rule.json';
const SEEDS = Array.from({ length: 10 }, (_, i) => 42 + i);
export const CLASSIC5: Record<string, BranchSpec> = {
  A: { label: '仅网站', patches: [{ event: '$first', channels: ['website'] }] },
  B: { label: '网站 + 公告栏', patches: [{ event: '$first', channels: ['website', 'board'] }] },
  C: { label: '网站 + 推送', patches: [{ event: '$first', channels: ['website', 'push'] }] },
  D: { label: '网站 + 推送 + 16:00 澄清', patches: [{ event: '$first', channels: ['website', 'push'], clarify: { at: '$notice_day 16:00', channels: ['website', 'push'] } }] },
  E: { label: '网站 + 推送 · 精确标题', patches: [{ event: '$first', channels: ['website', 'push'], headline: 'exact' }] },
};

export interface Pair {
  runId: string;
  kind: DecisionRequest['kind'];
  agent: string;
  family: string;
  t: number;
  candidates: Candidate[];
  ruleFactors: DecisionRequest['ruleFactors'];
  confidence: number;
  belief: DecisionRequest['belief'];
  rule: SemanticAnswer;
  jev: SemanticAnswer;
  observation: DecisionRequest['observation'];
}

function manifest(provider: 'rule' | 'jev'): ExperimentManifest {
  const sc = town30();
  return { id: `c2-${provider}`, name: `C2 ${provider === 'jev' ? 'Jev' : '规则'} · 经典小镇 A–E`, scenario: 'town30', seeds: SEEDS, provider, forkAt: formatTime(forkTimeFor(sc, CLASSIC5)), until: formatTime(untilFor(sc)), branches: CLASSIC5 };
}

async function run(): Promise<void> {
  if (!hasModelAccess()) throw new Error('需要 OPENROUTER_API_KEY');
  const { store, runs, exps } = openLab();
  mkdirSync('data/lab', { recursive: true });
  const ws = createWriteStream(PAIRS);
  runs.jev.observer = (req, ans, runId) => {
    const p: Pair = { runId, kind: req.kind, agent: req.agent, family: req.family, t: req.t, candidates: req.candidates, ruleFactors: req.ruleFactors, confidence: req.belief.confidence, belief: req.belief, rule: req.semanticRule, jev: ans, observation: req.observation };
    ws.write(`${JSON.stringify(p)}\n`);
  };
  const spend0 = store.spend();
  const jev = await runManifest(exps, store, manifest('jev'));
  const rule = await runManifest(exps, store, manifest('rule'));
  await new Promise((r) => ws.end(r));
  console.log('experiments', jev.id, rule.id, 'spend', (store.spend() - spend0).toFixed(4));
  writeFileSync('data/lab/c2-ids.json', JSON.stringify({ jev: jev.id, rule: rule.id }));
}

// ---------------------------------------------------------------- 分析

const people = new Map(town30().people.map((p) => [p.id, p]));
const agentOf = (id: string): Agent => ({ traits: people.get(id)!.traits }) as unknown as Agent;

function scored(p: Pair, sem: SemanticAnswer): Record<string, number> {
  const a = agentOf(p.agent);
  if (p.kind === 'reaction') return scoreReaction(a, p.belief, p.candidates, p.ruleFactors, sem, false).probabilities;
  return scoreNotify(a, p.candidates, p.ruleFactors, sem).probabilities;
}

function analyze(): void {
  const { store } = openLab();
  const ids = JSON.parse(readFileSync('data/lab/c2-ids.json', 'utf8')) as { jev: string; rule: string };
  const J = store.experiment(ids.jev)!.result as ExperimentResult;
  const R = store.experiment(ids.rule)!.result as ExperimentResult;
  const keys = ['E1.t50', 'E1.aware', 'E1.exact', 'E1.allDayEver', 'E1.intended', 'E1.surprisedPeople', 'E1.overreactMin', 'E1.verified', 'trust.govDelta'];
  const outcomes: Record<string, Record<string, { jev: number | null; rule: number | null; jevLower: number; n: number }>> = {};
  console.log('==== 结果（10 seed 中位数：Jev | 规则；Jev 更低的 seed 数）');
  for (const b of Object.keys(CLASSIC5)) {
    outcomes[b] = {};
    const parts: string[] = [];
    for (const k of keys) {
      const jv = J.stats[b]![k]!;
      const rv = R.stats[b]![k]!;
      let lower = 0;
      jv.values.forEach((v, i) => {
        const w = rv.values[i];
        if ((v ?? Infinity) < (w ?? Infinity)) lower++;
      });
      outcomes[b]![k] = { jev: jv.median, rule: rv.median, jevLower: lower, n: jv.values.length };
      parts.push(`${k.replace('E1.', '')} ${jv.median}|${rv.median} (${lower})`);
    }
    console.log(b, CLASSIC5[b]!.label.padEnd(16), parts.join(' · '));
  }
  // 对照方向在两种心智下是否一致
  const dir = (res: ExperimentResult, a: string, b: string, k: string) => {
    let pos = 0;
    const av = res.stats[a]![k]!.values;
    const bv = res.stats[b]![k]!.values;
    av.forEach((v, i) => {
      if ((v ?? 7 * 86400) - (bv[i] ?? 7 * 86400) > 0) pos++;
    });
    return pos / av.length;
  };
  const contrasts = [
    { id: 'push_speed', a: 'A', b: 'C', k: 'E1.t50', label: '加推送更快' },
    { id: 'push_surprise', a: 'A', b: 'C', k: 'E1.surprisedPeople', label: '加推送少措手不及' },
    { id: 'headline_over', a: 'C', b: 'E', k: 'E1.overreactMin', label: '精确标题少过度调整' },
    { id: 'clarify_over', a: 'C', b: 'D', k: 'E1.overreactMin', label: '澄清少过度调整' },
  ].map((c) => ({ ...c, jev: dir(J, c.a, c.b, c.k), rule: dir(R, c.a, c.b, c.k) }));
  console.log('==== 结论方向成立的 seed 比例（Jev | 规则）');
  for (const c of contrasts) console.log(`  ${c.label}: ${Math.round(c.jev * 100)}% | ${Math.round(c.rule * 100)}%`);

  // 逐决策
  const pairs = readFileSync(PAIRS, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Pair).filter((p) => !p.jev.fallback);
  const react = pairs.filter((p) => p.kind === 'reaction');
  const notify = pairs.filter((p) => p.kind === 'notify');
  const mass: Record<string, { rule: number; jev: number; n: number }> = {};
  let agree = 0;
  let tv = 0;
  const conc: Array<[number, number]> = [];
  const ver: Array<[number, number]> = [];
  const fitKeep: Array<[number, number]> = [];
  for (const p of react) {
    const pr = scored(p, p.rule);
    const pj = scored(p, p.jev);
    const top = (x: Record<string, number>) => Object.entries(x).sort((a, b) => b[1] - a[1])[0]![0];
    if (top(pr) === top(pj)) agree++;
    tv += 0.5 * p.candidates.reduce((acc, c) => acc + Math.abs((pr[c.id] ?? 0) - (pj[c.id] ?? 0)), 0);
    for (const c of p.candidates) {
      const m = (mass[c.kind] ??= { rule: 0, jev: 0, n: 0 });
      m.rule += pr[c.id] ?? 0;
      m.jev += pj[c.id] ?? 0;
    }
    for (const k of new Set(p.candidates.map((c) => c.kind))) mass[k]!.n++;
    conc.push([p.rule.concern ?? NaN, p.jev.concern ?? NaN]);
    ver.push([p.rule.verifyNeed ?? NaN, p.jev.verifyNeed ?? NaN]);
    const keep = p.candidates.find((c) => c.kind === 'keep');
    if (keep) fitKeep.push([p.rule.fit?.[keep.id] ?? NaN, p.jev.fit?.[keep.id] ?? NaN]);
  }
  const mean = (xs: number[]) => xs.filter(Number.isFinite).reduce((a, b) => a + b, 0) / xs.filter(Number.isFinite).length;
  const corr = (xy: Array<[number, number]>) => {
    const ok = xy.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const mx = mean(ok.map((v) => v[0]));
    const my = mean(ok.map((v) => v[1]));
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const [x, y] of ok) {
      sxy += (x - mx) * (y - my);
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
    }
    return r3(sxy / Math.sqrt(sxx * syy));
  };
  const wm: Array<[number, number]> = [];
  for (const p of notify) for (const c of p.candidates) if (c.kind === 'dm') wm.push([p.rule.wouldMessage?.[c.id] ?? NaN, p.jev.wouldMessage?.[c.id] ?? NaN]);
  const decision = {
    reactions: react.length,
    notifies: notify.length,
    topAgree: r3(agree / react.length),
    meanTV: r3(tv / react.length),
    probMassByKind: Object.fromEntries(Object.entries(mass).map(([k, v]) => [k, { rule: r3(v.rule / v.n), jev: r3(v.jev / v.n), n: v.n }])),
    concern: { rule: r3(mean(conc.map((v) => v[0]))), jev: r3(mean(conc.map((v) => v[1]))), corr: corr(conc) },
    verifyNeed: { rule: r3(mean(ver.map((v) => v[0]))), jev: r3(mean(ver.map((v) => v[1]))), corr: corr(ver) },
    fitKeep: { rule: r3(mean(fitKeep.map((v) => v[0]))), jev: r3(mean(fitKeep.map((v) => v[1]))), corr: corr(fitKeep) },
    wouldMessage: { rule: r3(mean(wm.map((v) => v[0]))), jev: r3(mean(wm.map((v) => v[1]))), corr: corr(wm), n: wm.length },
  };
  console.log('==== 逐决策（同一请求：规则语义 vs Jev 语义，经同一套效用与抽样）');
  console.log(JSON.stringify(decision, null, 1));
  const cost = Object.values(J.branches).reduce((acc, b) => acc + b.perSeed.reduce((x, m) => x + m.calls.cost, 0), 0);
  const calls = Object.values(J.branches).reduce((acc, b) => acc + b.perSeed.reduce((x, m) => x + m.calls.calls, 0), 0);
  const cached = Object.values(J.branches).reduce((acc, b) => acc + b.perSeed.reduce((x, m) => x + m.calls.cached, 0), 0);
  const fallbacks = Object.values(J.branches).reduce((acc, b) => acc + b.perSeed.reduce((x, m) => x + m.decisions.fallbacks, 0), 0);
  mkdirSync('docs/experiments/results', { recursive: true });
  writeFileSync(SUMMARY, JSON.stringify({ experiments: ids, seeds: SEEDS, outcomes, contrasts, decision, jev: { calls, cached, fallbacks, cost: r3(cost * 1000) / 1000 } }, null, 1));
  console.log('calls', calls, 'cached', cached, 'fallbacks', fallbacks, 'cost $', cost.toFixed(4), '→', SUMMARY);
}

const cmd = process.argv[2] ?? 'run';
if (cmd === 'run') await run();
if (cmd === 'run' || cmd === 'analyze') analyze();
