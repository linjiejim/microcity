import { clamp, r3 } from '../core/rng.ts';
import { dayOf, hm, HOUR, MIN, timeOfDay, type SimTime } from '../core/time.ts';
import { HOBBIES, type Hobby } from '../data/tables.ts';
import { tieKey, type PersonDef, type PlaceKind } from '../model/def.ts';
import type { OptionTrace } from '../model/events.ts';
import type { Intent, PersonState } from '../model/state.ts';
import { mealAt, NEEDS, type Rates } from '../params.ts';
import { closenessAt, needsAt, ratesFor } from '../reduce.ts';
import type { Engine } from '../engine/engine.ts';
import { habitBed } from './commits.ts';
import { budgetOf } from './budget.ts';

/**
 * 自由选择（D64）：候选 → 效用（各项因子相加）→ softmax 抽样 → 写成 decision 事件。
 * 改候选的生成或效用公式要升 POLICY_VERSION。
 */

export interface Deadline {
  /** 最晚这个时刻要到 place */
  at: SimTime;
  place: string;
  pace?: number;
  /** 下一件事是一家人的饭：不太饿就不另外吃了 */
  meal?: boolean;
}

export interface Option {
  id: string;
  label: string;
  place: string;
  intent: Intent;
  f: Record<string, number>;
  u: number;
}

const inWindows = (windows: Array<[number, number]>, sod: number): boolean => windows.some(([a, b]) => sod >= a && sod < b);

