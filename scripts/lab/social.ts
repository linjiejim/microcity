// S1–S6 社会实验：定义、规则模式批量运行（3 座镇 × 20 seed）、按预注册的判定规则检验假设
// 用法：
//   node --import tsx --no-warnings scripts/lab/social.ts rule [S1,S2…]      规则模式批量（内存里跑，不写库）
//   node --import tsx --no-warnings scripts/lab/social.ts ui [S1,…] [rule|jev] 登记到主库（dev 服务要先停），复盘里能打开
//   node --import tsx --no-warnings scripts/lab/social.ts analyze             汇总两种模式的检验结果
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { formatTime, forkTimeFor, untilFor, type BranchSpec, type ExperimentManifest, type ParamPatch, type TownSpec } from '@microcity/sim';
import type { ExperimentResult } from '../../apps/server/src/experiments.ts';
import { runPool, type Job, type Row } from './pool.ts';
import { SECOND_WAVE, labTown } from './towns.ts';

export const TOWN_SEEDS = [42, 7, 99];
const RUN_SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const JEV_SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const ALL3 = ['website', 'push', 'board'] as const;

export interface Experiment {
  id: string;
  name: string;
  base: (seed: number) => TownSpec;
  branches: Record<string, BranchSpec>;
  /** 整个实验的参数覆盖（例如在 v1 参数下对照） */
  params?: ParamPatch;
  /** 探索性：不在预注册里，看了预注册实验的结果后才设计的 */
  exploratory?: string;
  hypotheses: Hypothesis[];
}

/** 假设 = 若干个“预测为正”的配对差；type 决定怎么判定 */
export interface Hypothesis {
  id: string;
  text: string;
  /** 每一项：指标键（'E1.t50'、'trustAt.E2.govMean'…）与分支表达式 */
  terms: Array<{ key: string; plus: string[]; minus: string[]; label: string }>;
  /** positive：差 > 0；small：中位差落在 [lo, hi) 且不反向 */
  type: 'positive' | 'small' | 'report';
  lo?: number;
  hi?: number;
}

