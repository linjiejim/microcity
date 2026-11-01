/**
 * 信任随经历演化（spec v1 §2.3，D21；v2 §2.5）：真相被看见之后，见证者按规则表调整信任，并记下这次经历。
 * 规则是显式的、可审计的；不交给模型判断。幅度由 Jev 信任面板校准（实验记录 C4）。
 */
import { overlap, type SimTime } from '../core/time.ts';
import { windowInterval } from '../info/slots.ts';
import type { Belief } from '../info/types.ts';
import type { OutageTruth } from '../scenario/events.ts';
import type { Agent, ExperienceKind, WorldState } from '../state/types.ts';
import type { TownMap } from '../world/map.ts';
import { DEFAULT_PARAMS, type RuleParams } from '../params.ts';

export const SOCIAL_RULES_VERSION = 'social_v3';

/** 默认规则表（变化量）；实际用的是 RuleParams.trust（可被实验覆盖，× scale） */
export const TRUST_RULES = (({ scale: _scale, ...rules }) => rules)(DEFAULT_PARAMS.trust);
export type TrustRule = keyof typeof TRUST_RULES;

/** 见证者：住在/工作在受影响区域，或当天那个时段有安排在那儿 */
export function isWitness(map: TownMap, a: Agent, o: OutageTruth, winFrom: SimTime, winTo: SimTime): boolean {
  if (map.places[a.home]?.district === o.area) return true;
  if (a.workplace && map.places[a.workplace]?.district === o.area) return true;
  return (a.plans[o.day] ?? []).some((it) => it.status !== 'cancelled' && map.places[it.place]?.district === o.area && overlap(it.start, it.end, winFrom, winTo) > 0);
}

export interface TrustDelta {
  target: 'gov' | string;
  delta: number;
  reason: string;
  family: string;
  /** 只在 target = 'gov' 时有：这次经历属于哪一类 */
  kind?: ExperienceKind;
}

function hours(sec: number): string {
  const h = sec / 3600;
  return Number.isInteger(h) ? `${h} 小时` : `${Math.round(h * 10) / 10} 小时`;
}

