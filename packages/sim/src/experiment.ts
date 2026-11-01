import { dayStart, formatTime, HOUR, MIN, parseTime, type SimTime } from './core/time.ts';
import type { PublishChannel } from './info/types.ts';
import type { ScenarioDef, ScriptEvent } from './scenario/types.ts';
import { scriptFromEvents, type OutageEventSpec } from './scenario/events.ts';
import type { TownSpec } from './scenario/spec.ts';
import { canonical } from './core/hash.ts';
import { isDefaultPatch, paramAt, resolveParams, type ParamPatch } from './params.ts';

/**
 * 对一轮事件的干预：改渠道、改标题清晰度、不发通知、加/去澄清；
 * v3 起还能改“这一轮到底有没有”：虚惊（通知了但不停电）、不存在（这一轮从未发生）。
 */
export interface EventPatch {
  event: string;
  channels?: PublishChannel[];
  headline?: 'exact' | 'coarse' | 'none';
  /** true = 这一轮不发通知 */
  silent?: boolean;
  /** null = 去掉澄清 */
  clarify?: { at: string; channels: PublishChannel[] } | null;
  /** 'false_alarm' = 虚惊；'absent' = 这一轮从未发生；'outage' = 照常 */
  mode?: 'outage' | 'false_alarm' | 'absent';
}

/** 换一座镇：对底座规格的修改（文化、媒介、关系网、人口）；这样的分支从头跑，不共享分叉点 */
export interface TownPatch {
  culture?: Partial<TownSpec['culture']>;
  media?: Partial<TownSpec['media']>;
  network?: Partial<TownSpec['network']>;
  population?: Partial<TownSpec['population']>;
}

export interface BranchSpec {
  label: string;
  patches?: EventPatch[];
  /** 规则参数覆盖（从分叉点起生效；与实验级覆盖合并） */
  params?: ParamPatch;
  /** 换一座镇（从头跑） */
  town?: TownPatch;
  /** v0 兼容：作用于第一轮事件的渠道 */
  channels?: PublishChannel[];
  /** v0 兼容：第一轮事件的澄清 */
  clarification?: { at: string; channels: PublishChannel[] };
}

/**
 * 先猜再跑：事先写下的预测（v3）。跑完后按与实验记录相同的规则自动判定：
 * higher / lower：逐 seed 配对，预测方向在 ≥ 70% 的配对里成立为“支持”、≤ 50% 为“不支持”，其余“部分支持”；
 * same：配对差的中位数绝对值 < tolerance（缺省 1）为“支持”，否则“不支持”。
 * 指标键同对照表：'E1.t50'、'E3.intended'、'E1.gapT50'、'trust.govDelta'、'trustAt.E3.govMean'。
 */
export interface Prediction {
  id: string;
  text: string;
  metric: string;
  a: string;
  b: string;
  expect: 'higher' | 'lower' | 'same';
  tolerance?: number;
}

export interface ExperimentManifest {
  id: string;
  name: string;
  /** 场景 id：'town30' 或登记过的生成场景 */
  scenario: string;
  seeds: number[];
  provider: 'rule' | 'jev';
  forkAt: string;
  until: string;
  branches: Record<string, BranchSpec>;
  /** 整个实验的规则参数覆盖（例如在校准后的参数下跑） */
  params?: ParamPatch;
  /** 先猜再跑：事先写下的预测，跑完自动判定 */
  predictions?: Prediction[];
  /** 这个实验在问什么（实验广场与分享用） */
  question?: string;
}

export const DEFAULT_BRANCHES: Record<string, BranchSpec> = {
  A: { label: '仅网站', patches: [{ event: '$first', channels: ['website'] }] },
  B: { label: '网站 + 公告栏', patches: [{ event: '$first', channels: ['website', 'board'] }] },
  C: { label: '网站 + 推送', patches: [{ event: '$first', channels: ['website', 'push'] }] },
  D: { label: '网站 + 推送 + 16:00 澄清', patches: [{ event: '$first', channels: ['website', 'push'], clarify: { at: '$notice_day 16:00', channels: ['website', 'push'] } }] },
};

