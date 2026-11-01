import { randomUUID } from 'node:crypto';
import {
  Engine,
  applyTownPatch,
  beliefCensus,
  branchParams,
  branchScript,
  describeBranch,
  contentHash,
  dayStart,
  funnelMetrics,
  outcomeMetrics,
  parseTime,
  timeToShare,
  trustSummary,
  type BeliefCensus,
  type BranchSpec,
  type DecisionRecord,
  type DomainEvent,
  type ExperimentManifest,
  type Prediction,
  type OutageTruth,
  type ScenarioDef,
  type SimTime,
  type TrustSummary,
  type WorldState,
} from '@microcity/sim';
import { DecisionService, driveHeadless, type LiveRun, type RunManager } from './runs.ts';

/** 一轮停电在一个分支里的结果 */
export interface OutageMetrics {
  family: string;
  /** 从第一条关于它的信息出现起，半数/八成人相信用时（秒）；未达到为 null */
  t50: number | null;
  t80: number | null;
  /** 停电开始那一刻 */
  aware: number;
  exact: number;
  allDay: number;
  believed: number;
  intended: number;
  relayed: number;
  surprisedPeople: number;
  surprisedMin: number;
  affected: number;
  overreactMin: number;
  versions: number;
  /** 任何时候信过“全天”的人（谣言触达） */
  allDayEver: number;
  /** 听到了但不信 */
  disbelieved: number;
  /** 上网查证过 */
  verified: number;
  /** 家和单位都不在停电区、却改了安排的人（外溢） */
  intendedOutside: number;
  /** 停电开始前信过走样版本的人：时段不是真实的精确时段，或丢了地点（v3） */
  distortedEver: number;
  /** 按年龄：青年 18–29、老人 60+（v3）。知情、精确是停电那一刻的百分比；措手不及是住在停电区的组员里的百分比 */
  youthAware: number;
  seniorAware: number;
  youthExact: number;
  seniorExact: number;
  youthT50: number | null;
  seniorT50: number | null;
  youthSurprised: number;
  seniorSurprised: number;
  /** 老人比青年晚多久过半（秒；没过半按 7 天算）、青年比老人多知情 / 多知道精确时段（百分点） */
  gapT50: number;
  gapAware: number;
  gapExact: number;
}

/** 实验探针：脚本可以挂上自己的统计（事件、决策、每轮开始时的快照、结束时的汇总），结果存进 perSeed.extra */
export interface ExperimentProbe {
  event?(e: DomainEvent): void;
  record?(r: DecisionRecord): void;
  checkpoint?(outage: string, s: WorldState): void;
  finish(s: WorldState): Record<string, unknown>;
}

export interface BranchMetrics {
  seed: number;
  outages: Record<string, OutageMetrics>;
  trust: TrustSummary;
  /** 每轮停电开始那一刻的信任（看上一轮留下了什么） */
  trustAt?: Record<string, TrustSummary>;
  decisions: { total: number; byProvider: Record<string, number>; fallbacks: number };
  calls: { calls: number; cached: number; errors: number; cost: number; avgLatency: number };
  finalHash: string;
  /** 探针的汇总（只有脚本挂了探针时才有） */
  extra?: Record<string, unknown>;
}

export interface Stat {
  n: number;
  missing: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  values: Array<number | null>;
}

export interface Paired {
  better: number;
  worse: number;
  same: number;
  medianDiff: number | null;
}

