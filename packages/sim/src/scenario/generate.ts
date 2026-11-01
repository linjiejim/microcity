/**
 * 按模板规则生成小镇（spec v1 §2.5，D23/D24）。纯函数：同一规格 → 同一场景。
 * - base = 'generated'：沿用经典的“河分南北”骨架，按规格装箱建筑、生成人口/关系/组织；
 * - base = 'classic'：v0 手工小镇，只接受修饰（文化平移、媒介重分配、公告栏、朋友、具名人物、剧本）。
 */
import { at, hm } from '../core/time.ts';
import { clamp, rand, randInt, randNormal } from '../core/rng.ts';
import type { District, PlaceDef, PlaceKind, Prop, TileKind } from '../world/map.ts';
import type { Habits, HouseholdDef, Look, OfferDef, OrgDef, PersonDef, RelationDef, RoleId, ScenarioDef, Traits } from './types.ts';
import { scriptFromEvents, truthOf } from './events.ts';
import { CLASSIC_EVENTS, town30 } from './town30.ts';
import { CLASSIC_BASELINE, classicSpec, normalizeSpec, ROLE_LABEL, specHash, STAFFING, toOutageEvents, type CharacterSpec, type TownSpec } from './spec.ts';
import { givenPool, PLACE_NAMES, SPEECH_BY_TRAIT, SURNAMES, WFH_LABELS } from './names.ts';

export const GENERATOR_VERSION = 'gen_v1';

/** 规格 → 场景（经典底座走修饰，其余走生成） */
export function scenarioFromSpec(spec: TownSpec, id?: string): ScenarioDef {
  return spec.base === 'classic' ? classicFromSpec(spec, id) : generateTown(spec, id);
}

// ---------------------------------------------------------------- 经典底座

const DEFAULT_CLASSIC_HASH = specHash(normalizeSpec(classicSpec()).spec);

export function classicFromSpec(spec: TownSpec, id?: string): ScenarioDef {
  const h = specHash(spec);
  if (h === DEFAULT_CLASSIC_HASH) {
    const sc = town30();
    return id ? { ...sc, id } : sc;
  }
  const sc = structuredClone(town30());
  const R = (...k: Array<string | number>) => rand(spec.seed, 'classic', ...k);
  const people = sc.people;
  // 文化：按差值平移（保留个体差异）
  const shift = (key: keyof Traits, delta: number) => {
    if (Math.abs(delta) < 0.01) return;
    for (const p of people) p.traits[key] = r2(clamp(p.traits[key] + delta, 0.05, 0.95));
  };
  shift('trustOfficial', spec.culture.trustGov - CLASSIC_BASELINE.culture.trustGov);
  shift('anxiety', spec.culture.anxiety - CLASSIC_BASELINE.culture.anxiety);
  shift('sociability', spec.culture.sociability - CLASSIC_BASELINE.culture.sociability);
  shift('detail', spec.culture.detail - CLASSIC_BASELINE.culture.detail);
  // 媒介：按可能性排序后重新分配
  if (Math.abs(spec.media.push - CLASSIC_BASELINE.media.push) >= 0.02) {
    const k = Math.round(people.length * spec.media.push);
    const ranked = [...people].sort((a, b) => pushScore(b, R) - pushScore(a, R));
    ranked.forEach((p, i) => (p.habits.push = i < k));
  }
  if (Math.abs(spec.media.website - CLASSIC_BASELINE.media.website) >= 0.02) {
    const k = Math.round(people.length * spec.media.website);
    const ranked = [...people].sort((a, b) => webScore(b, R) - webScore(a, R));
    ranked.forEach((p, i) => (p.habits.website = i < k ? (p.habits.website.length ? p.habits.website : websiteSlots(p.role)) : []));
  }
  // 公告栏：0–2 个在两处路口/广场之间增减；3 个时北岸公园也立一块
  if (spec.media.boards !== CLASSIC_BASELINE.media.boards) {
    const keep = spec.media.boards;
    const order = ['P01', 'P03'];
    for (const [i, pid] of order.entries()) {
      if (i < keep) continue;
      const pl = sc.map.places.find((p) => p.id === pid);
      if (pl?.board) {
        sc.map.props = sc.map.props.filter((x) => !(x.kind === 'board' && x.ref === pl.board!.id));
        delete pl.board;
      }
    }
    if (keep >= 3) {
      const park = sc.map.places.find((p) => p.id === 'P02')!;
      park.board = { id: 'BC', tile: { x: 7, y: 3 } };
      sc.map.props.push({ kind: 'board', x: 7, y: 3, ref: 'BC' });
    }
  }
  // 朋友：多了按同质性补，少了从最弱的朋友关系删
  const target = spec.network.friends;
  if (Math.abs(target - CLASSIC_BASELINE.network.friends) >= 0.1) {
    const deg = () => (sc.relations.filter((r) => r.kind === 'friend').length * 2) / people.length;
    if (target < deg()) {
      const friends = sc.relations.filter((r) => r.kind === 'friend').sort((a, b) => a.strength - b.strength || (a.a + a.b).localeCompare(b.a + b.b));
      while (deg() > target && friends.length) {
        const r = friends.shift()!;
        sc.relations = sc.relations.filter((x) => x !== r);
      }
    } else {
      const homeDistrict = new Map(sc.households.map((hh) => [hh.id, sc.map.places.find((p) => p.id === hh.place)!.district]));
      addFriends(
        people.map((p) => ({ id: p.id, age: p.age, district: homeDistrict.get(p.household)!, household: p.household, leisure: p.habits.leisure })),
        sc.relations,
        target,
        spec.network.crossDistrict,
        (...k) => R('friend', ...k),
      );
    }
  }
  // 具名人物：按姓名改特质、习惯、小传
  for (const c of spec.characters) {
    const p = people.find((x) => x.name === c.name);
    if (!p) continue;
    applyCharacter(p, c);
  }
  // 剧本
  const events = toOutageEvents(spec.events, true);
  const e0 = events[0]!;
  const c0 = CLASSIC_EVENTS[0]!;
  if (e0.area === c0.area && e0.day === c0.day && e0.from === c0.from && e0.to === c0.to && c0.texts) e0.texts = structuredClone(c0.texts);
  const ctx = { places: sc.map.places, orgs: sc.orgs };
  return {
    ...sc,
    id: id ?? `cls_${h}`,
    name: `${spec.name} · ${people.length} 人`,
    version: `town30@1+${h}`,
    script: scriptFromEvents(events, ctx),
    events,
    outages: events.map(truthOf),
  };
}

function applyCharacter(p: PersonDef, c: CharacterSpec): void {
  if (c.traits) for (const [k, v] of Object.entries(c.traits)) if (typeof v === 'number') p.traits[k as keyof Traits] = v;
  if (c.habits?.push !== undefined) p.habits.push = c.habits.push;
  if (c.habits?.website !== undefined) p.habits.website = c.habits.website ? (p.habits.website.length ? p.habits.website : websiteSlots(p.role)) : [];
  if (c.habits?.phone) {
    p.habits.phone = c.habits.phone;
    p.habits.drain = c.habits.phone === 'high' ? 9 : c.habits.phone === 'mid' ? 5 : 3;
  }
  if (c.bio) p.bio = c.bio;
}