const T = (key: string, plus: string[], minus: string[], label: string) => ({ key, plus, minus, label });

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'S1',
    name: 'S1 渠道×标题',
    base: (s) => labTown(s),
    branches: {
      A: { label: '少推送·模糊标题', town: { media: { push: 0.1 } }, patches: [{ event: '$first', headline: 'coarse' }] },
      B: { label: '少推送·精确标题', town: { media: { push: 0.1 } }, patches: [{ event: '$first', headline: 'exact' }] },
      C: { label: '多推送·模糊标题', town: { media: { push: 0.7 } }, patches: [{ event: '$first', headline: 'coarse' }] },
      D: { label: '多推送·精确标题', town: { media: { push: 0.7 } }, patches: [{ event: '$first', headline: 'exact' }] },
    },
    hypotheses: [
      { id: 'H1a', text: '推送多的镇信得更快', type: 'positive', terms: [T('E1.t50', ['A'], ['C'], 't50 A−C'), T('E1.t50', ['B'], ['D'], 't50 B−D')] },
      { id: 'H1b', text: '精确标题减少过度调整', type: 'positive', terms: [T('E1.overreactMin', ['A'], ['B'], '过度 A−B'), T('E1.overreactMin', ['C'], ['D'], '过度 C−D')] },
      { id: 'H1c', text: '标题模糊时推送越多过度调整越多；精确时不然（差中差 > 0）', type: 'positive', terms: [T('E1.overreactMin', ['C', 'B'], ['A', 'D'], '(C−A)−(D−B)')] },
      { id: 'H1d', text: '推送多的镇措手不及略少，差距 < 2 人', type: 'small', lo: 0, hi: 2, terms: [T('E1.surprisedPeople', ['A'], ['C'], '措手不及 A−C')] },
    ],
  },
  {
    id: 'S2',
    name: 'S2 信任文化×渠道',
    base: (s) => labTown(s),
    branches: {
      A: { label: '高信任·无推送', town: { culture: { trustGov: 0.8 } }, patches: [{ event: '$first', channels: ['website', 'board'] }] },
      B: { label: '高信任·有推送', town: { culture: { trustGov: 0.8 } }, patches: [{ event: '$first', channels: [...ALL3] }] },
      C: { label: '低信任·无推送', town: { culture: { trustGov: 0.3 } }, patches: [{ event: '$first', channels: ['website', 'board'] }] },
      D: { label: '低信任·有推送', town: { culture: { trustGov: 0.3 } }, patches: [{ event: '$first', channels: [...ALL3] }] },
    },
    hypotheses: [
      { id: 'H2a', text: '低信任的镇信得更慢、不信与查证的人更多', type: 'positive', terms: [T('E1.t50', ['C'], ['A'], 't50 C−A'), T('E1.t50', ['D'], ['B'], 't50 D−B'), T('E1.disbelieved', ['C', 'D'], ['A', 'B'], '不信 低−高'), T('E1.verified', ['C', 'D'], ['A', 'B'], '查证 低−高')] },
      { id: 'H2b', text: '低信任的镇信过“全天”的人更多', type: 'positive', terms: [T('E1.allDayEver', ['C', 'D'], ['A', 'B'], '全天 低−高')] },
      { id: 'H2c', text: '推送的提速在低信任的镇更小（差中差 > 0）', type: 'positive', terms: [T('E1.t50', ['A', 'D'], ['B', 'C'], '(A−B)−(C−D)')] },
      { id: 'H2d', text: '低信任的镇措手不及的人更多', type: 'positive', terms: [T('E1.surprisedPeople', ['C', 'D'], ['A', 'B'], '措手不及 低−高')] },
    ],
  },
  {
    id: 'S3',
    name: 'S3 焦虑与谣言',
    base: (s) => labTown(s),
    branches: {
      A: { label: '焦虑 0.25', town: { culture: { anxiety: 0.25 } } },
      B: { label: '焦虑 0.45', town: { culture: { anxiety: 0.45 } } },
      C: { label: '焦虑 0.65', town: { culture: { anxiety: 0.65 } } },
    },
    hypotheses: [
      { id: 'H3a', text: '信过“全天”的人随焦虑单调上升', type: 'positive', terms: [T('E1.allDayEver', ['B'], ['A'], '全天 B−A'), T('E1.allDayEver', ['C'], ['B'], '全天 C−B')] },
      { id: 'H3b', text: '过度调整随焦虑上升', type: 'positive', terms: [T('E1.overreactMin', ['B'], ['A'], '过度 B−A'), T('E1.overreactMin', ['C'], ['B'], '过度 C−B')] },
      { id: 'H3c', text: '措手不及随焦虑下降（谣言是保险）', type: 'positive', terms: [T('E1.surprisedPeople', ['A'], ['B'], '措手不及 A−B'), T('E1.surprisedPeople', ['B'], ['C'], '措手不及 B−C')] },
    ],
  },
  {
    id: 'S4',
    name: 'S4 跨区关系',
    base: (s) => labTown(s),
    branches: {
      A: { label: '跨区关系 0.05', town: { network: { crossDistrict: 0.05 } } },
      B: { label: '跨区关系 0.3', town: { network: { crossDistrict: 0.3 } } },
      C: { label: '跨区关系 0.6', town: { network: { crossDistrict: 0.6 } } },
    },
    hypotheses: [
      { id: 'H4a', text: '跨区关系越多，停电时已知情的人越多', type: 'positive', terms: [T('E1.aware', ['B'], ['A'], '知情 B−A'), T('E1.aware', ['C'], ['B'], '知情 C−B')] },
      { id: 'H4b', text: '停电区外改了安排的人随跨区关系上升', type: 'positive', terms: [T('E1.intendedOutside', ['B'], ['A'], '外溢 B−A'), T('E1.intendedOutside', ['C'], ['B'], '外溢 C−B')] },
      { id: 'H4c', text: '措手不及基本不受影响（|中位差| < 1）', type: 'small', lo: -1, hi: 1, terms: [T('E1.surprisedPeople', ['C'], ['A'], '措手不及 C−A')] },
    ],
  },
  {
    id: 'S4b',
    name: 'S4b 跨区关系（只发网站）',
    exploratory: 'S4 在三渠道发布下触顶（60 人里 59 人停电前已知情），关系网没有发挥作用的余地；改成只在网站发布，让口耳相传成为主要通路。',
    base: (s) => labTown(s),
    branches: {
      A: { label: '跨区关系 0.05', town: { network: { crossDistrict: 0.05 } }, patches: [{ event: '$first', channels: ['website'] }] },
      B: { label: '跨区关系 0.3', town: { network: { crossDistrict: 0.3 } }, patches: [{ event: '$first', channels: ['website'] }] },
      C: { label: '跨区关系 0.6', town: { network: { crossDistrict: 0.6 } }, patches: [{ event: '$first', channels: ['website'] }] },
    },
    hypotheses: [
      { id: 'H4a', text: '跨区关系越多，停电时已知情的人越多', type: 'positive', terms: [T('E1.aware', ['B'], ['A'], '知情 B−A'), T('E1.aware', ['C'], ['B'], '知情 C−B')] },
      { id: 'H4b', text: '停电区外改了安排的人随跨区关系上升', type: 'positive', terms: [T('E1.intendedOutside', ['B'], ['A'], '外溢 B−A'), T('E1.intendedOutside', ['C'], ['B'], '外溢 C−B')] },
      { id: 'H4c', text: '措手不及基本不受影响（|中位差| < 1）', type: 'small', lo: -1, hi: 1, terms: [T('E1.surprisedPeople', ['C'], ['A'], '措手不及 C−A')] },
    ],
  },
  {
    id: 'S5',
    name: 'S5 失信的代价（两轮）',
    base: (s) => labTown(s, { events: [...labTown(s).events, structuredClone(SECOND_WAVE)] } as Partial<TownSpec>),
    branches: {
      A: { label: 'E1 精确通知', patches: [{ event: 'E1', headline: 'exact' }] },
      B: { label: 'E1 不发通知', patches: [{ event: 'E1', silent: true }] },
      C: { label: 'E1 模糊标题', patches: [{ event: 'E1', headline: 'coarse' }] },
    },
    hypotheses: [
      { id: 'H5a', text: 'E1 之后对官方的信任 B < C < A', type: 'positive', terms: [T('trustAt.E2.govMean', ['A'], ['C'], '信任 A−C'), T('trustAt.E2.govMean', ['C'], ['B'], '信任 C−B')] },
      { id: 'H5b', text: 'E2 的相信速度 B 慢于 A，查证 B 多于 A', type: 'positive', terms: [T('E2.t50', ['B'], ['A'], 'E2 t50 B−A'), T('E2.verified', ['B'], ['A'], 'E2 查证 B−A')] },
      { id: 'H5c', text: 'E2 措手不及 B ≥ A，但差距 < 2 人', type: 'small', lo: 0, hi: 2, terms: [T('E2.surprisedPeople', ['B'], ['A'], 'E2 措手不及 B−A')] },
      { id: 'H5d', text: 'E2 改了安排的人：B 比 A 多还是少（不预设方向）', type: 'report', terms: [T('E2.intended', ['B'], ['A'], 'E2 改安排 B−A')] },
    ],
  },
  {
    id: 'S5b',
    name: 'S5b 失信的代价（第二轮只发网站）',
    exploratory: 'S5 的第二轮通知很强（三渠道、精确标题），几乎人人都知道，信任下降没有机会影响行为；把第二轮改成只在网站发布，看信任在官方渠道弱的时候是否要紧。',
    base: (s) => labTown(s, { events: [...labTown(s).events, { ...structuredClone(SECOND_WAVE), notice: { ...structuredClone(SECOND_WAVE.notice), channels: ['website'] } }] } as Partial<TownSpec>),
    branches: {
      A: { label: 'E1 精确通知', patches: [{ event: 'E1', headline: 'exact' }] },
      B: { label: 'E1 不发通知', patches: [{ event: 'E1', silent: true }] },
      C: { label: 'E1 模糊标题', patches: [{ event: 'E1', headline: 'coarse' }] },
    },
    hypotheses: [
      { id: 'H5a', text: 'E1 之后对官方的信任 B < C < A', type: 'positive', terms: [T('trustAt.E2.govMean', ['A'], ['C'], '信任 A−C'), T('trustAt.E2.govMean', ['C'], ['B'], '信任 C−B')] },
      { id: 'H5b', text: 'E2 的相信速度 B 慢于 A', type: 'positive', terms: [T('E2.t50', ['B'], ['A'], 'E2 t50 B−A')] },
      { id: 'H5c′', text: '第二轮通知弱时，E2 措手不及 B 多于 A', type: 'positive', terms: [T('E2.surprisedPeople', ['B'], ['A'], 'E2 措手不及 B−A')] },
      { id: 'H5d', text: 'E2 改了安排的人：B 比 A 多还是少（不预设方向）', type: 'report', terms: [T('E2.intended', ['B'], ['A'], 'E2 改安排 B−A')] },
    ],
  },
  {
    id: 'S7',
    name: 'S7 连续失信（三轮）',
    exploratory: 'S5/S5b 里一次沉默的代价被吸收了；模型里官方通知的可信度有下限（0.5 + 0.45 × 信任），推测再多几次沉默也不会出现“不信官方”的临界点。三轮同区停电，前两轮都不通知，第三轮只在网站发。',
    base: (s) =>
      labTown(s, {
        events: [
          { id: 'E1', area: 'north', day: 3, from: '14:00', to: '16:00', notice: { at: 'D02 08:05', channels: ['website', 'push', 'board'], headline: 'exact', advice: ['charge_devices'] }, clarify: null, workOrder: true },
          { id: 'E2', area: 'north', day: 5, from: '14:00', to: '16:00', notice: { at: 'D04 08:05', channels: ['website', 'push', 'board'], headline: 'exact', advice: ['charge_devices'] }, clarify: null, workOrder: true },
          { id: 'E3', area: 'north', day: 7, from: '14:00', to: '16:00', notice: { at: 'D06 08:05', channels: ['website'], headline: 'exact', advice: ['charge_devices'] }, clarify: null, workOrder: true },
        ],
      } as Partial<TownSpec>),
    branches: {
      A: { label: '两轮都如实通知' },
      B: { label: '两轮都不通知', patches: [{ event: 'E1', silent: true }, { event: 'E2', silent: true }] },
    },
    hypotheses: [
      { id: 'H7a', text: 'E3 开始时对官方的信任 B < A', type: 'positive', terms: [T('trustAt.E3.govMean', ['A'], ['B'], '信任 A−B')] },
      { id: 'H7b', text: '没有临界点：E3 听到但不信的人 B 与 A 相差 < 1 人', type: 'small', lo: -1, hi: 1, terms: [T('E3.disbelieved', ['B'], ['A'], 'E3 不信 B−A')] },
      { id: 'H7c', text: 'E3 措手不及：B 比 A 多还是少（不预设方向）', type: 'report', terms: [T('E3.surprisedPeople', ['B'], ['A'], 'E3 措手不及 B−A')] },
      { id: 'H7d', text: 'E3 改了安排的人：B 比 A 多还是少（不预设方向）', type: 'report', terms: [T('E3.intended', ['B'], ['A'], 'E3 改安排 B−A')] },
    ],
  },
  {
    id: 'S6',
    name: 'S6 澄清时机',
    base: (s) => labTown(s),
    branches: {
      A: { label: '不澄清' },
      B: { label: '当天中午澄清', patches: [{ event: 'E1', clarify: { at: 'D03 12:00', channels: [...ALL3] } }] },
      C: { label: '当晚澄清', patches: [{ event: 'E1', clarify: { at: 'D03 20:00', channels: [...ALL3] } }] },
      D: { label: '停电当天上午澄清', patches: [{ event: 'E1', clarify: { at: 'D04 11:00', channels: [...ALL3] } }] },
    },
    hypotheses: [
      { id: 'H6a', text: '任何澄清都减少过度调整，越早越好（B < C < D < A）', type: 'positive', terms: [T('E1.overreactMin', ['A'], ['D'], '过度 A−D'), T('E1.overreactMin', ['D'], ['C'], '过度 D−C'), T('E1.overreactMin', ['C'], ['B'], '过度 C−B')] },
      { id: 'H6b', text: '澄清增加停电时知道精确时段的人', type: 'positive', terms: [T('E1.exact', ['B'], ['A'], '精确 B−A'), T('E1.exact', ['C'], ['A'], '精确 C−A'), T('E1.exact', ['D'], ['A'], '精确 D−A')] },
      { id: 'H6c', text: '停电当天上午的澄清对过度调整几乎无效（减少 < 不澄清时的 15%）', type: 'small', lo: -Infinity, hi: 0.15, terms: [T('E1.overreactMin/ref:A', ['A'], ['D'], '过度 (A−D)/A')] },
    ],
  },
];

