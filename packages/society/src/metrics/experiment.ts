import type { CommunityDef } from '../model/def.ts';
import type { Intervention } from '../model/intervention.ts';
import type { CommunitySpec } from '../community/spec.ts';
import { INDICATORS, isIndicatorKey } from './indicators.ts';
import { DayRunner, type DayAgg } from './stats.ts';

/**
 * 实验（D90）：同一个社区、同一批种子下，基线与干预两条世界线。
 * 指标取干预开始之后的日子；逐种子配对比较。
 */
export interface Prediction {
  id: string;
  /** 一句话的预测 */
  text: string;
  metric: string;
  /** 干预这条线比基线更高还是更低 */
  expect: 'higher' | 'lower';
}

export interface Experiment {
  name: string;
  question: string;
  spec: CommunitySpec;
  seeds: number[];
  days: number;
  interventions: Intervention[];
  /** 指标从第几天起算；不给就从最早的那条干预开始 */
  from?: number;
  predictions: Prediction[];
}

export const EXPERIMENT_LIMITS = { seeds: [1, 12], days: [3, 30] } as const;

export function firstDay(interventions: Intervention[]): number {
  let d = Infinity;
  for (const iv of interventions) d = Math.min(d, 'day' in iv ? iv.day : iv.from);
  return Number.isFinite(d) ? d : 1;
}

/** 检查一份实验清单；返回问题列表（空表示可以跑） */
export function validateExperiment(x: Experiment): string[] {
  const bad: string[] = [];
  if (!x.name?.trim()) bad.push('实验要有名字');
  if (!Array.isArray(x.seeds) || x.seeds.length < EXPERIMENT_LIMITS.seeds[0] || x.seeds.length > EXPERIMENT_LIMITS.seeds[1]) bad.push(`种子要有 ${EXPERIMENT_LIMITS.seeds[0]}–${EXPERIMENT_LIMITS.seeds[1]} 个`);
  else if (new Set(x.seeds).size !== x.seeds.length || x.seeds.some((s) => !Number.isInteger(s))) bad.push('种子要是互不相同的整数');
  if (!(x.days >= EXPERIMENT_LIMITS.days[0] && x.days <= EXPERIMENT_LIMITS.days[1])) bad.push(`天数要在 ${EXPERIMENT_LIMITS.days[0]}–${EXPERIMENT_LIMITS.days[1]} 之间`);
  if (!x.interventions?.length) bad.push('至少要有一条干预');
  else if (firstDay(x.interventions) > x.days) bad.push('干预开始的那天已经超出了实验的天数');
  for (const p of x.predictions ?? []) if (!isIndicatorKey(p.metric)) bad.push(`没有这个指标：${p.metric}`);
  return bad;
}

/** 跑一条世界线，返回每天的统计 */
export function runLine(def: CommunityDef, seed: number, interventions: Intervention[], days: number, onDay?: (day: number) => void): DayAgg[] {
  const runner = new DayRunner(def, { seed, interventions }, false);
  const out: DayAgg[] = [];
  for (let d = 1; d <= days; d++) {
    out.push(runner.next().agg);
    onDay?.(d);
  }
  return out;
}

export type Verdict = '支持' | '相反' | '不明确' | '没有差别';

/** 逐种子配对：不少于七成同向算支持，不到三成算相反（D90） */
export function judge(expect: 'higher' | 'lower', base: number[], treat: number[]): { verdict: Verdict; share: number } {
  const diffs = treat.map((b, i) => b - base[i]!);
  const scale = Math.max(1e-9, ...base.map(Math.abs), ...treat.map(Math.abs));
  if (diffs.every((d) => Math.abs(d) / scale < 1e-6)) return { verdict: '没有差别', share: 0 };
  const hit = diffs.filter((d) => (expect === 'higher' ? d > 0 : d < 0)).length / diffs.length;
  return { verdict: hit >= 0.7 ? '支持' : hit <= 0.3 ? '相反' : '不明确', share: hit };
}

export interface MetricResult {
  key: string;
  /** 每个种子一个值 */
  base: number[];
  treat: number[];
}

export interface PredictionResult extends Prediction {
  verdict: Verdict;
  share: number;
}

export interface Affected {
  /** def.people 的序号 */
  index: number;
  score: number;
  /** 差别最大的那一天 */
  day: number;
}

export interface ExperimentResult {
  from: number;
  metrics: MetricResult[];
  predictions: PredictionResult[];
  /** 第一个种子下，日子过得最不一样的人（D91） */
  affected: Affected[];
}

/** 两条线上同一个人同一天差多少：时间利用（小时）、花销、心情 */
export function dayDistance(a: DayAgg['people'][number], b: DayAgg['people'][number]): number {
  let hours = 0;
  for (let k = 0; k < a.use.length; k++) hours += Math.abs(a.use[k]! - b.use[k]!) / 3600;
  return hours / 2 + Math.abs(a.spent - b.spent) / 25 + Math.abs(a.mood - b.mood) * 8 + Math.abs(a.chats - b.chats) * 0.3;
}

/** base[i]、treat[i] 是第 i 个种子的两条线 */
export function compare(def: CommunityDef, x: Experiment, base: DayAgg[][], treat: DayAgg[][]): ExperimentResult {
  const from = x.from ?? firstDay(x.interventions);
  const win = (days: DayAgg[]) => days.filter((d) => d.day >= from);
  const metrics: MetricResult[] = Object.values(INDICATORS).map((ind) => ({ key: ind.key, base: base.map((days) => ind.compute(def, win(days))), treat: treat.map((days) => ind.compute(def, win(days))) }));
  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
  const predictions = x.predictions.map((p) => ({ ...p, ...judge(p.expect, byKey[p.metric]!.base, byKey[p.metric]!.treat) }));
  const a = base[0] ?? [];
  const b = treat[0] ?? [];
  const affected: Affected[] = def.people
    .map((_, index) => {
      let score = 0;
      let day = from;
      let worst = -1;
      for (let d = 0; d < Math.min(a.length, b.length); d++) {
        if (a[d]!.day < from) continue;
        const dist = dayDistance(a[d]!.people[index]!, b[d]!.people[index]!);
        score += dist;
        if (dist > worst) {
          worst = dist;
          day = a[d]!.day;
        }
      }
      return { index, score: Math.round(score * 100) / 100, day };
    })
    .sort((p, q) => q.score - p.score || p.index - q.index)
    .slice(0, 12);
  return { from, metrics, predictions, affected };
}
