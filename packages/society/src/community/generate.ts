import { clamp, rand, randInt, weightedIndex } from '../core/rng.ts';
import { hm } from '../core/time.ts';
import { CITY_JOBS, firmTemplateFor, HOBBIES, INTEREST_WEIGHTS, OCCUPATIONS, SHIFTS, type Post } from '../data/tables.ts';
import {
  tieKey,
  type CommunityDef,
  type FirmDef,
  type Gender,
  type HouseholdDef,
  type HouseholdType,
  type JobDef,
  type Look,
  type PersonDef,
  type PlaceDef,
  type Stage,
  type TieDef,
  type TieKind,
} from '../model/def.ts';
import { layoutFor, type HomeSlot } from './layout.ts';
import { givenFor, surnameFor } from './names.ts';
import { normalizeSpec, specHash, type CommunitySpec } from './spec.ts';

/**
 * 社区生成器：纯函数，同一规格永远生成同一社区。
 * 顺序：家庭与成员 → 布局（按户数盖房）→ 分房 → 岗位 → 兴趣、物品、长相 → 关系。
 */

interface Seed {
  age: number;
  gender: Gender;
  role: 'elder' | 'adult' | 'child';
}

interface Draft {
  type: HouseholdType;
  members: Seed[];
}

const TYPES: HouseholdType[] = ['elder_couple', 'elder_single', 'three_gen', 'nuclear', 'couple', 'single', 'single_parent', 'sharers'];
const TYPE_LABEL: Record<HouseholdType, string> = {
  elder_couple: '老两口',
  elder_single: '独居老人',
  three_gen: '三代同堂',
  nuclear: '一家三四口',
  couple: '小两口',
  single: '一个人住',
  single_parent: '单亲家庭',
  sharers: '合租',
};

function draftHouseholds(spec: CommunitySpec): Draft[] {
  const s = spec.seed;
  const out: Draft[] = [];
  let pop = 0;
  const weights = TYPES.map((t) => spec.households[t]);
  for (let i = 0; pop < spec.population && i < 400; i++) {
    const type = TYPES[weightedIndex(weights, rand(s, 'hh-type', i))]!;
    const r = (k: string, lo: number, hi: number) => randInt(s, lo, hi, 'hh', i, k);
    const u = (k: string) => rand(s, 'hh', i, k);
    const members: Seed[] = [];
    const couple = (lo: number, hi: number, role: Seed['role']) => {
      const m = r('m-age', lo, hi);
      members.push({ age: m, gender: 'm', role }, { age: Math.max(lo - 2, m - r('gap', 0, 5)), gender: 'f', role });
    };
    const kid = (k: string, parentAge: number, lo = 5, hi = 17) => members.push({ age: clamp(r(k, lo, hi), 5, Math.max(5, parentAge - 23)), gender: u(`${k}g`) < 0.5 ? 'f' : 'm', role: 'child' });
    switch (type) {
      case 'elder_couple':
        couple(62, 84, 'elder');
        break;
      case 'elder_single':
        members.push({ age: r('age', 66, 88), gender: u('g') < 0.64 ? 'f' : 'm', role: 'elder' });
        break;
      case 'three_gen': {
        if (u('gp2') < 0.6) couple(62, 78, 'elder');
        else members.push({ age: r('gp', 62, 80), gender: u('gpg') < 0.65 ? 'f' : 'm', role: 'elder' });
        couple(32, 46, 'adult');
        const pa = members[members.length - 1]!.age;
        kid('k1', pa, 5, 16);
        if (u('k2?') < 0.22 && members.length < 5) kid('k2', pa, 5, 12);
        break;
      }
      case 'nuclear': {
        couple(31, 50, 'adult');
        const pa = members[members.length - 1]!.age;
        kid('k1', pa);
        if (u('k2?') < 0.32) kid('k2', pa, 5, 13);
        break;
      }
      case 'couple':
        couple(24, 36, 'adult');
        break;
      case 'single':
        members.push({ age: u('older') < 0.14 ? r('age', 40, 56) : r('age', 22, 38), gender: u('g') < 0.48 ? 'f' : 'm', role: 'adult' });
        break;
      case 'single_parent': {
        const pa = r('age', 32, 48);
        members.push({ age: pa, gender: u('g') < 0.7 ? 'f' : 'm', role: 'adult' });
        kid('k1', pa, 5, 17);
        break;
      }
      default: {
        const n = u('n') < 0.6 ? 2 : 3;
        const g: Gender = u('g') < 0.5 ? 'f' : 'm';
        for (let k = 0; k < n; k++) members.push({ age: r(`age${k}`, 21, 30), gender: g, role: 'adult' });
      }
    }
    out.push({ type, members });
    pop += members.length;
  }
  return out;
}