// ---------------------------------------------------------------- 运行

function jobsOf(x: Experiment): Job[] {
  return TOWN_SEEDS.flatMap((ts) => RUN_SEEDS.map((seed) => ({ base: x.base(ts), seed, branches: x.branches, variants: [{ id: 'default', ...(x.params ? { params: x.params } : {}) }], tags: { exp: x.id, town: ts } })));
}

async function runRule(ids: string[]): Promise<void> {
  for (const x of EXPERIMENTS.filter((e) => ids.includes(e.id))) await runPool(jobsOf(x), `data/lab/social-${x.id}.jsonl`, { label: x.name });
}

async function runUi(ids: string[], provider: 'rule' | 'jev'): Promise<void> {
  const { openLab, runManifest } = await import('./lab-db.ts');
  const { store, runs, exps } = openLab();
  const file = 'data/lab/social-ui.json';
  const out: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const spend0 = store.spend();
  // 同一个进程里并发跑（SQLite 写入串行；Jev 的等待互相重叠）
  await Promise.all(
    EXPERIMENTS.filter((e) => ids.includes(e.id)).map(async (x) => {
      const { id: scId, scenario: sc } = runs.scenarios.register(x.base(42), 'api');
      const m: ExperimentManifest = {
        id: `${x.id}-${provider}`,
        name: `${x.name}${provider === 'jev' ? ' · Jev' : ''}`,
        scenario: scId,
        seeds: provider === 'jev' ? JEV_SEEDS : RUN_SEEDS,
        provider,
        forkAt: formatTime(forkTimeFor(sc, x.branches)),
        until: formatTime(untilFor(sc)),
        branches: x.branches,
        ...(x.params ? { params: x.params } : {}),
      };
      const r = await runManifest(exps, store, m);
      out[`${x.id}:${provider}`] = r.id;
      writeFileSync(file, JSON.stringify(out, null, 1));
      console.log(x.id, provider, r.id);
    }),
  );
  console.log('spend $', (store.spend() - spend0).toFixed(4), 'total local $', store.spend().toFixed(4));
}

