import { rand } from '../core/rng.ts';
import { dayStart, hm, MIN, type SimTime } from '../core/time.ts';
import { OCCUPATIONS, SHIFTS, type ActKind } from '../data/tables.ts';
import type { HouseholdDef, PersonDef } from '../model/def.ts';
import type { RuleParams } from '../params.ts';
import type { AnchorKind } from '../world/interiors.ts';
import type { WorldMap } from '../world/map.ts';

/**
 * 固定安排（承诺）：上班、上学、接送、一家人的饭、作业、复诊。
 * 它是（人, 日期）的纯函数，不占状态；状态里只记“做了 / 错过”。
 * 其余时间由需求驱动的自由选择填满（D64）。
 */
export interface Commit {
  /** `${day}:${key}` */
  id: string;
  kind: ActKind;
  place: string;
  start: SimTime;
  end: SimTime;
  label: string;
  anchors: AnchorKind[];
  away?: boolean;
  family?: boolean;
  /** 同行：去这件事的路上按这个速度走（米/秒），好让一起出发的人一起到 */
  pace?: number;
}

export interface CommitCtx {
  seed: number;
  params: RuleParams;
  map: WorldMap;
  P: Record<string, PersonDef>;
  H: Record<string, HouseholdDef>;
  /** 这一天不上班的额外原因：被裁了，或者单位停业（干预）；默认没有 */
  idle?: (p: PersonDef, day: number) => boolean;
}

const weekdayIndex = (day: number): number => (day - 1) % 7;

/** 这一天上不上班 */
export function worksOn(p: PersonDef, day: number): boolean {
  if (!p.job) return false;
  const wd = weekdayIndex(day);
  const rest = SHIFTS[p.job.shift]!.rest;
  if (p.job.owner) return true;
  if (rest === 'weekend') return wd < 5;
  if (rest === 'sunday') return wd < 6;
  if (rest === 'rotate') return !p.job.restDays.includes(wd);
  return true;
}

export const schoolOn = (p: PersonDef, day: number): boolean => !!p.school && weekdayIndex(day) < 5;

/** 这一天被工作或上学占住的时段（绝对时间）；works 默认按班次表 */
export function busy(p: PersonDef, day: number, works: (p: PersonDef, day: number) => boolean = worksOn): Array<[SimTime, SimTime]> {
  const d0 = dayStart(day);
  if (works(p, day)) return SHIFTS[p.job!.shift]!.segs.map(([a, b]) => [d0 + a, d0 + b]);
  if (schoolOn(p, day)) return [[d0 + (p.school!.away ? hm(7, 10) : hm(7, 50)), d0 + (p.school!.away ? hm(17, 20) : hm(16, 30))]];
  return [];
}

const overlaps = (ranges: Array<[SimTime, SimTime]>, a: SimTime, b: SimTime): boolean => ranges.some(([x, y]) => x < b && y > a);

/** 平时几点起（没有安排催着的时候） */
export function habitWake(seed: number, p: PersonDef, day: number): SimTime {
  const freeDay = !worksOn(p, day) && !schoolOn(p, day);
  const base = p.stage === 'retired' ? hm(5, 50) : p.stage === 'child' ? (freeDay ? hm(7, 50) : hm(7, 0)) : p.stage === 'student' ? (freeDay ? hm(8, 40) : hm(6, 30)) : p.stage === 'homemaker' ? hm(6, 30) : p.stage === 'jobless' ? hm(7, 40) : hm(6, 50);
  const owl = (p.traits.owl - 0.3) * (freeDay ? 90 : 30) * MIN;
  const jitter = Math.round((rand(seed, 'wake', p.id, day) - 0.5) * 24) * MIN;
  return dayStart(day) + base + Math.round(owl / MIN) * MIN + jitter;
}

