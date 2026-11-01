import { clamp01, r3, rand } from '../core/rng.ts';
import type { SimTime } from '../core/time.ts';
import type { Habits, Traits } from '../scenario/types.ts';
import { cleanSlots } from './claims.ts';
import { coarsen, windowPrecision } from './slots.ts';
import type { Belief, BeliefSource, BeliefStatus, Channel, Fragment, Slots, SlotKey } from './types.ts';
import { SLOT_KEYS } from './types.ts';
import { DEFAULT_PARAMS, type RuleParams } from '../params.ts';

/**
 * 理解：从片段中实际抽取了哪些槽位。
 * 看了标题的人不能自动知道正文细节（原方案第 21 页）。
 */
export function comprehend(p: {
  seed: number;
  agent: string;
  exposureId: string;
  slots: Slots;
  fragment: Fragment;
  opened: boolean;
  habits: Habits;
  traits: Traits;
  fatigue: number;
}): { slots: Slots; extracted: SlotKey[]; missed: SlotKey[]; coarsened: SlotKey[] } {
  const { seed, agent, exposureId, habits, fatigue } = p;
  let base: number;
  switch (p.fragment) {
    case 'headline':
    case 'poster_title':
      base = 0.78 + 0.15 * habits.readDepth;
      break;
    case 'body':
    case 'poster_full':
      base = 0.55 + 0.42 * habits.readDepth * (p.opened ? 1 : 0.6);
      break;
    case 'speech':
      base = 0.72 + 0.18 * p.traits.curiosity;
      break;
    case 'text':
      base = 0.8 + 0.15 * habits.readDepth;
      break;
  }
  base -= 0.25 * fatigue;
  const out: Slots = {};
  const extracted: SlotKey[] = [];
  const missed: SlotKey[] = [];
  const coarsened: SlotKey[] = [];
  for (const k of SLOT_KEYS) {
    const v = p.slots[k];
    if (v === undefined) continue;
    const core = k === 'event' || k === 'area' ? 0.12 : k === 'advice' ? -0.15 : p.fragment === 'speech' && k === 'window' ? -0.12 : p.fragment === 'speech' && k === 'day' ? -0.05 : 0;
    const pk = clamp01(base + core);
    const u = rand(seed, 'comp', agent, exposureId, k);
    if (u < pk) {
      if (k === 'window' && p.slots.window?.kind === 'exact') {
        // 精确时段可能只记住个大概
        const pExact = clamp01(0.45 + 0.5 * habits.readDepth - 0.3 * fatigue + (p.fragment === 'text' ? 0.2 : 0));
        if (rand(seed, 'comp', agent, exposureId, 'window_exact') < pExact) out.window = p.slots.window;
        else {
          out.window = coarsen(p.slots.window);
          coarsened.push('window');
        }
      } else (out as Record<string, unknown>)[k] = v;
      extracted.push(k);
    } else missed.push(k);
  }
  return { slots: cleanSlots(out), extracted, missed, coarsened };
}

const CERTAINTY_W: Record<string, number> = { confirmed: 1, likely: 0.8, rumor: 0.6 };

/**
 * 来源可信度：渠道 × 发布者 × 信任 × 确定度。
 * trustGov 是此人此刻对官方通知的信任（随经历变化），tieTrust 是此人对说话人的信任。
 */
export function credibility(p: { channel: Channel; slots: Slots; trustGov: number; tieTrust?: number }, P: RuleParams = DEFAULT_PARAMS): number {
  const C = P.credibility;
  const cert = CERTAINTY_W[p.slots.certainty ?? 'likely'] ?? 0.75;
  const official = p.slots.source === 'gov' || p.slots.source === 'org';
  switch (p.channel) {
    case 'website':
    case 'push':
    case 'board':
      return r3(clamp01((official ? C.officialBase + C.officialTrust * p.trustGov : C.unofficialBase + C.unofficialTrust * p.trustGov) * cert));
    case 'org':
      return r3(clamp01(0.9 * cert));
    case 'talk':
    case 'dm': {
      const trust = p.tieTrust ?? 0.4;
      const officialBoost = official ? C.talkOfficial * p.trustGov : 0;
      return r3(clamp01((C.talkBase + C.talkTie * trust + officialBoost) * cert));
    }
  }
}

export const statusOf = (c: number, P: RuleParams = DEFAULT_PARAMS): BeliefStatus => (c >= P.credibility.believe ? 'believe' : c >= P.credibility.doubt ? 'doubt' : 'disbelieve');

/**
 * 信念合并：槽位冲突按可信度裁决；置信度只为独立根源加成（同一谣言多次重复不是多条证据）。
 */
export function mergeBelief(prev: Belief | undefined, heard: { familyId: string; slots: Slots; versionId: string; source: BeliefSource; t: SimTime }, P: RuleParams = DEFAULT_PARAMS): { belief: Belief; changed: SlotKey[] } {
  const cred = heard.source.credibility;
  const changed: SlotKey[] = [];
  if (!prev) {
    const slotFrom: Belief['slotFrom'] = {};
    const slotCred: Belief['slotCred'] = {};
    for (const k of SLOT_KEYS) {
      if (heard.slots[k] !== undefined) {
        slotFrom[k] = heard.versionId;
        slotCred[k] = cred;
        changed.push(k);
      }
    }
    const confidence = r3(cred);
    return {
      belief: {
        familyId: heard.familyId,
        slots: cleanSlots(heard.slots),
        slotFrom,
        slotCred,
        versionId: heard.versionId,
        confidence,
        status: statusOf(confidence, P),
        sources: [heard.source],
        firstAt: heard.t,
        updatedAt: heard.t,
      },
      changed,
    };
  }
  const slots: Slots = { ...prev.slots };
  const slotFrom = { ...prev.slotFrom };
  const slotCred = { ...prev.slotCred };
  for (const k of SLOT_KEYS) {
    const nv = heard.slots[k];
    if (nv === undefined) continue;
    const ov = prev.slots[k];
    const oc = prev.slotCred[k] ?? 0;
    let take = false;
    if (ov === undefined) take = true;
    else if (JSON.stringify(ov) === JSON.stringify(nv)) {
      slotCred[k] = Math.max(oc, cred);
      continue;
    } else if (k === 'window') {
      const np = windowPrecision(nv as Slots['window']);
      const op = windowPrecision(ov as Slots['window']);
      // 更可信者胜；同等可信时更精确者胜
      take = cred > oc + 0.03 || (Math.abs(cred - oc) <= 0.03 && np > op);
    } else take = cred > oc + 0.03;
    if (take) {
      (slots as Record<string, unknown>)[k] = nv;
      slotFrom[k] = heard.versionId;
      slotCred[k] = cred;
      changed.push(k);
    }
  }
  const sources = [...prev.sources, heard.source];
  // 独立根源：每个根源取最高可信度，再按 1 − Π(1 − c) 合并
  const byRoot = new Map<string, number>();
  for (const s of sources) byRoot.set(s.root, Math.max(byRoot.get(s.root) ?? 0, s.credibility));
  let miss = 1;
  for (const c of byRoot.values()) miss *= 1 - c;
  const confidence = r3(clamp01(1 - miss));
  const versionId = changed.length > 0 ? heard.versionId : prev.versionId;
  return {
    belief: {
      familyId: prev.familyId,
      slots: cleanSlots(slots),
      slotFrom,
      slotCred,
      versionId,
      confidence,
      status: statusOf(confidence, P),
      sources: sources.slice(-12),
      firstAt: prev.firstAt,
      updatedAt: heard.t,
    },
    changed,
  };
}
