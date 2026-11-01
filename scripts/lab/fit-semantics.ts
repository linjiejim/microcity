// C2b 规则心智向 Jev 校准：用 C2 记下的真实决策请求，拟合规则语义因子的系数
// 训练：seed 42–46 的请求；检验：seed 47–51 的请求（逐决策），再用规则模式重跑经典小镇 A–E 看结果是否更接近 Jev
// 用法：node --import tsx --no-warnings scripts/lab/fit-semantics.ts [fit|validate]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, paramAt, patchAt, r3, resolveParams, ruleSemantics, scoreNotify, scoreReaction, sigmoid, town30, type Agent, type ParamPatch, type RuleParams } from '@microcity/sim';
import type { ExperimentResult } from '../../apps/server/src/experiments.ts';
import type { Pair } from './jev-pairs.ts';
import { CLASSIC5 } from './jev-pairs.ts';
import { runPool, type Row } from './pool.ts';

const OUT = 'docs/experiments/results/c2b-fit.json';
const FREE: Array<{ path: string; lo: number; hi: number }> = [
  { path: 'semantics.verifyBase', lo: 0.01, hi: 3 },
  { path: 'semantics.moveBase', lo: 0.01, hi: 3 },
  { path: 'semantics.adaptBase', lo: 0.01, hi: 3 },
  { path: 'semantics.serviceBase', lo: 0.01, hi: 3 },
  { path: 'semantics.prepareBase', lo: 0.01, hi: 3 },
  { path: 'semantics.restoreBase', lo: 0.01, hi: 3 },
  { path: 'semantics.concernBase', lo: -0.5, hi: 1 },
  { path: 'semantics.concernAnx', lo: 0, hi: 1.5 },
  { path: 'semantics.verifyVague', lo: 0, hi: 1 },
  { path: 'semantics.verifyPrecise', lo: 0, hi: 1 },
  { path: 'semantics.msgBase', lo: -0.6, hi: 0.8 },
];

const people = new Map(town30().people.map((p) => [p.id, p]));
const agentOf = (id: string): Agent => ({ id, traits: people.get(id)!.traits, trustGov: people.get(id)!.traits.trustOfficial }) as unknown as Agent;
const seedOf = (runId: string): number => (runId.startsWith('run_') ? 42 : Number(runId.split(':')[1]));