// ---------------------------------------------------------------- 生成底座

type Grp = 'S' | 'A' | 'Y';
interface Slot {
  grp: Grp;
  age: number;
  gender: 'f' | 'm';
  surname: string;
  given: string;
  character?: CharacterSpec;
  role?: RoleId;
  workplace?: string;
}
interface HH {
  type: string;
  members: Slot[];
  district: District;
  place?: string;
  unit?: number;
}

const HH_TYPES: Array<{ k: string; c: Partial<Record<Grp, number>>; w: number }> = [
  { k: 'three_gen', c: { S: 1, A: 2, Y: 1 }, w: 2 },
  { k: 'senior_couple', c: { S: 2 }, w: 2 },
  { k: 'senior_single', c: { S: 1 }, w: 1.6 },
  { k: 'senior_child', c: { S: 1, A: 1 }, w: 1.2 },
  { k: 'family', c: { A: 2, Y: 1 }, w: 3 },
  { k: 'couple', c: { A: 2 }, w: 2.5 },
  { k: 'single_adult', c: { A: 1 }, w: 1.4 },
  { k: 'single_young', c: { Y: 1 }, w: 1.4 },
  { k: 'roommates', c: { Y: 3 }, w: 1.1 },
  { k: 'roommates2', c: { Y: 2 }, w: 1.2 },
  { k: 'mixed_room', c: { Y: 2, A: 1 }, w: 0.9 },
];

const SIZE: Record<string, [number, number]> = {
  residence: [7, 5],
  gov: [6, 5],
  clinic: [6, 5],
  library: [8, 5],
  utility: [6, 5],
  newsroom: [4, 4],
  supermarket: [8, 5],
  cafe: [5, 5],
  restaurant: [6, 5],
  convenience: [5, 4],
  studio: [8, 5],
  park: [12, 5],
  plaza: [6, 5],
};

const HOURS: Record<string, Array<[number, number]> | null> = {
  residence: null,
  gov: [[hm(8, 30), hm(17, 30)]],
  clinic: [[hm(8), hm(18)]],
  library: [[hm(8), hm(21)]],
  utility: [[hm(8), hm(17)]],
  newsroom: [[hm(9), hm(18)]],
  supermarket: [[hm(8), hm(21)]],
  cafe: [[hm(7), hm(19)]],
  restaurant: [
    [hm(11), hm(14, 30)],
    [hm(17), hm(21)],
  ],
  convenience: [[hm(7), hm(22)]],
  studio: [[hm(9), hm(19)]],
  park: null,
  plaza: null,
};

const CAPACITY: Record<string, number> = { residence: 99, gov: 15, clinic: 12, library: 30, utility: 8, newsroom: 6, supermarket: 20, cafe: 16, restaurant: 20, convenience: 6, studio: 10, park: 30, plaza: 30 };

const STYLE: Record<string, Array<{ wall: string; roof: string; trim: string; floors: number; sign?: string }>> = {
  residence: [
    { wall: '#ead4aa', roof: '#be4a2f', trim: '#733e39', floors: 3 },
    { wall: '#e4a672', roof: '#a22633', trim: '#733e39', floors: 3 },
    { wall: '#c0cbdc', roof: '#3a4466', trim: '#5a6988', floors: 3 },
    { wall: '#b86f50', roof: '#3e2731', trim: '#ead4aa', floors: 2 },
  ],
  gov: [{ wall: '#c0cbdc', roof: '#124e89', trim: '#ffffff', floors: 3, sign: '政' }],
  clinic: [{ wall: '#ffffff', roof: '#e43b44', trim: '#e43b44', floors: 2, sign: '+' }],
  library: [{ wall: '#b86f50', roof: '#3e8948', trim: '#ead4aa', floors: 2, sign: '书' }],
  utility: [{ wall: '#8b9bb4', roof: '#feae34', trim: '#3a4466', floors: 1, sign: '⚡' }],
  newsroom: [{ wall: '#ead4aa', roof: '#68386c', trim: '#262b44', floors: 2, sign: '报' }],
  supermarket: [{ wall: '#ffffff', roof: '#63c74d', trim: '#3e8948', floors: 1, sign: '市' }],
  cafe: [
    { wall: '#e4a672', roof: '#733e39', trim: '#fee761', floors: 1, sign: '咖' },
    { wall: '#ead4aa', roof: '#b86f50', trim: '#f77622', floors: 1, sign: '咖' },
  ],
  restaurant: [
    { wall: '#be4a2f', roof: '#3e2731', trim: '#feae34', floors: 1, sign: '食' },
    { wall: '#d77643', roof: '#733e39', trim: '#fee761', floors: 1, sign: '食' },
  ],
  convenience: [{ wall: '#ffffff', roof: '#0099db', trim: '#f77622', floors: 1, sign: '便' }],
  studio: [{ wall: '#5a6988', roof: '#262b44', trim: '#2ce8f5', floors: 2, sign: '设' }],
  park: [{ wall: '#63c74d', roof: '#63c74d', trim: '#3e8948', floors: 0 }],
  plaza: [{ wall: '#c0cbdc', roof: '#c0cbdc', trim: '#8b9bb4', floors: 0 }],
};

/** 设施优先所在的区（多家时南北交替） */
const PREFER: Record<string, District> = { gov: 'south', utility: 'south', newsroom: 'south', clinic: 'south', library: 'south', supermarket: 'south', convenience: 'north', cafe: 'north', restaurant: 'north', studio: 'north' };

const ORG_ID: Record<string, string> = { cafe: 'cafe', restaurant: 'restaurant', convenience: 'convenience', supermarket: 'market', studio: 'studio', gov: 'gov', clinic: 'clinic', library: 'library', utility: 'utility', newsroom: 'press' };
const ORG_MONEY: Record<string, { capital: number; external: number; source: string; wages: number[] }> = {
  cafe: { capital: 20000, external: 900, source: 'ext:visitors', wages: [420, 300] },
  restaurant: { capital: 24000, external: 1100, source: 'ext:visitors', wages: [450, 280] },
  convenience: { capital: 12000, external: 500, source: 'ext:visitors', wages: [300] },
  supermarket: { capital: 40000, external: 1400, source: 'ext:visitors', wages: [400, 260] },
  studio: { capital: 60000, external: 1600, source: 'ext:clients', wages: [520, 420, 420] },
  gov: { capital: 80000, external: 800, source: 'ext:town_budget', wages: [380, 360] },
  clinic: { capital: 50000, external: 1100, source: 'ext:town_budget', wages: [600, 400] },
  library: { capital: 30000, external: 400, source: 'ext:town_budget', wages: [340] },
  utility: { capital: 50000, external: 800, source: 'ext:town_budget', wages: [380, 380] },
  newsroom: { capital: 15000, external: 400, source: 'ext:town_budget', wages: [360] },
};
const OFFERS: Record<string, Array<{ item: string; price: number; stock: number; scale?: boolean }>> = {
  cafe: [
    { item: 'coffee', price: 18, stock: 200 },
    { item: 'cafe_meal', price: 32, stock: 40, scale: true },
    { item: 'pastry', price: 15, stock: 50 },
  ],
  restaurant: [{ item: 'meal', price: 38, stock: 80, scale: true }],
  supermarket: [
    { item: 'groceries', price: 16, stock: 300, scale: true },
    { item: 'power_bank', price: 69, stock: 6 },
  ],
  convenience: [
    { item: 'groceries', price: 20, stock: 40 },
    { item: 'snack', price: 8, stock: 100 },
    { item: 'power_bank', price: 79, stock: 4 },
  ],
};

