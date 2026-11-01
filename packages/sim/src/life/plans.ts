import { jitterMin, rand } from '../core/rng.ts';
import { at, DAY, isWeekend, MIN, type SimTime } from '../core/time.ts';
import type { District, PlaceDef, TownMap } from '../world/map.ts';
import type { ActKind, Agent, PlanItem, WorldState } from '../state/types.ts';

export interface PlanCtx {
  seed: number;
  map: TownMap;
  state: WorldState;
}

const LABEL: Record<ActKind, string> = {
  sleep: '睡觉',
  breakfast: '早饭',
  lunch: '午饭',
  dinner: '晚饭',
  work: '上班',
  wfh: '在家办公',
  class: '上课',
  study: '自习',
  shop: '采购',
  leisure: '休闲',
  walk: '散步',
  nap: '午睡',
  tv: '看电视',
  home: '在家',
  care: '照顾家人',
  jobsearch: '找工作',
  read_board: '看公告',
  wait: '等待',
};
export const actLabel = (k: ActKind): string => LABEL[k];

/** 起床时间（确定性：只依赖 seed / 人 / 日期） */
export function wakeTime(seed: number, a: Agent, day: number): SimTime {
  const base: Record<string, [number, number]> = {
    cafe_manager: [5, 50], barista: [8, 20], chef_owner: [8, 0], server: [8, 30], clerk: [8, 50],
    market_manager: [6, 50], cashier: [9, 0], studio_lead: [7, 20], designer: [7, 40], gov_clerk: [7, 0],
    gov_liaison: [7, 0], doctor: [6, 50], nurse: [6, 40], librarian: [7, 20], technician: [6, 40],
    reporter: [7, 30], wfh: [7, 50], student: [7, 40], retiree: [6, 0], caregiver: [6, 20], jobseeker: [7, 20],
  };
  const [h, m] = base[a.role] ?? [7, 0];
  const lateWeekend = isWeekend(day) && !['cafe_manager', 'barista', 'chef_owner', 'server', 'clerk', 'market_manager', 'cashier'].includes(a.role) ? 50 : 0;
  return at(day, h, m + lateWeekend) + jitterMin(seed, 8, 'wake', a.id, day);
}

export function bedTime(seed: number, a: Agent, day: number): SimTime {
  const base: Record<string, [number, number]> = {
    retiree: [21, 40], caregiver: [22, 20], student: [23, 40], chef_owner: [22, 50], server: [22, 40], clerk: [22, 50],
    cashier: [22, 50], cafe_manager: [22, 0], nurse: [22, 30], doctor: [22, 40],
  };
  const [h, m] = base[a.role] ?? [23, 0];
  return Math.min(at(day, 23, 55), at(day, h, m) + jitterMin(seed, 10, 'bed', a.id, day));
}

interface Block {
  kind: ActKind;
  place: string;
  from: SimTime;
  to: SimTime;
  punctual?: boolean;
  flexible?: boolean;
  social?: boolean;
  purchase?: PlanItem['purchase'];
  label?: string;
}

/** 午饭去哪：按习惯找离上班地点（没有就离家）最近的店；没有这类店就在家吃 */
const lunchPlace = (map: TownMap, a: Agent): { place: string; purchase?: PlanItem['purchase']; label: string } => {
  const from = a.workplace ?? a.home;
  switch (a.habits.lunch) {
    case 'cafe': {
      const p = map.nearestOf('cafe', from);
      if (p) return { place: p.id, purchase: { item: 'cafe_meal', qty: 1, for: 'self' }, label: `午饭（${p.short}）` };
      return { place: a.home, label: '午饭（在家做）' };
    }
    case 'restaurant': {
      const p = map.nearestOf('restaurant', from);
      if (p) return { place: p.id, purchase: { item: 'meal', qty: 1, for: 'self' }, label: `午饭（${p.short}）` };
      return { place: a.home, label: '午饭（在家做）' };
    }
    case 'home':
      return { place: a.home, label: '午饭（在家做）' };
    default:
      return { place: a.workplace ?? a.home, label: '午饭（带饭/员工餐）' };
  }
};

/** 开放空间：先公园、后广场；先本区 */
export function openSpaceNear(map: TownMap, from: string, district?: District): PlaceDef | undefined {
  return (district ? map.nearestOf(['park', 'plaza'], from, { district }) : undefined) ?? map.nearestOf(['park', 'plaza'], from);
}