const APT_PREF: Record<HouseholdType, number> = { single: 0.8, sharers: 0.85, couple: 0.65, single_parent: 0.6, nuclear: 0.45, elder_single: 0.4, elder_couple: 0.3, three_gen: 0.05 };
const RENT_PREF: Record<HouseholdType, number> = { single: 2.4, sharers: 3.5, couple: 1.6, single_parent: 1.2, nuclear: 0.6, elder_single: 0.15, elder_couple: 0.1, three_gen: 0.15 };

const SKIN = ['#F1D3B8', '#EBC7A6', '#E3B990', '#D9AC84', '#F4DCC6'];
const HAIR_DARK = ['#2B2622', '#3A2E28', '#1F1D1C', '#4A3A30'];
const HAIR_GRAY = ['#B9B4AC', '#D6D2CA', '#8E8A84', '#EDEAE4'];
const TOPS_ADULT = ['#4B7EAD', '#C2553A', '#5C9E6E', '#8A6A9A', '#E3A13A', '#3F9AA0', '#D9776A', '#6C7A89', '#B98B5E', '#EDE6DA', '#35506B', '#A45A8A'];
const TOPS_ELDER = ['#8F7F6F', '#6F7F86', '#A68C74', '#7C8C7A', '#9A6F5E', '#5E6E7E', '#B5A28A', '#7A6A8A'];
const TOPS_CHILD = ['#F2B63D', '#E8674A', '#4FB0C6', '#7CC47F', '#F28DA6', '#6C8CE0', '#FFD86B'];
const BOTTOMS = ['#3B4A5A', '#4A4038', '#5B5F66', '#2F3B4A', '#6B5B4B', '#3E4C3F'];

function lookFor(s: number, id: string, age: number, gender: Gender, occupation?: string): Look {
  const u = (k: string) => rand(s, 'look', id, k);
  const pickOf = <T>(arr: readonly T[], k: string): T => arr[Math.floor(u(k) * arr.length)]!;
  const gray = age >= 62 || (age >= 52 && u('gray') < 0.4);
  const tops = age < 14 ? TOPS_CHILD : age >= 60 ? TOPS_ELDER : TOPS_ADULT;
  let hairStyle: Look['hairStyle'];
  if (gender === 'f') hairStyle = age < 14 ? pickOf(['ponytail', 'bob'] as const, 'hs') : age >= 60 ? pickOf(['bun', 'bob', 'short'] as const, 'hs') : pickOf(['long', 'ponytail', 'bob', 'bun'] as const, 'hs');
  else hairStyle = age >= 62 && u('bald') < 0.28 ? 'bald' : age < 30 && u('cap') < 0.15 ? 'cap' : 'short';
  let accent: Look['accent'];
  if (occupation === 'cook' || occupation === 'vendor' || occupation === 'server') accent = 'apron';
  else if (u('acc') < 0.24) accent = 'glasses';
  else if (age >= 60 && u('hat') < 0.2) accent = 'hat';
  else if (age >= 55 && gender === 'f' && u('scarf') < 0.2) accent = 'scarf';
  return { skin: pickOf(SKIN, 'skin'), hair: pickOf(gray ? HAIR_GRAY : HAIR_DARK, 'hair'), hairStyle, top: pickOf(tops, 'top'), bottom: pickOf(BOTTOMS, 'bottom'), ...(accent ? { accent } : {}) };
}