// ---------------------------------------------------------------- 检验

const NEVER = 7 * 86400;
function metric(m: { outages: Record<string, Record<string, unknown>>; trustAt?: Record<string, Record<string, number>> }, key: string): number {
  if (key.startsWith('trustAt.')) {
    const [, oid, k] = key.split('.');
    return m.trustAt?.[oid!]?.[k!] ?? NaN;
  }
  const [oid, k] = key.split('/')[0]!.split('.') as [string, string];
  const v = m.outages[oid]?.[k];
  return typeof v === 'number' ? v : k === 't50' || k === 't80' ? NEVER : NaN;
}

interface Unit {
  /** 同一座镇、同一个 seed 的各分支指标 */
  branches: Record<string, Parameters<typeof metric>[0]>;
}

function termValues(units: Unit[], t: Hypothesis['terms'][number]): number[] {
  const ref = t.key.includes('/ref:') ? t.key.split('/ref:')[1]! : null;
  return units
    .map((u) => {
      const s = (bs: string[]) => bs.reduce((acc, b) => acc + metric(u.branches[b]!, t.key), 0);
      const d = s(t.plus) - s(t.minus);
      return ref ? d / Math.max(1, metric(u.branches[ref]!, t.key)) : d;
    })
    .filter(Number.isFinite);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)]! + s[Math.ceil(m)]!) / 2;
};

