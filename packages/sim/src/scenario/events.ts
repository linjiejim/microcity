/**
 * 事件规格 → 剧本（spec v1 §2.2，D22；v3 §2.1）。
 * 一轮“停电事件”生成：通知（可无）、澄清（可无）、检修工单（可无）、断电与来电。
 * 虚惊（mode = 'false_alarm'）：照常通知与派工单，但不断电；到原定恢复供电的时刻“真相可见”。
 * 分支 = 对事件规格打补丁后重新生成剧本。
 */
import { at, hhmm, HOUR, MIN, weekday, type SimTime } from '../core/time.ts';
import { coarsen, windowLabel } from '../info/slots.ts';
import type { Advice, NewsDraft, PublishChannel, Slots } from '../info/types.ts';
import { DISTRICT_LABEL, type District, type PlaceDef } from '../world/map.ts';
import type { OrgDef, ScriptEvent } from './types.ts';

export interface NoticeSpec {
  at: SimTime;
  channels: PublishChannel[];
  /** 标题里的时段写到什么程度（正文总是精确） */
  headline: 'exact' | 'coarse' | 'none';
  advice: Advice[];
}

export interface ClarifySpec {
  at: SimTime;
  channels: PublishChannel[];
}

export interface OutageEventSpec {
  id: string;
  /** 主张族 id；缺省 F_<id> */
  family?: string;
  /** 新闻 id；缺省 N_<id> / C_<id> / WO_<id> */
  ids?: { notice?: string; clarify?: string; workOrder?: string };
  /** 覆盖通知的标题/正文文字（槽位仍由规格决定） */
  texts?: { headline?: string; body?: string };
  area: District;
  day: number;
  /** 当天秒数 */
  from: number;
  to: number;
  notice: NoticeSpec | null;
  clarify: ClarifySpec | null;
  workOrder: boolean;
  /** 缺省 'outage'；'false_alarm' = 虚惊：发了通知但没有停电 */
  mode?: 'outage' | 'false_alarm';
}

/** 世界真相：这一轮实际在哪、哪天、几点到几点停电（虚惊：原定的区域与时段，电没断） */
export interface OutageTruth {
  id: string;
  family: string;
  area: District;
  day: number;
  from: number;
  to: number;
  falseAlarm?: true;
}

export const familyOf = (e: OutageEventSpec): string => e.family ?? `F_${e.id}`;

export function newsIdsOf(e: OutageEventSpec): { notice: string; clarify: string; workOrder: string } {
  return { notice: e.ids?.notice ?? `N_${e.id}`, clarify: e.ids?.clarify ?? `C_${e.id}`, workOrder: e.ids?.workOrder ?? `WO_${e.id}` };
}

export const truthOf = (e: OutageEventSpec): OutageTruth => ({ id: e.id, family: familyOf(e), area: e.area, day: e.day, from: e.from, to: e.to, ...(e.mode === 'false_alarm' ? { falseAlarm: true as const } : {}) });

const ADVICE_TEXT: Record<Advice, string> = {
  charge_devices: '请提前为手机等设备充电',
  plan_elsewhere: '需用电办公者请另行安排',
  store_food: '请提前备好食物',
};

const pad = (n: number) => String(n).padStart(2, '0');

interface Ctx {
  places: PlaceDef[];
  orgs: OrgDef[];
}

function orgOfKind(ctx: Ctx, kind: PlaceDef['kind']): { id: string; name: string; short: string } | undefined {
  for (const o of ctx.orgs) {
    const p = ctx.places.find((x) => x.id === o.place);
    if (p?.kind === kind) return { id: o.id, name: o.name, short: p.short };
  }
  return undefined;
}

/** 区域内的地标（写进通知正文）：住宅在前，最多 5 个 */
function landmarks(ctx: Ctx, area: District): string {
  const inArea = ctx.places.filter((p) => p.district === area && !p.open);
  const sorted = [...inArea.filter((p) => p.kind === 'residence'), ...inArea.filter((p) => p.kind !== 'residence')];
  return sorted
    .slice(0, 5)
    .map((p) => p.short)
    .join('、');
}

export function noticeDraft(e: OutageEventSpec, ctx: Ctx): NewsDraft {
  const gov = orgOfKind(ctx, 'gov') ?? { id: 'gov', name: '镇政务中心', short: '政务中心' };
  const area = DISTRICT_LABEL[e.area];
  const other = DISTRICT_LABEL[e.area === 'north' ? 'south' : 'north'];
  const wd = weekday(e.day);
  const span = `${hhmm(e.from)}–${hhmm(e.to)}`;
  const exact = { kind: 'exact' as const, from: e.from, to: e.to };
  const hl = e.notice?.headline ?? 'coarse';
  const headWindow = hl === 'exact' ? exact : hl === 'coarse' ? coarsen(exact) : undefined;
  const advice = e.notice?.advice ?? [];
  const headSlots: Slots = { event: 'power_outage', area: e.area, day: e.day, ...(headWindow ? { window: headWindow } : {}), source: 'gov', certainty: 'confirmed' };
  const bodySlots: Slots = { event: 'power_outage', area: e.area, day: e.day, window: exact, source: 'gov', certainty: 'confirmed', ...(advice.length ? { advice: [...advice] } : {}) };
  const headText = e.texts?.headline ?? (hl === 'exact' ? `${area}${wd} ${span} 计划停电` : hl === 'coarse' ? `${area}${wd}${windowLabel(coarsen(exact))}计划停电` : `${area}${wd}计划停电`);
  const adviceText = advice.length ? `${advice.map((a) => ADVICE_TEXT[a]).join('，')}。` : '';
  const bodyText = e.texts?.body ?? `因线路检修，${area}（${landmarks(ctx, e.area)}一带）将于${wd}（D${pad(e.day)}）${span} 停电。${adviceText}${other}不受影响。`;
  return {
    id: newsIdsOf(e).notice,
    familyId: familyOf(e),
    headline: { text: headText, slots: headSlots },
    body: { text: bodyText, slots: bodySlots },
    publisher: { kind: 'org', id: gov.id, name: gov.name },
  };
}