export function makeDayPlan(ctx: PlanCtx, a: Agent, day: number): PlanItem[] {
  const { seed, map } = ctx;
  const wake = wakeTime(seed, a, day);
  const bed = bedTime(seed, a, day);
  const nextWake = wakeTime(seed, a, day + 1);
  const T = (h: number, m = 0, spread = 0, key = '') => at(day, h, m) + (spread ? jitterMin(seed, spread, 'plan', a.id, day, key) : 0);
  const home = a.home;
  const weekend = isWeekend(day);
  const r = (key: string) => rand(seed, 'plan', a.id, day, key);
  const blocks: Block[] = [];
  const push = (b: Block) => blocks.push(b);
  const breakfastEnd = wake + 25 * MIN + jitterMin(seed, 4, 'plan', a.id, day, 'bf');
  push({ kind: 'breakfast', place: home, from: wake, to: breakfastEnd, social: true });
  let cursor = breakfastEnd;
  const lunch = lunchPlace(map, a);
  const wp = a.workplace ?? home;

  const workDay = (start: SimTime, lunchAt: SimTime, lunchEnd: SimTime, end: SimTime) => {
    push({ kind: 'home', place: home, from: cursor, to: start, flexible: true });
    push({ kind: 'work', place: wp, from: start, to: lunchAt, punctual: true, social: true });
    push({ kind: 'lunch', place: lunch.place, from: lunchAt, to: lunchEnd, social: true, label: lunch.label, ...(lunch.purchase ? { purchase: lunch.purchase } : {}) });
    push({ kind: 'work', place: wp, from: lunchEnd, to: end, punctual: true });
    cursor = end;
  };
  const shift = (start: SimTime, end: SimTime, mealAt?: SimTime) => {
    push({ kind: 'home', place: home, from: cursor, to: start, flexible: true });
    if (mealAt) {
      push({ kind: 'work', place: wp, from: start, to: mealAt, punctual: true, social: true });
      push({ kind: 'lunch', place: wp, from: mealAt, to: mealAt + 30 * MIN, social: true, label: '员工餐' });
      push({ kind: 'work', place: wp, from: mealAt + 30 * MIN, to: end, punctual: true });
    } else push({ kind: 'work', place: wp, from: start, to: end, punctual: true, social: true });
    cursor = end;
  };
  const leisureAfter = (until: SimTime) => {
    const pref = a.habits.leisure;
    if (pref.length === 0 || r('leisure') > 0.35 + 0.5 * a.traits.sociability) return;
    const place = pref[Math.floor(r('leisure_pick') * pref.length)]!;
    const dur = (35 + Math.floor(r('leisure_dur') * 50)) * MIN;
    const end = Math.min(until - 20 * MIN, cursor + dur);
    if (end - cursor < 20 * MIN) return;
    const pk = map.places[place]?.kind;
    push({ kind: pk === 'park' || pk === 'plaza' ? 'walk' : 'leisure', place, from: cursor, to: end, flexible: true, social: true, ...(pk === 'cafe' ? { purchase: { item: 'coffee', qty: 1, for: 'self' as const } } : {}) });
    cursor = end;
  };
  const shopIfNeeded = (until: SimTime) => {
    const hh = ctx.state.households[a.householdId];
    if (!hh) return;
    const shopper = hh.members.find((m) => ['caregiver', 'retiree', 'jobseeker'].includes(ctx.state.agents[m]?.role ?? '')) ?? hh.members[0];
    if (shopper !== a.id) return;
    const food = ctx.state.stock[a.householdId]?.groceries ?? 0;
    if (food >= hh.members.length * 3) return;
    // 平时去最近的超市；住处附近有便利店时，三成多的时候就近买
    const conv = map.nearestOf('convenience', home, { district: map.places[home]?.district });
    const sup = map.nearestOf('supermarket', home);
    const store = conv && (!sup || r('store') < 0.35) ? conv.id : (sup ?? conv)?.id;
    if (!store) return;
    const end = Math.min(until, cursor + 40 * MIN);
    if (end - cursor < 25 * MIN) return;
    push({ kind: 'shop', place: store, from: cursor, to: end, flexible: true, purchase: { item: 'groceries', qty: hh.members.length * 4, for: 'household' }, label: '买菜' });
    cursor = end;
  };
  const dinnerAndEvening = (dinnerAt: SimTime) => {
    if (dinnerAt > cursor) push({ kind: 'home', place: home, from: cursor, to: dinnerAt, flexible: true });
    const dEnd = dinnerAt + 45 * MIN;
    push({ kind: 'dinner', place: home, from: Math.max(cursor, dinnerAt), to: dEnd, social: true });
    const tv = a.role === 'retiree' || a.role === 'caregiver' || r('tv') < 0.35;
    push({ kind: tv ? 'tv' : 'home', place: home, from: dEnd, to: bed, flexible: true });
    cursor = bed;
  };

  const office = (start: [number, number], lunchT: [number, number], end: [number, number]) => {
    if (weekend) {
      push({ kind: 'home', place: home, from: cursor, to: T(10, 30, 20, 'we1'), flexible: true });
      cursor = T(10, 30, 20, 'we1');
      shopIfNeeded(T(12, 0));
      leisureAfter(T(12, 0));
      push({ kind: 'lunch', place: home, from: cursor, to: T(13, 0), social: true, label: '午饭（在家做）' });
      cursor = T(13, 0);
      leisureAfter(T(17, 30));
      dinnerAndEvening(T(18, 30, 15, 'din'));
      return;
    }
    workDay(T(start[0], start[1], 5, 'ws'), T(lunchT[0], lunchT[1], 5, 'lu'), T(lunchT[0], lunchT[1] + 55, 5, 'lu2'), T(end[0], end[1], 10, 'we'));
    shopIfNeeded(T(19, 0));
    leisureAfter(T(18, 45));
    dinnerAndEvening(Math.max(cursor, T(18, 40, 12, 'din')));
  };

  switch (a.role) {
    case 'cafe_manager':
      shift(T(6, 40), T(15, 0, 5, 'se'), T(11, 30, 5, 'meal'));
      leisureAfter(T(17, 30));
      shopIfNeeded(T(18, 0));
      dinnerAndEvening(T(18, 20, 10, 'din'));
      break;
    case 'barista':
      shift(T(10, 30), T(19, 0), T(14, 0, 5, 'meal'));
      dinnerAndEvening(Math.max(cursor, T(19, 30, 5, 'din')));
      break;
    case 'chef_owner':
    case 'server':
      push({ kind: 'home', place: home, from: cursor, to: T(10, a.role === 'server' ? 30 : 0), flexible: true });
      push({ kind: 'work', place: wp, from: T(10, a.role === 'server' ? 30 : 0), to: T(14, 0), punctual: true, social: true });
      push({ kind: 'lunch', place: wp, from: T(14, 0), to: T(14, 30), social: true, label: '员工餐' });
      push({ kind: 'home', place: home, from: T(14, 30), to: T(16, 30), flexible: true, label: '午休' });
      push({ kind: 'work', place: wp, from: T(16, 30), to: T(20, 40), punctual: true, social: true });
      push({ kind: 'dinner', place: wp, from: T(20, 40), to: T(21, 10), social: true, label: '员工餐' });
      cursor = T(21, 10);
      push({ kind: 'home', place: home, from: cursor, to: bed, flexible: true });
      cursor = bed;
      break;
    case 'clerk':
      push({ kind: 'home', place: home, from: cursor, to: T(11, 40), flexible: true });
      push({ kind: 'lunch', place: home, from: T(11, 40), to: T(12, 15), social: true, label: '午饭（在家做）' });
      cursor = T(12, 15);
      shift(T(12, 30), T(21, 0), T(17, 30));
      push({ kind: 'home', place: home, from: cursor, to: bed, flexible: true });
      cursor = bed;
      break;
    case 'market_manager':
      shift(T(8, 0), T(17, 0, 10, 'se'), T(12, 0, 5, 'meal'));
      shopIfNeeded(T(18, 0));
      dinnerAndEvening(T(18, 30, 10, 'din'));
      break;
    case 'cashier':
      push({ kind: 'home', place: home, from: cursor, to: T(11, 20), flexible: true });
      push({ kind: 'lunch', place: home, from: T(11, 20), to: T(11, 50), social: true, label: '午饭（在家做）' });
      cursor = T(11, 50);
      shift(T(12, 0), T(21, 0), T(17, 30));
      push({ kind: 'home', place: home, from: cursor, to: bed, flexible: true });
      cursor = bed;
      break;
    case 'studio_lead':
    case 'designer':
      office([9, 30], [12, 0], [18, 30]);
      break;
    case 'gov_clerk':
    case 'gov_liaison':
      office([8, 30], [12, 0], [17, 30]);
      break;
    case 'doctor':
    case 'nurse':
      office([8, 0], [12, 0], [17, 0]);
      break;
    case 'librarian':
      office([9, 0], [12, 0], [18, 0]);
      break;
    case 'technician':
      office([8, 0], [12, 0], [17, 0]);
      break;
    case 'reporter':
      office([9, 0], [12, 0], [18, 0]);
      break;
    case 'wfh': {
      push({ kind: 'home', place: home, from: cursor, to: T(9, 0, 10, 'ws'), flexible: true });
      push({ kind: 'wfh', place: home, from: T(9, 0, 10, 'ws'), to: T(12, 0, 5, 'lu'), flexible: true });
      push({ kind: 'lunch', place: home, from: T(12, 0, 5, 'lu'), to: T(13, 0, 5, 'lu2'), social: true, label: '午饭（在家做）' });
      push({ kind: 'wfh', place: home, from: T(13, 0, 5, 'lu2'), to: T(17, 30, 10, 'we'), flexible: true });
      cursor = T(17, 30, 10, 'we');
      shopIfNeeded(T(18, 30));
      leisureAfter(T(18, 45));
      dinnerAndEvening(Math.max(cursor, T(18, 45, 10, 'din')));
      break;
    }
    case 'student': {
      const school = map.nearestOf('library', home);
      if (!weekend && school) {
        push({ kind: 'home', place: home, from: cursor, to: T(8, 50), flexible: true });
        push({ kind: 'class', place: school.id, from: T(8, 50), to: T(11, 30), punctual: true, social: true });
        cursor = T(11, 30);
      }
      const l = lunchPlace(map, a);
      push({ kind: 'lunch', place: l.place, from: cursor, to: T(12, 40, 10, 'lu'), social: true, label: l.label, ...(l.purchase ? { purchase: l.purchase } : {}) });
      cursor = T(12, 40, 10, 'lu');
      const atLib = !!school && r('study') < 0.5;
      push({ kind: 'study', place: atLib ? school.id : home, from: cursor, to: T(16, 40, 15, 'st'), flexible: true, label: atLib ? `自习（${school.short}）` : '自习（在家）' });
      cursor = T(16, 40, 15, 'st');
      leisureAfter(T(18, 30));
      dinnerAndEvening(Math.max(cursor, T(18, 40, 10, 'din')));
      break;
    }
    case 'retiree': {
      const walkPlace = openSpaceNear(map, home, map.places[home]?.district)?.id ?? home;
      push({ kind: 'walk', place: walkPlace, from: cursor, to: T(7, 50, 10, 'mw'), social: true, label: '晨练' });
      cursor = T(7, 50, 10, 'mw');
      push({ kind: 'home', place: home, from: cursor, to: T(9, 30, 10, 'out'), flexible: true });
      cursor = T(9, 30, 10, 'out');
      shopIfNeeded(T(10, 30));
      const outing = a.habits.leisure[Math.floor(r('outing') * Math.max(1, a.habits.leisure.length))] ?? walkPlace;
      const ok = map.places[outing]?.kind;
      push({ kind: ok === 'park' || ok === 'plaza' || outing === home ? 'walk' : 'leisure', place: outing, from: cursor, to: T(11, 30, 10, 'oe'), flexible: true, social: true });
      cursor = T(11, 30, 10, 'oe');
      push({ kind: 'lunch', place: home, from: cursor, to: T(12, 30), social: true, label: '午饭（在家做）' });
      push({ kind: 'nap', place: home, from: T(12, 30), to: T(13, 50, 10, 'nap') });
      push({ kind: 'tv', place: home, from: T(13, 50, 10, 'nap'), to: T(16, 50, 15, 'tv'), flexible: true, label: '在家看电视' });
      cursor = T(16, 50, 15, 'tv');
      leisureAfter(T(17, 50));
      dinnerAndEvening(Math.max(cursor, T(18, 0, 10, 'din')));
      break;
    }
    case 'caregiver': {
      push({ kind: 'care', place: home, from: cursor, to: T(9, 20, 10, 'c1'), flexible: true });
      cursor = T(9, 20, 10, 'c1');
      shopIfNeeded(T(10, 30));
      leisureAfter(T(11, 20));
      push({ kind: 'care', place: home, from: cursor, to: T(11, 50), flexible: true });
      push({ kind: 'lunch', place: home, from: T(11, 50), to: T(12, 40), social: true, label: '午饭（在家做）' });
      push({ kind: 'tv', place: home, from: T(12, 40), to: T(16, 30, 15, 'tv'), flexible: true, label: '在家看电视做家务' });
      cursor = T(16, 30, 15, 'tv');
      dinnerAndEvening(T(18, 20, 10, 'din'));
      break;
    }
    case 'jobseeker': {
      push({ kind: 'home', place: home, from: cursor, to: T(9, 30, 10, 'js'), flexible: true });
      push({ kind: 'jobsearch', place: map.nearestOf('library', home)?.id ?? home, from: T(9, 30, 10, 'js'), to: T(11, 40, 10, 'je'), flexible: true, social: true });
      cursor = T(11, 40, 10, 'je');
      push({ kind: 'lunch', place: home, from: cursor, to: T(12, 40), social: true, label: '午饭（在家做）' });
      cursor = T(12, 40);
      // 双数日去看望不住在一起的亲人（例如住在北区的父亲）
      const kin = ctx.state.relations.find((rel) => {
        if (rel.kind !== 'family' || (rel.a !== a.id && rel.b !== a.id)) return false;
        const other = ctx.state.agents[rel.a === a.id ? rel.b : rel.a];
        return !!other && other.householdId !== a.householdId;
      });
      const parent = kin;
      if (parent && day % 2 === 0 && ctx.state.agents[parent.a === a.id ? parent.b : parent.a]!.age > a.age) {
        const pid = parent.a === a.id ? parent.b : parent.a;
        const ph = ctx.state.agents[pid]?.home;
        if (ph) {
          push({ kind: 'home', place: home, from: cursor, to: T(14, 40), flexible: true });
          const who = parent.note?.startsWith('父') ? '父亲' : parent.note?.startsWith('母') ? '母亲' : '家人';
          push({ kind: 'care', place: ph, from: T(14, 40), to: T(16, 40), flexible: true, social: true, label: `看望${who}` });
          cursor = T(16, 40);
        }
      }
      shopIfNeeded(T(18, 0));
      dinnerAndEvening(Math.max(cursor, T(18, 30, 10, 'din')));
      break;
    }
  }
  if (cursor < bed) push({ kind: 'home', place: home, from: cursor, to: bed, flexible: true });
  push({ kind: 'sleep', place: home, from: bed, to: nextWake });
  return normalize(ctx, a, day, blocks);
}