export function options(e: Engine, p: PersonDef, ps: PersonState, t: SimTime, deadline?: Deadline): Option[] {
  if (ps.loc.k !== 'in') return [];
  const P = e.params;
  const cur = ps.loc.place;
  const home = p.home;
  const sod = timeOfDay(t);
  const n = needsAt(ps.needs, t);
  const hh = e.hh(p);
  const pantry = e.state.households[hh.id]!;
  const members = hh.members.length;
  const wallet = e.balance(p.id);
  // 手头紧不紧（D98）：余钱撑几周、每周可支配的收入、是不是刚被裁
  const tight = budgetOf(e, p, dayOf(t)).tight;
  const out: Option[] = [];
  const u01 = (...key: Array<string | number>) => e.rand('opt', p.id, ps.choiceN, ...key);

  // 过了平时睡觉的点，其他事越来越不想做
  const night = sod < hm(5) ? dayOf(t) - 1 : dayOf(t);
  // 睡前还要洗漱的话，得提前这么久收拾（D97）：“到点”指的是躺下的时刻
  const [wa, wb] = P.washNight;
  const washPending = sod >= hm(19, 30) && (ps.hobbyToday.wash ?? 0) < 2;
  const washDur = washPending ? (wa + Math.floor(u01('wash-night') * (wb - wa + 1))) * MIN : 0;
  // 平时几点睡；第二天要早起的，按要睡够的时长往前提（早班的人早早就躺下）
  const need8 = (p.age < 13 ? P.sleepNeed[0] : p.age < 18 ? P.sleepNeed[1] : P.sleepNeed[2]) * HOUR;
  const bedBy = Math.min(habitBed(e.seed, p, night), e.wakeDue(p, t) - need8);
  const lateH = (t + washDur - bedBy) / HOUR;
  const late = lateH > 0 ? -P.latePenalty * lateH : 0;

  /** 需求项：越缺的需求权重越大；会消耗某项需求的活动按同样的权重扣分 */
  const need = (rates: Rates, dur: number): number => {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const deficit = 1 - n[i]!;
      const gain = clamp((rates[i]! * dur) / HOUR, -n[i]!, deficit);
      s += P.needWeight[NEEDS[i]!] * Math.pow(deficit, P.needCurve) * gain;
    }
    return s;
  };
  const travelMin = (place: string) => e.travelSec(p, cur, place) / MIN;
  const costTerm = (cost: number) => -cost * (P.costBase + P.costTight * tight + P.costThrift * p.traits.thrift);
  // 眼下最便宜的菜价（每份）：在家吃饭的成本、各家店比价的基准
  let foodPrice = Infinity;
  for (const kind of ['market', 'grocery'] as const)
    for (const pl of e.map.ofKind(kind)) {
      if (e.rules.closed(pl.id, dayOf(t))) continue;
      const fp = e.priceAt(pl.id, 'food', t);
      if (fp !== undefined && fp < foodPrice) foodPrice = fp;
    }
  if (!Number.isFinite(foodPrice)) foodPrice = 8;

  /** 在某地做 want 秒，受下一件事、营业时间、人数的限制；做不成返回 null */
  const fit = (place: string, want: number, min: number, service: boolean): number | null => {
    if ((ps.avoid[place] ?? 0) > t) return null;
    const arrive = t + e.travelSec(p, cur, place);
    let d = want;
    if (deadline) d = Math.min(d, deadline.at - arrive - e.travelSec(p, place, deadline.place, deadline.pace));
    const pl = e.map.place(place);
    if (e.rules.closed(place, dayOf(arrive))) return null;
    if (pl.hours) {
      const a = timeOfDay(arrive);
      if (a < pl.hours[0] || a >= pl.hours[1]) return null;
      d = Math.min(d, pl.hours[1] - a);
    }
    if (service && !e.served(place)) return null;
    if (place !== home && e.countAt(place) >= pl.capacity) return null;
    return d >= min ? Math.floor(d) : null;
  };

  const push = (id: string, label: string, place: string, intent: Intent, f: Record<string, number>) => {
    if (place !== cur) f.travel = -P.travelCost * travelMin(place);
    if (late && intent.kind !== 'sleep') f.late = late;
    let u = 0;
    for (const k in f) u += f[k]!;
    out.push({ id, label, place, intent, f, u });
  };

  // ── 睡觉：到点就困，越晚越想睡
  // 离该起床不到一个半小时就不再睡（否则早起的人洗漱完又躺回去，上班迟到）
  const bedAt = t + e.travelSec(p, cur, home);
  if ((sod >= hm(19, 30) || sod < hm(5) || n[1] < 0.08) && e.wakeDue(p, bedAt) - bedAt >= 90 * MIN) {
    const sleep = e.sleepIntent(p, bedAt);
    // 睡前先洗漱（D97）：今天早上洗过一次，晚上还没洗；过了午夜就直接睡
    const intent: Intent = washPending ? { kind: 'wash', dur: washDur, label: '洗漱，准备睡觉', anchors: ['free'], next: sleep } : sleep;
    push('sleep', '睡觉', home, intent, { need: need(P.rates.sleep, Math.min(intent.dur, 8 * HOUR)), habit: 4 * clamp(lateH, -2.5, 2), base: -1 });
  }
  // 午睡
  if (sod >= hm(12, 20) && sod < hm(14, 40) && (p.age >= 58 || n[1] < 0.3)) {
    const d = fit(home, (30 + Math.floor(u01('nap') * 31)) * MIN, 20 * MIN, false);
    if (d) push('nap', '午睡', home, { kind: 'nap', dur: d, label: '午睡', anchors: ['bed', 'sofa'] }, { need: need(P.rates.nap, d), habit: p.age >= 58 ? 0.6 : 0, base: -0.4 });
  }

  // ── 吃：饿了才考虑；马上要和家里人吃饭就不另外吃
  const meal = mealAt(sod);
  if (n[0] < (meal ? P.mealBelow : P.snackBelow) && !(deadline?.meal && deadline.at - t < 80 * MIN && n[0] > 0.2)) {
    const habit = meal ? P.mealWindowBonus : 0;
    const name = meal ?? '东西';
    if (pantry.food >= 1) {
      // 大人自己在家吃，得先做（D97）；孩子由家里人顺手弄好
      const [ca, cb] = meal === '早饭' ? P.cookBreakfast : P.cookMeal;
      const cook = p.age >= 16 ? (ca + Math.floor(u01('cook') * (cb - ca + 1))) * MIN : 0;
      const eat = (25 + Math.floor(u01('eat-home') * 11)) * MIN;
      const total = fit(home, cook + eat, cook + 15 * MIN, false);
      if (total) {
        const d = total - cook;
        const eatIntent: Intent = { kind: 'eat_home', dur: d, label: `在家吃${name}`, anchors: ['dine'] };
        const intent: Intent = cook > 0 ? { kind: 'cook', dur: cook, label: `做${name}`, anchors: ['stove'], next: eatIntent } : eatIntent;
        push('eat_home', `在家吃${name}`, home, intent, { need: need(P.rates.eat_home, d), habit, base: -P.cookEffort * (1.4 - p.traits.order), cost: costTerm(foodPrice) });
      }
    }
    const job = p.job;
    if (job && cur === job.place && deadline?.place === cur && pantry.food >= 1) {
      const d = fit(cur, 20 * MIN, 12 * MIN, false);
      if (d) push('eat_work', '吃自带的饭', cur, { kind: 'eat_work', dur: d, label: '吃自带的饭', anchors: ['table', 'desk', 'free'] }, { need: need(P.rates.eat_work, d), habit, base: 0.3 });
    }
    const eateries = e
      .mealPlaces(t)
      .map((pl) => ({ pl, m: travelMin(pl.id) }))
      .sort((a, b) => a.m - b.m || (a.pl.id < b.pl.id ? -1 : 1));
    for (const { pl } of eateries) {
      const price = e.priceAt(pl.id, 'meal', t);
      if (price === undefined || wallet < price || p.age < P.eatOutAge) continue;
      const d = fit(pl.id, (20 + Math.floor(u01('eat-out', pl.id) * 11)) * MIN, 12 * MIN, pl.kind === 'eatery');
      if (d) push(`eat_out:${pl.id}`, `去${pl.name}吃${name}`, pl.id, { kind: 'eat_out', dur: d, label: `在${pl.name}吃${name}`, anchors: ['table', 'read', 'board', 'free'] }, { need: need(P.rates.eat_out, d), habit, cost: costTerm(price) });
    }
  }

  // ── 买菜、买日用品：由家里负责采购的人去
  if (p.age >= 16 && (hh.shopper === p.id || pantry.food < members)) {
    const lines = e.pantry(hh, t);
    const lowFood = pantry.food < members * lines.low;
    const lowSup = pantry.supplies < members * P.suppliesLow;
    if (lowFood || lowSup) {
      const shortage = clamp(1 - pantry.food / (members * lines.low), 0, 1) + (pantry.food < members ? 0.8 : 0) + (lowSup ? 0.3 : 0);
      const targets: PlaceKind[] = lowFood ? ['market', 'grocery'] : ['grocery'];
      for (const kind of targets)
        for (const pl of e.map.ofKind(kind)) {
          const d = fit(pl.id, (12 + Math.floor(u01('shop', pl.id) * 11)) * MIN, 8 * MIN, true);
          if (!d) continue;
          const what = kind === 'market' ? '买菜' : lowFood ? '买菜和日用品' : '买日用品';
          // 同样买菜，哪家贵哪家吃亏：按每份菜的价差算
          const unit = lowFood ? (e.priceAt(pl.id, 'food', t) ?? foodPrice) : 0;
          push(`shop:${pl.id}`, `去${pl.name}${what}`, pl.id, { kind: 'shop', dur: d, label: `在${pl.name}${what}`, anchors: ['browse', 'queue'] }, { base: 1.2, need: 5 * shortage, habit: kind === 'market' && sod < hm(10) ? 1 : 0, cost: lowFood ? costTerm((unit - foodPrice) * 4) : 0 });
        }
    }
  }

  // ── 消遣：自己的兴趣，加上人人都会做的几样
  const weather = e.state.weather;
  const hobbyIds = [...p.interests];
  for (const id in HOBBIES) if (HOBBIES[id]!.generic && !hobbyIds.includes(id)) hobbyIds.push(id);
  for (const id of hobbyIds) {
    const h: Hobby = HOBBIES[id]!;
    if (p.age < h.ages[0] || p.age > h.ages[1]) continue;
    if (h.needs && !e.has(p, h.needs)) continue;
    const liked = p.interests.includes(id);
    const want = (h.dur[0] + u01('dur', id) * (h.dur[1] - h.dur[0])) * MIN;
    const min = h.dur[0] * MIN * 0.6;
    const rates = ratesFor({ kind: 'hobby', hobby: id }, P);
    const repeat = -P.repeatPenalty * (ps.hobbyToday[id] ?? 0);
    for (const where of h.where) {
      const places = where === 'home' ? [e.map.place(home)] : e.map.ofKind(where);
      for (const pl of places) {
        const cost = (h.cost[pl.kind] ?? 0) * (h.item ? e.rules.priceFactor(pl.id, h.item, dayOf(t)) : 1);
        if (cost > wallet) continue;
        const d = fit(pl.id, want, min, pl.kind === 'teahouse');
        if (!d) continue;
        const arriveSod = timeOfDay(t + e.travelSec(p, cur, pl.id));
        const f: Record<string, number> = { need: need(rates, d), habit: inWindows(h.windows, arriveSod) ? P.windowIn : P.windowOut };
        if (liked) f.like = P.interestBonus;
        if (cost > 0) f.cost = costTerm(cost);
        if (repeat) f.repeat = repeat;
        // 露天的地方（公园、广场、球场）看天气，不管这件事本身算不算户外活动
        if (pl.open) {
          if (weather === 'rain') f.weather = -P.rainOutdoor;
          else if (weather === 'cloud') f.weather = -P.cloudOutdoor;
        }
        if (h.outdoor) f.base = (p.traits.active - 0.5) * 1.0;
        else if (where === 'home') f.base = -(p.traits.active - 0.5) * 0.4;
        if (h.social >= 0.1 && where !== 'home') {
          // 同伴：熟人在场、同好在场
          let close = 0;
          let same = 0;
          for (const other of e.state.here[pl.id]!) {
            if (other === p.id) continue;
            const tie = e.state.ties[tieKey(p.id, other)];
            if (tie) close += closenessAt(tie, t, P);
            const oa = e.state.people[other]!.act;
            if (oa?.kind === 'hobby' && oa.hobby === id) same++;
          }
          const company = Math.min(P.companyCap, P.companyPerCloseness * close) + P.crowdPer * Math.min(P.crowdCap, same);
          if (company > 0) f.company = company * (0.6 + 0.8 * p.traits.social);
        }
        const label = where === 'home' ? h.label : `去${pl.name}${h.label}`;
        push(`hobby:${id}:${pl.id}`, label, pl.id, { kind: 'hobby', hobby: id, dur: d, label: where === 'home' ? h.label : `在${pl.name}${h.label}`, anchors: h.anchors }, f);
      }
    }
  }

  // ── 家务
  if (p.age >= 16 && sod >= hm(7, 30) && sod < hm(20, 30)) {
    const d = fit(home, (20 + Math.floor(u01('chores') * 21)) * MIN, 15 * MIN, false);
    if (d) push('chores', '做家务', home, { kind: 'chores', dur: d, label: '做家务', anchors: ['free', 'stove'] }, { need: need(P.rates.chores, d), base: 0.2 + 0.8 * p.traits.order + (p.job ? 0 : 0.5), repeat: -0.9 * (ps.hobbyToday.chores ?? 0) });
  }

  // ── 歇着：在家，或者（工作间隙）就在原地
  {
    const d = fit(home, (40 + Math.floor(u01('rest') * 51)) * MIN, 5 * MIN, false);
    if (d) push('rest', cur === home ? '歇一会儿' : '回家歇着', home, { kind: 'rest', dur: d, label: '在家歇着', anchors: ['sofa', 'dine', 'free'] }, { need: need(P.rates.rest, d), base: 0.3 });
    if (cur !== home && deadline?.place === cur) {
      const d2 = fit(cur, 20 * MIN, 5 * MIN, false);
      if (d2) push('rest_here', '原地歇一会儿', cur, { kind: 'rest', dur: d2, label: '歇一会儿', anchors: ['free'] }, { need: need(P.rates.rest, d2), base: 0.5 });
    }
  }

  return out;
}