/** 对照指标：哪个方向更好 */
export const METRIC_DEFS: Array<{ key: string; label: string; better: 'low' | 'high' | null; unit: 'sec' | 'person' | 'min' | 'count' | 'trust' | 'pp'; more?: boolean }> = [
  { key: 't50', label: '半数人相信用时', better: 'low', unit: 'sec' },
  { key: 't80', label: '八成人相信用时', better: 'low', unit: 'sec' },
  { key: 'aware', label: '停电时已知情', better: 'high', unit: 'person' },
  { key: 'exact', label: '停电时知道精确时段', better: 'high', unit: 'person' },
  { key: 'allDay', label: '停电时信“全天”', better: 'low', unit: 'person' },
  { key: 'intended', label: '改了安排', better: null, unit: 'person' },
  { key: 'surprisedPeople', label: '措手不及', better: 'low', unit: 'person' },
  { key: 'overreactMin', label: '过度调整', better: 'low', unit: 'min' },
  { key: 'versions', label: '主张版本数', better: null, unit: 'count' },
  { key: 'allDayEver', label: '信过“全天”', better: 'low', unit: 'person', more: true },
  { key: 'disbelieved', label: '听到但不信', better: null, unit: 'person', more: true },
  { key: 'verified', label: '上网查证过', better: null, unit: 'person', more: true },
  { key: 'intendedOutside', label: '停电区外改了安排', better: 'low', unit: 'person', more: true },
  { key: 'distortedEver', label: '信过走样版本', better: 'low', unit: 'person', more: true },
  { key: 'gapT50', label: '老人比青年晚多久过半', better: 'low', unit: 'sec', more: true },
  { key: 'gapAware', label: '青年比老人多知情', better: 'low', unit: 'pp', more: true },
  { key: 'gapExact', label: '青年比老人多知道精确时段', better: 'low', unit: 'pp', more: true },
];
export const TRUST_DEFS: Array<{ key: string; label: string; better: 'low' | 'high' | null; unit: 'trust' | 'count' }> = [
  { key: 'govDelta', label: '对官方信任的变化', better: 'high', unit: 'trust' },
  { key: 'tiesDown', label: '信任下降的关系', better: 'low', unit: 'count' },
];

/** 预测的判定 */
export interface PredictionVerdict {
  id: string;
  verdict: '支持' | '部分支持' | '不支持' | '无法判定';
  /** 配对差（a − b）的中位数 */
  median: number | null;
  /** a 高于 / 低于 b 的配对比例 */
  higher: number;
  lower: number;
  n: number;
}

export interface ExperimentResult {
  version: 3;
  forkT: SimTime;
  forkSeq: number;
  forkHash: string;
  baseRunId: string;
  seeds: number[];
  reference: string;
  outages: Array<{ id: string; family: string; area: string; day: number; from: number; to: number }>;
  branches: Record<string, { label: string; runId: string; perSeed: BranchMetrics[]; scenario: string; changes: string[] }>;
  stats: Record<string, Record<string, Stat>>;
  paired: Record<string, Record<string, Paired>>;
  predictions?: PredictionVerdict[];
}

function firstInfoAt(s: WorldState, family: string): number | undefined {
  let t = Infinity;
  for (const n of Object.values(s.news)) if (n.familyId === family) t = Math.min(t, n.publishedAt);
  for (const v of Object.values(s.versions)) if (v.familyId === family) t = Math.min(t, v.createdAt);
  return Number.isFinite(t) ? t : undefined;
}

/** 分支运行中边跑边记的量（快照里看不到的“曾经”） */
export class BranchTally {
  readonly allDay = new Map<string, Set<string>>();
  readonly verified = new Map<string, Set<string>>();
  readonly distorted = new Map<string, Set<string>>();
  private truth: Map<string, { start: number; from: number; to: number }>;
  constructor(outages: readonly OutageTruth[] = []) {
    this.truth = new Map(outages.map((o) => [o.family, { start: dayStart(o.day) + o.from, from: o.from, to: o.to }]));
  }
  event(e: DomainEvent): void {
    if (e.type !== 'belief_set') return;
    if (e.belief.slots.window?.kind === 'all_day') this.add(this.allDay, e.family, e.agent);
    const o = this.truth.get(e.family);
    if (o && e.t < o.start && e.belief.status !== 'disbelieve') {
      const w = e.belief.slots.window;
      if (!(w?.kind === 'exact' && w.from === o.from && w.to === o.to) || !e.belief.slots.area) this.add(this.distorted, e.family, e.agent);
    }
  }
  record(r: DecisionRecord): void {
    if (r.kind === 'reaction' && r.chosen[0] === 'verify' && r.commit.outcome === 'applied') this.add(this.verified, r.family, r.agent);
  }
  private add(m: Map<string, Set<string>>, family: string, agent: string): void {
    let x = m.get(family);
    if (!x) m.set(family, (x = new Set()));
    x.add(agent);
  }
}

