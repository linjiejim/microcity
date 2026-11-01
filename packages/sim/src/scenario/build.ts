import { rand } from '../core/rng.ts';
import { HOUR } from '../core/time.ts';
import { TownMap } from '../world/map.ts';
import { INFO_RULES_VERSION } from '../info/claims.ts';
import { POLICY_VERSION } from '../mind/reaction.ts';
import type { Agent, Relation, WorldState } from '../state/types.ts';
import type { ScenarioDef } from './types.ts';

export function buildMap(sc: ScenarioDef): TownMap {
  return new TownMap(sc.map.w, sc.map.h, sc.map.tiles, sc.map.places, sc.map.props);
}

export const cents = (yuan: number): number => Math.round(yuan * 100);

/** 初始世界：所有人在家睡觉；关系 = 显式关系 + 同户/同事/同楼自动生成 */
export function buildInitialState(sc: ScenarioDef, seed: number): WorldState {
  const map = buildMap(sc);
  const hh = Object.fromEntries(sc.households.map((h) => [h.id, h]));
  const agents: Record<string, Agent> = {};
  for (const p of sc.people) {
    const h = hh[p.household];
    if (!h) throw new Error(`${p.id} 的户 ${p.household} 不存在`);
    const home = map.places[h.place]!;
    agents[p.id] = {
      id: p.id,
      name: p.name,
      age: p.age,
      gender: p.gender,
      role: p.role,
      roleLabel: p.roleLabel,
      householdId: p.household,
      home: h.place,
      unit: h.unit,
      ...(p.org ? { org: p.org } : {}),
      ...(p.workplace ? { workplace: p.workplace } : {}),
      bio: p.bio,
      speech: p.speech,
      traits: { ...p.traits },
      trustGov: p.traits.trustOfficial,
      trustIn: {},
      habits: { ...p.habits, website: [...p.habits.website], leisure: [...p.habits.leisure] },
      look: { ...p.look },
      wallet: `ag:${p.id}`,
      loc: { k: 'in', place: h.place, tile: { ...home.door } },
      act: null,
      plans: {},
      wokeAt: sc.start - 8 * HOUR,
      lastMealAt: sc.start - 10 * HOUR,
      phone: { battery: Math.round(55 + 45 * rand(seed, 'battery', p.id)), at: sc.start, charging: true, awake: false, drain: p.habits.drain },
      pendingPush: [],
      inbox: [],
      beliefs: {},
      funnel: {},
      seen: {},
      told: {},
      dcount: {},
      stats: { inconvenience: 0, disruptedSec: 0, surprised: 0, surprisedSec: 0, overreactSec: 0, prepSpent: 0, byOutage: {} },
    };
  }
  const places: WorldState['places'] = {};
  for (const p of sc.map.places) places[p.id] = { id: p.id, powered: true, mode: { kind: 'normal' }, occupants: [] };
  for (const a of Object.values(agents)) {
    const ps = places[a.home];
    if (ps && a.loc.k === 'in') ps.occupants.push(a.id);
  }
  const accounts: Record<string, number> = {};
  for (const p of sc.people) accounts[`ag:${p.id}`] = cents(p.wallet);
  const orgs: WorldState['orgs'] = {};
  for (const o of sc.orgs) {
    orgs[o.id] = { id: o.id, name: o.name, place: o.place, ...(o.manager ? { manager: o.manager } : {}), staff: [...o.staff], account: `org:${o.id}` };
    accounts[`org:${o.id}`] = cents(o.capital);
  }
  for (const src of ['ext:visitors', 'ext:clients', 'ext:town_budget', 'ext:pension', 'ext:family', 'ext:benefit', 'ext:suppliers']) accounts[src] = accounts[src] ?? 0;
  const stock: WorldState['stock'] = {};
  const prices: WorldState['prices'] = {};
  for (const o of sc.offers) {
    (stock[o.place] ??= {})[o.item] = o.stock;
    (prices[o.place] ??= {})[o.item] = cents(o.price);
  }
  for (const h of sc.households) (stock[h.id] ??= {}).groceries = h.food;

  // 关系
  const rels = new Map<string, Relation>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const addRel = (r: Relation, override: boolean) => {
    const k = key(r.a, r.b);
    if (!rels.has(k) || override) rels.set(k, r);
  };
  for (const h of sc.households) {
    for (let i = 0; i < h.members.length; i++)
      for (let j = i + 1; j < h.members.length; j++) addRel({ a: h.members[i]!, b: h.members[j]!, kind: 'family', strength: 0.85, trust: 0.85, note: '同住' }, false);
  }
  for (const o of sc.orgs) {
    for (let i = 0; i < o.staff.length; i++)
      for (let j = i + 1; j < o.staff.length; j++) addRel({ a: o.staff[i]!, b: o.staff[j]!, kind: 'coworker', strength: 0.55, trust: 0.6 }, false);
  }
  const byBuilding = new Map<string, string[]>();
  for (const a of Object.values(agents)) byBuilding.set(a.home, [...(byBuilding.get(a.home) ?? []), a.id]);
  for (const ids of byBuilding.values()) {
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const x = agents[ids[i]!]!;
        const y = agents[ids[j]!]!;
        if (x.householdId !== y.householdId) addRel({ a: x.id, b: y.id, kind: 'neighbor', strength: 0.3, trust: 0.45 }, false);
      }
  }
  for (const r of sc.relations) addRel({ ...r }, true);

  const boards: WorldState['boards'] = {};
  for (const p of sc.map.places) if (p.board) boards[p.board.id] = { id: p.board.id, place: p.id, tile: { ...p.board.tile }, posters: [] };

  return {
    meta: { scenario: sc.id, scenarioVersion: sc.version, seed, rulesVersion: `${INFO_RULES_VERSION}+${POLICY_VERSION}`, t: sc.start, seq: 0 },
    agents,
    households: Object.fromEntries(sc.households.map((h) => [h.id, { id: h.id, label: h.label, place: h.place, unit: h.unit, members: [...h.members] }])),
    places,
    orgs,
    relations: [...rels.values()].sort((x, y) => key(x.a, x.b).localeCompare(key(y.a, y.b))),
    accounts,
    stock,
    prices,
    news: {},
    versions: {},
    boards,
    website: [],
    dms: {},
    pending: {},
  };
}
