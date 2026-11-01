// C1 参数敏感性：一次改一个旋钮（低/高，20 seed）+ 拉丁超立方 200 组（8 seed）
// 用法：node --import tsx scripts/lab/sens.ts [run|analyze]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DEFAULT_PARAMS, PARAM_KNOBS, paramAt, patchAt, rand, type BranchSpec, type ParamPatch } from '@microcity/sim';
import { runPool, type Job, type Row } from './pool.ts';
import { labTown } from './towns.ts';

const OUT = 'data/lab/c1-sens.jsonl';
const SUMMARY = 'docs/experiments/results/c1-sensitivity.json';

const CLASSIC: Record<string, BranchSpec> = {
  A: { label: '仅网站', patches: [{ event: '$first', channels: ['website'] }] },
  B: { label: '网站 + 公告栏', patches: [{ event: '$first', channels: ['website', 'board'] }] },
  C: { label: '网站 + 推送', patches: [{ event: '$first', channels: ['website', 'push'] }] },
  D: { label: '网站 + 推送 + 16:00 澄清', patches: [{ event: '$first', channels: ['website', 'push'], clarify: { at: '$notice_day 16:00', channels: ['website', 'push'] } }] },
  E: { label: '网站 + 推送 · 精确标题', patches: [{ event: '$first', channels: ['website', 'push'], headline: 'exact' }] },
};
const LAB: Record<string, BranchSpec> = {
  P0: { label: '默认（三渠道 · 模糊标题）' },
  P1: { label: '仅网站', patches: [{ event: '$first', channels: ['website'] }] },
  P2: { label: '精确标题', patches: [{ event: '$first', headline: 'exact' }] },
  P3: { label: '当天 16:00 澄清', patches: [{ event: '$first', clarify: { at: '$notice_day 16:00', channels: ['website', 'push', 'board'] } }] },
};

const N_LHS = 200;
const OAT_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const LHS_SEEDS = Array.from({ length: 8 }, (_, i) => i + 1);

/** 拉丁超立方：每个旋钮把范围分 N 层，层的顺序按确定性随机打乱 */
function lhs(): Array<{ id: string; params: ParamPatch; x: Record<string, number> }> {
  const perms = PARAM_KNOBS.map((k) => {
    const idx = Array.from({ length: N_LHS }, (_, i) => i);
    return idx.map((i) => ({ i, u: rand(2026, 'lhs-perm', k.path, i) })).sort((a, b) => a.u - b.u).map((x) => x.i);
  });
  return Array.from({ length: N_LHS }, (_, j) => {
    const params: ParamPatch = {};
    const x: Record<string, number> = {};
    PARAM_KNOBS.forEach((k, ki) => {
      const v = k.lo + ((perms[ki]![j]! + rand(2026, 'lhs-u', k.path, j)) / N_LHS) * (k.hi - k.lo);
      const r = Math.round(v * 1000) / 1000;
      patchAt(k.path, r, params);
      x[k.path] = r;
    });
    return { id: `lhs:${String(j).padStart(3, '0')}`, params, x };
  });
}

function oat(): Array<{ id: string; params?: ParamPatch }> {
  return [{ id: 'default' }, ...PARAM_KNOBS.flatMap((k) => [{ id: `${k.path}:lo`, params: patchAt(k.path, k.lo) }, { id: `${k.path}:hi`, params: patchAt(k.path, k.hi) }])];
}

async function run(): Promise<void> {
  const L = lhs();
  const jobs: Job[] = [];
  for (const [scen, base, branches] of [
    ['classic', 'town30', CLASSIC],
    ['lab42', labTown(42), LAB],
  ] as const) {
    for (const seed of OAT_SEEDS) jobs.push({ base, seed, branches, variants: oat(), tags: { scen } });
    for (const seed of LHS_SEEDS) for (let c = 0; c < N_LHS; c += 25) jobs.push({ base, seed, branches, variants: L.slice(c, c + 25), tags: { scen } });
  }
  await runPool(jobs, OUT, { label: 'C1' });
}

// ---------------------------------------------------------------- 分析

