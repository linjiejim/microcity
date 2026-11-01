import { contentHash } from '../core/hash.ts';
import { clamp01, r3, rand } from '../core/rng.ts';
import type { SimTime } from '../core/time.ts';
import type { Traits } from '../scenario/types.ts';
import { coarsen } from './slots.ts';
import type { Channel, ClaimVersion, Fragment, Mutation, Slots, SlotKey } from './types.ts';
import { SLOT_KEYS } from './types.ts';
import { DEFAULT_PARAMS, type RuleParams } from '../params.ts';

export const INFO_RULES_VERSION = 'info_rules_v1';

export function versionIdFor(familyId: string, slots: Slots): string {
  return `v_${contentHash({ familyId, slots }).slice(0, 8)}`;
}

export function makeVersion(p: {
  familyId: string;
  slots: Slots;
  origin: ClaimVersion['origin'];
  parentId?: string;
  root: string;
  mutations: Mutation[];
  t: SimTime;
}): ClaimVersion {
  const slots = cleanSlots(p.slots);
  return {
    id: versionIdFor(p.familyId, slots),
    familyId: p.familyId,
    ...(p.parentId ? { parentId: p.parentId } : {}),
    slots,
    contentHash: contentHash(slots),
    origin: p.origin,
    root: p.root,
    mutations: p.mutations,
    createdAt: p.t,
  };
}

/** 删除空值，保证同内容同哈希 */
export function cleanSlots(s: Slots): Slots {
  const out: Slots = {};
  for (const k of SLOT_KEYS) {
    const v = s[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * 转述变形（spec §2.5）：谣言的唯一来源。
 * 说话人对每个槽位按 detail 保留/降精度/丢弃；时段缺失且焦虑高时可能补成“全天”。
 */
export function transmitSlots(p: {
  seed: number;
  speaker: string;
  listener: string;
  familyId: string;
  n: number;
  slots: Slots;
  traits: Traits;
  medium: 'speech' | 'text' | 'org';
}, P: RuleParams = DEFAULT_PARAMS): { slots: Slots; mutations: Mutation[] } {
  const { seed, speaker, listener, familyId, n, traits } = p;
  const T = P.transmit;
  const boost = p.medium === 'text' ? 0.2 : p.medium === 'org' ? 0.35 : 0;
  const detail = clamp01(traits.detail + boost + T.detailShift);
  const out: Slots = {};
  const muts: Mutation[] = [];
  const u = (slot: string) => rand(seed, 'tx', speaker, listener, familyId, n, slot);
  const s = p.slots;
  const keep = (k: SlotKey, pKeep: number) => {
    const v = s[k];
    if (v === undefined) return;
    if (u(k) < pKeep) (out as Record<string, unknown>)[k] = v;
    else muts.push({ slot: k, op: 'drop', from: v, because: { detail: r3(detail) } });
  };
  keep('event', 0.99);
  keep('area', 0.96 + 0.03 * detail);
  keep('day', 0.88 + 0.1 * detail);
  if (s.window) {
    if (s.window.kind === 'exact') {
      const x = u('window');
      const pExact = T.exactBase + T.exactDetail * detail;
      if (x < pExact) out.window = s.window;
      else if (x < T.dropWindowAbove) {
        out.window = coarsen(s.window);
        muts.push({ slot: 'window', op: 'coarsen', from: s.window, to: out.window, because: { detail: r3(detail) } });
      } else muts.push({ slot: 'window', op: 'drop', from: s.window, because: { detail: r3(detail) } });
    } else keep('window', s.window.kind === 'coarse' ? 0.84 + 0.12 * detail : 0.95);
  }
  if (s.source) {
    if (u('source') < 0.45 + 0.45 * detail) out.source = s.source;
    else {
      out.source = 'person';
      if (s.source !== 'person') muts.push({ slot: 'source', op: 'drop', from: s.source, to: 'person', because: { detail: r3(detail) } });
    }
  }
  if (s.certainty) {
    if (s.certainty === 'confirmed' && u('certainty') > 0.72 + 0.25 * detail) {
      out.certainty = 'likely';
      muts.push({ slot: 'certainty', op: 'weaken', from: 'confirmed', to: 'likely', because: { detail: r3(detail) } });
    } else out.certainty = s.certainty;
  }
  keep('advice', 0.35 + 0.45 * detail);
  // 焦虑补全：说话人自己不知道时段（不是转述时漏说）→ “全天”
  if (!s.window && !out.window && out.event === 'power_outage') {
    const q = Math.max(0, traits.anxiety - T.fillFrom) * T.fillGain;
    if (q > 0 && u('fill') < q) {
      out.window = { kind: 'all_day' };
      muts.push({ slot: 'window', op: 'fill_worst_case', to: out.window, because: { anxiety: r3(traits.anxiety), p: r3(q) } });
      if (out.certainty === 'likely' && traits.anxiety > 0.75) {
        out.certainty = 'confirmed';
        muts.push({ slot: 'certainty', op: 'strengthen', from: 'likely', to: 'confirmed', because: { anxiety: r3(traits.anxiety) } });
      }
    }
  }
  if (!out.certainty) out.certainty = 'likely';
  return { slots: cleanSlots(out), mutations: muts };
}

/** 不同片段能看到的槽位 */
export function fragmentVersionId(news: { headline: { versionId: string }; body: { versionId: string } }, fragment: Fragment): string {
  return fragment === 'body' || fragment === 'poster_full' ? news.body.versionId : news.headline.versionId;
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  website: '镇网站',
  push: '推送',
  board: '公告栏',
  talk: '当面交谈',
  dm: '私信',
  org: '单位通知',
};

export const FRAGMENT_LABEL: Record<Fragment, string> = {
  headline: '标题',
  body: '全文',
  poster_title: '海报标题',
  poster_full: '海报全文',
  speech: '口述',
  text: '文字',
};