const MANAGER: RoleId[] = ['cafe_manager', 'chef_owner', 'clerk', 'market_manager', 'studio_lead', 'gov_clerk', 'doctor', 'librarian'];
const AGE_FIT: Partial<Record<RoleId, [number, number]>> = {
  cafe_manager: [28, 50], barista: [19, 32], chef_owner: [32, 58], server: [19, 36], clerk: [30, 60], market_manager: [32, 55], cashier: [19, 40],
  studio_lead: [30, 48], designer: [22, 38], gov_clerk: [30, 58], gov_liaison: [28, 55], doctor: [32, 62], nurse: [24, 50], librarian: [30, 62],
  technician: [24, 62], reporter: [22, 45],
};

const SK = ['#e8b796', '#c28569', '#e4a672'];
const HAIR = ['#181425', '#3e2731', '#733e39'];
const PANTS = ['#262b44', '#3a4466', '#124e89', '#733e39', '#3e2731'];
const SHIRTS = ['#0099db', '#63c74d', '#b55088', '#f6757a', '#68386c', '#d77643', '#8b9bb4', '#e43b44', '#3e8948', '#feae34', '#2ce8f5', '#ead4aa'];

const r2 = (x: number): number => Math.round(x * 100) / 100;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function generateTown(spec: TownSpec, id?: string): ScenarioDef {
  const seed = spec.seed;
  const R = (...k: Array<string | number>) => rand(seed, 'gen', ...k);
  const N = spec.population.size;

  // 1. 户型与年龄段
  const nS = Math.round(N * spec.population.seniors);
  const nY = Math.round(N * spec.population.youth);
  const left: Record<Grp, number> = { S: nS, A: N - nS - nY, Y: nY };
  const households: HH[] = [];
  for (let i = 0; left.S + left.A + left.Y > 0 && i < 200; i++) {
    const feasible = HH_TYPES.filter((t) => (Object.entries(t.c) as Array<[Grp, number]>).every(([g, n]) => left[g] >= n));
    const total = feasible.reduce((s, t) => s + t.w, 0);
    let u = R('hh', i) * total;
    let t = feasible[feasible.length - 1]!;
    for (const f of feasible) {
      u -= f.w;
      if (u < 0) {
        t = f;
        break;
      }
    }
    const members: Slot[] = [];
    for (const g of ['S', 'A', 'Y'] as Grp[]) for (let k = 0; k < (t.c[g] ?? 0); k++) members.push({ grp: g, age: 0, gender: 'm', surname: '', given: '' });
    for (const g of ['S', 'A', 'Y'] as Grp[]) left[g] -= t.c[g] ?? 0;
    households.push({ type: t.k, members, district: 'north' });
  }
  // 区：按人数比例分到北区
  const northTarget = Math.round(N * spec.population.northShare);
  let northCount = 0;
  for (const h of households) {
    h.district = northCount < northTarget ? 'north' : 'south';
    if (h.district === 'north') northCount += h.members.length;
  }
  // 两个区都得有人住
  if (!households.some((h) => h.district === 'south')) households[households.length - 1]!.district = 'south';
  if (!households.some((h) => h.district === 'north')) households[0]!.district = 'north';

  // 2. 具名人物占位
  const slots = households.flatMap((h, hi) => h.members.map((m, mi) => ({ m, h, hi, mi })));
  for (const c of spec.characters.slice(0, N)) {
    const grp: Grp | undefined = c.age === undefined ? undefined : c.age >= 60 ? 'S' : c.age >= 30 ? 'A' : 'Y';
    const free = slots.filter((s) => !s.m.character);
    const partner = c.kin?.relation === '夫妻' ? slots.find((s) => s.m.character?.name === c.kin!.name) : undefined;
    const pick =
      (partner && free.find((s) => s.h === partner.h)) ??
      free.find((s) => (!grp || s.m.grp === grp) && (!c.district || s.h.district === c.district)) ??
      free.find((s) => !grp || s.m.grp === grp) ??
      free[0];
    if (!pick) break;
    pick.m.character = c;
  }

  // 3. 年龄、性别、姓名
  const usedNames = new Set<string>();
  const surnameQueue = [...SURNAMES].sort((a, b) => R('sn', a) - R('sn', b));
  let sq = 0;
  const nextSurname = () => surnameQueue[sq++ % surnameQueue.length]!;
  for (const [hi, h] of households.entries()) {
    const ageIn = (lo: number, hi2: number, k: string) => randInt(seed, lo, hi2, 'gen', 'age', hi, k);
    const S = h.members.filter((m) => m.grp === 'S');
    const A = h.members.filter((m) => m.grp === 'A');
    const Y = h.members.filter((m) => m.grp === 'Y');
    // 先定孩子，再定父母与祖辈，保证代际年龄差
    for (const [i, m] of Y.entries()) m.age = ageIn(18, h.type.startsWith('room') || h.type === 'single_young' || h.type === 'mixed_room' ? 29 : 26, `y${i}`);
    const minParent = Y.length && (h.type === 'family' || h.type === 'three_gen') ? Math.max(...Y.map((y) => y.age)) + 22 : 30;
    const parentBase = ageIn(Math.min(59, minParent), Math.min(59, Math.max(minParent, minParent + 8)), 'a');
    for (const [i, m] of A.entries()) m.age = h.type === 'couple' || h.type === 'family' || h.type === 'three_gen' ? clamp(parentBase + randInt(seed, -3, 3, 'gen', 'age', hi, `a${i}`), 30, 59) : ageIn(30, 58, `a${i}`);
    const minSenior = A.length && (h.type === 'three_gen' || h.type === 'senior_child') ? Math.max(...A.map((a) => a.age)) + 22 : 60;
    const seniorBase = ageIn(Math.max(60, Math.min(84, minSenior)), Math.max(60, Math.min(86, minSenior + 10)), 's');
    for (const [i, m] of S.entries()) m.age = clamp(seniorBase + (i ? randInt(seed, -4, 3, 'gen', 'age', hi, `s${i}`) : 0), 60, 88);
    // 夫妻一男一女
    const pairs = h.type === 'senior_couple' ? [S] : h.type === 'couple' || h.type === 'family' || h.type === 'three_gen' ? [A] : [];
    for (const m of h.members) m.gender = R('g', hi, h.members.indexOf(m)) < 0.5 ? 'f' : 'm';
    for (const p of pairs) if (p.length === 2) [p[0]!.gender, p[1]!.gender] = R('pair', hi) < 0.5 ? ['m', 'f'] : ['f', 'm'];
    // 具名人物覆盖
    for (const m of h.members) {
      const c = m.character;
      if (!c) continue;
      if (c.age !== undefined) m.age = c.age;
      if (c.gender) m.gender = c.gender;
    }
    // 姓：夫妻各自的姓；孩子随父姓；其余各自
    const familySurname = nextSurname();
    for (const m of h.members) m.surname = nextSurname();
    const father = [...A, ...S].find((m) => m.gender === 'm');
    if (h.type === 'family' || h.type === 'three_gen' || h.type === 'senior_child') {
      if (father) father.surname = familySurname;
      for (const y of Y) y.surname = familySurname;
      if (h.type === 'senior_child' || h.type === 'three_gen') {
        const elder = S.find((s) => s.gender === 'm') ?? S[0];
        if (elder) elder.surname = familySurname;
        const son = A.find((a) => a.gender === 'm');
        if (son) son.surname = familySurname;
      }
    }
    for (const [mi, m] of h.members.entries()) {
      if (m.character) {
        m.surname = m.character.name.slice(0, 1);
        m.given = m.character.name.slice(1);
        usedNames.add(m.character.name);
        continue;
      }
      const pool = givenPool(m.age, m.gender);
      for (let k = 0; k < 40; k++) {
        const g = pool[Math.floor(R('given', hi, mi, k) * pool.length)]!;
        if (!usedNames.has(m.surname + g) && !spec.characters.some((c) => c.name === m.surname + g)) {
          m.given = g;
          break;
        }
        if (k === 39) m.given = g + '二';
      }
      usedNames.add(m.surname + m.given);
    }
  }

  // 4. 地点清单
  type Item = { kind: PlaceKind; district: District; name: string; short: string; idx: number };
  const items: Item[] = [];
  const nameIdx: Record<string, number> = {};
  const nameFor = (kind: string, d: District): [string, string] => {
    const key = `${kind}:${d}`;
    const i = (nameIdx[key] = (nameIdx[key] ?? -1) + 1);
    const pool = PLACE_NAMES[kind]![d];
    const [n, s] = pool[i % pool.length]!;
    return i < pool.length ? [n, s] : [`${n}${i + 1}`, `${s}${i + 1}`];
  };
  const addItem = (kind: PlaceKind, d: District) => {
    const [name, short] = nameFor(kind, d);
    items.push({ kind, district: d, name, short, idx: items.filter((x) => x.kind === kind).length });
  };
  // 开放空间：北区公园、南区广场，其余交替
  const parks = spec.facilities.parks;
  addItem('park', 'north');
  if (parks >= 2) addItem('plaza', 'south');
  if (parks >= 3) addItem('plaza', 'north');
  if (parks < 2) addItem('plaza', 'south');
  // 住宅：每栋 4 户
  for (const d of ['north', 'south'] as District[]) {
    const hs = households.filter((h) => h.district === d);
    for (let b = 0; b < Math.ceil(hs.length / 4); b++) addItem('residence', d);
  }
  // 工作地点
  const facilityList: Array<[PlaceKind, number]> = [
    ['gov', 1],
    ['utility', 1],
    ['supermarket', spec.facilities.supermarket],
    ['convenience', spec.facilities.convenience],
    ['cafe', spec.facilities.cafe],
    ['restaurant', spec.facilities.restaurant],
    ['clinic', spec.facilities.clinic],
    ['library', spec.facilities.library],
    ['studio', spec.facilities.studio],
    ['newsroom', spec.facilities.newsroom],
  ];
  for (const [kind, n] of facilityList) {
    for (let i = 0; i < n; i++) {
      const pref = PREFER[kind] ?? 'north';
      addItem(kind, i % 2 === 0 ? pref : pref === 'north' ? 'south' : 'north');
    }
  }

  // 5. 装箱：四排地块 × 若干街区
  const BANDS: Record<District, Array<{ y0: number; door: number }>> = {
    north: [
      { y0: 0, door: 5 },
      { y0: 8, door: 13 },
    ],
    south: [
      { y0: 18, door: 23 },
      { y0: 26, door: 31 },
    ],
  };
  const H = 32;
  let nb = 3;
  let placed: Array<{ item: Item; x: number; y: number; w: number; h: number; door: { x: number; y: number } }> = [];
  for (; nb <= 7; nb++) {
    placed = [];
    const free: Record<string, number> = {};
    let ok = true;
    for (const d of ['north', 'south'] as District[]) {
      const mine = items.filter((it) => it.district === d);
      // 开放空间先占左上；其余按“住宅、店铺”交错
      const open = mine.filter((it) => it.kind === 'park' || it.kind === 'plaza');
      const res = mine.filter((it) => it.kind === 'residence');
      const work = mine.filter((it) => it.kind !== 'park' && it.kind !== 'plaza' && it.kind !== 'residence');
      const mixed: Item[] = [];
      for (let i = 0; i < Math.max(res.length, work.length); i++) {
        if (work[i]) mixed.push(work[i]!);
        if (res[i]) mixed.push(res[i]!);
      }
      // 先放宽的（开放空间最先），再往剩余空间最多的街区里塞：铺得开也装得下
      const order: Item[] = [...open, ...mixed.map((it, i) => ({ it, i })).sort((a, b) => SIZE[b.it.kind]![0] - SIZE[a.it.kind]![0] || a.i - b.i).map(({ it }) => it)];
      const slotOrder: Array<{ band: number; block: number }> = [];
      for (let b = 0; b < nb; b++) for (let band = 0; band < 2; band++) slotOrder.push({ band, block: b });
      for (const it of order) {
        const [w, h] = SIZE[it.kind]!;
        // 选剩余空间最多的街区（同样多取靠左上），让建筑在全镇铺开而不是挤在左边
        let bestSlot: { band: number; block: number } | undefined;
        let bestRoom = -1;
        for (const s of slotOrder) {
          const used = free[`${d}:${s.band}:${s.block}`] ?? 0;
          const room = 14 - used - (used > 0 ? 1 : 0);
          if (room < w) continue;
          if (room > bestRoom) {
            bestRoom = room;
            bestSlot = s;
          }
        }
        if (!bestSlot) {
          ok = false;
          break;
        }
        const key = `${d}:${bestSlot.band}:${bestSlot.block}`;
        const used = free[key] ?? 0;
        const start = bestSlot.block * 16 + used + (used > 0 ? 1 : 0);
        const band = BANDS[d][bestSlot.band]!;
        const y = band.y0 + (5 - h);
        placed.push({ item: it, x: start, y, w, h, door: { x: start + Math.floor(w / 2), y: band.door } });
        free[key] = start + w - bestSlot.block * 16;
      }
      if (!ok) break;
    }
    if (ok) break;
  }
  const W = 16 * nb - 2;

  // 6. 瓦片
  const tiles: TileKind[] = Array.from({ length: W * H }, () => 'grass' as TileKind);
  const set = (x: number, y: number, k: TileKind) => {
    if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = k;
  };
  for (const y of [5, 13, 14, 17, 23, 31]) for (let x = 0; x < W; x++) set(x, y, 'path');
  for (const y of [6, 7, 24, 25]) for (let x = 0; x < W; x++) set(x, y, 'road');
  for (const y of [15, 16]) for (let x = 0; x < W; x++) set(x, y, 'water');
  for (let b = 0; b < nb - 1; b++) for (const x of [b * 16 + 14, b * 16 + 15]) for (let y = 0; y < H; y++) set(x, y, y === 15 || y === 16 ? 'bridge' : 'road');
  for (const p of placed) {
    const k: TileKind = p.item.kind === 'park' ? 'park' : p.item.kind === 'plaza' ? 'plaza' : 'lot';
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) set(x, y, k);
  }

  // 7. 地点定义
  const idCount: Record<string, number> = { R: 0, W: 0, P: 0 };
  const places: PlaceDef[] = [];
  const placeOf = new Map<Item, PlaceDef>();
  const scaleCap = Math.max(1, N / 30);
  for (const p of [...placed].sort((a, b) => kindOrder(a.item.kind) - kindOrder(b.item.kind) || a.item.idx - b.item.idx)) {
    const k = p.item.kind;
    const prefix = k === 'residence' ? 'R' : k === 'park' || k === 'plaza' ? 'P' : 'W';
    const pid = `${prefix}${pad(++idCount[prefix]!)}`;
    const styles = STYLE[k]!;
    const style = { ...styles[p.item.idx % styles.length]! };
    const open = k === 'park' || k === 'plaza';
    const def: PlaceDef = {
      id: pid,
      name: p.item.name,
      short: p.item.short,
      district: p.item.district,
      kind: k,
      rect: { x: p.x, y: p.y, w: p.w, h: p.h },
      door: p.door,
      open,
      hours: HOURS[k] ? HOURS[k]!.map(([a, b]) => [a, b] as [number, number]) : null,
      needsPower: !open,
      capacity: open || k === 'residence' ? CAPACITY[k]! : Math.round(CAPACITY[k]! * (['cafe', 'restaurant', 'supermarket', 'convenience', 'library'].includes(k) ? scaleCap : 1)),
      ...(k === 'residence' ? { units: 4 } : {}),
      style,
    };
    places.push(def);
    placeOf.set(p.item, def);
  }

  // 8. 道具：公告栏、喷泉、树、花、路灯、长椅
  const props: Prop[] = [];
  const openPlaces = places.filter((p) => p.open);
  const boardOrder = [...openPlaces.filter((p) => p.kind === 'plaza' && p.district === 'south'), ...openPlaces.filter((p) => p.district === 'north'), ...openPlaces.filter((p) => !(p.kind === 'plaza' && p.district === 'south') && p.district !== 'north')];
  const boardIds = ['BA', 'BB', 'BC'];
  for (const [i, p] of boardOrder.slice(0, spec.media.boards).entries()) {
    const tile = { x: p.rect.x, y: p.rect.y };
    p.board = { id: boardIds[i]!, tile };
    props.push({ kind: 'board', x: tile.x, y: tile.y, ref: boardIds[i]! });
  }
  const plaza = openPlaces.find((p) => p.kind === 'plaza');
  if (plaza) props.push({ kind: 'fountain', x: plaza.rect.x + Math.floor(plaza.rect.w / 2), y: plaza.rect.y + 2 });
  const doorSet = new Set(places.map((p) => `${p.door.x},${p.door.y}`));
  const blockedProp = new Set(props.map((p) => `${p.x},${p.y}`));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = tiles[y * W + x];
      const inPark = places.find((p) => p.kind === 'park' && x >= p.rect.x && x < p.rect.x + p.rect.w && y >= p.rect.y && y < p.rect.y + p.rect.h);
      if (k !== 'grass' && !inPark) continue;
      if (blockedProp.has(`${x},${y}`) || doorSet.has(`${x},${y + 1}`)) continue;
      const u = R('deco', x, y);
      if (inPark) {
        // 公园里的树只种在最里面一排，不挡路；偶尔放张长椅
        if (y === inPark.rect.y && u < 0.35 && x !== inPark.rect.x) {
          set(x, y, 'tree');
          props.push({ kind: 'tree', x, y });
        } else if (y !== inPark.rect.y && u > 0.96) props.push({ kind: 'bench', x, y });
        continue;
      }
      if (u < 0.1) {
        set(x, y, 'tree');
        props.push({ kind: 'tree', x, y });
      } else if (u < 0.125) {
        set(x, y, 'flower');
        props.push({ kind: 'flower', x, y });
      }
    }
  }
  for (const y of [5, 13, 17, 23, 31]) {
    for (let x = 3; x < W; x += 9) {
      if (tiles[y * W + x] !== 'path' || doorSet.has(`${x},${y}`)) continue;
      props.push({ kind: 'lamp', x, y });
    }
  }
  for (const p of openPlaces) if (p.kind === 'plaza') props.push({ kind: 'bench', x: p.rect.x + p.rect.w - 1, y: p.rect.y + p.rect.h - 1 });

  // 9. 住户落位：每栋 4 户
  const residences = (d: District) => places.filter((p) => p.kind === 'residence' && p.district === d);
  for (const d of ['north', 'south'] as District[]) {
    const hs = households.filter((h) => h.district === d);
    const rs = residences(d);
    hs.forEach((h, i) => {
      h.place = rs[Math.floor(i / 4)]!.id;
      h.unit = (i % 4) + 1;
    });
  }

  // 10. 岗位分配
  const workplaces = places.filter((p) => STAFFING[p.kind]);
  const all = households.flatMap((h) => h.members);
  const worker = (m: Slot) => m.age >= 20 && m.age <= 64;
  // 具名人物指定的身份先落位
  for (const m of all) {
    const c = m.character;
    if (!c?.role) continue;
    m.role = c.role;
    const kind = Object.entries(STAFFING).find(([, roles]) => roles.includes(c.role!))?.[0];
    if (kind) {
      const wp = workplaces.filter((p) => p.kind === kind);
      const taken = (p: PlaceDef) => all.filter((x) => x.workplace === p.id && x.role === c.role).length;
      const cap = (p: PlaceDef) => STAFFING[p.kind]!.filter((r) => r === c.role).length;
      const target = wp.find((p) => taken(p) < cap(p)) ?? wp[0];
      if (target) m.workplace = target.id;
      else m.role = undefined;
    }
  }
  for (const p of workplaces) {
    const roles = [...STAFFING[p.kind]!];
    for (const [ri, role] of roles.entries()) {
      const filled = all.filter((x) => x.workplace === p.id && x.role === role).length;
      const need = roles.slice(0, ri + 1).filter((r) => r === role).length;
      if (filled >= need) continue;
      const [lo, hi] = AGE_FIT[role] ?? [22, 60];
      let best: Slot | undefined;
      let bestScore = -Infinity;
      for (const [mi, m] of all.entries()) {
        if (m.role || !worker(m) || m.character?.role) continue;
        const fit = m.age >= lo && m.age <= hi ? 1 : 0.3 - Math.min(m.age < lo ? lo - m.age : m.age - hi, 30) / 30;
        const score = fit + R('job', p.id, ri, mi) * 0.6;
        if (score > bestScore) {
          bestScore = score;
          best = m;
        }
      }
      if (best) {
        best.role = role;
        best.workplace = p.id;
      }
    }
  }
  for (const [mi, m] of all.entries()) {
    if (m.role) continue;
    if (m.age >= 60) m.role = 'retiree';
    else if (m.age <= 24) m.role = R('rest', mi) < 0.65 ? 'student' : R('rest2', mi) < 0.5 ? 'wfh' : 'jobseeker';
    else {
      const u = R('rest', mi);
      m.role = u < 0.4 ? 'wfh' : u < 0.72 ? 'caregiver' : 'jobseeker';
    }
  }

  // 11. 人物定义
  const hasKind = (k: PlaceKind) => places.some((p) => p.kind === k);
  const people: PersonDef[] = [];
  const hhDefs: HouseholdDef[] = [];
  let pi = 0;
  for (const [hi, h] of households.entries()) {
    const hid = `h${pad(hi + 1)}`;
    const ids: string[] = [];
    for (const m of h.members) {
      pi++;
      const aid = `a${pad(pi)}`;
      ids.push(aid);
      const role = m.role!;
      const wp = m.workplace ? places.find((p) => p.id === m.workplace) : undefined;
      const traits = makeTraits(seed, aid, m, role, spec);
      const look = makeLook(seed, aid, m, role, traits);
      const person: PersonDef = {
        id: aid,
        name: m.surname + m.given,
        age: m.age,
        gender: m.gender,
        household: hid,
        role,
        roleLabel: roleLabelFor(seed, aid, role, wp),
        ...(wp ? { org: orgIdFor(places, wp), workplace: wp.id } : {}),
        bio: '',
        speech: speechFor(seed, aid, traits, m.age),
        traits,
        habits: { website: [], push: false, phone: 'mid', readDepth: 0.6, drain: 5, lunch: 'home', leisure: [] },
        look,
        wallet: walletFor(seed, aid, role),
      };
      person.habits = makeHabits(seed, aid, person, places, h.place!, hasKind);
      people.push(person);
    }
    const labelOf = () => {
      if (h.members.length === 1) return people[people.length - 1]!.name;
      if (h.type.startsWith('room') || h.type === 'mixed_room') return `${places.find((p) => p.id === h.place)!.short}合租`;
      const surnames = [...new Set(h.members.map((m) => m.surname))];
      return h.type === 'couple' || h.type === 'senior_couple' ? `${surnames.slice(0, 2).join('')}家` : `${h.members.find((m) => m.gender === 'm' && m.grp !== 'Y')?.surname ?? surnames[0]}家`;
    };
    hhDefs.push({ id: hid, label: labelOf(), place: h.place!, unit: h.unit!, members: ids, food: 4 + h.members.length * 3 });
  }
  // 媒介：按可能性排序分配推送与网站习惯
  const kPush = Math.round(N * spec.media.push);
  const kWeb = Math.round(N * spec.media.website);
  const Rm = (...k: Array<string | number>) => R('media', ...k);
  [...people].sort((a, b) => pushScore(b, Rm) - pushScore(a, Rm)).forEach((p, i) => (p.habits.push = i < kPush));
  [...people].sort((a, b) => webScore(b, Rm) - webScore(a, Rm)).forEach((p, i) => (p.habits.website = i < kWeb ? websiteSlots(p.role) : []));
  // 具名人物覆盖 + 小传
  for (const p of people) {
    const c = spec.characters.find((x) => x.name === p.name);
    if (c) applyCharacter(p, c);
  }
  for (const p of people) if (!spec.characters.find((x) => x.name === p.name && x.bio)) p.bio = bioFor(seed, p, hhDefs.find((h) => h.id === p.household)!, people);

  // 12. 组织、商品、补贴
  const orgs: OrgDef[] = [];
  for (const p of workplaces) {
    const staff = people.filter((x) => x.workplace === p.id);
    if (staff.length === 0) continue;
    const money = ORG_MONEY[p.kind]!;
    const roles = STAFFING[p.kind]!;
    const manager = staff.find((x) => MANAGER.includes(x.role)) ?? staff[0]!;
    const wages: Record<string, number> = {};
    for (const s of staff) wages[s.id] = money.wages[Math.max(0, roles.indexOf(s.role))] ?? money.wages[money.wages.length - 1]!;
    orgs.push({ id: orgIdFor(places, p), name: p.name, place: p.id, manager: manager.id, staff: staff.map((x) => x.id), capital: money.capital, externalDaily: Math.round(money.external * (money.source === 'ext:visitors' ? Math.max(1, N / 30) : 1)), externalSource: money.source, wages });
  }
  for (const p of people) if (p.org && !orgs.some((o) => o.id === p.org)) delete p.org;
  const offers: OfferDef[] = [];
  for (const p of places) for (const o of OFFERS[p.kind] ?? []) offers.push({ place: p.id, item: o.item, price: o.price, stock: Math.round(o.stock * (o.scale ? Math.max(1, N / 30) : 1)), restockTo: Math.round(o.stock * (o.scale ? Math.max(1, N / 30) : 1)) });
  const stipends: ScenarioDef['stipends'] = [];
  for (const p of people) {
    const amt = p.role === 'retiree' ? randInt(seed, 150, 190, 'gen', 'pension', p.id) : p.role === 'student' ? randInt(seed, 60, 80, 'gen', 'fam', p.id) : p.role === 'wfh' ? randInt(seed, 350, 420, 'gen', 'cli', p.id) : p.role === 'jobseeker' ? 90 : 0;
    if (amt > 0) stipends.push({ agent: p.id, amount: amt, source: p.role === 'retiree' ? 'ext:pension' : p.role === 'student' ? 'ext:family' : p.role === 'wfh' ? 'ext:clients' : 'ext:benefit' });
  }

  // 13. 关系：跨户亲属、具名人物关系、朋友
  const relations: RelationDef[] = [];
  const homeDistrict = new Map(hhDefs.map((hh) => [hh.id, places.find((p) => p.id === hh.place)!.district]));
  const byId = new Map(people.map((p) => [p.id, p]));
  const kinLinked = new Set<string>();
  for (const hh of hhDefs) {
    const elders = hh.members.map((m) => byId.get(m)!).filter((p) => p.age >= 60);
    if (elders.length === 0 || elders.length !== hh.members.length) continue;
    if (R('kin', hh.id) >= spec.network.kin) continue;
    const elder = elders[0]!;
    const child = people.find((c) => c.household !== hh.id && !kinLinked.has(c.id) && elder.age - c.age >= 20 && elder.age - c.age <= 40 && c.age >= 25);
    if (!child) continue;
    kinLinked.add(child.id);
    relations.push({ a: elder.id, b: child.id, kind: 'family', strength: 0.9, trust: 0.9, note: `${elder.gender === 'm' ? '父' : '母'}${child.gender === 'm' ? '子' : '女'}` });
  }
  for (const c of spec.characters) {
    if (!c.kin) continue;
    const a = people.find((p) => p.name === c.name);
    const b = people.find((p) => p.name === c.kin!.name);
    if (!a || !b || a.id === b.id) continue;
    const friend = c.kin.relation === '朋友';
    relations.push({ a: a.id, b: b.id, kind: friend ? 'friend' : 'family', strength: friend ? 0.7 : 0.9, trust: friend ? 0.7 : 0.9, note: c.kin.relation });
  }
  addFriends(
    people.map((p) => ({ id: p.id, age: p.age, district: homeDistrict.get(p.household)!, household: p.household, leisure: p.habits.leisure })),
    relations,
    spec.network.friends,
    spec.network.crossDistrict,
    (...k) => R('friend', ...k),
  );

  // 14. 剧本
  const events = toOutageEvents(spec.events, false);
  const h = specHash(spec);
  return {
    id: id ?? `gen_${h}`,
    name: `${spec.name} · ${N} 人`,
    version: `${GENERATOR_VERSION}@${h}`,
    start: at(1, 6, 0),
    map: { w: W, h: H, tiles, places, props },
    people,
    households: hhDefs,
    orgs,
    relations,
    items: [
      { id: 'coffee', name: '咖啡' },
      { id: 'cafe_meal', name: '简餐' },
      { id: 'pastry', name: '点心' },
      { id: 'meal', name: '套餐' },
      { id: 'groceries', name: '食材' },
      { id: 'snack', name: '零食' },
      { id: 'power_bank', name: '充电宝' },
    ],
    offers,
    stipends,
    script: scriptFromEvents(events, { places, orgs }),
    events,
    outages: events.map(truthOf),
  };
}