export function judge(h: Hypothesis, units: Unit[]): { verdict: string; terms: Array<{ label: string; key: string; median: number; pos: number; neg: number; n: number }> } {
  const terms = h.terms.map((t) => {
    const d = termValues(units, t);
    return { label: t.label, key: t.key, median: Math.round(median(d) * 1000) / 1000, pos: Math.round((d.filter((x) => x > 0).length / d.length) * 100) / 100, neg: Math.round((d.filter((x) => x < 0).length / d.length) * 100) / 100, n: d.length };
  });
  let verdict: string;
  if (h.type === 'report') verdict = '报告';
  else if (h.type === 'small') {
    const ok = terms.every((t) => t.median >= (h.lo ?? -Infinity) && t.median < (h.hi ?? Infinity) && (h.lo === undefined || h.lo < 0 || t.pos >= t.neg));
    verdict = ok ? '支持' : '不支持';
  } else {
    const each = terms.map((t) => (t.pos >= 0.7 ? 2 : t.pos <= 0.5 ? 0 : 1));
    verdict = each.every((x) => x === 2) ? '支持' : each.every((x) => x === 0) ? '不支持' : '部分支持';
  }
  return { verdict, terms };
}

function unitsFromRows(rows: Row[]): Unit[] {
  const by = new Map<string, Unit>();
  for (const r of rows) {
    const k = `${r.tags.town}:${r.seed}`;
    let u = by.get(k);
    if (!u) by.set(k, (u = { branches: {} }));
    u.branches[r.branch] = { ...r.metrics, trustAt: r.trustAt } as unknown as Parameters<typeof metric>[0];
  }
  return [...by.values()];
}