const NEVER = 7 * 86400;
type M = Row['metrics']['outages'][string];
const val = (r: Row, k: keyof M): number => {
  const v = r.metrics.outages.E1?.[k];
  return typeof v === 'number' ? v : k === 't50' || k === 't80' ? NEVER : NaN;
};
const median = (xs: number[]): number => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)]! + s[Math.ceil(m)]!) / 2;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/** 结论：两个分支之间某个指标的差（正 = 结论方向成立） */
const CONTRASTS: Record<string, Array<{ id: string; label: string; a: string; b: string; k: keyof M }>> = {
  classic: [
    { id: 'push_speed', label: '加推送更快（t50：A − C）', a: 'A', b: 'C', k: 't50' },
    { id: 'board_speed', label: '加公告栏更快（t50：A − B）', a: 'A', b: 'B', k: 't50' },
    { id: 'push_surprise', label: '加推送少措手不及（A − C）', a: 'A', b: 'C', k: 'surprisedPeople' },
    { id: 'headline_over', label: '精确标题少过度调整（C − E）', a: 'C', b: 'E', k: 'overreactMin' },
    { id: 'clarify_over', label: '澄清少过度调整（C − D）', a: 'C', b: 'D', k: 'overreactMin' },
    { id: 'headline_surprise', label: '精确标题少措手不及（C − E）', a: 'C', b: 'E', k: 'surprisedPeople' },
  ],
  lab42: [
    { id: 'channels_speed', label: '三渠道比仅网站快（t50：P1 − P0）', a: 'P1', b: 'P0', k: 't50' },
    { id: 'channels_surprise', label: '三渠道少措手不及（P1 − P0）', a: 'P1', b: 'P0', k: 'surprisedPeople' },
    { id: 'headline_over', label: '精确标题少过度调整（P0 − P2）', a: 'P0', b: 'P2', k: 'overreactMin' },
    { id: 'clarify_over', label: '澄清少过度调整（P0 − P3）', a: 'P0', b: 'P3', k: 'overreactMin' },
    { id: 'headline_surprise', label: '精确标题少措手不及（P0 − P2）', a: 'P0', b: 'P2', k: 'surprisedPeople' },
  ],
};
const LEVELS: Array<keyof M> = ['t50', 'surprisedPeople', 'overreactMin', 'allDayEver', 'exact', 'intended'];

function spearman(x: number[], y: number[]): number {
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
    const r = new Array<number>(a.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]!.v === idx[i]!.v) j++;
      for (let k = i; k <= j; k++) r[idx[k]!.i] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ok = x.map((_, i) => Number.isFinite(x[i]!) && Number.isFinite(y[i]!));
  const xs = rank(x.filter((_, i) => ok[i]));
  const ys = rank(y.filter((_, i) => ok[i]));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

