import type { SimTime } from '../core/time.ts';
import type { FunnelState, FunnelStop, WorldState } from '../state/types.ts';

export const STAGES = ['reached', 'exposed', 'attended', 'comprehended', 'believed', 'intended', 'acted', 'relayed'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  reached: '可达',
  exposed: '曝光',
  attended: '注意',
  comprehended: '理解',
  believed: '相信',
  intended: '改了安排',
  acted: '付诸行动',
  relayed: '转告他人',
};

export const STOP_LABEL: Record<FunnelStop, string> = {
  not_reached: '未达',
  ignored: '未看',
  not_understood: '未懂',
  disbelieved: '不信',
  irrelevant: '与己无关',
  blocked: '有意但受阻',
  no_change: '知道但照常',
};

export interface FunnelMetrics {
  population: number;
  stages: Record<Stage, number>;
  stops: Record<FunnelStop, number>;
  /** 首次相信的时刻（排序） */
  believedTimes: SimTime[];
}

export function funnelMetrics(s: WorldState, family: string): FunnelMetrics {
  const agents = Object.values(s.agents);
  const stages = Object.fromEntries(STAGES.map((x) => [x, 0])) as Record<Stage, number>;
  const stops = { not_reached: 0, ignored: 0, not_understood: 0, disbelieved: 0, irrelevant: 0, blocked: 0, no_change: 0 } as Record<FunnelStop, number>;
  const believedTimes: SimTime[] = [];
  for (const a of agents) {
    const f: FunnelState = a.funnel[family] ?? {};
    for (const st of STAGES) if (f[st] !== undefined) stages[st] += 1;
    if (f.believed !== undefined) believedTimes.push(f.believed);
    if (f.reached === undefined) stops.not_reached += 1;
    else if (f.stop) stops[f.stop] += 1;
  }
  return { population: agents.length, stages, stops, believedTimes: believedTimes.sort((x, y) => x - y) };
}

/** 达到某比例相信的时刻（相对发布）；未达到返回 null（不填 0） */
export function timeToShare(m: FunnelMetrics, share: number, since: SimTime): number | null {
  const need = Math.ceil(m.population * share);
  const t = m.believedTimes[need - 1];
  return t === undefined ? null : t - since;
}

export interface BeliefCensus {
  aware: number;
  exact: number;
  coarse: number;
  allDay: number;
  unknownWindow: number;
  believe: number;
  doubt: number;
  disbelieve: number;
  holders: Record<string, string[]>;
}

/** 此刻每个人相信的时段是什么（谣言持有人数） */
export function beliefCensus(s: WorldState, family: string): BeliefCensus {
  const c: BeliefCensus = { aware: 0, exact: 0, coarse: 0, allDay: 0, unknownWindow: 0, believe: 0, doubt: 0, disbelieve: 0, holders: {} };
  for (const a of Object.values(s.agents)) {
    const b = a.beliefs[family];
    if (!b) continue;
    c.aware += 1;
    c[b.status] += 1;
    const k = !b.slots.window ? 'unknownWindow' : b.slots.window.kind === 'exact' ? 'exact' : b.slots.window.kind === 'coarse' ? 'coarse' : 'allDay';
    c[k] += 1;
    (c.holders[k] ??= []).push(a.id);
  }
  return c;
}

export interface OutcomeMetrics {
  inconvenienceItems: number;
  disruptedMin: number;
  surprisedItems: number;
  surprisedMin: number;
  surprisedPeople: number;
  affectedPeople: number;
  overreactMin: number;
  prepSpent: number;
}

/** 后果指标；给 outage 时只统计这一轮停电 */
export function outcomeMetrics(s: WorldState, outage?: string): OutcomeMetrics {
  let inconvenienceItems = 0;
  let disruptedSec = 0;
  let affected = 0;
  let over = 0;
  let sItems = 0;
  let sSec = 0;
  let sPeople = 0;
  for (const a of Object.values(s.agents)) {
    const st = outage ? a.stats.byOutage[outage] : a.stats;
    if (!st) continue;
    sItems += st.surprised;
    sSec += st.surprisedSec;
    if (st.surprised > 0) sPeople += 1;
    inconvenienceItems += st.inconvenience;
    disruptedSec += st.disruptedSec;
    over += st.overreactSec;
    if (st.inconvenience > 0) affected += 1;
  }
  const bank0 = 0;
  const prep = Object.values(s.agents).reduce((acc, a) => acc + ((s.stock[a.id]?.power_bank ?? bank0) > 0 ? 1 : 0), 0);
  return { inconvenienceItems, disruptedMin: Math.round(disruptedSec / 60), surprisedItems: sItems, surprisedMin: Math.round(sSec / 60), surprisedPeople: sPeople, affectedPeople: affected, overreactMin: Math.round(over / 60), prepSpent: prep };
}

export interface PlaceUse {
  id: string;
  occupants: number;
  powered: boolean;
  mode: string;
}

export function placeUse(s: WorldState): PlaceUse[] {
  return Object.values(s.places).map((p) => ({ id: p.id, occupants: p.occupants.length, powered: p.powered, mode: p.mode.kind }));
}

/** 信任变化汇总：对官方信任的均值变化、上升/下降人数、人际信任上升/下降的有向关系数 */
export interface TrustSummary {
  govMean0: number;
  govMean: number;
  govUp: number;
  govDown: number;
  tiesUp: number;
  tiesDown: number;
}

export function trustSummary(s: WorldState): TrustSummary {
  const agents = Object.values(s.agents);
  const base = new Map<string, number>();
  for (const r of s.relations) {
    base.set(`${r.a}|${r.b}`, Math.max(base.get(`${r.a}|${r.b}`) ?? 0, r.trust));
    base.set(`${r.b}|${r.a}`, Math.max(base.get(`${r.b}|${r.a}`) ?? 0, r.trust));
  }
  let g0 = 0;
  let g = 0;
  let up = 0;
  let down = 0;
  let tu = 0;
  let td = 0;
  for (const a of agents) {
    g0 += a.traits.trustOfficial;
    g += a.trustGov;
    if (a.trustGov > a.traits.trustOfficial + 0.005) up++;
    else if (a.trustGov < a.traits.trustOfficial - 0.005) down++;
    for (const [o, v] of Object.entries(a.trustIn)) {
      const b0 = base.get(`${a.id}|${o}`) ?? 0.4;
      if (v > b0 + 0.005) tu++;
      else if (v < b0 - 0.005) td++;
    }
  }
  const n = agents.length || 1;
  return { govMean0: Math.round((g0 / n) * 1000) / 1000, govMean: Math.round((g / n) * 1000) / 1000, govUp: up, govDown: down, tiesUp: tu, tiesDown: td };
}
