import type { TownMap } from '../world/map.ts';
import type { DomainEvent } from '../state/events.ts';
import type { WorldState } from '../state/types.ts';

export interface Violation {
  rule: string;
  detail: string;
}

export const totalMoney = (s: WorldState): number => Object.values(s.accounts).reduce((x, y) => x + y, 0);

/** 硬约束：违例即内核 bug（原方案第 33 页：先修内核，不调人格提示词掩盖） */
export function checkInvariants(s: WorldState, map: TownMap, initialMoney: number): Violation[] {
  const v: Violation[] = [];
  const money = totalMoney(s);
  if (money !== initialMoney) v.push({ rule: 'money_conservation', detail: `总额 ${money} ≠ 期初 ${initialMoney}` });
  for (const [acc, bal] of Object.entries(s.accounts)) {
    if ((acc.startsWith('ag:') || acc.startsWith('org:')) && bal < 0) v.push({ rule: 'no_negative_balance', detail: `${acc} = ${bal}` });
    if (!Number.isInteger(bal)) v.push({ rule: 'integer_money', detail: `${acc} = ${bal}` });
  }
  for (const [holder, items] of Object.entries(s.stock)) {
    for (const [item, n] of Object.entries(items)) if (n < 0) v.push({ rule: 'no_negative_stock', detail: `${holder}.${item} = ${n}` });
  }
  const occ = new Map<string, string>();
  for (const p of Object.values(s.places)) {
    const def = map.places[p.id];
    if (def && p.occupants.length > def.capacity + 1) v.push({ rule: 'capacity', detail: `${p.id} ${p.occupants.length}/${def.capacity}` });
    for (const id of p.occupants) {
      if (occ.has(id)) v.push({ rule: 'single_location', detail: `${id} 同时在 ${occ.get(id)} 与 ${p.id}` });
      occ.set(id, p.id);
    }
  }
  for (const a of Object.values(s.agents)) {
    if (a.loc.k === 'in' && occ.get(a.id) !== a.loc.place) v.push({ rule: 'occupancy_consistency', detail: `${a.id} 在 ${a.loc.place} 但名单是 ${occ.get(a.id)}` });
    if (a.loc.k !== 'in' && occ.has(a.id)) v.push({ rule: 'occupancy_consistency', detail: `${a.id} 不在室内却在 ${occ.get(a.id)} 名单里` });
    if (a.loc.k === 'walk' && a.act) v.push({ rule: 'single_main_action', detail: `${a.id} 边走路边 ${a.act.kind}` });
    if (a.act && a.act.endsAt < a.act.startedAt) v.push({ rule: 'time_order', detail: `${a.id} 活动结束早于开始` });
    for (const [day, items] of Object.entries(a.plans)) {
      for (let i = 1; i < items.length; i++) {
        const p = items[i - 1]!;
        const q = items[i]!;
        if (q.start < p.start) v.push({ rule: 'plan_order', detail: `${a.id} D${day} ${p.id} 与 ${q.id} 顺序错` });
      }
    }
    for (const [fam, b] of Object.entries(a.beliefs)) {
      if (!a.funnel[fam]?.exposed) v.push({ rule: 'knowledge_isolation', detail: `${a.id} 对 ${fam} 有信念却没有曝光记录` });
      for (const [slot, vid] of Object.entries(b.slotFrom)) if (vid && !s.versions[vid]) v.push({ rule: 'belief_provenance', detail: `${a.id}.${fam}.${slot} 来自不存在的版本 ${vid}` });
    }
  }
  return v;
}

/**
 * 事件级知识隔离：每条 belief_set 都必须指向同一个人此前的 exposure；
 * 每个 relay 版本都必须由记录在案的转述产生。
 */
export function checkProvenance(events: DomainEvent[]): Violation[] {
  const v: Violation[] = [];
  const exposures = new Map<string, string>();
  const versions = new Set<string>();
  for (const e of events) {
    if (e.type === 'exposure') exposures.set(e.id, e.agent);
    if (e.type === 'version_created') {
      versions.add(e.version.id);
      if (e.version.origin.kind === 'relay' && e.version.parentId && !versions.has(e.version.parentId)) v.push({ rule: 'version_lineage', detail: `${e.version.id} 的父版本 ${e.version.parentId} 尚不存在` });
    }
    if (e.type === 'belief_set') {
      if (!e.exposureId || exposures.get(e.exposureId) !== e.agent) v.push({ rule: 'belief_without_exposure', detail: `${e.agent} 在 seq ${e.seq} 更新信念，但没有对应曝光` });
    }
    if (e.type === 'transmission' && !versions.has(e.tr.versionId)) v.push({ rule: 'transmission_version', detail: `转述 ${e.tr.id} 引用了未创建的版本` });
  }
  return v;
}
