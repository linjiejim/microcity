import { CH_HEX as PAL_CH, WIN_HEX } from '../theme/palette.ts';
import {
  CHANNEL_LABEL,
  FRAGMENT_LABEL,
  STAGE_LABEL,
  STOP_LABEL,
  clock,
  describeSlots,
  slotNames,
  formatTime,
  weekday,
  dayOf,
  type Channel,
  type DomainEvent,
  type Slots,
  type WorldState,
} from '@microcity/sim';
import type { IconName } from '../ui/icons.ts';

export { CHANNEL_LABEL, FRAGMENT_LABEL, STAGE_LABEL, STOP_LABEL };

export const CH_COLOR: Record<Channel, string> = {
  website: 'var(--ch-website)',
  push: 'var(--ch-push)',
  board: 'var(--ch-board)',
  talk: 'var(--ch-talk)',
  dm: 'var(--ch-dm)',
  org: 'var(--ch-org)',
};
export const CH_HEX: Record<Channel, string> = { ...PAL_CH };
export const CH_ICON: Record<Channel, IconName> = { website: 'web', push: 'push', board: 'board', talk: 'talk', dm: 'dm', org: 'org' };

export function windowTone(s?: Slots): { color: string; hex: string; label: string } {
  const w = s?.window;
  if (!w) return { color: 'var(--w-unknown)', hex: WIN_HEX.unknown, label: '时段不详' };
  if (w.kind === 'exact') return { color: 'var(--w-exact)', hex: WIN_HEX.exact, label: '精确时段' };
  if (w.kind === 'coarse') return { color: 'var(--w-coarse)', hex: WIN_HEX.coarse, label: '粗略时段' };
  return { color: 'var(--w-allday)', hex: WIN_HEX.all_day, label: '“全天”' };
}

export const time = (t: number): string => formatTime(t);
export const hm = (t: number): string => clock(t);
export const dayLabel = (t: number): string => `D${String(dayOf(t)).padStart(2, '0')} ${weekday(dayOf(t))}`;
export const yuan = (cents: number): string => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
export const pct = (x: number): string => `${Math.round(x * 100)}%`;