export function trustVerdict(s: WorldState, map: TownMap, a: Agent, o: OutageTruth, fams: Set<string>, winFrom: SimTime, winTo: SimTime, P: RuleParams = DEFAULT_PARAMS): TrustDelta[] {
  if (!isWitness(map, a, o, winFrom, winTo)) return [];
  const R = (k: TrustRule): number => P.trust[k] * P.trust.scale;
  const out: TrustDelta[] = [];
  const st = a.stats.byOutage[o.id];
  const surprised = (st?.surprised ?? 0) > 0;
  const over = (st?.overreactSec ?? 0) > 0;
  let sawOfficial = false;
  let sawCorrection = false;
  let coarseHeadlineOnly = false;
  let readBody = false;
  for (const f of fams) {
    const seen = a.seen[f];
    if (!seen) continue;
    for (const nid of seen.headlines) {
      const n = s.news[nid];
      if (!n) continue;
      sawOfficial = true;
      if (n.correctionOf) sawCorrection = true;
      const hv = s.versions[n.headline.versionId];
      if (hv?.slots.window?.kind === 'coarse' && !seen.bodies.includes(nid)) coarseHeadlineOnly = true;
    }
    if (seen.bodies.length > 0) readBody = true;
  }
  const beliefs = [...fams].map((f) => a.beliefs[f]).filter((b): b is Belief => !!b);
  const best = beliefs.sort((x, y) => y.confidence - x.confidence)[0];
  const exactRight = best?.status === 'believe' && best.slots.window?.kind === 'exact' && best.slots.window.from === o.from && best.slots.window.to === o.to;

  // —— 对官方通知：每人只归入一类经历（与信任面板的 6 种经历对应） ——
  let gov: [TrustRule, ExperienceKind, string] | undefined;
  if (surprised && !sawOfficial) gov = ['surprisedUninformed', 'surprised_uninformed', '停电前没收到任何官方通知，被打了个措手不及'];
  else if (surprised) gov = ['surprisedInformed', 'surprised_informed', '看到过通知但没弄清楚，还是被停电打乱了安排'];
  else if (over && coarseHeadlineOnly) gov = ['vagueHeadline', 'vague_overreact', '通知标题只说了个大概时段，白白挪了安排'];
  else if (sawCorrection && exactRight) gov = ['clarification', 'clarified', '第一条通知含糊，好在官方及时澄清，按澄清的时间安排好了'];
  else if (exactRight && readBody) gov = ['accurateNotice', 'accurate', '官方通知说得准，提前安排好了'];
  if (gov) out.push({ target: 'gov', delta: R(gov[0]), reason: gov[2], family: o.family, kind: gov[1] });

  // —— 对告诉过他的人：只看最近一次从这个人那里听到的版本 ——
  const latest = new Map<string, { versionId: string; family: string; t: SimTime }>();
  for (const b of beliefs) {
    for (const src of b.sources) {
      if (!src.from || src.from === a.id) continue;
      const prev = latest.get(src.from);
      if (!prev || src.t >= prev.t) latest.set(src.from, { versionId: src.versionId, family: b.familyId, t: src.t });
    }
  }
  for (const [from, src] of [...latest.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    const v = s.versions[src.versionId];
    if (!v) continue;
    const name = s.agents[from]?.name ?? from;
    const sl = v.slots;
    let d = 0;
    let why = '';
    if (sl.area && sl.area !== 'town' && sl.area !== o.area) [d, why] = [R('relayWrongPlace'), `${name}说的地方不对`];
    else if (sl.day && sl.day !== o.day) [d, why] = [R('relayWrongPlace'), `${name}说的日子不对`];
    else if (sl.window?.kind === 'all_day') [d, why] = [R('relayAllDay'), `${name}说停一整天，结果只停了 ${hours(o.to - o.from)}`];
    else if (sl.window?.kind === 'exact') {
      if (sl.window.from === o.from && sl.window.to === o.to) [d, why] = [R('relayExact'), `${name}说的时间一分不差`];
      else [d, why] = [R('relayWrongTime'), `${name}说的时间不对`];
    } else if (sl.window?.kind === 'coarse') {
      const [w0, w1] = windowInterval(sl.window);
      if (o.from >= w0 && o.to <= w1) [d, why] = [R('relayCoarse'), `${name}说得大体不错`];
      else [d, why] = [R('relayWrongTime'), `${name}说的时段不对`];
    }
    if (d !== 0) out.push({ target: from, delta: d, reason: why, family: src.family });
  }
  return out;
}

/**
 * 虚惊的信任裁决（social_v3）：到原定恢复供电的时刻，停电区的见证者看见电一直没断。
 * 信了通知的人按“有没有为此改安排”归入两类经历；没听说的人不变；如实转述的人不受牵连。
 */
export function falseAlarmVerdict(map: TownMap, a: Agent, o: OutageTruth, fams: Set<string>, winFrom: SimTime, winTo: SimTime, P: RuleParams = DEFAULT_PARAMS): TrustDelta[] {
  if (!isWitness(map, a, o, winFrom, winTo)) return [];
  const believed = [...fams].some((f) => a.beliefs[f]?.status === 'believe');
  if (!believed) return [];
  const R = (k: TrustRule): number => P.trust[k] * P.trust.scale;
  const costly = (a.stats.byOutage[o.id]?.overreactSec ?? 0) > 0;
  return [
    costly
      ? { target: 'gov', delta: R('falseAlarmCostly'), reason: '通知说要停电，我为此挪了安排，结果电一直没断', family: o.family, kind: 'false_alarm_costly' }
      : { target: 'gov', delta: R('falseAlarm'), reason: '通知说要停电，结果电一直没断', family: o.family, kind: 'false_alarm' },
  ];
}
