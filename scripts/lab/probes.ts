// 实验探针：边跑边记快照里看不到的东西（经典案例 K、R 用）
// - groups：按年龄分组的知情、精确、措手不及、组内半数相信用时
// - lineage：每个人是“第几手”听到的、每次转述带没带精确时段、谁信过走样的版本
import type { DecisionRecord, DomainEvent, ScenarioDef, Slots, WorldState } from '@microcity/sim';

export interface Probe {
  event?(e: DomainEvent): void;
  record?(r: DecisionRecord): void;
  checkpoint?(outage: string, s: WorldState): void;
  finish(s: WorldState): Record<string, unknown>;
}

export type ProbeName = 'groups' | 'lineage';

export const GROUPS = ['youth', 'middle', 'senior'] as const;
export type Group = (typeof GROUPS)[number];
export const groupOf = (age: number): Group => (age < 30 ? 'youth' : age < 60 ? 'middle' : 'senior');

type WindowKind = 'exact' | 'coarse' | 'none' | 'all_day';
const windowKind = (s: Slots): WindowKind => (!s.window ? 'none' : s.window.kind === 'exact' ? 'exact' : s.window.kind === 'coarse' ? 'coarse' : 'all_day');

function homes(sc: ScenarioDef): Map<string, { district: 'north' | 'south'; age: number }> {
  const place = new Map(sc.map.places.map((p) => [p.id, p.district]));
  const hh = new Map(sc.households.map((h) => [h.id, h.place]));
  return new Map(sc.people.map((p) => [p.id, { district: place.get(hh.get(p.household)!)!, age: p.age }]));
}

function firstInfoAt(s: WorldState, family: string): number | undefined {
  let t = Infinity;
  for (const n of Object.values(s.news)) if (n.familyId === family) t = Math.min(t, n.publishedAt);
  for (const v of Object.values(s.versions)) if (v.familyId === family) t = Math.min(t, v.createdAt);
  return Number.isFinite(t) ? t : undefined;
}

/** 分组：每轮停电开始那一刻的知情与精确；结束时的措手不及、改安排、查证、组内半数相信用时 */
function groupsProbe(sc: ScenarioDef): Probe {
  const who = homes(sc);
  const at: Record<string, Record<Group, { n: number; aware: number; exact: number; believe: number }>> = {};
  const verified = new Map<string, Set<string>>();
  return {
    record(r) {
      if (r.kind === 'reaction' && r.chosen[0] === 'verify' && r.commit.outcome === 'applied') {
        let x = verified.get(r.family);
        if (!x) verified.set(r.family, (x = new Set()));
        x.add(r.agent);
      }
    },
    checkpoint(oid, s) {
      const o = sc.outages.find((x) => x.id === oid)!;
      const g = Object.fromEntries(GROUPS.map((k) => [k, { n: 0, aware: 0, exact: 0, believe: 0 }])) as Record<Group, { n: number; aware: number; exact: number; believe: number }>;
      for (const a of Object.values(s.agents)) {
        const x = g[groupOf(a.age)];
        x.n++;
        const b = a.beliefs[o.family];
        if (!b) continue;
        x.aware++;
        if (b.status === 'believe') x.believe++;
        if (b.slots.window?.kind === 'exact' && b.slots.window.from === o.from && b.slots.window.to === o.to) x.exact++;
      }
      at[oid] = g;
    },
    finish(s) {
      const out: Record<string, Record<Group, Record<string, number | null>>> = {};
      for (const o of sc.outages) {
        const since = firstInfoAt(s, o.family);
        const row = {} as Record<Group, Record<string, number | null>>;
        for (const k of GROUPS) {
          const members = Object.values(s.agents).filter((a) => groupOf(a.age) === k);
          const inArea = members.filter((a) => who.get(a.id)?.district === o.area);
          const times = members.map((a) => a.funnel[o.family]?.believed).filter((t): t is number => t !== undefined).sort((x, y) => x - y);
          const need = Math.ceil(members.length / 2);
          const c = at[o.id]?.[k];
          row[k] = {
            n: members.length,
            nArea: inArea.length,
            aware: c?.aware ?? null,
            exact: c?.exact ?? null,
            believe: c?.believe ?? null,
            surprisedArea: inArea.filter((a) => (a.stats.byOutage[o.id]?.surprised ?? 0) > 0).length,
            intended: members.filter((a) => a.funnel[o.family]?.intended !== undefined).length,
            verified: members.filter((a) => verified.get(o.family)?.has(a.id)).length,
            t50: since !== undefined && times.length >= need && need > 0 ? times[need - 1]! - since : null,
          };
        }
        out[o.id] = row;
      }
      return { groups: out };
    },
  };
}