function analyze(): void {
  const rows = readFileSync(OUT, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Row);
  const L = new Map(lhs().map((x) => [x.id, x.x]));
  const out: Record<string, unknown> = { knobs: PARAM_KNOBS.map((k) => ({ ...k, default: paramAt(DEFAULT_PARAMS, k.path) })), seeds: { oat: OAT_SEEDS.length, lhs: LHS_SEEDS.length }, nLhs: N_LHS };
  for (const scen of ['classic', 'lab42']) {
    const R = rows.filter((r) => r.tags.scen === scen);
    // variant → branch → seed → row
    const by = new Map<string, Map<string, Map<number, Row>>>();
    for (const r of R) {
      let v = by.get(r.variant);
      if (!v) by.set(r.variant, (v = new Map()));
      let b = v.get(r.branch);
      if (!b) v.set(r.branch, (b = new Map()));
      b.set(r.seed, r);
    }
    const contrast = (variant: string, c: (typeof CONTRASTS)[string][number]) => {
      const v = by.get(variant)!;
      const a = v.get(c.a)!;
      const b = v.get(c.b)!;
      const d = [...a.keys()].map((s) => val(a.get(s)!, c.k) - val(b.get(s)!, c.k));
      return { median: median(d), pos: d.filter((x) => x > 0).length / d.length, neg: d.filter((x) => x < 0).length / d.length };
    };
    const level = (variant: string, branch: string, k: keyof M) => median([...by.get(variant)!.get(branch)!.values()].map((r) => val(r, k)));
    const branches = Object.keys(scen === 'classic' ? CLASSIC : LAB);
    const baseline = {
      levels: Object.fromEntries(branches.map((b) => [b, Object.fromEntries(LEVELS.map((k) => [k, r2(level('default', b, k))]))])),
      contrasts: Object.fromEntries(CONTRASTS[scen]!.map((c) => [c.id, { label: c.label, ...contrast('default', c) }])),
    };
    const oatRes = PARAM_KNOBS.map((k) => ({
      path: k.path,
      label: k.label,
      lo: k.lo,
      hi: k.hi,
      levels: Object.fromEntries(['lo', 'hi'].map((side) => [side, Object.fromEntries(LEVELS.map((m) => [m, r2(level(`${k.path}:${side}`, branches[0]!, m))]))])),
      contrasts: Object.fromEntries(CONTRASTS[scen]!.map((c) => [c.id, { lo: contrast(`${k.path}:lo`, c), hi: contrast(`${k.path}:hi`, c) }])),
    }));
    const lhsIds = [...by.keys()].filter((v) => v.startsWith('lhs:')).sort();
    const robust = Object.fromEntries(
      CONTRASTS[scen]!.map((c) => {
        const meds = lhsIds.map((v) => contrast(v, c).median);
        return [c.id, { label: c.label, holds: r2(meds.filter((x) => x > 0).length / meds.length), flips: r2(meds.filter((x) => x < 0).length / meds.length), q10: r2(quant(meds, 0.1)), q50: r2(quant(meds, 0.5)), q90: r2(quant(meds, 0.9)) }];
      }),
    );
    const sens = Object.fromEntries(
      [...LEVELS.map((m) => ({ id: `level:${m}`, f: (v: string) => level(v, branches[0]!, m) })), ...CONTRASTS[scen]!.map((c) => ({ id: `contrast:${c.id}`, f: (v: string) => contrast(v, c).median }))].map(({ id, f }) => {
        const y = lhsIds.map(f);
        return [id, Object.fromEntries(PARAM_KNOBS.map((k) => [k.path, r2(spearman(lhsIds.map((v) => L.get(v)![k.path]!), y))]))];
      }),
    );
    out[scen] = { baseline, oat: oatRes, lhs: { robust, spearman: sens } };
    // 打印
    console.log(`\n==== ${scen} 默认参数（${OAT_SEEDS.length} seed 中位数）`);
    for (const b of branches) console.log(b.padEnd(3), JSON.stringify(baseline.levels[b]));
    for (const [id, c] of Object.entries(baseline.contrasts)) console.log(`  ${c.label}: 中位差 ${r2(c.median)} · 成立 ${Math.round(c.pos * 100)}% · 反向 ${Math.round(c.neg * 100)}%`);
    console.log(`---- ${scen} 拉丁超立方 ${lhsIds.length} 组：结论成立的参数组比例`);
    for (const [id, x] of Object.entries(robust)) console.log(`  ${x.label}: 成立 ${Math.round(x.holds * 100)}% · 反向 ${Math.round(x.flips * 100)}% · 10/50/90 分位 ${x.q10} / ${x.q50} / ${x.q90}`);
    console.log(`---- ${scen} 一次改一个旋钮：结论的中位差（低 → 高）`);
    for (const o of oatRes) console.log(`  ${o.label.padEnd(14)} ${CONTRASTS[scen]!.map((c) => `${c.id} ${r2(o.contrasts[c.id]!.lo.median)}→${r2(o.contrasts[c.id]!.hi.median)}`).join(' | ')}`);
    console.log(`---- ${scen} 秩相关（旋钮 vs 结果，拉丁超立方）`);
    for (const [id, cor] of Object.entries(sens)) {
      const top = Object.entries(cor).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
      console.log(`  ${id.padEnd(28)} ${top.map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    }
  }
  mkdirSync('docs/experiments/results', { recursive: true });
  writeFileSync(SUMMARY, JSON.stringify(out, null, 1));
  console.log('\nsummary →', SUMMARY);
}

function quant(xs: number[], p: number): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * p;
  return s[Math.floor(i)]! + (s[Math.ceil(i)]! - s[Math.floor(i)]!) * (i - Math.floor(i));
}

const cmd = process.argv[2] ?? 'run';
if (cmd === 'run') await run();
if (cmd === 'run' || cmd === 'analyze') analyze();