function kindOrder(k: PlaceKind): number {
  return ['residence', 'gov', 'clinic', 'library', 'utility', 'newsroom', 'supermarket', 'cafe', 'restaurant', 'convenience', 'studio', 'plaza', 'park'].indexOf(k);
}

function orgIdFor(places: PlaceDef[], p: PlaceDef): string {
  const same = places.filter((x) => x.kind === p.kind);
  const i = same.indexOf(p);
  const base = ORG_ID[p.kind] ?? p.kind;
  return i <= 0 ? base : `${base}${i + 1}`;
}

function roleLabelFor(seed: number, id: string, role: RoleId, wp?: PlaceDef): string {
  const s = wp?.short ?? '';
  switch (role) {
    case 'cafe_manager':
      return `${s}值班经理`;
    case 'chef_owner':
      return `${s}主厨兼老板`;
    case 'server':
      return `${s}服务员`;
    case 'clerk':
      return `${s}店长`;
    case 'market_manager':
      return `${s}店长`;
    case 'cashier':
      return `${s}收银员`;
    case 'studio_lead':
      return `${wp?.name ?? '工作室'}主管`;
    case 'gov_clerk':
      return `${s}办事员`;
    case 'doctor':
      return `${s}医生`;
    case 'nurse':
      return `${s}护士`;
    case 'librarian':
      return `${s}管理员`;
    case 'technician':
      return `${s}技术员`;
    case 'wfh':
      return WFH_LABELS[Math.floor(rand(seed, 'gen', 'wfh', id) * WFH_LABELS.length)]!;
    default:
      return ROLE_LABEL[role];
  }
}

