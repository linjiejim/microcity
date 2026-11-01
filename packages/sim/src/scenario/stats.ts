/** 小镇画像：预览、对话建镇、报告共用 */
import type { PlaceKind } from '../world/map.ts';
import type { ScenarioDef } from './types.ts';
import { describeEvent } from './events.ts';

export interface TownStats {
  population: number;
  households: number;
  districts: { north: number; south: number };
  ages: { youth: number; adult: number; senior: number };
  roles: Record<string, number>;
  places: Partial<Record<PlaceKind, number>>;
  boards: number;
  push: number;
  website: number;
  trustGov: number;
  anxiety: number;
  sociability: number;
  detail: number;
  /** 人均朋友数（显式朋友关系） */
  friends: number;
  /** 跨户亲属对数 */
  kinPairs: number;
  crossDistrictFriends: number;
  events: string[];
  map: { w: number; h: number };
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0);

export function townStats(sc: ScenarioDef): TownStats {
  const N = sc.people.length;
  const placeOf = new Map(sc.map.places.map((p) => [p.id, p]));
  const hhDistrict = new Map(sc.households.map((h) => [h.id, placeOf.get(h.place)?.district ?? 'north']));
  const districtOf = new Map(sc.people.map((p) => [p.id, hhDistrict.get(p.household) ?? 'north']));
  const roles: Record<string, number> = {};
  for (const p of sc.people) roles[p.role] = (roles[p.role] ?? 0) + 1;
  const places: Partial<Record<PlaceKind, number>> = {};
  for (const p of sc.map.places) places[p.kind] = (places[p.kind] ?? 0) + 1;
  const friends = sc.relations.filter((r) => r.kind === 'friend');
  const hh = new Map(sc.people.map((p) => [p.id, p.household]));
  return {
    population: N,
    households: sc.households.length,
    districts: { north: sc.people.filter((p) => districtOf.get(p.id) === 'north').length, south: sc.people.filter((p) => districtOf.get(p.id) === 'south').length },
    ages: { youth: sc.people.filter((p) => p.age < 30).length, adult: sc.people.filter((p) => p.age >= 30 && p.age < 60).length, senior: sc.people.filter((p) => p.age >= 60).length },
    roles,
    places,
    boards: sc.map.places.filter((p) => p.board).length,
    push: Math.round((sc.people.filter((p) => p.habits.push).length / N) * 100) / 100,
    website: Math.round((sc.people.filter((p) => p.habits.website.length > 0).length / N) * 100) / 100,
    trustGov: mean(sc.people.map((p) => p.traits.trustOfficial)),
    anxiety: mean(sc.people.map((p) => p.traits.anxiety)),
    sociability: mean(sc.people.map((p) => p.traits.sociability)),
    detail: mean(sc.people.map((p) => p.traits.detail)),
    friends: Math.round(((friends.length * 2) / N) * 100) / 100,
    kinPairs: sc.relations.filter((r) => r.kind === 'family' && hh.get(r.a) !== hh.get(r.b)).length,
    crossDistrictFriends: friends.filter((r) => districtOf.get(r.a) !== districtOf.get(r.b)).length,
    events: sc.events.map(describeEvent),
    map: { w: sc.map.w, h: sc.map.h },
  };
}