export function branchMetrics(s: WorldState, sc: ScenarioDef, atStart: Record<string, BeliefCensus>, tally?: BranchTally): Pick<BranchMetrics, 'outages' | 'trust'> {
  const outages: Record<string, OutageMetrics> = {};
  const districtOf = (place?: string) => (place ? sc.map.places.find((p) => p.id === place)?.district : undefined);
  for (const o of sc.outages) {
    const f = funnelMetrics(s, o.family);
    const since = firstInfoAt(s, o.family);
    const c = atStart[o.id];
    const out = outcomeMetrics(s, o.id);
    const outside = Object.values(s.agents).filter((a) => a.funnel[o.family]?.intended !== undefined && districtOf(a.home) !== o.area && districtOf(a.workplace) !== o.area).length;
    const age = ageMetrics(s, o, since, c, districtOf);
    outages[o.id] = {
      family: o.family,
      t50: since === undefined ? null : timeToShare(f, 0.5, since),
      t80: since === undefined ? null : timeToShare(f, 0.8, since),
      aware: c?.aware ?? 0,
      exact: c?.exact ?? 0,
      allDay: c?.allDay ?? 0,
      believed: f.stages.believed,
      intended: f.stages.intended,
      relayed: f.stages.relayed,
      surprisedPeople: out.surprisedPeople,
      surprisedMin: out.surprisedMin,
      affected: out.affectedPeople,
      overreactMin: out.overreactMin,
      versions: Object.values(s.versions).filter((v) => v.familyId === o.family).length,
      allDayEver: tally?.allDay.get(o.family)?.size ?? 0,
      disbelieved: f.stops.disbelieved,
      verified: tally?.verified.get(o.family)?.size ?? 0,
      intendedOutside: outside,
      distortedEver: tally?.distorted.get(o.family)?.size ?? 0,
      ...age,
    };
  }
  return { outages, trust: trustSummary(s) };
}

const NEVER = 7 * 86400;
const pct = (x: number, n: number) => (n > 0 ? Math.round((1000 * x) / n) / 10 : 0);

/** 按年龄分组的知情、精确、半数相信用时与措手不及（青年 18–29、老人 60+） */
function ageMetrics(s: WorldState, o: OutageTruth, since: number | undefined, c: BeliefCensus | undefined, districtOf: (p?: string) => string | undefined) {
  const group = (lo: number, hi: number) => {
    const members = Object.values(s.agents).filter((a) => a.age >= lo && a.age <= hi);
    const ids = new Set(members.map((a) => a.id));
    const aware = Object.values(c?.holders ?? {}).flat().filter((id) => ids.has(id)).length;
    const exact = (c?.holders.exact ?? []).filter((id) => ids.has(id)).length;
    const times = members.map((a) => a.funnel[o.family]?.believed).filter((t): t is number => t !== undefined).sort((x, y) => x - y);
    const need = Math.ceil(members.length / 2);
    const inArea = members.filter((a) => districtOf(a.home) === o.area);
    return {
      aware: pct(aware, members.length),
      exact: pct(exact, members.length),
      t50: since !== undefined && need > 0 && times.length >= need ? times[need - 1]! - since : null,
      surprised: pct(inArea.filter((a) => (a.stats.byOutage[o.id]?.surprised ?? 0) > 0).length, inArea.length),
    };
  };
  const y = group(18, 29);
  const g = group(60, 200);
  return {
    youthAware: y.aware,
    seniorAware: g.aware,
    youthExact: y.exact,
    seniorExact: g.exact,
    youthT50: y.t50,
    seniorT50: g.t50,
    youthSurprised: y.surprised,
    seniorSurprised: g.surprised,
    gapT50: (g.t50 ?? NEVER) - (y.t50 ?? NEVER),
    gapAware: Math.round((y.aware - g.aware) * 10) / 10,
    gapExact: Math.round((y.exact - g.exact) * 10) / 10,
  };
}