export function generateCommunity(input: CommunitySpec): CommunityDef {
  const { spec } = normalizeSpec(input);
  const s = spec.seed;
  const drafts = draftHouseholds(spec);
  const { map, homes } = layoutFor(spec, drafts.length);
  const placeById = Object.fromEntries(map.places.map((p) => [p.id, p])) as Record<string, PlaceDef>;

  // ── 分房：大家庭住院子；其余按偏好分楼房或院子
  const apts = homes.filter((h) => h.apartment);
  const houses = homes.filter((h) => !h.apartment);
  const order = drafts.map((d, i) => ({ d, i })).sort((a, b) => b.d.members.length - a.d.members.length || a.i - b.i);
  const homeOf = new Map<number, HomeSlot>();
  for (const { d, i } of order) {
    const wantApt = d.members.length <= 4 && rand(s, 'apt?', i) < APT_PREF[d.type] * (0.6 + spec.apartments);
    const pool = wantApt ? (apts.length ? apts : houses) : houses.length ? houses : apts;
    // 不总是取最近的：在前几个里抽，住得不那么整齐
    const k = Math.min(pool.length - 1, Math.floor(rand(s, 'home', i) * Math.min(6, pool.length)));
    const slot = pool.splice(k, 1)[0];
    if (!slot) throw new Error('住房不够：户数超过了布局的容量');
    homeOf.set(i, slot);
  }

  // ── 人
  const people: PersonDef[] = [];
  const households: HouseholdDef[] = [];
  const usedNames = new Set<string>();
  const bus = map.places.find((p) => p.kind === 'busstop')!;
  // 没有小学的社区，孩子也坐车去城里上学
  const school = map.places.find((p) => p.kind === 'school');
  const rentTotal = drafts.reduce((a, d) => a + RENT_PREF[d.type], 0) / drafts.length;

  drafts.forEach((d, i) => {
    const hid = `h${String(i + 1).padStart(2, '0')}`;
    const slot = homeOf.get(i)!;
    const head = d.members.find((m) => m.gender === 'm' && m.role !== 'child') ?? d.members[0]!;
    const familyName = surnameFor(s, hid);
    const memberIds: string[] = [];
    d.members.forEach((m, k) => {
      const id = `p${String(people.length + 1).padStart(3, '0')}`;
      // 孩子与男主人同姓；女方与合租的人各有各的姓
      const sameName = d.type !== 'sharers' && (m.role === 'child' || m === head || (m.gender === 'm' && m.role === 'elder'));
      let name = '';
      for (let attempt = 0; attempt < 30; attempt++) {
        name = (sameName ? familyName : surnameFor(s, `${id}:${attempt}`)) + givenFor(s, id, m.gender, m.age, attempt);
        if (!usedNames.has(name)) break;
      }
      usedNames.add(name);
      const stage: Stage = m.age < 13 ? 'child' : m.age < 18 ? 'student' : m.age >= 60 ? 'retired' : 'worker';
      const t = (key: string, bias = 0) => clamp(0.5 + bias + (rand(s, 'trait', id, key) - 0.5) * 0.8, 0.02, 0.98);
      people.push({
        id,
        name,
        age: m.age,
        gender: m.gender,
        stage,
        household: hid,
        slot: k,
        home: slot.place,
        unit: slot.unit,
        traits: { social: t('social'), order: t('order', m.age >= 55 ? 0.08 : m.age < 25 ? -0.08 : 0), thrift: t('thrift', m.age >= 60 ? 0.15 : 0), active: t('active', m.age >= 75 ? -0.15 : 0), owl: t('owl', m.age >= 60 ? -0.3 : m.age < 35 && m.age >= 16 ? 0.18 : 0) },
        interests: [],
        belongings: [],
        pension: 0,
        cash: 0,
        look: { skin: '', hair: '', hairStyle: 'short', top: '', bottom: '' },
        bio: '',
        ...(stage === 'child' && school ? { school: { place: school.id, away: false } } : stage === 'child' || stage === 'student' ? { school: { place: bus.id, away: true } } : {}),
      });
      memberIds.push(id);
    });
    const rents = rand(s, 'rent?', hid) < clamp((spec.renters * RENT_PREF[d.type]) / rentTotal, 0, 0.97);
    const apt = placeById[slot.place]!.kind === 'apartment';
    households.push({
      id: hid,
      type: d.type,
      label: `${familyName}家（${TYPE_LABEL[d.type]}）`,
      home: slot.place,
      unit: slot.unit,
      members: memberIds,
      shopper: memberIds[0]!,
      cook: memberIds[0]!,
      rentWeekly: rents ? Math.round((apt ? 250 : 330) + rand(s, 'rent', hid) * 120 + (d.members.length - 1) * 25) : 0,
      belongings: [],
      cash: 0,
      food: 0,
      supplies: 0,
      dinnerAt: hm(18, 30),
    });
  });
  const P = Object.fromEntries(people.map((p) => [p.id, p])) as Record<string, PersonDef>;

  // ── 工作：先定谁要工作，再把本社区的岗位按优先级排好，剩下的人去城里
  const wantsWork: PersonDef[] = [];
  for (const p of people) {
    if (p.stage === 'worker') {
      const hh = households.find((h) => h.id === p.household)!;
      const hasChild = hh.members.some((m) => P[m]!.age < 13);
      const others = hh.members.filter((m) => m !== p.id && P[m]!.age >= 21 && P[m]!.age < 60).length;
      const pWork = p.gender === 'm' ? 0.93 : hasChild && others > 0 ? 0.68 : 0.88;
      if (rand(s, 'works?', p.id) < pWork) wantsWork.push(p);
      else p.stage = hasChild || others > 0 ? 'homemaker' : 'jobless';
    } else if (p.stage === 'retired' && p.age <= 68 && rand(s, 'works?', p.id) < 0.16) wantsWork.push(p);
  }

  const firms: FirmDef[] = [];
  interface Slot {
    firm: FirmDef;
    place: PlaceDef;
    post: Post;
    prio: number;
    idx: number;
  }
  const slots: Slot[] = [];
  for (const place of map.places) {
    const tpl = firmTemplateFor(place.kind, place.biz);
    if (!tpl) continue;
    const firm: FirmDef = {
      id: `f_${place.id}`,
      name: place.name,
      place: place.id,
      kind: tpl.kind,
      staff: [],
      offers: tpl.offers.map((o) => ({ ...o, stock: o.restockTo })),
      cash: Math.round(tpl.cash * spec.wealth),
      externalDaily: Math.round(tpl.externalDaily * spec.wealth),
    };
    place.firm = firm.id;
    firms.push(firm);
    const seenShift = new Set<string>();
    tpl.posts.forEach((post, idx) => {
      // 优先级：店主 > 每个班次的第一个人 > 其余（按序号轮流）
      const first = !seenShift.has(post.shift);
      seenShift.add(post.shift);
      slots.push({ firm, place, post, idx, prio: post.owner ? 0 : first ? 1 : 2 + idx });
    });
  }
  slots.sort((a, b) => a.prio - b.prio || (a.firm.id < b.firm.id ? -1 : a.firm.id > b.firm.id ? 1 : a.idx - b.idx));

  const pool = [...wantsWork].sort((a, b) => rand(s, 'job-order', a.id) - rand(s, 'job-order', b.id));
  const localQuota = Math.round(pool.length * (1 - spec.cityShare));
  const ELDER_OK = new Set(['vendor', 'shopkeeper', 'tea_staff', 'center_staff', 'cook']);
  const fits = (p: PersonDef, post: Post): boolean => {
    if (p.age >= 60) return ELDER_OK.has(post.occupation);
    if (post.owner) return p.age >= 30;
    if (post.occupation === 'vendor') return p.age >= 32;
    if (post.occupation === 'doctor' || post.occupation === 'foreman') return p.age >= 28;
    return true;
  };
  const restCounter = new Map<string, number>();
  let local = 0;
  for (const slot of slots) {
    if (local >= localQuota) break;
    const k = pool.findIndex((p) => fits(p, slot.post));
    if (k < 0) continue;
    const p = pool.splice(k, 1)[0]!;
    const shift = SHIFTS[slot.post.shift]!;
    const occ = OCCUPATIONS[slot.post.occupation]!;
    // 轮休：同一家店的人错开；店主不休
    let restDays: number[] = [];
    if (shift.rest === 'rotate' && !slot.post.owner) {
      const n = restCounter.get(slot.firm.id) ?? 0;
      restCounter.set(slot.firm.id, n + 1);
      restDays = [(n * 2 + Math.floor(rand(s, 'rest', slot.firm.id) * 7)) % 7];
    }
    const job: JobDef = { occupation: occ.id, firm: slot.firm.id, place: slot.place.id, shift: shift.id, wage: Math.round(occ.wage * spec.wealth * (0.92 + rand(s, 'wage', p.id) * 0.16)), restDays, ...(slot.post.owner ? { owner: true } : {}) };
    p.job = job;
    if (p.stage !== 'retired') p.stage = 'worker';
    slot.firm.staff.push(p.id);
    if (slot.post.owner) slot.firm.owner = p.id;
    local++;
  }
  const cityW = CITY_JOBS.map((j) => j.w);
  for (const p of pool) {
    if (p.age >= 60) continue;
    const cj = CITY_JOBS[weightedIndex(cityW, rand(s, 'city-job', p.id))]!;
    const occ = OCCUPATIONS[cj.occupation]!;
    const shift = SHIFTS[cj.shift]!;
    p.job = { occupation: occ.id, firm: 'city', place: bus.id, shift: shift.id, wage: Math.round(occ.wage * spec.wealth * (0.85 + rand(s, 'wage', p.id) * 0.3)), restDays: shift.rest === 'rotate' ? [Math.floor(rand(s, 'rest', p.id) * 7)] : [] };
  }

  // ── 家务分工、晚饭时间、家底
  const free = (p: PersonDef) => !p.job && p.age >= 18;
  for (const hh of households) {
    const ms = hh.members.map((m) => P[m]!);
    const adults = ms.filter((m) => m.age >= 18);
    const rank = (m: PersonDef) => (free(m) ? 0 : 2) + (m.gender === 'f' ? 0 : 0.5) + (m.age >= 78 ? 1.2 : 0) + (m.job && SHIFTS[m.job.shift]!.away ? 1 : 0);
    const byRank = [...adults].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
    hh.shopper = (byRank[0] ?? ms[0]!).id;
    hh.cook = (byRank.find((m) => m.age < 80) ?? byRank[0] ?? ms[0]!).id;
    const small = ms.some((m) => m.age <= 9);
    const escort = small ? adults.find((m) => free(m) && m.age < 78) : undefined;
    if (escort) hh.escort = escort.id;
    // 晚饭：等最晚下班的那个本地上班的人（最多等到 19:40）
    let dinner = hm(18, 20) + Math.round(rand(s, 'dinner', hh.id) * 8) * 300;
    for (const m of adults) {
      if (!m.job) continue;
      const sh = SHIFTS[m.job.shift]!;
      const end = sh.segs[sh.segs.length - 1]![1];
      if (end <= hm(19, 10)) dinner = Math.max(dinner, end + hm(0, 30));
    }
    hh.dinnerAt = Math.min(dinner, hm(19, 40));
    hh.cash = Math.round((2200 + 1300 * adults.length + rand(s, 'hh-cash', hh.id) * 2500) * spec.wealth);
    hh.food = ms.length * 6;
    hh.supplies = ms.length * 5;
    const hb: string[] = ['fridge'];
    const u = (k: string) => rand(s, 'hh-item', hh.id, k);
    if (u('tv') < (ms.length === 1 && ms[0]!.age < 40 ? 0.55 : 0.94)) hb.push('tv');
    if (u('washer') < 0.9) hb.push('washer');
    if (u('aircon') < 0.78 * spec.wealth) hb.push('aircon');
    if (u('car') < (hh.type === 'nuclear' || hh.type === 'three_gen' ? 0.24 : 0.07) * spec.wealth) hb.push('car');
    hh.belongings = hb;
  }

  // ── 兴趣、物品、钱、长相、简介
  for (const p of people) {
    const u = (k: string) => rand(s, 'person', p.id, k);
    const scored = INTEREST_WEIGHTS.map((iw) => ({ hobby: iw.hobby, m: iw.w(p.age, p.gender === 'f') - u(`i:${iw.hobby}`) }))
      .filter((x) => x.m > 0)
      .sort((a, b) => b.m - a.m)
      .slice(0, 4)
      .map((x) => x.hobby);
    if (scored.length === 0 && p.age >= 8) scored.push('read');
    p.interests = scored;
    const own: string[] = [];
    if (p.age >= 12 && u('phone') < (p.age < 60 ? 0.99 : p.age < 76 ? 0.9 : 0.62)) own.push('phone');
    if (p.job && u('ebike') < 0.46) own.push('ebike');
    else if (p.stage === 'retired' && p.age < 70 && u('ebike') < 0.18) own.push('ebike');
    if (p.stage === 'student' && u('bike') < 0.5) own.push('bike');
    if (scored.includes('chess')) own.push('chess_set');
    if (scored.includes('dance')) own.push('fan');
    if (scored.includes('ball')) own.push('ball');
    if (scored.includes('read')) own.push('books');
    if (p.age >= 50 && u('thermos') < 0.6) own.push('thermos');
    if (p.school) own.push('schoolbag');
    const hh = households.find((h) => h.id === p.household)!;
    if (hh.shopper === p.id && p.age >= 55) own.push('cart');
    if (p.job && (p.job.occupation === 'city_office' || p.job.occupation === 'city_tech')) own.push('laptop');
    p.belongings = own;
    if (p.stage === 'retired') p.pension = u('nopension') < 0.05 ? 900 : Math.round((2500 + u('pension') * 1900) * spec.wealth);
    else if (p.stage === 'jobless') p.pension = 600;
    p.cash = Math.round((p.age < 13 ? 20 + u('cash') * 60 : p.age < 18 ? 60 + u('cash') * 160 : p.stage === 'retired' ? 1200 + u('cash') * 3200 : 700 + u('cash') * 2400) * (p.age < 18 ? 1 : spec.wealth));
    p.look = lookFor(s, p.id, p.age, p.gender, p.job?.occupation);
    const what = p.job ? OCCUPATIONS[p.job.occupation]!.label : p.stage === 'child' ? '上小学' : p.stage === 'student' ? '在城里上中学' : p.stage === 'retired' ? '退休' : p.stage === 'homemaker' ? '在家持家' : '待业';
    const likes = scored.map((h) => HOBBIES[h]!.label).join('、');
    p.bio = `${p.age} 岁，${what}，住${placeById[p.home]!.name}。${likes ? `爱${likes}。` : ''}`;
  }

  // ── 关系
  const ties = new Map<string, TieDef>();
  const link = (a: string, b: string, kind: TieKind, closeness: number) => {
    if (a === b) return;
    const key = tieKey(a, b);
    const prev = ties.get(key);
    const c = Math.round(clamp(closeness, 0.05, 0.98) * 100) / 100;
    if (prev && prev.closeness >= c) return;
    ties.set(key, { a: a < b ? a : b, b: a < b ? b : a, kind: prev && (prev.kind === 'family' || prev.kind === 'partner') ? prev.kind : kind, closeness: c, trust: Math.round((0.45 + 0.5 * c) * 100) / 100 });
  };
  const ur = (...k: Array<string | number>) => rand(s, 'tie', ...k);
  // 家人
  for (const hh of households) {
    const ms = hh.members.map((m) => P[m]!);
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i]!;
        const b = ms[j]!;
        if (hh.type === 'sharers') link(a.id, b.id, 'friend', 0.45 + ur('share', a.id, b.id) * 0.25);
        else {
          const partners = a.age >= 21 && b.age >= 21 && a.gender !== b.gender && Math.abs(a.age - b.age) <= 8;
          link(a.id, b.id, partners ? 'partner' : 'family', partners ? 0.9 : 0.82 + ur('fam', a.id, b.id) * 0.1);
        }
      }
  }
  // 不住在一起的亲人：一部分老人是别家某个大人的父母
  const elderHH = households.filter((h) => h.type === 'elder_couple' || h.type === 'elder_single');
  const youngHH = households.filter((h) => h.type === 'nuclear' || h.type === 'couple' || h.type === 'single' || h.type === 'single_parent');
  const takenChild = new Set<string>();
  for (const eh of elderHH) {
    if (ur('kin?', eh.id) > 0.45) continue;
    const elders = eh.members.map((m) => P[m]!);
    const minAge = Math.min(...elders.map((e) => e.age));
    const cands = youngHH.flatMap((h) => h.members.map((m) => P[m]!)).filter((c) => c.age >= 21 && c.age <= minAge - 22 && !takenChild.has(c.id));
    if (cands.length === 0) continue;
    const child = cands[Math.floor(ur('kin', eh.id) * cands.length)]!;
    takenChild.add(child.id);
    for (const e of elders) {
      link(e.id, child.id, 'family', 0.66);
      for (const m of households.find((h) => h.id === child.household)!.members) if (m !== child.id) link(e.id, m, 'family', P[m]!.age < 18 ? 0.6 : 0.42);
    }
  }
  // 同事
  for (const f of firms) for (let i = 0; i < f.staff.length; i++) for (let j = i + 1; j < f.staff.length; j++) link(f.staff[i]!, f.staff[j]!, 'coworker', 0.22 + ur('co', f.staff[i]!, f.staff[j]!) * 0.26);
  // 同学
  const pupils = people.filter((p) => p.school);
  for (const a of pupils) {
    const mates = pupils.filter((b) => b.id !== a.id && Math.abs(b.age - a.age) <= 1 && b.school!.away === a.school!.away).sort((x, y) => ur('mate', a.id, x.id) - ur('mate', a.id, y.id));
    for (const b of mates.slice(0, 2 + Math.floor(ur('mates', a.id) * 3))) link(a.id, b.id, 'classmate', 0.3 + ur('mc', a.id, b.id) * 0.3);
  }
  // 邻居：同一栋楼，或门口相距不远的院子；只连各家的大人
  const heads = households.map((h) => ({ h, adults: h.members.map((m) => P[m]!).filter((m) => m.age >= 18), place: placeById[h.home]! }));
  for (let i = 0; i < heads.length; i++)
    for (let j = i + 1; j < heads.length; j++) {
      const a = heads[i]!;
      const b = heads[j]!;
      const sameBlock = a.h.home === b.h.home ? Math.abs(Math.floor(a.h.unit / 2) - Math.floor(b.h.unit / 2)) <= 1 : a.place.kind === 'house' && b.place.kind === 'house' && Math.abs(a.place.door.x - b.place.door.x) + Math.abs(a.place.door.y - b.place.door.y) <= 4;
      if (!sameBlock || ur('nb?', a.h.id, b.h.id) > 0.75) continue;
      const pa = a.adults[Math.floor(ur('nba', a.h.id, b.h.id) * a.adults.length)];
      const pb = b.adults[Math.floor(ur('nbb', a.h.id, b.h.id) * b.adults.length)];
      if (pa && pb) link(pa.id, pb.id, 'neighbor', 0.18 + ur('nbc', a.h.id, b.h.id) * 0.3 + (pa.age >= 60 && pb.age >= 60 ? 0.12 : 0));
    }
  // 朋友：年龄相近、有共同爱好的更容易是朋友
  const grown = people.filter((p) => p.age >= 14);
  for (const a of grown) {
    const n = Math.floor(ur('friends', a.id) * 3 + a.traits.social * 1.4);
    if (n <= 0) continue;
    const cands = grown
      .filter((b) => b.id !== a.id && b.household !== a.household && Math.abs(b.age - a.age) <= 10)
      .map((b) => ({ b, score: ur('fr', a.id, b.id) + (b.interests.some((h) => a.interests.includes(h)) ? 0.35 : 0) + (b.gender === a.gender ? 0.15 : 0) }))
      .sort((x, y) => y.score - x.score);
    for (const { b } of cands.slice(0, n)) link(a.id, b.id, 'friend', 0.45 + ur('frc', a.id, b.id) * 0.3);
  }

  return {
    id: `c_${specHash(spec)}`,
    name: spec.name,
    spec: specHash(spec),
    blurb: spec.blurb,
    map,
    people,
    households,
    firms,
    ties: [...ties.values()].sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1)),
  };
}