/** 把分支规格落成对具体事件的补丁（v0 兼容字段、$first 占位都在这里解析） */
export function patchesOf(spec: BranchSpec, events: readonly OutageEventSpec[]): EventPatch[] {
  const first = events[0];
  const out: EventPatch[] = [];
  for (const p of spec.patches ?? []) {
    const ev = p.event === '$first' ? first : events.find((e) => e.id === p.event);
    if (!ev) continue;
    const q: EventPatch = { ...p, event: ev.id };
    if (p.clarify) q.clarify = { ...p.clarify, at: resolveAt(p.clarify.at, ev) };
    out.push(q);
  }
  if (first && (spec.channels || spec.clarification)) {
    out.push({ event: first.id, ...(spec.channels ? { channels: [...spec.channels] } : {}), ...(spec.clarification ? { clarify: { at: resolveAt(spec.clarification.at, first), channels: [...spec.clarification.channels] } } : {}) });
  }
  return out;
}

/** '$notice_day 16:00' → 通知当天 16:00 */
function resolveAt(s: string, ev: OutageEventSpec): string {
  if (!s.startsWith('$notice_day')) return s;
  const day = ev.notice ? Math.floor(ev.notice.at / 86400) + 1 : ev.day - 1;
  return `D${String(day).padStart(2, '0')}${s.slice('$notice_day'.length)}`;
}

export function applyPatches(events: readonly OutageEventSpec[], patches: readonly EventPatch[]): OutageEventSpec[] {
  let out = structuredClone(events) as OutageEventSpec[];
  for (const p of patches) {
    const e = out.find((x) => x.id === p.event);
    if (!e) continue;
    if (p.mode === 'absent') {
      out = out.filter((x) => x !== e);
      continue;
    }
    if (p.mode) e.mode = p.mode;
    if (p.silent) e.notice = null;
    else if (e.notice) {
      if (p.channels) e.notice.channels = [...p.channels];
      if (p.headline) e.notice.headline = p.headline;
    }
    if (p.clarify === null) e.clarify = null;
    else if (p.clarify) e.clarify = { at: parseTime(p.clarify.at), channels: [...p.clarify.channels] };
  }
  return out;
}

/** 分支的剧本：打补丁后重新生成，真实停电不变 */
export function branchScript(sc: ScenarioDef, spec: BranchSpec): ScriptEvent[] {
  const events = applyPatches(sc.events, patchesOf(spec, sc.events));
  return scriptFromEvents(events, { places: sc.map.places, orgs: sc.orgs });
}

/** 分叉点：所有分支补丁涉及的最早发布时刻之前（取整到 10 分钟） */
export function forkTimeFor(sc: ScenarioDef, branches: Record<string, BranchSpec>): SimTime {
  let t = Infinity;
  for (const spec of Object.values(branches)) {
    for (const p of patchesOf(spec, sc.events)) {
      const e = sc.events.find((x) => x.id === p.event);
      if (!e) continue;
      if (e.notice) t = Math.min(t, e.notice.at);
      if (e.clarify) t = Math.min(t, e.clarify.at);
      if (p.clarify) t = Math.min(t, parseTime(p.clarify.at));
      if (!e.notice && !p.silent) t = Math.min(t, dayStart(e.day) - 12 * HOUR);
    }
  }
  if (!Number.isFinite(t)) t = sc.start + HOUR;
  return Math.max(sc.start + 10 * MIN, Math.floor((t - 5 * MIN) / (10 * MIN)) * 10 * MIN);
}

/** 跑到哪：最后一轮停电结束后 4 小时 */
export function untilFor(sc: ScenarioDef): SimTime {
  const last = sc.outages.reduce((m, o) => Math.max(m, dayStart(o.day) + o.to), sc.start + 3 * 86400);
  return last + 4 * HOUR;
}

