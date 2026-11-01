// 经典案例 W（狼来了）、K（知沟）、R（传话游戏）：定义、规则批量、登记到主库、按预注册判定
// 预注册：docs/experiments/20260929-classic-cases.md（假设与判定细则写于任何相关运行之前）
// 用法：
//   node --import tsx --no-warnings scripts/lab/cases.ts rule [W,K,R]        规则模式（3 座镇 × 20 seed，只在内存里跑）
//   node --import tsx --no-warnings scripts/lab/cases.ts ui [W,K,R] [rule|jev] 登记到主库（先停 dev 服务），复盘里能打开
//   node --import tsx --no-warnings scripts/lab/cases.ts analyze              汇总两种心智的判定 → docs/experiments/results/cases.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { formatTime, forkTimeFor, untilFor, type BranchSpec, type EventInput, type ExperimentManifest, type ScenarioDef, type TownSpec } from '@microcity/sim';
import type { BranchMetrics, ExperimentResult } from '../../apps/server/src/experiments.ts';
import { runPool, type Job, type Row } from './pool.ts';
import { makeProbe, type ProbeName } from './probes.ts';
import { labTown } from './towns.ts';

const TOWN_SEEDS = [42, 7, 99];
const RUN_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const JEV_SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const NEVER = 7 * 86400;
const ALL3 = ['website', 'push', 'board'] as const;

/** 一个分支在一次重复里的全部数据 */
interface BranchData {
  metrics: Pick<BranchMetrics, 'outages' | 'trust'>;
  trustAt?: BranchMetrics['trustAt'];
  extra?: Record<string, any>;
}

/** 假设的一项：若干（指标，分支，符号）之和；type 决定怎么判 */
interface Term {
  label: string;
  parts: Array<{ key: string; branch: string; sign: 1 | -1 }>;
  type: 'positive' | 'small' | 'level';
  /** small：中位数落在 [lo, hi)；maxPos：正向配对比例上限（可选）；level：中位数 ≤ hi */
  lo?: number;
  hi?: number;
  maxPos?: number;
}
interface Hypothesis {
  id: string;
  kind: '检验' | '演示' | '报告';
  text: string;
  terms: Term[];
}
interface Case {
  id: 'W' | 'K' | 'R';
  name: string;
  base: (seed: number) => TownSpec;
  branches: Record<string, BranchSpec>;
  probes: ProbeName[];
  derive: (d: BranchData) => Record<string, number>;
  levels: string[];
  hypotheses: Hypothesis[];
}

const diff = (key: string, a: string, b: string) => [
  { key, branch: a, sign: 1 as const },
  { key, branch: b, sign: -1 as const },
];
const val = (key: string, a: string) => [{ key, branch: a, sign: 1 as const }];
const pos = (label: string, parts: Term['parts']): Term => ({ label, parts, type: 'positive' });
const small = (label: string, parts: Term['parts'], lo: number, hi: number, maxPos?: number): Term => ({ label, parts, type: 'small', lo, hi, ...(maxPos !== undefined ? { maxPos } : {}) });
const level = (label: string, parts: Term['parts'], hi: number): Term => ({ label, parts, type: 'level', hi });

const num = (x: unknown, dflt = Number.NaN): number => (typeof x === 'number' && Number.isFinite(x) ? x : dflt);
const t50 = (x: unknown): number => num(x, NEVER);

// ---------------------------------------------------------------- W 狼来了

const wolfEvent = (id: string, day: number): EventInput => ({ id, area: 'north', day, from: '14:00', to: '16:00', notice: { at: `D0${day - 1} 08:05`, channels: [...ALL3], headline: 'exact', advice: ['charge_devices', 'plan_elsewhere'] }, clarify: null, workOrder: true });

