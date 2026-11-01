import { clamp01, r3, sigmoid } from '../core/rng.ts';
import { dayOf, dayStart, HOUR, overlap, type SimTime } from '../core/time.ts';
import type { TownMap } from '../world/map.ts';
import type { Belief, Channel, Slots } from '../info/types.ts';
import { windowInterval } from '../info/slots.ts';
import type { Agent, PlanItem, Relation, WorldState } from '../state/types.ts';
import { DEFAULT_PARAMS, type RuleParams } from '../params.ts';

export function relationBetween(s: WorldState, a: string, b: string): Relation | undefined {
  let best: Relation | undefined;
  for (const r of s.relations) {
    if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) {
      if (!best || r.strength > best.strength) best = r;
    }
  }
  return best;
}

export function contactsOf(s: WorldState, a: string): Array<{ id: string; rel: Relation }> {
  const out: Array<{ id: string; rel: Relation }> = [];
  const seen = new Set<string>();
  for (const r of s.relations) {
    const other = r.a === a ? r.b : r.b === a ? r.a : null;
    if (!other || seen.has(other)) continue;
    seen.add(other);
    out.push({ id: other, rel: relationBetween(s, a, other)! });
  }
  return out;
}

export const districtOf = (map: TownMap, place?: string): 'north' | 'south' | undefined => (place ? map.places[place]?.district : undefined);

export function areaMatches(area: Slots['area'], district?: string): boolean {
  if (!area) return true; // 未知地点按最坏情况
  if (area === 'town') return true;
  return area === district;
}

/** 疲劳：醒来越久越累 */
export function fatigueOf(a: Agent, t: SimTime): number {
  if (a.act?.kind === 'sleep') return 1;
  return r3(clamp01((t - a.wokeAt) / (17 * HOUR)) * 0.9);
}

export function hungerOf(a: Agent, t: SimTime): number {
  return r3(clamp01((t - a.lastMealAt) / (5 * HOUR)));
}

/** 主张与此人的相关性（0–1）：地点 × 日期 */
export function relevanceOf(s: WorldState, map: TownMap, a: Agent, slots: Slots, t: SimTime): { score: number; area: number; day: number } {
  const homeD = districtOf(map, a.home);
  const workD = districtOf(map, a.workplace);
  let area: number;
  if (!slots.area) area = 0.5;
  else if (slots.area === 'town' || slots.area === homeD || slots.area === workD) area = 1;
  else {
    const today = dayOf(t);
    const goes = [today, today + 1].some((d) => (a.plans[d] ?? []).some((it) => it.status === 'planned' && districtOf(map, it.place) === slots.area));
    area = goes ? 0.7 : 0.15;
  }
  let day: number;
  if (!slots.day) day = 0.8;
  else {
    const diff = slots.day - dayOf(t);
    day = diff < 0 ? 0.1 : diff <= 1 ? 1 : diff <= 3 ? 0.7 : 0.4;
  }
  return { score: r3(area * day), area, day };
}

/** 重要性：丢了 2 小时在家办公远比少看 2 小时电视严重 */
export const IMPORTANCE: Record<string, number> = {
  work: 1, wfh: 1, class: 0.9, study: 0.8, jobsearch: 0.7, shop: 0.6, breakfast: 0.6, lunch: 0.6, dinner: 0.7,
  leisure: 0.3, tv: 0.3, walk: 0.1, home: 0.1, nap: 0.1, care: 0.4, sleep: 0.1, read_board: 0, wait: 0,
};

export interface AtRisk {
  item: PlanItem;
  day: number;
  overlapSec: number;
  from: SimTime;
  to: SimTime;
}

/** 按此人所信槽位，找出受影响的计划项 */
export function atRiskItems(map: TownMap, a: Agent, slots: Slots, t: SimTime): AtRisk[] {
  const today = dayOf(t);
  const days = slots.day ? [slots.day] : [today, today + 1];
  const [w0, w1] = windowInterval(slots.window);
  const out: AtRisk[] = [];
  for (const d of days) {
    const items = a.plans[d] ?? [];
    const from = dayStart(d) + w0;
    const to = dayStart(d) + w1;
    for (const it of items) {
      if (it.status !== 'planned') continue;
      if (!it.needsPower) continue;
      if (!areaMatches(slots.area, districtOf(map, it.place))) continue;
      const ov = overlap(Math.max(it.start, t), it.end, from, to);
      if (ov < 10 * 60) continue;
      out.push({ item: it, day: d, overlapSec: ov, from: Math.max(it.start, from, t), to: Math.min(it.end, to) });
    }
  }
  return out.sort((x, y) => y.overlapSec * (IMPORTANCE[y.item.kind] ?? 0.3) - x.overlapSec * (IMPORTANCE[x.item.kind] ?? 0.3));
}