function needsPowerFor(map: TownMap, kind: ActKind, place: string, home: string): boolean {
  if (place === home) return kind === 'wfh' || kind === 'tv' || kind === 'breakfast' || kind === 'lunch' || kind === 'dinner' || kind === 'study' || kind === 'jobsearch';
  const p = map.places[place];
  if (!p || !p.needsPower) return false;
  return kind !== 'walk' && kind !== 'care' && kind !== 'home';
}

function normalize(ctx: PlanCtx, a: Agent, day: number, blocks: Block[]): PlanItem[] {
  // 顺序化、去掉零长度块、补齐空隙
  const bs = blocks.filter((b) => b.to > b.from).sort((x, y) => x.from - y.from);
  const merged: Block[] = [];
  for (const b of bs) {
    const prev = merged[merged.length - 1];
    if (prev && b.from < prev.to) b.from = prev.to;
    if (b.to - b.from < 3 * MIN) continue;
    if (prev && b.from > prev.to) merged.push({ kind: 'home', place: a.home, from: prev.to, to: b.from, flexible: true });
    merged.push(b);
  }
  // 准点项：提前出发
  for (let i = 1; i < merged.length; i++) {
    const b = merged[i]!;
    const prev = merged[i - 1]!;
    if (!b.punctual || b.place === prev.place) continue;
    const travel = ctx.map.travelSeconds(prev.place, b.place) + 2 * MIN;
    const depart = b.from - travel;
    if (depart - prev.from >= 5 * MIN) {
      prev.to = depart;
      b.from = depart;
    }
  }
  return merged
    .filter((b) => b.to - b.from >= 3 * MIN)
    .map((b, i) => ({
      id: `${a.id}-${day}-${i}`,
      kind: b.kind,
      place: b.place,
      start: b.from,
      end: b.to,
      punctual: !!b.punctual,
      flexible: !!b.flexible,
      needsPower: needsPowerFor(ctx.map, b.kind, b.place, a.home),
      social: !!b.social,
      ...(b.purchase ? { purchase: b.purchase } : {}),
      status: 'planned' as const,
      label: b.label ?? LABEL[b.kind],
    }));
}

export const dayEnd = (day: number): SimTime => day * DAY;