export function stat(values: Array<number | null>): Stat {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const q = (p: number) => {
    if (!xs.length) return null;
    const i = (xs.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return Math.round((xs[lo]! + (xs[hi]! - xs[lo]!) * (i - lo)) * 1000) / 1000;
  };
  return {
    n: values.length,
    missing: values.length - xs.length,
    median: q(0.5),
    p25: q(0.25),
    p75: q(0.75),
    min: xs.length ? xs[0]! : null,
    max: xs.length ? xs[xs.length - 1]! : null,
    mean: xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null,
    values,
  };
}

/** 逐 seed 配对：未达到（null）按最差处理 */
export function paired(ref: Array<number | null>, x: Array<number | null>, better: 'low' | 'high' | null): Paired {
  let b = 0;
  let w = 0;
  let same = 0;
  const diffs: number[] = [];
  for (let i = 0; i < Math.min(ref.length, x.length); i++) {
    const r = ref[i];
    const v = x[i];
    if (r !== null && r !== undefined && v !== null && v !== undefined) diffs.push(v - r);
    if (!better) continue;
    const worst = better === 'low' ? Infinity : -Infinity;
    const rv = r ?? worst;
    const vv = v ?? worst;
    if (rv === vv) same++;
    else if ((better === 'low' && vv < rv) || (better === 'high' && vv > rv)) b++;
    else w++;
  }
  diffs.sort((a, c) => a - c);
  const medianDiff = diffs.length ? (diffs.length % 2 ? diffs[(diffs.length - 1) / 2]! : (diffs[diffs.length / 2 - 1]! + diffs[diffs.length / 2]!) / 2) : null;
  return { better: b, worse: w, same, medianDiff: medianDiff === null ? null : Math.round(medianDiff * 1000) / 1000 };
}

/** 一个分支在各 seed 上某个指标的取值（指标键：'E1.t50'、'trust.govDelta'、'trustAt.E3.govMean'） */
export function metricSeries(branch: { perSeed: BranchMetrics[] }, key: string): Array<number | null> {
  return branch.perSeed.map((m) => {
    if (key.startsWith('trust.')) {
      const k = key.slice(6);
      return k === 'govDelta' ? Math.round((m.trust.govMean - m.trust.govMean0) * 1000) / 1000 : k === 'tiesDown' ? m.trust.tiesDown : null;
    }
    if (key.startsWith('trustAt.')) {
      const [, oid, k] = key.split('.') as [string, string, keyof TrustSummary];
      const v = m.trustAt?.[oid]?.[k];
      return typeof v === 'number' ? v : null;
    }
    const [oid, k] = key.split('.') as [string, keyof OutageMetrics];
    const v = m.outages[oid]?.[k];
    return typeof v === 'number' ? v : null;
  });
}

/** 指标键是否合法（预测与接口校验用） */
export function isMetricKey(key: string, outageIds: readonly string[]): boolean {
  const parts = key.split('.');
  if (parts[0] === 'trust') return parts.length === 2 && TRUST_DEFS.some((d) => d.key === parts[1]);
  if (parts[0] === 'trustAt') return parts.length === 3 && outageIds.includes(parts[1]!) && ['govMean', 'govMean0', 'govUp', 'govDown', 'tiesUp', 'tiesDown'].includes(parts[2]!);
  return parts.length === 2 && outageIds.includes(parts[0]!) && (METRIC_DEFS.some((d) => d.key === parts[1]) || ['believed', 'relayed', 'surprisedMin', 'affected', 'youthAware', 'seniorAware', 'youthExact', 'seniorExact', 'youthT50', 'seniorT50', 'youthSurprised', 'seniorSurprised'].includes(parts[1]!));
}

/** 预测的判定：逐 seed 配对（t50 类没达到按 7 天算） */
export function judgePredictions(branches: ExperimentResult['branches'], predictions: readonly Prediction[]): PredictionVerdict[] {
  return predictions.map((p) => {
    const a = branches[p.a];
    const b = branches[p.b];
    if (!a || !b) return { id: p.id, verdict: '无法判定', median: null, higher: 0, lower: 0, n: 0 };
    const fill = (v: number | null) => (v === null && /t50|t80|T50/.test(p.metric) ? NEVER : v);
    const xs = metricSeries(a, p.metric).map(fill);
    const ys = metricSeries(b, p.metric).map(fill);
    const d: number[] = [];
    for (let i = 0; i < Math.min(xs.length, ys.length); i++) if (xs[i] !== null && ys[i] !== null) d.push(xs[i]! - ys[i]!);
    if (!d.length) return { id: p.id, verdict: '无法判定', median: null, higher: 0, lower: 0, n: 0 };
    const sorted = [...d].sort((x, y) => x - y);
    const median = (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.ceil((sorted.length - 1) / 2)]!) / 2;
    const higher = d.filter((x) => x > 0).length / d.length;
    const lower = d.filter((x) => x < 0).length / d.length;
    let verdict: PredictionVerdict['verdict'];
    if (p.expect === 'same') verdict = Math.abs(median) < (p.tolerance ?? 1) ? '支持' : '不支持';
    else {
      const share = p.expect === 'higher' ? higher : lower;
      verdict = share >= 0.7 ? '支持' : share <= 0.5 ? '不支持' : '部分支持';
    }
    return { id: p.id, verdict, median: Math.round(median * 1000) / 1000, higher: Math.round(higher * 100) / 100, lower: Math.round(lower * 100) / 100, n: d.length };
  });
}