const W: Case = {
  id: 'W',
  name: '经典·狼来了（虚报 vs 漏报）',
  base: (s) => labTown(s, { events: [wolfEvent('E1', 3), wolfEvent('E2', 5), wolfEvent('E3', 7)] } as Partial<TownSpec>),
  branches: {
    A: { label: '没有前情', patches: [{ event: 'E1', mode: 'absent' }, { event: 'E2', mode: 'absent' }] },
    B: { label: '两次准确' },
    C: { label: '一次虚惊', patches: [{ event: 'E1', mode: 'absent' }, { event: 'E2', mode: 'false_alarm' }] },
    D: { label: '两次虚惊', patches: [{ event: 'E1', mode: 'false_alarm' }, { event: 'E2', mode: 'false_alarm' }] },
    E: { label: '两次漏报', patches: [{ event: 'E1', silent: true }, { event: 'E2', silent: true }] },
  },
  probes: [],
  derive: (d) => {
    const e3 = d.metrics.outages.E3!;
    return {
      trustE3: num(d.trustAt?.E3?.govMean),
      'e3.intended': e3.intended,
      'e3.surprised': e3.surprisedPeople,
      'e3.verified': e3.verified,
      'e3.disbelieved': e3.disbelieved,
      'e3.t50': t50(e3.t50),
      'e3.aware': e3.aware,
      'prior.over': (d.metrics.outages.E1?.overreactMin ?? 0) + (d.metrics.outages.E2?.overreactMin ?? 0),
      'prior.surprised': (d.metrics.outages.E1?.surprisedPeople ?? 0) + (d.metrics.outages.E2?.surprisedPeople ?? 0),
    };
  },
  levels: ['trustE3', 'e3.intended', 'e3.surprised', 'e3.verified', 'e3.disbelieved', 'e3.t50', 'prior.over', 'prior.surprised'],
  hypotheses: [
    { id: 'HW1', kind: '检验', text: '虚惊伤信任：E3 开始时的信任 D < C < A', terms: [pos('信任 A−C', diff('trustE3', 'A', 'C')), pos('信任 C−D', diff('trustE3', 'C', 'D'))] },
    { id: 'HW2', kind: '检验', text: '狼来了：两次虚惊后 E3 照做的人更少', terms: [pos('改安排 A−D', diff('e3.intended', 'A', 'D'))] },
    { id: 'HW3', kind: '检验', text: '一次不够：一次虚惊几乎不改变照做人数', terms: [small('改安排 C−A', diff('e3.intended', 'C', 'A'), -1, 1)] },
    { id: 'HW4', kind: '检验', text: '社会吸收：两次虚惊后措手不及不明显增多', terms: [small('措手不及 D−A', diff('e3.surprised', 'D', 'A'), -Infinity, 1, 0.5)] },
    { id: 'HW5a', kind: '检验', text: '虚报比漏报更伤信任', terms: [pos('信任 E−D', diff('trustE3', 'E', 'D'))] },
    { id: 'HW5b', kind: '检验', text: '虚报比漏报更伤照做', terms: [pos('改安排 E−D', diff('e3.intended', 'E', 'D'))] },
    { id: 'W-r1', kind: '报告', text: 'E3 查证：两次虚惊 vs 没有前情', terms: [pos('查证 D−A', diff('e3.verified', 'D', 'A'))] },
    { id: 'W-r2', kind: '报告', text: 'E3 半数相信用时：两次虚惊 vs 没有前情', terms: [pos('t50 D−A', diff('e3.t50', 'D', 'A'))] },
    { id: 'W-r3', kind: '报告', text: 'E3 听到但不信：两次虚惊 vs 没有前情', terms: [pos('不信 D−A', diff('e3.disbelieved', 'D', 'A'))] },
  ],
};

// ---------------------------------------------------------------- K 知沟

const K: Case = {
  id: 'K',
  name: '经典·知沟（老人与青年）',
  base: (s) => labTown(s, { population: { size: 60, seniors: 0.4, youth: 0.3, northShare: 0.5 } } as Partial<TownSpec>),
  branches: {
    A: { label: '只发网站', patches: [{ event: '$first', channels: ['website'] }] },
    B: { label: '网站 + 推送', patches: [{ event: '$first', channels: ['website', 'push'] }] },
    C: { label: '网站 + 公告栏', patches: [{ event: '$first', channels: ['website', 'board'] }] },
    D: { label: '三渠道', patches: [{ event: '$first', channels: [...ALL3] }] },
  },
  probes: ['groups'],
  derive: (d) => {
    const g = d.extra?.groups?.E1 ?? {};
    const y = g.youth ?? {};
    const s = g.senior ?? {};
    const share = (x: Record<string, number>, k: string, n = 'n') => (num(x[n], 0) > 0 ? (100 * num(x[k], 0)) / num(x[n]) : Number.NaN);
    return {
      't50.youth': t50(y.t50),
      't50.senior': t50(s.t50),
      speedGap: t50(s.t50) - t50(y.t50),
      'aware.youth': share(y, 'aware'),
      'aware.senior': share(s, 'aware'),
      awareGap: share(y, 'aware') - share(s, 'aware'),
      'exact.youth': share(y, 'exact'),
      'exact.senior': share(s, 'exact'),
      exactGap: share(y, 'exact') - share(s, 'exact'),
      'surprised.youth': share(y, 'surprisedArea', 'nArea'),
      'surprised.senior': share(s, 'surprisedArea', 'nArea'),
      surpriseGap: share(s, 'surprisedArea', 'nArea') - share(y, 'surprisedArea', 'nArea'),
    };
  },
  levels: ['t50.youth', 't50.senior', 'speedGap', 'aware.youth', 'aware.senior', 'exact.youth', 'exact.senior', 'surprised.youth', 'surprised.senior'],
  hypotheses: [
    { id: 'HK1', kind: '检验', text: '知沟（速度）：推送拉大速度差', terms: [pos('速度差 B−A', diff('speedGap', 'B', 'A'))] },
    { id: 'HK2', kind: '检验', text: '天花板（终局）：推送不拉大停电时的知情差', terms: [small('知情差 B−A（百分点）', diff('awareGap', 'B', 'A'), -5, 5)] },
    { id: 'HK3', kind: '检验', text: '公告栏缩小速度差', terms: [pos('速度差 A−C', diff('speedGap', 'A', 'C'))] },
    { id: 'HK4', kind: '检验', text: '推送带来“早知道”，不是“知道得准”', terms: [small('精确差 B−A（百分点）', diff('exactGap', 'B', 'A'), -Infinity, 5)] },
    { id: 'HK5', kind: '检验', text: '只发网站时老人更易措手不及；公告栏比推送更能缩小', terms: [pos('A 的措手不及差', val('surpriseGap', 'A')), pos('措手不及差 B−C', diff('surpriseGap', 'B', 'C'))] },
  ],
};