function makeTraits(seed: number, id: string, m: Slot, role: RoleId, spec: TownSpec): Traits {
  const n = (k: string, sd = 0.12) => randNormal(seed, 'gen', 'trait', id, k) * sd;
  const S = m.age >= 60;
  const Y = m.age < 30;
  const c = spec.culture;
  const f = (x: number) => r2(clamp(x, 0.05, 0.95));
  const anxiety = f(c.anxiety + (S ? 0.05 : 0) + (role === 'caregiver' ? 0.1 : 0) + n('anx'));
  return {
    anxiety,
    riskAversion: f(0.5 + (S ? 0.12 : 0) + 0.25 * (anxiety - 0.45) + n('risk', 0.1)),
    sociability: f(c.sociability + (Y ? 0.08 : 0) + (role === 'clerk' || role === 'server' || role === 'barista' ? 0.08 : 0) + n('soc')),
    order: f(0.6 + (S ? 0.15 : 0) - (Y ? 0.12 : 0) + n('ord')),
    curiosity: f(0.55 + (Y ? 0.08 : 0) + (role === 'reporter' ? 0.25 : 0) + n('cur')),
    altruism: f(0.55 + (role === 'caregiver' ? 0.15 : 0) + n('alt')),
    commitment: f(0.65 + (MANAGER.includes(role) ? 0.15 : 0) - (Y ? 0.1 : 0) + n('com')),
    trustOfficial: f(c.trustGov + (S ? 0.08 : 0) + (role === 'gov_clerk' || role === 'gov_liaison' ? 0.15 : 0) - (role === 'reporter' ? 0.05 : 0) + n('trust')),
    detail: f(c.detail + (['reporter', 'doctor', 'gov_clerk', 'librarian'].includes(role) ? 0.15 : 0) - (role === 'student' ? 0.1 : 0) + n('det')),
  };
}