function load(): { train: Pair[]; test: Pair[] } {
  const pairs = readFileSync('data/lab/c2-pairs.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Pair).filter((p) => !p.jev.fallback);
  return { train: pairs.filter((p) => seedOf(p.runId) <= 46), test: pairs.filter((p) => seedOf(p.runId) >= 47) };
}

const patchOf = (x: number[]): ParamPatch => {
  const p: ParamPatch = {};
  FREE.forEach((f, i) => patchAt(f.path, r3(Math.min(f.hi, Math.max(f.lo, x[i]!))), p));
  return p;
};

/** 损失：选择分布的 KL(Jev ‖ 规则) + 联系人“发消息”概率的交叉熵 */
function loss(pairs: Pair[], P: RuleParams): { total: number; kl: number; msg: number; top: number } {
  let kl = 0;
  let nr = 0;
  let top = 0;
  let msg = 0;
  let nm = 0;
  for (const p of pairs) {
    const a = agentOf(p.agent);
    if (p.kind === 'reaction') {
      const semR = ruleSemantics(a, p.belief, p.candidates, P);
      const pr = scoreReaction(a, p.belief, p.candidates, p.ruleFactors, semR, false).probabilities;
      const pj = scoreReaction(a, p.belief, p.candidates, p.ruleFactors, p.jev, false).probabilities;
      let k = 0;
      for (const c of p.candidates) {
        const q = (pj[c.id] ?? 0) + 1e-4;
        const r = (pr[c.id] ?? 0) + 1e-4;
        k += q * Math.log(q / r);
      }
      kl += k;
      nr++;
      const arg = (x: Record<string, number>) => Object.entries(x).sort((u, v) => v[1] - u[1])[0]![0];
      if (arg(pr) === arg(pj)) top++;
    } else {
      const S = P.semantics;
      for (const c of p.candidates) {
        if (c.kind !== 'dm') continue;
        const tie = p.ruleFactors[c.id]?.tie?.value ?? 0.5;
        const wm = Math.min(1, Math.max(0, S.msgBase + S.msgAltruism * a.traits.altruism + S.msgTie * tie));
        const semR = { ...p.rule, wouldMessage: { [c.id]: wm }, concern: Math.min(1, Math.max(0, S.concernBase + S.concernAnx * a.traits.anxiety + S.concernRisk * a.traits.riskAversion)) };
        const qr = scoreNotify(a, [c], p.ruleFactors, semR).probabilities[c.id] ?? 0.5;
        const qj = scoreNotify(a, [c], p.ruleFactors, p.jev).probabilities[c.id] ?? 0.5;
        msg += -(qj * Math.log(qr + 1e-4) + (1 - qj) * Math.log(1 - qr + 1e-4)) + (qj * Math.log(qj + 1e-4) + (1 - qj) * Math.log(1 - qj + 1e-4));
        nm++;
      }
    }
  }
  return { total: kl / Math.max(1, nr) + msg / Math.max(1, nm), kl: kl / Math.max(1, nr), msg: msg / Math.max(1, nm), top: top / Math.max(1, nr) };
}

/** Nelder–Mead（有界：越界在 patchOf 里夹回） */
function nelderMead(f: (x: number[]) => number, x0: number[], steps: number[], iters = 400): number[] {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + steps[i]! : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iters; it++) {
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0]!;
    const worst = simplex[n]!;
    const c = x0.map((_, j) => simplex.slice(0, n).reduce((acc, s) => acc + s.x[j]!, 0) / n);
    const refl = c.map((v, j) => v + (v - worst.x[j]!));
    const fr = f(refl);
    if (fr < best.f) {
      const exp = c.map((v, j) => v + 2 * (v - worst.x[j]!));
      const fe = f(exp);
      simplex[n] = fe < fr ? { x: exp, f: fe } : { x: refl, f: fr };
    } else if (fr < simplex[n - 1]!.f) simplex[n] = { x: refl, f: fr };
    else {
      const con = c.map((v, j) => v + 0.5 * (worst.x[j]! - v));
      const fc = f(con);
      if (fc < worst.f) simplex[n] = { x: con, f: fc };
      else simplex = simplex.map((s, i) => (i === 0 ? s : { x: s.x.map((v, j) => best.x[j]! + 0.5 * (v - best.x[j]!)), f: f(s.x.map((v, j) => best.x[j]! + 0.5 * (v - best.x[j]!))) }));
    }
    if (it % 50 === 0) process.stderr.write(`\rNM ${it} best ${simplex.sort((a, b) => a.f - b.f)[0]!.f.toFixed(4)}   `);
  }
  process.stderr.write('\n');
  return simplex.sort((a, b) => a.f - b.f)[0]!.x;
}

function fit(): ParamPatch {
  const { train, test } = load();
  const x0 = FREE.map((f) => paramAt(DEFAULT_PARAMS, f.path));
  const f = (x: number[]) => loss(train, resolveParams(patchOf(x))).total;
  let x = nelderMead(f, x0, x0.map((v) => Math.max(0.1, Math.abs(v) * 0.5)));
  x = nelderMead(f, x, x.map((v) => Math.max(0.05, Math.abs(v) * 0.2)));
  const patch = patchOf(x);
  const P = resolveParams(patch);
  const report = {
    free: FREE.map((q, i) => ({ path: q.path, v1: paramAt(DEFAULT_PARAMS, q.path), fitted: r3(Math.min(q.hi, Math.max(q.lo, x[i]!))) })),
    train: { n: train.length, before: roundAll(loss(train, DEFAULT_PARAMS)), after: roundAll(loss(train, P)) },
    test: { n: test.length, before: roundAll(loss(test, DEFAULT_PARAMS)), after: roundAll(loss(test, P)) },
    massByKind: massByKind(test, P),
    patch,
  };
  mkdirSync('docs/experiments/results', { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  return patch;
}

const roundAll = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r3(v)]));