// ---------------------------------------------------------------- R 传话游戏

const R: Case = {
  id: 'R',
  name: '经典·传话游戏（磨平与“重要性 × 模糊度”）',
  base: (s) => labTown(s),
  branches: {
    A: { label: '标题写精确时段', patches: [{ event: '$first', headline: 'exact' }] },
    B: { label: '标题只写“下午”', patches: [{ event: '$first', headline: 'coarse' }] },
    C: { label: '标题不写时间', patches: [{ event: '$first', headline: 'none' }] },
    D: { label: '不发通知，只有工单', patches: [{ event: '$first', silent: true }] },
  },
  probes: ['lineage'],
  derive: (d) => {
    const l = d.extra?.lineage?.E1 ?? {};
    const h = (k: string) => l.byHop?.[k] ?? { n: 0, exact: 0 };
    const share = (k: string) => (h(k).n > 0 ? h(k).exact / h(k).n : Number.NaN);
    return {
      distortedEver: num(l.distortedEver, 0),
      versions: d.metrics.outages.E1!.versions,
      relays: num(l.relays?.north, 0) + num(l.relays?.south, 0),
      relayNorth: num(l.relayPerCapita?.north, 0),
      relaySouth: num(l.relayPerCapita?.south, 0),
      relayNS: num(l.relayPerCapita?.north, 0) - num(l.relayPerCapita?.south, 0),
      allDayEver: d.metrics.outages.E1!.allDayEver,
      exactHop1: share('1'),
      exactHop2: share('2'),
      exactHop3: share('3'),
      decay: share('1') - share('3'),
      aware: d.metrics.outages.E1!.aware,
      surprised: d.metrics.outages.E1!.surprisedPeople,
    };
  },
  levels: ['distortedEver', 'versions', 'relays', 'relayNorth', 'relaySouth', 'allDayEver', 'exactHop1', 'exactHop2', 'exactHop3', 'aware', 'surprised'],
  hypotheses: [
    { id: 'HR1', kind: '检验', text: '模糊度越高，信过走样版本的人越多', terms: [pos('走样 B−A', diff('distortedEver', 'B', 'A')), pos('走样 C−B', diff('distortedEver', 'C', 'B')), pos('走样 D−C', diff('distortedEver', 'D', 'C'))] },
    { id: 'HR2', kind: '检验', text: '重要性：北区人均转述多于南区', terms: [pos('B 北−南', val('relayNS', 'B')), pos('D 北−南', val('relayNS', 'D'))] },
    {
      id: 'HR3',
      kind: '检验',
      text: '重要性 × 模糊度：模糊度对转述的推动在北区更大',
      terms: [
        pos('差中差', [
          { key: 'relayNorth', branch: 'D', sign: 1 },
          { key: 'relayNorth', branch: 'A', sign: -1 },
          { key: 'relaySouth', branch: 'D', sign: -1 },
          { key: 'relaySouth', branch: 'A', sign: 1 },
        ]),
      ],
    },
    { id: 'HR4', kind: '演示', text: '磨平：没有官方原文时，精确时段随手数衰减', terms: [pos('D 第1手−第3手', val('decay', 'D'))] },
    { id: 'HR5', kind: '检验', text: '官方原文把走样拉回来：有通知时衰减更平缓', terms: [pos('衰减 D−B', diff('decay', 'D', 'B'))] },
    { id: 'HR6', kind: '检验', text: '同化：“全天”只在缺时间信息时出现', terms: [level('A 的全天', val('allDayEver', 'A'), 0.5), level('B 的全天', val('allDayEver', 'B'), 0.5), pos('全天 D−B', diff('allDayEver', 'D', 'B'))] },
  ],
};