export function aggregate(sc: ScenarioDef, branches: ExperimentResult['branches']): Pick<ExperimentResult, 'stats' | 'paired' | 'reference'> {
  const names = Object.keys(branches);
  const reference = names[0]!;
  const series = (name: string, key: string): Array<number | null> => metricSeries(branches[name]!, key);
  const keys: Array<{ key: string; better: 'low' | 'high' | null }> = [
    ...sc.outages.flatMap((o) => METRIC_DEFS.map((d) => ({ key: `${o.id}.${d.key}`, better: d.better }))),
    ...TRUST_DEFS.map((d) => ({ key: `trust.${d.key}`, better: d.better })),
  ];
  const stats: ExperimentResult['stats'] = {};
  const pairedOut: ExperimentResult['paired'] = {};
  for (const name of names) {
    stats[name] = {};
    pairedOut[name] = {};
    for (const k of keys) {
      stats[name]![k.key] = stat(series(name, k.key));
      if (name !== reference) pairedOut[name]![k.key] = paired(series(reference, k.key), series(name, k.key), k.better);
    }
  }
  return { stats, paired: pairedOut, reference };
}

export interface LiveExperiment {
  status: 'running' | 'done' | 'failed';
  seedIndex: number;
  seeds: number;
  progress: Record<string, number>;
}

/**
 * 多 seed 对照实验（spec v1 §2.7，D28；v2 §2.2）：第一个 seed 完整落库（能在城市里打开每个分支），
 * 其余 seed 只在内存里跑、只留指标；模型调用记在合成运行 id 名下。
 * - 普通分支：从共同分叉点恢复，只改剧本（与参数覆盖，从分叉点起生效）；
 * - 换镇分支（town）：按补丁登记一座新镇，同一个 seed 从头跑。
 */
export class ExperimentRunner {
  readonly live = new Map<string, LiveExperiment>();
  private pending = new Map<string, Promise<void>>();
  constructor(private runs: RunManager) {}

  start(m: ExperimentManifest, opts: { probe?: (sc: ScenarioDef) => ExperimentProbe } = {}): string {
    const expId = `exp_${randomUUID().slice(0, 8)}`;
    this.runs.store.insertExperiment(expId, m);
    const live: LiveExperiment = { status: 'running', seedIndex: 0, seeds: m.seeds.length, progress: { base: 0, ...Object.fromEntries(Object.keys(m.branches).map((k) => [k, 0])) } };
    this.live.set(expId, live);
    const p = this.run(expId, m, live, opts.probe).catch((e) => {
      console.error('experiment failed', e);
      this.runs.store.updateExperiment(expId, 'failed', null, String((e as Error).message));
      live.status = 'failed';
    });
    this.pending.set(expId, p);
    void p.finally(() => this.pending.delete(expId));
    return expId;
  }