/** 一项安排按所信的槽位会撞上停电多久（秒）；口径与 atRiskItems 一致 */
export function riskOverlap(map: TownMap, it: Pick<PlanItem, 'start' | 'end' | 'place' | 'needsPower'>, slots: Slots, t: SimTime): number {
  if (!it.needsPower) return 0;
  if (!areaMatches(slots.area, districtOf(map, it.place))) return 0;
  const d = dayOf(it.start);
  const today = dayOf(t);
  if (slots.day ? slots.day !== d : d !== today && d !== today + 1) return 0;
  const [w0, w1] = windowInterval(slots.window);
  return overlap(Math.max(it.start, t), it.end, dayStart(d) + w0, dayStart(d) + w1);
}

export function busyOf(a: Agent): number {
  if (a.loc.k === 'walk') return 0.5;
  switch (a.act?.kind) {
    case 'work':
    case 'class':
    case 'wfh':
      return 0.6;
    case 'breakfast':
    case 'lunch':
    case 'dinner':
    case 'shop':
      return 0.3;
    default:
      return 0.15;
  }
}

/** 注意：P(注意 | 已曝光) = sigmoid(相关性 + 新颖性 + 好奇 + 渠道显著度 − 忙碌 − 疲劳 − 重复) */
export function attentionOf(p: { a: Agent; channel: Channel; relevance: number; novelty: number; repeat: number; t: SimTime }, P: RuleParams = DEFAULT_PARAMS): { p: number; factors: Record<string, number> } {
  const A = P.attention;
  const f = {
    relevance: r3(p.relevance),
    novelty: r3(p.novelty),
    curiosity: p.a.traits.curiosity,
    salience: A.salience[p.channel],
    busy: busyOf(p.a),
    fatigue: fatigueOf(p.a, p.t),
    repeat: r3(p.repeat),
  };
  const x = A.intercept + A.relevance * f.relevance + A.novelty * f.novelty + A.curiosity * f.curiosity + f.salience - A.busy * f.busy - A.fatigue * f.fatigue - A.repeat * f.repeat;
  return { p: r3(sigmoid(x)), factors: f };
}

/** 显著性：置信度 × 事件临近 × 新鲜度 × 事件分量（两小时停电远不如"停一整天"值得一提） */
export function salienceOf(b: Belief, t: SimTime, personal = 0): number {
  const hours = (t - b.firstAt) / HOUR;
  const fresh = Math.exp(-hours / 36);
  const soon = b.slots.day ? (b.slots.day - dayOf(t) <= 1 && b.slots.day >= dayOf(t) ? 1 : b.slots.day < dayOf(t) ? 0.1 : 0.6) : 0.7;
  const w = b.slots.window;
  const importance = !w ? 0.55 : w.kind === 'all_day' ? 1 : w.kind === 'coarse' ? 0.6 : clamp01((w.to - w.from) / HOUR / 8) || 0.2;
  return r3(clamp01(b.confidence * soon * (0.4 + 0.6 * fresh) * (0.45 + 0.55 * importance) + 0.1 * personal));
}

/** 对话中是否提起（同步规则） */
export function mentionOf(p: { speaker: Agent; listener: Agent; belief: Belief; relevanceToListener: number; strength: number; told: boolean; toldCount: number; personal: number; t: SimTime }, P: RuleParams = DEFAULT_PARAMS): { p: number; factors: Record<string, number> } {
  const M = P.mention;
  const f = {
    salience: salienceOf(p.belief, p.t, p.personal),
    listener_relevance: r3(p.relevanceToListener),
    sociability: p.speaker.traits.sociability,
    tie: p.strength,
    anxiety: p.speaker.traits.anxiety,
    told: p.told ? 1 : 0,
    already_told_others: Math.min(5, p.toldCount),
  };
  const x = M.intercept + M.salience * f.salience + M.listenerRelevance * f.listener_relevance + M.sociability * f.sociability + M.tie * f.tie + M.anxiety * f.anxiety - M.told * f.told - M.toldOthers * f.already_told_others;
  return { p: r3(sigmoid(x)), factors: f };
}

export function chatOf(a: Agent, strength: number): number {
  return r3(sigmoid(-1.2 + 1.8 * a.traits.sociability + 1.4 * strength));
}