export const CASES: Case[] = [W, K, R];

// ---------------------------------------------------------------- 运行

async function runRule(ids: string[]): Promise<void> {
  for (const c of CASES.filter((x) => ids.includes(x.id))) {
    const jobs: Job[] = TOWN_SEEDS.flatMap((ts) => RUN_SEEDS.map((seed) => ({ base: c.base(ts), seed, branches: c.branches, variants: [{ id: 'default' }], tags: { case: c.id, town: ts }, probes: c.probes })));
    await runPool(jobs, `data/lab/case-${c.id}.jsonl`, { label: c.name });
  }
}

async function runUi(ids: string[], provider: 'rule' | 'jev'): Promise<void> {
  const { openLab, runManifest } = await import('./lab-db.ts');
  const { store, runs, exps } = openLab();
  const file = 'data/lab/cases-ui.json';
  const out: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const spend0 = store.spend();
  await Promise.all(
    CASES.filter((x) => ids.includes(x.id)).map(async (c) => {
      const { id: scId, scenario: sc } = runs.scenarios.register(c.base(42), 'api');
      const m: ExperimentManifest = {
        id: `${c.id}-${provider}`,
        name: `${c.name}${provider === 'jev' ? ' · Jev' : ''}`,
        scenario: scId,
        seeds: provider === 'jev' ? JEV_SEEDS : RUN_SEEDS,
        provider,
        forkAt: formatTime(forkTimeFor(sc, c.branches)),
        until: formatTime(untilFor(sc)),
        branches: c.branches,
      };
      const r = await runManifestWithProbe(exps, store, m, c.probes);
      out[`${c.id}:${provider}`] = r.id;
      writeFileSync(file, JSON.stringify(out, null, 1));
      console.log(c.id, provider, r.id);
      void runManifest;
    }),
  );
  console.log('spend $', (store.spend() - spend0).toFixed(4), 'total local $', store.spend().toFixed(4));
}

async function runManifestWithProbe(exps: import('../../apps/server/src/experiments.ts').ExperimentRunner, store: import('../../apps/server/src/db.ts').Store, m: ExperimentManifest, probes: ProbeName[]): Promise<{ id: string }> {
  const t0 = Date.now();
  const id = exps.start(m, probes.length ? { probe: (sc: ScenarioDef) => makeProbe(probes, sc) } : {});
  const tick = setInterval(() => {
    const x = exps.live.get(id);
    if (x) process.stderr.write(`${m.name} · ${Math.round((Date.now() - t0) / 1000)}s · seed ${x.seedIndex + 1}/${x.seeds} ${Object.entries(x.progress).map(([k, v]) => `${k}:${Math.round(v * 100)}%`).join(' ')}\n`);
  }, 60000);
  await exps.wait(id);
  clearInterval(tick);
  const e = store.experiment(id)!;
  if (e.status !== 'done') throw new Error(`${m.name} 失败：${e.error}`);
  return { id };
}

// ---------------------------------------------------------------- 判定

type Unit = Record<string, Record<string, number>>;

const median = (xs: number[]): number => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return Number.NaN;
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)]! + s[Math.ceil(m)]!) / 2;
};
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);

function judge(h: Hypothesis, units: Unit[]) {
  const terms = h.terms.map((t) => {
    const xs = units.map((u) => t.parts.reduce((acc, p) => acc + p.sign * (u[p.branch]?.[p.key] ?? Number.NaN), 0)).filter(Number.isFinite);
    const m = median(xs);
    const posShare = xs.filter((x) => x > 0).length / Math.max(1, xs.length);
    const negShare = xs.filter((x) => x < 0).length / Math.max(1, xs.length);
    let grade: 0 | 1 | 2;
    if (t.type === 'positive') grade = posShare >= 0.7 ? 2 : posShare <= 0.5 ? 0 : 1;
    else if (t.type === 'small') grade = m >= (t.lo ?? -Infinity) && m < (t.hi ?? Infinity) && (t.maxPos === undefined || posShare <= t.maxPos) ? 2 : 0;
    else grade = m <= (t.hi ?? 0) ? 2 : 0;
    return { label: t.label, type: t.type, median: r3(m), pos: r3(posShare), neg: r3(negShare), n: xs.length, grade };
  });
  const verdict = h.kind === '报告' ? '报告' : terms.every((t) => t.grade === 2) ? '支持' : terms.every((t) => t.grade === 0) ? '不支持' : '部分支持';
  return { kind: h.kind, text: h.text, verdict, terms };
}