function makeHabits(seed: number, id: string, p: PersonDef, places: PlaceDef[], home: string, hasKind: (k: PlaceKind) => boolean): Habits {
  const u = (k: string) => rand(seed, 'gen', 'habit', id, k);
  const age = p.age;
  const phone: Habits['phone'] = age < 30 ? 'high' : age < 60 ? (u('ph') < 0.3 ? 'high' : 'mid') : u('ph') < 0.25 ? 'mid' : 'low';
  const drain = phone === 'high' ? randInt(seed, 8, 12, 'gen', 'drain', id) : phone === 'mid' ? randInt(seed, 5, 7, 'gen', 'drain', id) : randInt(seed, 2, 4, 'gen', 'drain', id);
  let lunch: Habits['lunch'] = 'home';
  switch (p.role) {
    case 'studio_lead':
    case 'designer':
    case 'reporter':
      lunch = hasKind('cafe') && (u('lu') < 0.55 || !hasKind('restaurant')) ? 'cafe' : hasKind('restaurant') ? 'restaurant' : 'workplace';
      break;
    case 'student':
      lunch = hasKind('cafe') ? 'cafe' : 'home';
      break;
    case 'technician':
      lunch = 'bring';
      break;
    case 'wfh':
    case 'retiree':
    case 'caregiver':
    case 'jobseeker':
    case 'clerk':
    case 'cashier':
      lunch = 'home';
      break;
    default:
      lunch = 'workplace';
  }
  const leisure: string[] = [];
  const homeD = places.find((x) => x.id === home)?.district;
  const open = places.filter((x) => x.open);
  const nearOpen = open.find((x) => x.district === homeD) ?? open[0];
  const busy = ['cafe_manager', 'barista', 'chef_owner', 'server', 'clerk', 'market_manager', 'cashier'].includes(p.role);
  if (!busy || u('lb') < 0.3) {
    if (nearOpen && (p.traits.sociability > 0.45 || u('lo') < 0.5)) leisure.push(nearOpen.id);
    const cafe = places.find((x) => x.kind === 'cafe' && x.district === homeD) ?? places.find((x) => x.kind === 'cafe');
    if (cafe && p.traits.sociability > 0.55 && u('lc') < 0.6) leisure.push(cafe.id);
    const lib = places.find((x) => x.kind === 'library');
    if (lib && p.traits.curiosity > 0.6 && u('ll') < 0.6) leisure.push(lib.id);
    const other = open.find((x) => x !== nearOpen);
    if (other && p.traits.sociability > 0.7 && u('lx') < 0.5) leisure.push(other.id);
  }
  return {
    website: [],
    push: false,
    phone,
    readDepth: r2(clamp(0.25 + 0.65 * p.traits.detail + randNormal(seed, 'gen', 'rd', id) * 0.08, 0.2, 0.95)),
    drain,
    lunch,
    leisure,
  };
}

