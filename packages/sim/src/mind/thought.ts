/**
 * 人物画像与“想法”（spec v1 §2.6，D26）：由状态模板化生成，确定、离线可用、与事实一致。
 * “想法”是第一人称的一句话，只复述此人主观知道的东西；模板按键取，不同人不同说法。
 */
import { rand } from '../core/rng.ts';
import { dayStart, type SimTime } from '../core/time.ts';
import { describeSlots } from '../info/slots.ts';
import { CHANNEL_LABEL } from '../info/claims.ts';
import type { BeliefStatus } from '../info/types.ts';
import type { OutageTruth } from '../scenario/events.ts';
import type { Agent, ExperienceKind, FunnelStop, WorldState } from '../state/types.ts';
import { DISTRICT_LABEL, type District, type TownMap } from '../world/map.ts';
import { relationBetween } from './assess.ts';
import { isWitness } from './social.ts';

export type CardStage = 'unaware' | 'glimpsed' | 'disbelieve' | 'doubt' | 'believe' | 'changed' | 'acted';
export const CARD_STAGE_TEXT: Record<CardStage, string> = {
  unaware: '未接触',
  glimpsed: '扫到没进脑子',
  disbelieve: '不信',
  doubt: '将信将疑',
  believe: '相信',
  changed: '改了安排',
  acted: '已照做',
};
export type Mood = 'unaware' | 'calm' | 'worried' | 'skeptical' | 'annoyed' | 'relieved';
export const MOOD_TEXT: Record<Mood, string> = { unaware: '不知情', calm: '平静', worried: '担心', skeptical: '怀疑', annoyed: '恼火', relieved: '庆幸' };

export interface PersonCard {
  id: string;
  name: string;
  age: number;
  role: string;
  district: District;
  household: string;
  stage: CardStage;
  window: 'exact' | 'coarse' | 'all_day' | 'unknown' | null;
  belief: { text: string; confidence: number; status: BeliefStatus; via: string } | null;
  stop: { stop: FunnelStop; reason: string } | null;
  /** 因这件事改过的安排（标签） */
  changes: string[];
  told: number;
  affected: boolean;
  surprised: boolean;
  overreactMin: number;
  trustGov: number;
  /** 初始信任（特质） */
  trustGov0: number;
  /** 人际信任相对关系初值的变化 */
  trustShifts: Array<{ id: string; name: string; from: number; to: number }>;
  /** 此刻之前经历过的停电（social_v2），早的在前 */
  memory: Array<{ outage: string; kind: ExperienceKind; text: string }>;
  activity: string;
  thought: { text: string; mood: Mood };
}

/** 算作“因为这件事改了安排”的来源（恢复原安排不算） */
const REVISION = new Set(['move', 'adapt', 'prepare', 'org']);

function activityText(s: WorldState, map: TownMap, a: Agent): string {
  if (a.loc.k === 'walk') return `在去${map.places[a.loc.walk.toPlace]?.short ?? ''}的路上`;
  if (!a.act) return '闲着';
  if (a.act.kind === 'sleep') return '在睡觉';
  const where = map.places[a.act.place];
  const at = where && where.id !== a.home ? `在${where.short}` : '在家';
  return `${at}${a.act.label.replace(/^在家/, '')}`;
}