/** 平时几点睡；night 是入睡那个晚上所在的日期 */
export function habitBed(seed: number, p: PersonDef, night: number): SimTime {
  const base = p.stage === 'child' ? hm(20, 50) : p.stage === 'student' ? hm(22, 10) : p.stage === 'retired' ? hm(21, 30) : hm(22, 40);
  const owl = (p.traits.owl - 0.3) * 80 * MIN;
  const eve = weekdayIndex(night) >= 4 && weekdayIndex(night) <= 5 && p.stage !== 'retired' && p.stage !== 'child' ? 25 * MIN : 0;
  const jitter = Math.round((rand(seed, 'bed', p.id, night) - 0.5) * 28) * MIN;
  return dayStart(night) + base + Math.round(owl / MIN) * MIN + eve + jitter;
}

/** 一家人的午饭、晚饭几点开 */
export function mealTimes(seed: number, hh: HouseholdDef): { lunch: number; dinner: number } {
  return { lunch: hm(11, 50) + Math.round(rand(seed, 'lunch', hh.id) * 5) * 5 * MIN, dinner: hh.dinnerAt };
}

const LUNCH_LEN = 30 * MIN;
const DINNER_LEN = 35 * MIN;

export function commitsFor(ctx: CommitCtx, p: PersonDef, day: number): Commit[] {
  const { seed, params, map, P, H } = ctx;
  const d0 = dayStart(day);
  const hh = H[p.household]!;
  const out: Commit[] = [];
  const add = (key: string, c: Omit<Commit, 'id'>) => out.push({ id: `${day}:${key}`, ...c });
  const slow = params.walkSpeed * params.slowFactor;
  const walk = (from: string, to: string) => Math.round((map.meters(from, to) * params.streetScale) / slow);
  const works = (m: PersonDef, d: number) => worksOn(m, d) && !ctx.idle?.(m, d);

  // 上班
  if (works(p, day)) {
    const job = p.job!;
    const shift = SHIFTS[job.shift]!;
    const occ = OCCUPATIONS[job.occupation]!;
    shift.segs.forEach(([a, b], i) =>
      add(`work${i}`, { kind: 'work', place: job.place, start: d0 + a, end: d0 + b, label: shift.away ? '去城里上班' : `上班（${map.place(job.place).name}）`, anchors: occ.anchors, ...(shift.away ? { away: true } : {}) }),
    );
  }

  // 上学；小的由家里人接送，没人接的上托管到傍晚
  const small = (c: PersonDef) => !!c.school && !c.school.away && c.age <= 9;
  if (schoolOn(p, day)) {
    const sc = p.school!;
    if (sc.away) add('school', { kind: 'school', place: sc.place, start: d0 + hm(7, 10), end: d0 + hm(17, 20), label: '去城里上中学', anchors: ['wait'], away: true });
    else {
      const escorted = small(p) && !!hh.escort;
      const aftercare = small(p) && !hh.escort;
      const end = d0 + (aftercare ? hm(17, 40) : hm(16, 30));
      add('school', { kind: 'school', place: sc.place, start: d0 + hm(7, 50), end, label: aftercare ? '上课（放学后托管）' : '上课', anchors: ['class'], ...(escorted ? { pace: slow } : {}) });
      if (escorted) {
        const start = d0 + hm(16, 32) + walk(sc.place, p.home) + params.lead;
        add('home', { kind: 'rest', place: p.home, start, end: start + 8 * MIN, label: '跟着大人回家', anchors: ['sofa', 'free'], pace: slow });
      }
    }
  }
  const kids = hh.escort === p.id ? hh.members.map((m) => P[m]!).filter((c) => small(c) && schoolOn(c, day)) : [];
  if (kids.length > 0) {
    const kid = kids[0]!;
    const sc = kid.school!.place;
    const who = kids.length > 1 ? '孩子们' : kid.name;
    add('drop', { kind: 'escort', place: sc, start: d0 + hm(7, 50), end: d0 + hm(7, 53), label: `送${who}上学`, anchors: ['free'], pace: slow });
    add('pick', { kind: 'escort', place: sc, start: d0 + hm(16, 26), end: d0 + hm(16, 32), label: `接${who}放学`, anchors: ['free'] });
    const start = d0 + hm(16, 32) + walk(sc, p.home) + params.lead;
    add('home', { kind: 'rest', place: p.home, start, end: start + 8 * MIN, label: '带孩子回家', anchors: ['sofa', 'free'], pace: slow });
  }

  // 一家人的饭：两个人以上才开伙；做饭的人提前进厨房
  const members = hh.members.map((m) => P[m]!);
  if (members.length >= 2) {
    const meals = mealTimes(seed, hh);
    const plan = (key: 'lunch' | 'dinner', at: number, len: number, prep: number, name: string) => {
      const t0 = d0 + at;
      const canEat = (m: PersonDef): boolean => {
        const b = busy(m, day, works);
        if (overlaps(b, t0 - 5 * MIN, t0 + len)) return false;
        // 午饭：当天上班的人自己解决；晚饭：下班赶得回来才算
        if (key === 'lunch') return b.length === 0;
        const lastEnd = b.reduce((x, [, y]) => (y <= t0 ? Math.max(x, y) : x), 0);
        if (lastEnd > 0 && works(m, day) && !SHIFTS[m.job!.shift]!.away) return lastEnd + Math.round((map.meters(m.job!.place, m.home) * params.streetScale) / params.walkSpeed) + params.lead <= t0 + 10 * MIN;
        return true;
      };
      const eaters = members.filter(canEat);
      if (eaters.length < 2) return;
      const freeBefore = (m: PersonDef) => m.age >= 16 && !overlaps(busy(m, day, works), t0 - prep - 10 * MIN, t0);
      const cook = (eaters.find((m) => m.id === hh.cook && freeBefore(m)) ?? eaters.find(freeBefore))?.id;
      if (!cook) return;
      if (!eaters.some((m) => m.id === p.id)) return;
      if (cook === p.id) add(`${key}-cook`, { kind: 'cook', place: p.home, start: t0 - prep, end: t0, label: `做${name}`, anchors: ['stove'] });
      add(key, { kind: 'eat_home', place: p.home, start: t0, end: t0 + len, label: `一家人吃${name}`, anchors: ['dine'], family: true });
    };
    plan('lunch', meals.lunch, LUNCH_LEN, 30 * MIN, '午饭');
    plan('dinner', meals.dinner, DINNER_LEN, 40 * MIN, '晚饭');
  }

  // 作业：晚饭后
  if (schoolOn(p, day)) {
    const start = d0 + Math.max(hm(19, 20), hh.dinnerAt + DINNER_LEN + 10 * MIN);
    add('homework', { kind: 'study', place: p.home, start, end: start + (p.stage === 'child' ? 45 : 75) * MIN, label: '写作业', anchors: ['desk', 'dine'] });
  }

  // 一部分老人每周固定一天去卫生站
  if (p.stage === 'retired' && !p.job) {
    const clinic = map.ofKind('clinic')[0];
    if (clinic && rand(seed, 'clinic?', p.id) < 0.22 && weekdayIndex(day) === Math.floor(rand(seed, 'clinic-day', p.id) * 5)) {
      const start = d0 + hm(9, 10) + Math.round(rand(seed, 'clinic-at', p.id) * 8) * 10 * MIN;
      add('clinic', { kind: 'clinic', place: clinic.id, start, end: start + 25 * MIN, label: '去卫生站量血压', anchors: ['exam', 'wait'] });
    }
  }

  // 排序并去掉冲突：工作与上学优先，其余先到先得
  out.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  const hard = (c: Commit) => c.kind === 'work' || c.kind === 'school' || c.kind === 'escort';
  const kept: Commit[] = [];
  for (const c of out) {
    const prev = kept[kept.length - 1];
    if (prev && c.start < prev.end) {
      if (hard(c) && !hard(prev)) kept[kept.length - 1] = c;
      continue;
    }
    kept.push(c);
  }
  return kept;
}