/** 选一个并写下决策记录；没有可选的返回 undefined */
export function choose(e: Engine, p: PersonDef, ps: PersonState, t: SimTime, deadline?: Deadline): Option | undefined {
  const opts = options(e, p, ps, t, deadline);
  if (opts.length === 0) return undefined;
  const tau = e.params.temperature;
  const max = opts.reduce((m, o) => Math.max(m, o.u), -Infinity);
  const w = opts.map((o) => Math.exp((o.u - max) / tau));
  const total = w.reduce((a, b) => a + b, 0);
  const u = e.rand('choice', p.id, ps.choiceN);
  let acc = 0;
  let k = opts.length - 1;
  for (let i = 0; i < opts.length; i++) {
    acc += w[i]! / total;
    if (u < acc) {
      k = i;
      break;
    }
  }
  const chosen = opts[k]!;
  // 记录里留概率最高的 6 个（选中的一定在内）
  const ranked = opts.map((o, i) => ({ o, p: w[i]! / total })).sort((a, b) => b.p - a.p);
  const kept = ranked.slice(0, 6);
  if (!kept.some((x) => x.o === chosen)) kept[kept.length - 1] = ranked.find((x) => x.o === chosen)!;
  const trace: OptionTrace[] = kept.map(({ o, p: prob }) => ({ id: o.id, label: o.label, ...(o.place !== (ps.loc.k === 'in' ? ps.loc.place : '') ? { place: o.place } : {}), u: r3(o.u), p: r3(prob), f: Object.fromEntries(Object.entries(o.f).map(([key, v]) => [key, r3(v)])) }));
  e.emit({ type: 'decision', agent: p.id, n: ps.choiceN, options: trace, chosen: chosen.id, u: r3(u), total: opts.length });
  return chosen;
}