function unitsFromRows(c: Case, rows: Row[]): Unit[] {
  const by = new Map<string, Unit>();
  for (const r of rows) {
    const k = `${r.tags.town}:${r.seed}`;
    let u = by.get(k);
    if (!u) by.set(k, (u = {}));
    u[r.branch] = c.derive({ metrics: r.metrics, trustAt: r.trustAt, ...(r.extra ? { extra: r.extra as Record<string, any> } : {}) });
  }
  return [...by.values()];
}

function unitsFromResult(c: Case, r: ExperimentResult): Unit[] {
  return r.seeds.map((_, i) => Object.fromEntries(Object.entries(r.branches).map(([k, b]) => [k, c.derive({ metrics: b.perSeed[i]!, trustAt: b.perSeed[i]!.trustAt, ...(b.perSeed[i]!.extra ? { extra: b.perSeed[i]!.extra as Record<string, any> } : {}) })])));
}

async function analyze(): Promise<void> {
  const ui: Record<string, string> = existsSync('data/lab/cases-ui.json') ? JSON.parse(readFileSync('data/lab/cases-ui.json', 'utf8')) : {};
  const { DatabaseSync } = await import('node:sqlite');
  const db = Object.keys(ui).length ? new DatabaseSync('data/microcity.sqlite', { readOnly: true }) : undefined;
  const exp = (id: string): ExperimentResult | undefined => {
    const row = db?.prepare('SELECT result FROM experiments WHERE id = ?').get(id) as { result: string | null } | undefined;
    return row?.result ? (JSON.parse(row.result) as ExperimentResult) : undefined;
  };
  const out: Record<string, unknown> = {};
  for (const c of CASES) {
    const file = `data/lab/case-${c.id}.jsonl`;
    const rule = existsSync(file) ? unitsFromRows(c, readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Row)) : [];
    const jr = ui[`${c.id}:jev`] ? exp(ui[`${c.id}:jev`]!) : undefined;
    const jev = jr ? unitsFromResult(c, jr) : [];
    const levels = (units: Unit[]) => Object.fromEntries(Object.keys(c.branches).map((b) => [b, Object.fromEntries(c.levels.map((k) => [k, r3(median(units.map((u) => u[b]?.[k] ?? Number.NaN)))]))]));
    const mode = (units: Unit[]) => (units.length ? { n: units.length, levels: levels(units), hypotheses: Object.fromEntries(c.hypotheses.map((h) => [h.id, judge(h, units)])) } : null);
    const res = { name: c.name, branches: Object.fromEntries(Object.entries(c.branches).map(([k, b]) => [k, b.label])), rule: mode(rule), jev: mode(jev), ui: { rule: ui[`${c.id}:rule`] ?? null, jev: ui[`${c.id}:jev`] ?? null } };
    out[c.id] = res;
    console.log(`\n==== ${c.name}`);
    for (const m of ['rule', 'jev'] as const) {
      const x = res[m];
      if (!x) continue;
      console.log(`-- ${m}（${x.n} 次重复）`);
      for (const [b, lv] of Object.entries(x.levels)) console.log(`  ${b} ${c.branches[b]!.label.padEnd(10)} ${Object.entries(lv).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      for (const [hid, h] of Object.entries(x.hypotheses)) console.log(`  ${hid} [${h.kind}·${h.verdict}] ${h.text} · ${h.terms.map((t) => `${t.label} 中位 ${t.median} 正 ${Math.round(t.pos * 100)}% 负 ${Math.round(t.neg * 100)}%`).join(' | ')}`);
    }
  }
  mkdirSync('docs/experiments/results', { recursive: true });
  writeFileSync('docs/experiments/results/cases.json', JSON.stringify(out, null, 1));
}

// 只在直接运行时执行（被 gallery.ts 引用时不跑）
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = 'rule', which = 'W,K,R', prov = 'rule'] = process.argv.slice(2);
  const ids = which.split(',');
  if (cmd === 'rule') await runRule(ids);
  if (cmd === 'ui') await runUi(ids, prov === 'jev' ? 'jev' : 'rule');
  if (cmd === 'rule' || cmd === 'analyze') await analyze();
}