export function defaultManifest(seed: number | number[] = 42, provider: 'rule' | 'jev' = 'rule', sc?: ScenarioDef): ExperimentManifest {
  const seeds = Array.isArray(seed) ? seed : [seed];
  const branches = structuredClone(DEFAULT_BRANCHES);
  const scenario = sc?.id ?? 'town30';
  return {
    id: `exp-${scenario}-${seeds.join('_')}-${provider}`,
    name: `${sc ? `${sc.name}：` : '停电通知：'}渠道对照`,
    scenario,
    seeds,
    provider,
    forkAt: sc ? formatTime(forkTimeFor(sc, branches)) : 'D03 08:00',
    until: sc ? formatTime(untilFor(sc)) : 'D04 20:00',
    branches,
  };
}

/** 一个分支实际用的参数覆盖：实验级覆盖 + 分支覆盖（分支优先） */
export function branchParams(m: Pick<ExperimentManifest, 'params'>, spec: BranchSpec): ParamPatch | undefined {
  const merged = mergeDeep(structuredClone(m.params ?? {}) as Record<string, unknown>, (spec.params ?? {}) as Record<string, unknown>) as ParamPatch;
  if (isDefaultPatch(merged)) return undefined;
  resolveParams(merged);
  return merged;
}

/** 把换镇补丁合并到底座规格上（结果再交给 normalizeSpec 夹取） */
export function applyTownPatch(base: TownSpec, patch: TownPatch): TownSpec {
  const out = structuredClone(base);
  for (const k of ['culture', 'media', 'network', 'population'] as const) {
    const p = patch[k];
    if (!p) continue;
    for (const [key, v] of Object.entries(p)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`换镇参数 ${k}.${key} 必须是数`);
      if (!(key in out[k])) throw new Error(`未知的换镇参数 ${k}.${key}`);
      (out[k] as Record<string, number>)[key] = v;
    }
  }
  // 经典底座是手工小镇，只能做修饰；换了底座各分支就不再是同一座镇，所以直接拒绝
  if (out.base === 'classic' && (patch.population || patch.network?.crossDistrict !== undefined || patch.network?.kin !== undefined)) throw new Error('经典小镇不能改人口、跨区关系和亲属比例；请先用生成的小镇做底座');
  return out;
}

const TOWN_LABEL: Record<string, string> = {
  'culture.trustGov': '对官方的信任',
  'culture.anxiety': '焦虑',
  'culture.sociability': '爱社交',
  'culture.detail': '细致',
  'media.push': '订推送',
  'media.website': '看网站',
  'media.boards': '公告栏',
  'network.friends': '人均朋友',
  'network.crossDistrict': '跨区关系',
  'network.kin': '亲属',
  'population.size': '人口',
  'population.seniors': '老人',
  'population.youth': '青年',
  'population.northShare': '北岸人口',
};

/** 分支里“动了什么”的一行说明（界面与报告用） */
export function describeBranch(spec: BranchSpec, m?: Pick<ExperimentManifest, 'params'>): string[] {
  const out: string[] = [];
  for (const k of ['culture', 'media', 'network', 'population'] as const) {
    for (const [key, v] of Object.entries(spec.town?.[k] ?? {})) out.push(`${TOWN_LABEL[`${k}.${key}`] ?? `${k}.${key}`} ${v}`);
  }
  const p = m ? branchParams(m, spec) : spec.params;
  if (p) for (const path of leafPaths(p as Record<string, unknown>)) out.push(`${path} = ${paramAt(resolveParams(p), path)}`);
  return out;
}

function leafPaths(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leafPaths(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

function mergeDeep(into: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) into[k] = mergeDeep(((into[k] as Record<string, unknown>) ?? {}) as Record<string, unknown>, v as Record<string, unknown>);
    else if (v !== undefined) into[k] = v;
  }
  return into;
}

/** 两个分支的参数是否相同（用于判断能否共用分叉） */
export const sameParams = (a?: ParamPatch, b?: ParamPatch): boolean => canonical(a ?? {}) === canonical(b ?? {});