function unitsFromResult(r: ExperimentResult): Unit[] {
  return r.seeds.map((_, i) => ({ branches: Object.fromEntries(Object.entries(r.branches).map(([k, b]) => [k, b.perSeed[i]! as unknown as Parameters<typeof metric>[0]])) }));
}

async function analyze(): Promise<void> {
  const ui: Record<string, string> = existsSync('data/lab/social-ui.json') ? JSON.parse(readFileSync('data/lab/social-ui.json', 'utf8')) : {};
  // 只读打开主库：实验可能还在另一个进程里写
  const { DatabaseSync } = await import('node:sqlite');
  const db = Object.keys(ui).length ? new DatabaseSync('data/microcity.sqlite', { readOnly: true }) : undefined;
  const store = db && {
    experiment: (id: string) => {
      const row = db.prepare('SELECT result FROM experiments WHERE id = ?').get(id) as { result: string | null } | undefined;
      return row?.result ? { result: JSON.parse(row.result) as ExperimentResult } : undefined;
    },
  };
  const out: Record<string, unknown> = {};
  for (const x of EXPERIMENTS) {
    const file = `data/lab/social-${x.id}.jsonl`;
    const rule = existsSync(file) ? unitsFromRows(readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Row)) : [];
    // 校准前（v1 模型）的同一批实验：若有存档
    const fileV1 = `data/lab/v1/social-${x.id}.jsonl`;
    const ruleV1 = existsSync(fileV1) ? unitsFromRows(readFileSync(fileV1, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Row)) : [];
    const jevId = ui[`${x.id}:jev`];
    const jr = jevId && store ? store.experiment(jevId) : undefined;
    const jev = jr ? unitsFromResult(jr.result) : [];
    const levels = (units: Unit[]) =>
      Object.fromEntries(
        Object.keys(x.branches).map((b) => [
          b,
          Object.fromEntries(
            ['E1.t50', 'E1.aware', 'E1.exact', 'E1.allDayEver', 'E1.intended', 'E1.intendedOutside', 'E1.surprisedPeople', 'E1.overreactMin', 'E1.disbelieved', 'E1.verified', ...(x.id === 'S7' ? ['trustAt.E3.govMean', 'E3.t50', 'E3.aware', 'E3.intended', 'E3.surprisedPeople', 'E3.overreactMin', 'E3.verified', 'E3.disbelieved'] : []), ...(x.id.startsWith('S5') ? ['trustAt.E2.govMean', 'E2.t50', 'E2.aware', 'E2.intended', 'E2.surprisedPeople', 'E2.overreactMin', 'E2.verified', 'E2.disbelieved'] : [])].map((k) => [k, median(units.map((u) => metric(u.branches[b]!, k)).filter(Number.isFinite))]),
          ),
        ]),
      );
    const res = {
      name: x.name,
      ...(x.exploratory ? { exploratory: x.exploratory } : {}),
      branches: Object.fromEntries(Object.entries(x.branches).map(([k, b]) => [k, b.label])),
      rule: rule.length ? { n: rule.length, levels: levels(rule), hypotheses: Object.fromEntries(x.hypotheses.map((h) => [h.id, { text: h.text, ...judge(h, rule) }])) } : null,
      ruleV1: ruleV1.length ? { n: ruleV1.length, levels: levels(ruleV1), hypotheses: Object.fromEntries(x.hypotheses.map((h) => [h.id, { text: h.text, ...judge(h, ruleV1) }])) } : null,
      jev: jev.length ? { n: jev.length, experiment: jevId, levels: levels(jev), hypotheses: Object.fromEntries(x.hypotheses.map((h) => [h.id, { text: h.text, ...judge(h, jev) }])) } : null,
      ui: { rule: ui[`${x.id}:rule`] ?? null, jev: jevId ?? null },
    };
    out[x.id] = res;
    console.log(`\n==== ${x.name}`);
    for (const mode of ['ruleV1', 'rule', 'jev'] as const) {
      const r = res[mode];
      if (!r) continue;
      console.log(`-- ${mode}（${r.n} 次重复）`);
      for (const [b, lv] of Object.entries(r.levels)) console.log(`  ${b} ${x.branches[b]!.label.padEnd(10)} ${Object.entries(lv).map(([k, v]) => `${k.replace('E1.', '')}=${Math.round((v as number) * 100) / 100}`).join(' ')}`);
      for (const [hid, h] of Object.entries(r.hypotheses)) console.log(`  ${hid} [${h.verdict}] ${h.text} · ${h.terms.map((t) => `${t.label} 中位 ${t.median} 正 ${Math.round(t.pos * 100)}% 负 ${Math.round(t.neg * 100)}%`).join(' | ')}`);
    }
  }
  mkdirSync('docs/experiments/results', { recursive: true });
  writeFileSync('docs/experiments/results/social.json', JSON.stringify(out, null, 1));
}

// 只在直接运行时执行（被 gallery.ts 引用时不跑）
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = 'rule', which = EXPERIMENTS.map((e) => e.id).join(','), prov = 'rule'] = process.argv.slice(2);
  const ids = which.split(',');
  if (cmd === 'rule') await runRule(ids);
  if (cmd === 'ui') await runUi(ids, prov === 'jev' ? 'jev' : 'rule');
  if (cmd === 'rule' || cmd === 'analyze') await analyze();
}