export function personCard(s: WorldState, map: TownMap, id: string, family: string, t: SimTime, outage?: OutageTruth): PersonCard {
  const a = s.agents[id]!;
  const b = a.beliefs[family];
  const f = a.funnel[family] ?? {};
  const changes: string[] = [];
  for (const items of Object.values(a.plans)) {
    for (const it of items) {
      if (it.status === 'cancelled' || it.origin?.family !== family || !REVISION.has(it.origin.reason)) continue;
      if (!changes.includes(it.label)) changes.push(it.label);
    }
  }
  // 管理者调整营业（冷饮/暂停）不改自己的计划项，但也是“因为这件事做了安排”
  for (const p of Object.values(s.places)) {
    if (p.mode.kind === 'normal' || p.mode.by !== id) continue;
    changes.push(`${map.places[p.id]?.short ?? p.id}${p.mode.kind === 'cold_menu' ? '改卖冷饮点心' : '暂停营业'}`);
  }
  let stage: CardStage;
  if (!f.exposed) stage = 'unaware';
  else if (!b) stage = 'glimpsed';
  else if (b.status === 'disbelieve') stage = 'disbelieve';
  else if (b.status === 'doubt') stage = 'doubt';
  else if (f.acted) stage = 'acted';
  else if (f.intended || changes.length) stage = 'changed';
  else stage = 'believe';
  const st = outage ? a.stats.byOutage[outage.id] : a.stats;
  const src = b?.sources[b.sources.length - 1];
  const via = src ? (src.from ? `听${s.agents[src.from]?.name ?? src.from}说` : CHANNEL_LABEL[src.channel]) : '';
  const trustShifts = Object.entries(a.trustIn)
    .map(([oid, to]) => ({ id: oid, name: s.agents[oid]?.name ?? oid, from: relationBetween(s, a.id, oid)?.trust ?? 0.4, to }))
    .filter((x) => Math.abs(x.to - x.from) >= 0.005)
    .sort((x, y) => x.to - x.from - (y.to - y.from));
  const card: PersonCard = {
    id,
    name: a.name,
    age: a.age,
    role: a.roleLabel,
    district: map.places[a.home]?.district ?? 'north',
    household: a.householdId,
    stage,
    window: b ? (!b.slots.window ? 'unknown' : b.slots.window.kind === 'exact' ? 'exact' : b.slots.window.kind === 'coarse' ? 'coarse' : 'all_day') : null,
    belief: b ? { text: describeSlots(b.slots), confidence: b.confidence, status: b.status, via } : null,
    stop: f.stop ? { stop: f.stop, reason: f.stopReason ?? '' } : null,
    changes,
    told: (a.told[family] ?? []).length,
    affected: (st?.inconvenience ?? 0) > 0,
    surprised: (st?.surprised ?? 0) > 0,
    overreactMin: Math.round((st?.overreactSec ?? 0) / 60),
    trustGov: a.trustGov,
    trustGov0: a.traits.trustOfficial,
    trustShifts,
    memory: (a.memory ?? []).filter((m) => m.t <= t).map((m) => ({ outage: m.outage, kind: m.kind, text: m.text })),
    activity: activityText(s, map, a),
    thought: { text: '', mood: 'calm' },
  };
  card.thought = thoughtOf(s, map, a, card, family, t, outage);
  return card;
}