function massByKind(pairs: Pair[], P: RuleParams): Record<string, { v1: number; fitted: number; jev: number; n: number }> {
  const m: Record<string, { v1: number; fitted: number; jev: number; n: number }> = {};
  for (const p of pairs) {
    if (p.kind !== 'reaction') continue;
    const a = agentOf(p.agent);
    const p1 = scoreReaction(a, p.belief, p.candidates, p.ruleFactors, ruleSemantics(a, p.belief, p.candidates, DEFAULT_PARAMS), false).probabilities;
    const p2 = scoreReaction(a, p.belief, p.candidates, p.ruleFactors, ruleSemantics(a, p.belief, p.candidates, P), false).probabilities;
    const pj = scoreReaction(a, p.belief, p.candidates, p.ruleFactors, p.jev, false).probabilities;
    for (const c of p.candidates) {
      const x = (m[c.kind] ??= { v1: 0, fitted: 0, jev: 0, n: 0 });
      x.v1 += p1[c.id] ?? 0;
      x.fitted += p2[c.id] ?? 0;
      x.jev += pj[c.id] ?? 0;
    }
    for (const k of new Set(p.candidates.map((c) => c.kind))) m[k]!.n++;
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { v1: r3(v.v1 / v.n), fitted: r3(v.fitted / v.n), jev: r3(v.jev / v.n), n: v.n }]));
}

/** 结果层面的检验：规则 v1、规则（校准后）各跑一遍经典 A–E × seed 42–51，与 Jev 的结果比 */
async function validate(): Promise<void> {
  const report = JSON.parse(readFileSync(OUT, 'utf8')) as { patch: ParamPatch };
  const seeds = Array.from({ length: 10 }, (_, i) => 42 + i);
  const rows = await runPool(
    seeds.map((seed) => ({ base: 'town30' as const, seed, branches: CLASSIC5, variants: [{ id: 'v1' }, { id: 'fitted', params: report.patch }] })),
    'data/lab/c2b-validate.jsonl',
    { label: 'C2b' },
  );
  const { openLab } = await import('./lab-db.ts');
  const { store } = openLab();
  const ids = JSON.parse(readFileSync('data/lab/c2-ids.json', 'utf8')) as { jev: string };
  const J = store.experiment(ids.jev)!.result as ExperimentResult;
  const keys = ['t50', 'intended', 'surprisedPeople', 'overreactMin', 'verified', 'exact'] as const;
  const med = (xs: number[]) => {
    const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
    const m = (s.length - 1) / 2;
    return (s[Math.floor(m)]! + s[Math.ceil(m)]!) / 2;
  };
  const table: Record<string, Record<string, { jev: number; v1: number; fitted: number; closer: number }>> = {};
  for (const b of Object.keys(CLASSIC5)) {
    table[b] = {};
    for (const k of keys) {
      const jv = J.branches[b]!.perSeed.map((m) => (m.outages.E1?.[k] as number | null) ?? 7 * 86400);
      const val = (variant: string) => seeds.map((s) => (rows.find((r) => r.seed === s && r.branch === b && r.variant === variant)!.metrics.outages.E1?.[k] as number | null) ?? 7 * 86400);
      const v1 = val('v1');
      const ft = val('fitted');
      const closer = seeds.filter((_, i) => Math.abs(ft[i]! - jv[i]!) < Math.abs(v1[i]! - jv[i]!)).length / seeds.length;
      table[b]![k] = { jev: med(jv), v1: med(v1), fitted: med(ft), closer: r3(closer) };
    }
    console.log(b, Object.entries(table[b]!).map(([k, v]) => `${k} J ${v.jev} | v1 ${v.v1} | fit ${v.fitted} (${Math.round(v.closer * 100)}%)`).join(' · '));
  }
  // 汇总：各指标中位数与 Jev 的相对差距（v1 vs 校准后）
  const gap = (variant: 'v1' | 'fitted') => r3(Object.values(table).flatMap((t) => keys.map((k) => Math.abs(t[k]![variant] - t[k]!.jev) / Math.max(1, Math.abs(t[k]!.jev)))).reduce((a, b) => a + b, 0) / (Object.keys(table).length * keys.length));
  const full = JSON.parse(readFileSync(OUT, 'utf8'));
  full.validate = { seeds, table, meanRelGap: { v1: gap('v1'), fitted: gap('fitted') } };
  writeFileSync(OUT, JSON.stringify(full, null, 1));
  console.log('平均相对差距（与 Jev 的中位数比）v1', gap('v1'), '→ 校准后', gap('fitted'));
  void sigmoid;
}

const cmd = process.argv[2] ?? 'all';
if (cmd === 'fit' || cmd === 'all') fit();
if (cmd === 'validate' || cmd === 'all') await validate();