interface Hop {
  n: number;
  exact: number;
  coarse: number;
  none: number;
  allDay: number;
  area: number;
  slots: number;
}

/** 传话链：第几手、每次转述带了什么、谁信过走样的版本（截止到该轮停电开始） */
function lineageProbe(sc: ScenarioDef): Probe {
  const who = homes(sc);
  const fam2o = new Map(sc.outages.map((o) => [o.family, o]));
  const exposures = new Map<string, { channel: string; from?: string }>();
  const versions = new Map<string, Slots>();
  const hop = new Map<string, Map<string, number>>();
  const trs: Array<{ family: string; t: number; hop: number; district: 'north' | 'south'; slots: Slots; channel: string }> = [];
  const distorted = new Map<string, Set<string>>();
  const H = (f: string) => {
    let m = hop.get(f);
    if (!m) hop.set(f, (m = new Map()));
    return m;
  };
  return {
    event(e) {
      if (e.type === 'version_created') versions.set(e.version.id, e.version.slots);
      else if (e.type === 'exposure') exposures.set(e.id, { channel: e.channel, ...(e.from ? { from: e.from } : {}) });
      else if (e.type === 'belief_set') {
        const o = fam2o.get(e.family);
        if (!o || e.t >= (o.day - 1) * 86400 + o.from) return;
        const m = H(e.family);
        if (!e.prev && !m.has(e.agent)) {
          const src = e.exposureId ? exposures.get(e.exposureId) : undefined;
          m.set(e.agent, src?.from ? (m.get(src.from) ?? 0) + 1 : 0);
        }
        const k = windowKind(e.belief.slots);
        const bad = !(k === 'exact' && e.belief.slots.window?.kind === 'exact' && e.belief.slots.window.from === o.from && e.belief.slots.window.to === o.to) || !e.belief.slots.area;
        if (bad && e.belief.status !== 'disbelieve') {
          let d = distorted.get(e.family);
          if (!d) distorted.set(e.family, (d = new Set()));
          d.add(e.agent);
        }
      } else if (e.type === 'transmission') {
        const o = fam2o.get(e.tr.familyId);
        if (!o || e.t >= (o.day - 1) * 86400 + o.from) return;
        const slots = versions.get(e.tr.versionId);
        if (!slots) return;
        trs.push({ family: e.tr.familyId, t: e.t, hop: (H(e.tr.familyId).get(e.tr.from) ?? 0) + 1, district: who.get(e.tr.from)?.district ?? 'north', slots, channel: e.tr.channel });
      }
    },
    finish() {
      const out: Record<string, unknown> = {};
      for (const o of sc.outages) {
        const mine = trs.filter((x) => x.family === o.family);
        const pop = { north: 0, south: 0 };
        for (const v of who.values()) pop[v.district]++;
        const byHop: Record<string, Hop> = {};
        for (const x of mine) {
          const key = x.hop >= 4 ? '4+' : String(x.hop);
          const h = (byHop[key] ??= { n: 0, exact: 0, coarse: 0, none: 0, allDay: 0, area: 0, slots: 0 });
          h.n++;
          const k = windowKind(x.slots);
          if (k === 'exact') h.exact++;
          else if (k === 'coarse') h.coarse++;
          else if (k === 'none') h.none++;
          else h.allDay++;
          if (x.slots.area) h.area++;
          h.slots += Object.keys(x.slots).length;
        }
        const relays = { north: mine.filter((x) => x.district === 'north').length, south: mine.filter((x) => x.district === 'south').length };
        out[o.id] = {
          relays,
          relayPerCapita: { north: pop.north ? relays.north / pop.north : 0, south: pop.south ? relays.south / pop.south : 0 },
          distortedEver: distorted.get(o.family)?.size ?? 0,
          hopsReached: Object.fromEntries([...H(o.family).values()].reduce((m, h) => m.set(h >= 4 ? '4+' : String(h), (m.get(h >= 4 ? '4+' : String(h)) ?? 0) + 1), new Map<string, number>())),
          byHop,
        };
      }
      return { lineage: out };
    },
  };
}

export function makeProbe(names: readonly ProbeName[], sc: ScenarioDef): Probe {
  const ps = names.map((n) => (n === 'groups' ? groupsProbe(sc) : lineageProbe(sc)));
  return {
    event: (e) => ps.forEach((p) => p.event?.(e)),
    record: (r) => ps.forEach((p) => p.record?.(r)),
    checkpoint: (o, s) => ps.forEach((p) => p.checkpoint?.(o, s)),
    finish: (s) => Object.assign({}, ...ps.map((p) => p.finish(s))),
  };
}