  /** 脚本用：等实验跑完 */
  async wait(expId: string): Promise<void> {
    await this.pending.get(expId);
  }

  /** 换镇分支的场景（按规格内容哈希登记，同一补丁总是同一座镇） */
  townScenario(base: ScenarioDef, spec: BranchSpec): ScenarioDef {
    if (!spec.town) return base;
    const baseSpec = this.runs.scenarios.specOf(base.id);
    if (!baseSpec) throw new Error(`场景 ${base.id} 没有规格，不能换镇`);
    return this.runs.scenarios.register(applyTownPatch(baseSpec, spec.town), 'api').scenario;
  }

  private async run(expId: string, m: ExperimentManifest, live: LiveExperiment, makeProbe?: (sc: ScenarioDef) => ExperimentProbe): Promise<void> {
    const store = this.runs.store;
    const sc = this.runs.scenarios.require(m.scenario);
    const forkAt = parseTime(m.forkAt);
    const until = parseTime(m.until);
    const mode = m.provider === 'jev' ? 'external' : 'rule';
    const scOf = Object.fromEntries(Object.entries(m.branches).map(([k, b]) => [k, this.townScenario(sc, b)]));
    for (const [k, x] of Object.entries(scOf)) if (x.outages.map((o) => o.id).join() !== sc.outages.map((o) => o.id).join()) throw new Error(`分支 ${k} 的剧本与底座不一致`);
    const checkpoints = sc.outages
      .map((o) => ({ id: o.id, family: o.family, t: dayStart(o.day) + o.from }))
      .filter((c) => c.t > forkAt && c.t <= until)
      .sort((a, b) => a.t - b.t);
    const branches: ExperimentResult['branches'] = Object.fromEntries(Object.entries(m.branches).map(([k, b]) => [k, { label: b.label, runId: '', perSeed: [], scenario: scOf[k]!.id, changes: describeBranch(b) }]));
    let head: Pick<ExperimentResult, 'forkT' | 'forkSeq' | 'forkHash' | 'baseRunId'> = { forkT: forkAt, forkSeq: 0, forkHash: '', baseRunId: '' };
    const baseParams = branchParams(m, { label: 'base' });

    for (const [si, seed] of m.seeds.entries()) {
      live.seedIndex = si;
      for (const k of Object.keys(live.progress)) live.progress[k] = 0;
      const persist = si === 0;
      const synth = (b: string) => `${expId}:${seed}:${b}`;
      // 基线跑到分叉点
      let base: Engine;
      if (persist) {
        const baseId = `run_${randomUUID().slice(0, 8)}`;
        const run = this.runs.attach(
          { id: baseId, name: `${m.name} · 基线（分叉前）`, scenario: sc.id, seed, provider: m.provider, parent_run_id: null, fork_seq: null, fork_t: null, manifest: JSON.stringify(m), status: 'experiment', experiment_id: expId, branch: 'base' },
          Engine.create(sc, { seed, decisionMode: mode, ...(baseParams ? { params: baseParams } : {}) }),
        );
        const span = forkAt - sc.start;
        await run.runHeadless(forkAt, (t) => (live.progress.base = Math.min(1, (t - sc.start) / span)));
        run.saveSnapshot();
        base = run.engine;
        head.baseRunId = baseId;
      } else {
        base = Engine.create(sc, { seed, decisionMode: mode, ...(baseParams ? { params: baseParams } : {}) });
        await driveHeadless(base, forkAt, m.provider === 'jev' ? new DecisionService(this.runs.jev, synth('base')) : null);
      }
      live.progress.base = 1;
      const snap = base.snapshot();
      const forkHash = contentHash(snap.state);
      if (persist) head = { ...head, forkT: snap.now, forkSeq: snap.state.meta.seq, forkHash: forkHash.slice(0, 12) };

      for (const [name, spec] of Object.entries(m.branches)) {
        const bsc = scOf[name]!;
        const params = branchParams(m, spec);
        const fresh = bsc.id !== sc.id;
        let engine: Engine;
        if (fresh) engine = Engine.create(bsc, { seed, decisionMode: mode, script: branchScript(bsc, spec), ...(params ? { params } : {}) });
        else {
          engine = Engine.restore(snap, sc, { decisionMode: mode, script: branchScript(sc, spec), ...(params ? { params } : {}) });
          if (contentHash(engine.state) !== forkHash) throw new Error(`分支 ${name} 分叉前哈希不一致`);
        }
        const counts = { total: 0, byProvider: {} as Record<string, number>, fallbacks: 0 };
        const tally = new BranchTally(bsc.outages);
        const onRec = (r: DecisionRecord) => {
          counts.total++;
          counts.byProvider[r.provider] = (counts.byProvider[r.provider] ?? 0) + 1;
          if (r.fallback) counts.fallbacks++;
          tally.record(r);
        };
        const atStart: Record<string, BeliefCensus> = {};
        const trustAt: Record<string, TrustSummary> = {};
        const t0 = fresh ? bsc.start : snap.now;
        const bspan = until - t0;
        let runId = synth(name);
        let run: LiveRun | undefined;
        if (persist) {
          runId = `run_${randomUUID().slice(0, 8)}`;
          run = this.runs.attach(
            fresh
              ? { id: runId, name: `${m.name} · ${name} ${spec.label}`, scenario: bsc.id, seed, provider: m.provider, parent_run_id: null, fork_seq: null, fork_t: null, manifest: JSON.stringify(spec), status: 'experiment', experiment_id: expId, branch: name }
              : { id: runId, name: `${m.name} · ${name} ${spec.label}`, scenario: sc.id, seed, provider: m.provider, parent_run_id: head.baseRunId, fork_seq: head.forkSeq, fork_t: snap.now, manifest: JSON.stringify(spec), status: 'experiment', experiment_id: expId, branch: name },
            engine,
          );
          branches[name]!.runId = runId;
        }
        // 先让落库的运行拿到启动事件，再挂自己的监听
        const probe = makeProbe?.(bsc);
        engine.onEvent((e) => {
          tally.event(e);
          probe?.event?.(e);
        });
        engine.onRecord((r) => {
          onRec(r);
          probe?.record?.(r);
        });
        const decisions = m.provider === 'jev' && !persist ? new DecisionService(this.runs.jev, runId) : null;
        for (const cp of [...checkpoints, { id: '', family: '', t: until }]) {
          if (run) await run.runHeadless(cp.t, (t) => (live.progress[name] = Math.min(1, (t - t0) / bspan)));
          else await driveHeadless(engine, cp.t, decisions);
          live.progress[name] = Math.min(1, (cp.t - t0) / bspan);
          if (cp.id) {
            atStart[cp.id] = beliefCensus(engine.state, cp.family);
            trustAt[cp.id] = trustSummary(engine.state);
            probe?.checkpoint?.(cp.id, engine.state);
          }
          await new Promise((r) => setImmediate(r));
        }
        if (run) run.saveSnapshot();
        live.progress[name] = 1;
        const bm = branchMetrics(engine.state, bsc, atStart, tally);
        branches[name]!.perSeed.push({ seed, ...bm, trustAt, decisions: counts, calls: store.callStats(runId), finalHash: contentHash(engine.state).slice(0, 12), ...(probe ? { extra: probe.finish(engine.state) } : {}) });
      }
    }
    const result: ExperimentResult = {
      version: 3,
      ...head,
      seeds: m.seeds,
      outages: sc.outages.map((o) => ({ id: o.id, family: o.family, area: o.area, day: o.day, from: o.from, to: o.to })),
      branches,
      ...aggregate(sc, branches),
      ...(m.predictions?.length ? { predictions: judgePredictions(branches, m.predictions) } : {}),
    };
    store.updateExperiment(expId, 'done', result);
    live.status = 'done';
  }
}