export function dur(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '未达到';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} 小时 ${m % 60} 分` : `${h} 小时`;
}

const name = (s: WorldState | undefined, id?: string) => (id ? (s?.agents[id]?.name ?? id) : '');

export interface EventLine {
  icon: IconName;
  color: string;
  text: string;
  sub?: string;
}

/** 事件 → 一行人话（检查器“记忆”“时间线”、时间轴提示共用） */
export function describeEvent(e: DomainEvent, s: WorldState | undefined, self?: string): EventLine | null {
  const vslots = (vid?: string) => (vid && s?.versions[vid] ? s.versions[vid]!.slots : undefined);
  switch (e.type) {
    case 'news_published':
      return { icon: 'news', color: 'var(--accent)', text: `${e.news.intervention ? '【管理员干预】' : ''}${e.news.publisher.name}发布《${e.news.headline.text}》`, sub: `渠道：${e.news.channels.map((c) => CHANNEL_LABEL[c]).join(' / ')}` };
    case 'power':
      return { icon: e.on ? 'bolt' : 'boltOff', color: e.on ? 'var(--ok)' : 'var(--bad)', text: `${e.area === 'north' ? '北区' : '南区'}${e.on ? '恢复供电' : '停电'}` };
    case 'exposure': {
      const who = e.from ? `${name(s, e.from)}` : '';
      const via = e.channel === 'talk' ? `听${who}说` : e.channel === 'dm' ? `收到${who}的私信` : e.channel === 'org' ? '收到单位通知' : `在${CHANNEL_LABEL[e.channel]}看到${FRAGMENT_LABEL[e.fragment]}`;
      const sl = vslots(e.versionId);
      return {
        icon: CH_ICON[e.channel],
        color: CH_COLOR[e.channel],
        text: `${self ? '' : `${name(s, e.agent)}：`}${via}${sl ? `「${describeSlots(sl)}」` : ''}`,
        sub: `注意 P=${e.attention.p} 抽样 ${e.attention.u} → ${e.attention.opened ? '看进去了' : '只扫了一眼'}`,
      };
    }
    case 'comprehended':
      return { icon: 'bulb', color: 'var(--fg-2)', text: `理解：记住了${e.extracted.length ? slotNames(e.extracted) : '——什么也没记住'}${e.missed.length ? `；漏了${slotNames(e.missed)}` : ''}${e.coarsened.length ? '；时段只记了个大概' : ''}` };
    case 'belief_set': {
      const tone = windowTone(e.belief.slots);
      return { icon: e.belief.slots.window?.kind === 'all_day' ? 'rumor' : 'bulb', color: tone.color, text: `${self ? '' : `${name(s, e.agent)}：`}${e.belief.status === 'believe' ? '相信' : e.belief.status === 'doubt' ? '将信将疑' : '不信'}「${describeSlots(e.belief.slots)}」`, sub: `置信 ${e.belief.confidence}${e.prev ? `（之前 ${e.prev.confidence}）` : ''} · ${e.reason}` };
    }
    case 'transmission': {
      const sl = vslots(e.tr.versionId);
      const out = self === e.tr.from;
      return { icon: CH_ICON[e.tr.channel], color: CH_COLOR[e.tr.channel], text: out ? `告诉了${name(s, e.tr.to)}「${sl ? describeSlots(sl) : ''}」` : `${name(s, e.tr.from)} → ${name(s, e.tr.to)}「${sl ? describeSlots(sl) : ''}」`, sub: CHANNEL_LABEL[e.tr.channel] };
    }
    case 'conversation': {
      const other = e.participants.find((p) => p !== self);
      const news = e.exchanges.filter((x) => x.mentioned).length;
      return { icon: 'talk', color: news ? 'var(--ch-talk)' : 'var(--fg-3)', text: self ? `和${name(s, other)}聊天${news ? '（提到了消息）' : ''}` : `${e.participants.map((p) => name(s, p)).join('、')} 聊天`, sub: s?.agents[e.participants[0]!] ? undefined : undefined };
    }
    case 'dm_sent':
      return {
        icon: 'dm',
        color: 'var(--ch-dm)',
        text: self === e.dm.from ? `给${name(s, e.dm.to)}发了私信` : self === e.dm.to ? `${name(s, e.dm.from)}发来一条私信（还没看）` : `${name(s, e.dm.from)} 给 ${name(s, e.dm.to)} 发私信`,
      };
    case 'dm_read':
      return { icon: 'dm', color: 'var(--ch-dm)', text: '读了私信' };
    case 'decision':
      if (e.phase === 'requested') return { icon: 'question', color: 'var(--fg-2)', text: `${self ? '' : `${name(s, e.agent)}：`}开始考虑怎么应对（${e.kind === 'reaction' ? '改不改安排' : '要不要通知别人'}）`, sub: `${e.provider === 'jev' ? 'Jev' : '规则'} · ${e.commitAt ? `${clock(e.commitAt)} 定下来` : ''}` };
      return { icon: 'dice', color: 'var(--accent)', text: `${self ? '' : `${name(s, e.agent)}：`}决定「${e.chosenLabel ?? e.chosen}」`, sub: e.outcome === 'invalidated' ? '执行时已不合法，改为照常' : undefined };
    case 'plan_set':
      if (e.reason === 'daily') return null;
      return { icon: 'list', color: e.reason === 'fallback' ? 'var(--warn)' : 'var(--info)', text: e.reason === 'fallback' ? `临时改安排：${e.note ?? ''}` : e.reason === 'org' ? `单位调整了排班（${e.note === 'relocate_team' ? '去图书馆办公' : '停电时段休息'}）` : `改了安排：${e.note ?? ''}` };
    case 'inconvenience':
      return { icon: 'boltOff', color: e.expected ? 'var(--warn)' : 'var(--bad)', text: `${self ? '' : `${name(s, e.agent)}：`}因停电受影响（${e.reason}）`, sub: `损失 ${dur(e.seconds)}` };
    case 'overreaction':
      return { icon: 'warn', color: 'var(--rumor)', text: `过度调整：${e.reason}` };
    case 'activity_started':
      return { icon: 'clock', color: 'var(--fg-3)', text: `${e.act.label}（${s?.agents[e.agent] ? '' : ''}${placeName(s, e.act.place)}）` };
    case 'activity_ended':
      if (e.outcome === 'done') return null;
      return { icon: 'warn', color: 'var(--bad)', text: `${e.outcome === 'interrupted' ? '被打断' : '没做成'}：${e.reason ?? ''}` };
    case 'item_status':
      if (e.status !== 'failed') return null;
      return { icon: 'warn', color: 'var(--bad)', text: `计划落空：${e.reason ?? ''}` };
    case 'org_notice':
      return { icon: 'org', color: 'var(--ch-org)', text: `单位通知：${e.text}` };
    case 'place_mode':
      return { icon: 'org', color: 'var(--warn)', text: `${placeName(s, e.place)}调整营业：${e.mode.kind === 'cold_menu' ? '冷饮点心' : e.mode.kind === 'closed_window' ? '暂停营业' : '恢复'}${e.mode.kind !== 'normal' ? ` ${clock(e.mode.from)}–${clock(e.mode.to)}` : ''}` };
    case 'intervention':
      return { icon: 'flag', color: e.by === 'admin' ? 'var(--rumor)' : 'var(--fg-3)', text: e.note };
    case 'purchase_failed':
      return { icon: 'coin', color: 'var(--bad)', text: `没买成：${e.reason}` };
    case 'meal':
      return null;
    default:
      return null;
  }
}

export function placeName(s: WorldState | undefined, id: string): string {
  return PLACE_NAMES[id] ?? id;
}

/** 静态地点名（避免每处都查地图） */
export const PLACE_NAMES: Record<string, string> = {};
export function registerPlaceNames(places: Array<{ id: string; name: string }>): void {
  for (const p of places) PLACE_NAMES[p.id] = p.name;
}