function websiteSlots(role: RoleId): Habits['website'] {
  if (role === 'reporter') return ['wake', 'lunch', 'evening'];
  if (role === 'wfh') return ['evening'];
  if (role === 'gov_clerk' || role === 'gov_liaison' || role === 'studio_lead' || role === 'designer') return ['lunch'];
  return ['wake'];
}

function pushScore(p: PersonDef, R: (...k: Array<string | number>) => number): number {
  return (p.habits.push ? 0.6 : 0) + (p.age < 30 ? 0.35 : p.age < 60 ? 0.2 : 0) + (['gov_clerk', 'gov_liaison', 'reporter'].includes(p.role) ? 0.4 : 0) + (MANAGER.includes(p.role) ? 0.15 : 0) + R('push', p.id) * 0.5;
}

function webScore(p: PersonDef, R: (...k: Array<string | number>) => number): number {
  return (p.habits.website.length ? 0.6 : 0) + 0.6 * p.traits.detail + (p.age >= 60 ? 0.2 : 0) + (['gov_clerk', 'gov_liaison', 'reporter'].includes(p.role) ? 0.4 : 0) + R('web', p.id) * 0.4;
}

function makeLook(seed: number, id: string, m: Slot, role: RoleId, t: Traits): Look {
  const u = (k: string) => rand(seed, 'gen', 'look', id, k);
  const skinU = u('skin');
  const skin = skinU < 0.7 ? SK[0]! : skinU < 0.85 ? SK[1]! : SK[2]!;
  const hair = m.age >= 60 && u('grey') < 0.85 ? '#c0cbdc' : HAIR[Math.floor(u('hair') * HAIR.length)]!;
  const mStyles: Look['hairStyle'][] = ['short', 'short', 'short', 'curly'];
  const fStyles: Look['hairStyle'][] = m.age >= 60 ? ['bun', 'curly', 'bun'] : ['long', 'bun', 'bob', 'ponytail', 'long', 'curly'];
  let hairStyle = (m.gender === 'm' ? mStyles : fStyles)[Math.floor(u('hs') * (m.gender === 'm' ? mStyles.length : fStyles.length))]!;
  if ((role === 'technician' || role === 'clerk') && m.gender === 'm') hairStyle = 'cap';
  const shirt = role === 'technician' ? '#f77622' : role === 'doctor' || role === 'nurse' || role === 'chef_owner' ? '#ffffff' : role === 'gov_clerk' || role === 'gov_liaison' ? '#124e89' : SHIRTS[Math.floor(u('shirt') * SHIRTS.length)]!;
  const pants = PANTS[Math.floor(u('pants') * PANTS.length)]!;
  const apron = ['cafe_manager', 'barista', 'chef_owner', 'server'].includes(role);
  const accessory: Look['accessory'] = apron ? 'apron' : t.detail > 0.72 && u('gl') < 0.6 ? 'glasses' : m.age >= 60 && m.gender === 'f' && u('sc') < 0.25 ? 'scarf' : undefined;
  return { skin, hair, hairStyle, shirt, pants, ...(accessory ? { accessory } : {}) };
}

