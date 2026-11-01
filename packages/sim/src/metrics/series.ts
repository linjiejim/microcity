/**
 * 曲线（spec v1 §2.6）：对事件日志重放一次，按步长采样“社会状态”。
 * 信念构成、漏斗、后果、对官方信任的均值与五档分布、人际信任变化。
 */
import type { SimTime } from '../core/time.ts';
import type { DomainEvent } from '../state/events.ts';
import { applyEvent } from '../state/reducer.ts';
import type { WorldState } from '../state/types.ts';

export interface SeriesPoint {
  t: SimTime;
  unaware: number;
  glimpsed: number;
  disbelieve: number;
  doubt: number;
  exact: number;
  coarse: number;
  allDay: number;
  unknown: number;
  intended: number;
  acted: number;
  relayed: number;
  affected: number;
  surprised: number;
  /** 对官方信任的均值 */
  trustGov: number;
  /** 五档分布：<0.3 / 0.3–0.45 / 0.45–0.6 / 0.6–0.75 / ≥0.75 */
  trustHist: [number, number, number, number, number];
  /** 相对初值信任上升 / 下降的有向人际关系数 */
  tiesUp: number;
  tiesDown: number;
}

export function societyPoint(s: WorldState, family: string, t: SimTime): SeriesPoint {
  const p: SeriesPoint = { t, unaware: 0, glimpsed: 0, disbelieve: 0, doubt: 0, exact: 0, coarse: 0, allDay: 0, unknown: 0, intended: 0, acted: 0, relayed: 0, affected: 0, surprised: 0, trustGov: 0, trustHist: [0, 0, 0, 0, 0], tiesUp: 0, tiesDown: 0 };
  const agents = Object.values(s.agents);
  const base = new Map<string, number>();
  for (const r of s.relations) {
    base.set(`${r.a}|${r.b}`, Math.max(base.get(`${r.a}|${r.b}`) ?? 0, r.trust));
    base.set(`${r.b}|${r.a}`, Math.max(base.get(`${r.b}|${r.a}`) ?? 0, r.trust));
  }
  let sum = 0;
  for (const a of agents) {
    const b = a.beliefs[family];
    const f = a.funnel[family];
    if (!f?.exposed) p.unaware++;
    else if (!b) p.glimpsed++;
    else if (b.status === 'disbelieve') p.disbelieve++;
    else if (b.status === 'doubt') p.doubt++;
    else if (!b.slots.window) p.unknown++;
    else if (b.slots.window.kind === 'exact') p.exact++;
    else if (b.slots.window.kind === 'coarse') p.coarse++;
    else p.allDay++;
    if (f?.intended) p.intended++;
    if (f?.acted) p.acted++;
    if (f?.relayed) p.relayed++;
    if (a.stats.inconvenience > 0) p.affected++;
    if (a.stats.surprised > 0) p.surprised++;
    sum += a.trustGov;
    const v = a.trustGov;
    p.trustHist[v < 0.3 ? 0 : v < 0.45 ? 1 : v < 0.6 ? 2 : v < 0.75 ? 3 : 4]++;
    for (const [oid, to] of Object.entries(a.trustIn)) {
      const from = base.get(`${a.id}|${oid}`) ?? 0.4;
      if (to > from + 0.005) p.tiesUp++;
      else if (to < from - 0.005) p.tiesDown++;
    }
  }
  p.trustGov = agents.length ? Math.round((sum / agents.length) * 1000) / 1000 : 0;
  return p;
}

/** 从初始状态重放事件，每 step 秒采一个点（最后补一个终点） */
export function sampleSeries(initial: WorldState, events: DomainEvent[], opts: { step: number; family: string; until?: SimTime }): SeriesPoint[] {
  const s = structuredClone(initial);
  const out: SeriesPoint[] = [];
  let next = Math.ceil(s.meta.t / opts.step) * opts.step;
  for (const e of events) {
    while (e.t > next) {
      out.push(societyPoint(s, opts.family, next));
      next += opts.step;
    }
    applyEvent(s, e);
  }
  const end = opts.until ?? s.meta.t;
  while (next <= end) {
    out.push(societyPoint(s, opts.family, next));
    next += opts.step;
  }
  if (!out.length || out[out.length - 1]!.t < s.meta.t) out.push(societyPoint(s, opts.family, s.meta.t));
  return out;
}