export function clarifyDraft(e: OutageEventSpec, ctx: Ctx): NewsDraft {
  const gov = orgOfKind(ctx, 'gov') ?? { id: 'gov', name: '镇政务中心', short: '政务中心' };
  const area = DISTRICT_LABEL[e.area];
  const wd = weekday(e.day);
  const span = `${hhmm(e.from)}–${hhmm(e.to)}`;
  const slots: Slots = { event: 'power_outage', area: e.area, day: e.day, window: { kind: 'exact', from: e.from, to: e.to }, source: 'gov', certainty: 'confirmed' };
  return {
    id: newsIdsOf(e).clarify,
    familyId: familyOf(e),
    headline: { text: `澄清：${area}停电仅${wd} ${span}，非全天`, slots },
    body: { text: `近日有“${area}${wd}停一整天电”的说法，特此澄清：停电时间仅为${wd}（D${pad(e.day)}）${span}，范围为${area}。其余时间正常供电。`, slots: { ...slots, advice: ['charge_devices'] } },
    publisher: { kind: 'org', id: gov.id, name: gov.name },
    ...(e.notice ? { correctionOf: newsIdsOf(e).notice } : {}),
  };
}

function workOrderDraft(e: OutageEventSpec, ctx: Ctx, org: { id: string; name: string }): NewsDraft {
  const area = DISTRICT_LABEL[e.area];
  const wd = weekday(e.day);
  const slots: Slots = { event: 'power_outage', area: e.area, day: e.day, window: { kind: 'exact', from: e.from, to: e.to }, source: 'org', certainty: 'confirmed' };
  void ctx;
  return {
    id: newsIdsOf(e).workOrder,
    familyId: familyOf(e),
    headline: { text: `检修工单：${area}线路${wd} ${hhmm(e.from)}–${hhmm(e.to)}`, slots },
    body: { text: `${area}线路检修，${wd} ${hhmm(e.from)} 断电，${hhmm(e.to)} 恢复。`, slots },
    publisher: { kind: 'org', id: org.id, name: org.name },
  };
}

/** 事件规格 → 剧本（按时间排序；同一时刻保持生成顺序） */
export function scriptFromEvents(events: readonly OutageEventSpec[], ctx: Ctx): ScriptEvent[] {
  const gov = orgOfKind(ctx, 'gov') ?? { id: 'gov', name: '镇政务中心', short: '政务中心' };
  const util = orgOfKind(ctx, 'utility');
  const out: ScriptEvent[] = [];
  for (const e of events) {
    const area = DISTRICT_LABEL[e.area];
    if (e.notice) out.push({ at: e.notice.at, kind: 'publish', news: noticeDraft(e, ctx), channels: [...e.notice.channels], note: `${gov.short}按计划发布停电通知` });
    if (e.clarify) out.push({ at: e.clarify.at, kind: 'publish', news: clarifyDraft(e, ctx), channels: [...e.clarify.channels], note: `${gov.short}发布澄清` });
    if (e.workOrder && util) {
      const base = e.notice ? e.notice.at + 30 * MIN : at(e.day - 1, 8, 30);
      const woAt = Math.ceil(base / HOUR) * HOUR;
      out.push({ at: woAt, kind: 'org_notice', org: util.id, news: workOrderDraft(e, ctx, util), note: `${util.short}下发检修工单` });
    }
    if (e.mode === 'false_alarm') {
      out.push({ at: at(e.day, 0) + e.to, kind: 'reveal', area: e.area, outage: e.id, note: `${area}的电一直没断：虚惊一场` });
      continue;
    }
    out.push({ at: at(e.day, 0) + e.from, kind: 'power', area: e.area, on: false, note: `${area}线路检修断电`, outage: e.id });
    out.push({ at: at(e.day, 0) + e.to, kind: 'power', area: e.area, on: true, note: `${area}恢复供电`, outage: e.id });
  }
  return out.map((x, i) => ({ x, i })).sort((a, b) => a.x.at - b.x.at || a.i - b.i).map(({ x }) => x);
}

const CH: Record<PublishChannel, string> = { website: '网站', push: '推送', board: '公告栏' };

/** 描述一轮事件（界面与报告用） */
export function describeEvent(e: OutageEventSpec): string {
  const area = DISTRICT_LABEL[e.area];
  const span = `${hhmm(e.from)}–${hhmm(e.to)}`;
  const n = e.notice ? `D${pad(Math.floor(e.notice.at / 86400) + 1)} ${hhmm(e.notice.at % 86400)} 发通知（${e.notice.channels.map((c) => CH[c]).join('+')}，标题${e.notice.headline === 'exact' ? '写精确时段' : e.notice.headline === 'coarse' ? '只写粗略时段' : '不写时段'}）` : '不发通知';
  const c = e.clarify ? `；D${pad(Math.floor(e.clarify.at / 86400) + 1)} ${hhmm(e.clarify.at % 86400)} 澄清` : '';
  return `${area} D${pad(e.day)} ${weekday(e.day)} ${span} ${e.mode === 'false_alarm' ? '虚惊（通知了但没停电）' : '停电'}；${n}${c}`;
}