function walletFor(seed: number, id: string, role: RoleId): number {
  const [lo, hi] =
    role === 'retiree' ? [1800, 3400] : role === 'student' ? [600, 900] : role === 'jobseeker' ? [1500, 2500] : role === 'caregiver' ? [1400, 2000] : role === 'wfh' ? [2400, 3200] : role === 'doctor' ? [5500, 6800] : MANAGER.includes(role) ? [3800, 6200] : [1600, 3500];
  return Math.round(randInt(seed, lo, hi, 'gen', 'wallet', id) / 100) * 100;
}

function speechFor(seed: number, id: string, t: Traits, age: number): string {
  const key: keyof typeof SPEECH_BY_TRAIT = t.anxiety > 0.62 ? 'anxious' : age < 26 ? 'young' : t.sociability > 0.7 ? 'social' : t.detail > 0.7 ? 'detail' : 'calm';
  const pool = SPEECH_BY_TRAIT[key];
  return pool[Math.floor(rand(seed, 'gen', 'speech', id) * pool.length)]!;
}

function bioFor(seed: number, p: PersonDef, hh: HouseholdDef, people: PersonDef[]): string {
  const t = p.traits;
  const bits: string[] = [];
  if (t.anxiety > 0.62) bits.push('凡事爱往坏处想');
  if (t.trustOfficial < 0.4) bits.push('不太信官方的说法');
  else if (t.trustOfficial > 0.78) bits.push('对镇上的通知很上心');
  if (t.sociability > 0.72) bits.push('街坊消息灵通');
  if (t.detail > 0.75) bits.push('习惯核对原始消息');
  if (p.habits.push && p.age >= 50) bits.push('订了政务推送');
  if (p.habits.phone === 'high' && p.age < 30) bits.push('手机不离手');
  if (bits.length === 0) bits.push(['作息规律', '性子随和', '做事踏实'][Math.floor(rand(seed, 'gen', 'bio', p.id) * 3)]!);
  const others = hh.members.filter((m) => m !== p.id).map((m) => people.find((x) => x.id === m)!);
  const home = others.length === 0 ? '独居' : others.every((o) => o.age >= 60) && p.age >= 60 ? '和老伴同住' : others.some((o) => o.age - p.age >= 20) ? '和父母同住' : others.some((o) => p.age - o.age >= 20) ? '和孩子同住' : hh.label.endsWith('合租') ? '和朋友合租' : '和家人同住';
  return `${p.roleLabel}，${bits.slice(0, 2).join('，')}；${home}。`;
}

/** 朋友：按同质性（年龄接近、同区、同爱好地点）抽样，补到人均 target 个 */
function addFriends(
  people: Array<{ id: string; age: number; district: District; household: string; leisure: string[] }>,
  relations: RelationDef[],
  target: number,
  crossDistrict: number,
  R: (...k: Array<string | number>) => number,
): void {
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const exist = new Set(relations.map((r) => key(r.a, r.b)));
  const deg = new Map<string, number>(people.map((p) => [p.id, 0]));
  for (const r of relations) if (r.kind === 'friend') [r.a, r.b].forEach((x) => deg.set(x, (deg.get(x) ?? 0) + 1));
  const want = Math.round((target * people.length) / 2);
  let have = relations.filter((r) => r.kind === 'friend').length;
  for (let round = 0; have < want && round < 12; round++) {
    for (const p of people) {
      if (have >= want) break;
      if ((deg.get(p.id) ?? 0) >= Math.ceil(target) + 1) continue;
      let best: (typeof people)[number] | undefined;
      let bestS = -Infinity;
      for (const q of people) {
        if (q.id === p.id || q.household === p.household || exist.has(key(p.id, q.id))) continue;
        if ((deg.get(q.id) ?? 0) >= Math.ceil(target) + 2) continue;
        const same = q.district === p.district;
        const s = 1 - Math.min(1, Math.abs(p.age - q.age) / 40) + (same ? 0.35 : 0.35 * crossDistrict * 2 - 0.2) + (p.leisure.some((l) => q.leisure.includes(l)) ? 0.25 : 0) + R(p.id, q.id, round) * 0.6;
        if (s > bestS) {
          bestS = s;
          best = q;
        }
      }
      if (!best) continue;
      exist.add(key(p.id, best.id));
      relations.push({ a: p.id, b: best.id, kind: 'friend', strength: r2(0.35 + R('s', p.id, best.id) * 0.4), trust: r2(0.45 + R('t', p.id, best.id) * 0.3) });
      deg.set(p.id, (deg.get(p.id) ?? 0) + 1);
      deg.set(best.id, (deg.get(best.id) ?? 0) + 1);
      have++;
    }
  }
}