function thoughtOf(s: WorldState, map: TownMap, a: Agent, c: PersonCard, family: string, t: SimTime, o?: OutageTruth): { text: string; mood: Mood } {
  const pick = (key: string, xs: string[]) => xs[Math.floor(rand(s.meta.seed, 'thought', a.id, family, key) * xs.length)]!;
  const started = !!o && t >= dayStart(o.day) + o.from;
  const ended = !!o && t >= dayStart(o.day) + o.to;
  const hours = o ? Math.round(((o.to - o.from) / 3600) * 10) / 10 : 0;
  const area = o ? DISTRICT_LABEL[o.area] : '';
  const slots = c.belief ? `「${c.belief.text}」` : '';
  const change = c.changes[0];
  const hit = o ? (a.plans[o.day] ?? []).find((it) => (it.status === 'failed' || it.status === 'interrupted') && it.needsPower && map.places[it.place]?.district === o.area)?.label : undefined;
  const blamed = c.trustShifts.find((x) => x.to < x.from - 0.05);
  const govDown = c.trustGov < c.trustGov0 - 0.02;
  const govUp = c.trustGov > c.trustGov0 + 0.02;

  if (started && c.surprised) {
    if (!c.belief && c.stage === 'unaware') return { mood: 'annoyed', text: pick('s0', [`停电前根本没人告诉我，${hit ?? '手头的事'}泡汤了。`, `突然就停电了，${hit ?? '手头的事'}做不成，也没见谁通知一声。`]) };
    return { mood: 'annoyed', text: pick('s1', [`通知好像是扫过一眼，没当回事，结果${hit ?? '手头的事'}被停电打断了。`, `没弄清到底几点停，${hit ?? '安排'}还是被打乱了。`]) };
  }
  if (ended && c.overreactMin >= 30) {
    if (blamed) return { mood: 'annoyed', text: `${blamed.name}说得挺吓人，结果只停了 ${hours} 小时，我白白挪了 ${c.overreactMin} 分钟的安排。以后${blamed.name}的话得打个折扣。` };
    return { mood: 'annoyed', text: pick('o1', [`通知只说了个大概，我挪开了 ${c.overreactMin} 分钟的安排，其实只停了 ${hours} 小时。`, `早知道只停 ${hours} 小时，就不折腾那么久了。`]) };
  }
  if (ended && c.belief) {
    if (change) return { mood: 'relieved', text: pick('e1', [`还好提前知道，${change}，停电那会儿一点没耽误。`, `提前安排了（${change}），停电没碰上什么麻烦。`]) + (govUp ? '这回镇上的通知挺准。' : '') };
    const tail = govUp ? pick('e3', ['镇上的通知说得挺准。', '这回通知靠谱。']) : govDown ? '通知得再说清楚点。' : '';
    if (o && isWitness(map, a, o, dayStart(o.day) + o.from, dayStart(o.day) + o.to)) return { mood: 'calm', text: pick('e2', [`停电那 ${hours} 小时没碰上什么事。`, `${area}停了 ${hours} 小时电，我这边还好。`, '电停了又来了，没耽误什么。']) + tail };
    return { mood: 'calm', text: pick('e4', [`听说${area}停了 ${hours} 小时电，跟我关系不大。`, `${area}停电那会儿我不在那边。`]) + tail };
  }
  if (ended && !c.belief) return { mood: 'unaware', text: `${c.activity}。没听说停电的事。` };
  if (started && c.belief) return { mood: 'calm', text: change ? `${area}这会儿停着电，我已经提前安排好了（${change}）。` : `${area}这会儿停着电，我这边没受什么影响。` };

  switch (c.stage) {
    case 'unaware':
      return { mood: 'unaware', text: `${c.activity}，还没听说停电的事。` };
    case 'glimpsed':
      return { mood: 'unaware', text: pick('g', ['好像刷到个通知，没细看。', '瞄到一眼什么通知，没往心里去。']) };
    case 'disbelieve':
      return { mood: 'skeptical', text: `听说${slots}？不太信。` };
    case 'doubt':
      return { mood: 'skeptical', text: pick('d', [`听说${slots}，真的假的？`, `好像说${slots}，回头查查。`]) };
    default:
      break;
  }
  // 上一轮的经历留在心里（social_v2）：新一轮消息来了，会想起上次
  const prev = c.memory.filter((m) => !o || m.outage !== o.id).at(-1);
  if (prev && (c.stage === 'believe' || c.stage === 'changed')) {
    const now = change ? `这回${change}。` : '这回得早点安排。';
    if (prev.kind === 'surprised_uninformed') return { mood: 'worried', text: `上次停电前没人通知，被打了个措手不及。${now}` };
    if (prev.kind === 'surprised_informed') return { mood: 'worried', text: `上次通知没看明白，还是被停电耽误了，这回可得看仔细。${change ? `已经${change}。` : ''}` };
    if (prev.kind === 'vague_overreact') return { mood: 'skeptical', text: `上次通知只说个大概，白挪了半天安排。这回${slots}，${change ? `${change}。` : '先看准了再说。'}` };
    if (prev.kind === 'accurate' || prev.kind === 'clarified') return { mood: 'calm', text: `上次通知挺准，这回${slots}，${change ? `${change}。` : '照着安排就行。'}` };
    const cried = c.memory.filter((m) => m.kind.startsWith('false_alarm')).length;
    if (prev.kind === 'false_alarm_costly') return { mood: 'skeptical', text: `${cried > 1 ? '都虚惊好几回了' : '上次说停电，我挪了半天安排，结果根本没停'}。这回${slots}，${change ? `还是${change}吧。` : '先看看再说。'}` };
    if (prev.kind === 'false_alarm') return { mood: 'skeptical', text: `${cried > 1 ? '说了几回停电都没停' : '上次说停电也没停'}，这回${slots}，${change ? `${change}，以防万一。` : '大概又是虚惊吧。'}` };
  }
  if (c.window === 'all_day') return { mood: 'worried', text: a.traits.anxiety > 0.6 ? pick('a1', [`${slots}！得赶紧准备。`, `听说${slots}，这可怎么办。`]) : `${slots}，得提前安排一下。` };
  if (change) return { mood: 'calm', text: pick('c', [`${slots}，安排已经调整：${change}。`, `知道了${slots}，${change}，就这么定了。`]) };
  if (c.stop?.stop === 'blocked') return { mood: 'annoyed', text: `${slots}，想改安排，可${c.stop.reason.replace(/^安排受影响，但/, '')}。` };
  if (c.stop?.stop === 'irrelevant') return { mood: 'calm', text: pick('i', [`${slots}，跟我关系不大。`, `${slots}，不影响我。`]) };
  if (c.stop?.stop === 'no_change') return { mood: 'calm', text: `${slots}，照常就行。` };
  return { mood: 'worried', text: `${slots}，得想想怎么安排。` };
}
