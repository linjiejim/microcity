import { clamp01 } from './core/rng.ts';
import { DAY, HOUR, overlap, type SimTime } from './core/time.ts';
import { ACT_BUCKET, HOBBIES, type Bucket } from './data/tables.ts';
import { EXT, householdAccount, tieKey, type CommunityDef } from './model/def.ts';
import type { DomainEvent } from './model/events.ts';
import { emptyTally, type ActState, type NeedsState, type PersonState, type TieState, type Weather, type WorldState } from './model/state.ts';
import type { Rates, RuleParams } from './params.ts';

/**
 * 同构 reducer：状态只在这里、只由事件改变。
 * 引擎每发一个事件就调用一次；前端用同一个函数从事件重建任意时刻的状态。
 */

export interface ReduceCtx {
  params: RuleParams;
}

/** 一段活动期间需求每小时的变化 */
export function ratesFor(act: Pick<ActState, 'kind' | 'hobby' | 'away' | 'family'>, params: RuleParams): Rates {
  if (act.away) return params.rates.away;
  const base = params.rates[act.kind];
  if (act.kind === 'hobby' && act.hobby) {
    const h = HOBBIES[act.hobby];
    if (h) return [base[0], base[1] + h.energy, base[2] + h.social, base[3] + h.fun];
  }
  if (act.family) return [base[0], base[1], base[2] + params.familyMealSocial, base[3]];
  return base;
}

/** 把需求结算到 t 时刻（原地修改） */
export function settle(n: NeedsState, t: SimTime): void {
  const dt = (t - n.t) / HOUR;
  if (dt > 0) for (let i = 0; i < 4; i++) n.v[i] = clamp01(n.v[i]! + n.rate[i]! * dt);
  n.t = t;
}

/** t 时刻的需求值（不修改状态） */
export function needsAt(n: NeedsState, t: SimTime): [number, number, number, number] {
  const dt = Math.max(0, (t - n.t) / HOUR);
  return [clamp01(n.v[0] + n.rate[0] * dt), clamp01(n.v[1] + n.rate[1] * dt), clamp01(n.v[2] + n.rate[2] * dt), clamp01(n.v[3] + n.rate[3] * dt)];
}

/** 心情：四项需求的加权平均，按当天聊了几次天略微上调，再扣掉处境（被裁、没有余钱，D98） */
export function moodOf(needs: readonly number[], chats: number, stress = 0): number {
  return Math.round(Math.max(0, Math.min(1, 0.2 * needs[0]! + 0.25 * needs[1]! + 0.25 * needs[2]! + 0.3 * needs[3]! + Math.min(0.1, chats * 0.02)) - stress) * 1000) / 1000;
}

/**
 * 把 [from, to) 这段时间记进当天的时间利用。
 * 去城里上班、上学的那段，首尾各 awayCommute 算在路上（D97）：人在画面外，但这段路是真的。
 */
export function tallyInto(use: Record<Bucket, number>, act: ActState | null, moving: boolean, from: SimTime, to: SimTime, params: RuleParams): void {
  const dt = to - from;
  if (dt <= 0) return;
  if (moving) {
    use.travel += dt;
    return;
  }
  if (!act) {
    use.other += dt;
    return;
  }
  const bucket = ACT_BUCKET[act.kind];
  if (!act.away) {
    use[bucket] += dt;
    return;
  }
  const c = Math.floor(Math.min(params.awayCommute, (act.t1 - act.t0) / 2));
  const travel = overlap(from, to, act.t0, act.t0 + c) + overlap(from, to, act.t1 - c, act.t1);
  use.travel += travel;
  use[bucket] += dt - travel;
}

/** 久不见面的淡化：家人与伴侣不淡 */
export function closenessAt(tie: TieState, t: SimTime, params: RuleParams): number {
  if (tie.kind === 'family' || tie.kind === 'partner' || tie.lastMet < 0) return tie.closeness;
  return tie.closeness * Math.pow(0.5, (t - tie.lastMet) / DAY / params.tieHalfLife);
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function weatherOf(seed: number, day: number, rnd: (seed: number, ...key: Array<string | number>) => number): Weather {
  const u = rnd(seed, 'weather', day);
  return u < 0.16 ? 'rain' : u < 0.46 ? 'cloud' : 'sun';
}

/** 期初状态：所有人在家；需求取夜里的典型值 */
export function initialState(def: CommunityDef, params: RuleParams, seed: number, rnd: (seed: number, ...key: Array<string | number>) => number): WorldState {
  const state: WorldState = { t: 0, day: 1, weather: weatherOf(seed, 1, rnd), people: {}, households: {}, stock: {}, accounts: { [EXT]: 0 }, ties: {}, co: {}, occupied: {}, here: {} };
  for (const pl of def.map.places) {
    state.occupied[pl.id] = {};
    state.here[pl.id] = [];
  }
  for (const p of def.people) {
    const j = (k: string) => (rnd(seed, 'init', p.id, k) - 0.5) * 0.16;
    state.people[p.id] = {
      id: p.id,
      loc: { k: 'in', place: p.home },
      act: null,
      needs: { v: [clamp01(0.56 + j('h')), clamp01(0.42 + j('e')), clamp01(0.6 + j('s')), clamp01(0.6 + j('f'))], t: 0, rate: params.rates.wait },
      done: {},
      choiceN: 0,
      avoid: {},
      hobbyToday: {},
      today: emptyTally(),
      tallyT: 0,
      workedDays: 0,
      lastWorkDay: 0,
      carrying: false,
      heard: {},
    };
    state.here[p.home]!.push(p.id);
    state.accounts[p.id] = p.cash;
  }
  for (const h of def.households) {
    state.households[h.id] = { food: h.food, supplies: h.supplies };
    state.accounts[householdAccount(h.id)] = h.cash;
  }
  for (const f of def.firms) {
    state.accounts[f.id] = f.cash;
    state.stock[f.id] = Object.fromEntries(f.offers.map((o) => [o.item, o.stock]));
  }
  for (const t of def.ties) state.ties[tieKey(t.a, t.b)] = { kind: t.kind, closeness: t.closeness, trust: t.trust, lastMet: -1, meets: 0 };
  return state;
}

const EARNED = new Set(['wage', 'pension', 'allowance', 'profit']);
const SPENT = new Set(['purchase', 'lunch']);

function leave(state: WorldState, place: string, id: string): void {
  const list = state.here[place];
  if (!list) return;
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
}

export function reduce(state: WorldState, e: DomainEvent, ctx: ReduceCtx): void {
  state.t = e.t;
  const person = (id: string): PersonState => {
    const p = state.people[id];
    if (!p) throw new Error(`事件引用了不存在的人: ${id}`);
    return p;
  };
  switch (e.type) {
    case 'run_started':
      break;

    case 'day_started': {
      state.day = e.day;
      state.weather = e.weather;
      const keep = `${e.day - 1}:`;
      const today = `${e.day}:`;
      for (const id in state.people) {
        const p = state.people[id]!;
        p.hobbyToday = {};
        for (const k in p.done) if (!k.startsWith(keep) && !k.startsWith(today)) delete p.done[k];
        for (const k in p.avoid) if (p.avoid[k]! <= e.t) delete p.avoid[k];
      }
      break;
    }

    case 'move_started': {
      const p = person(e.agent);
      settle(p.needs, e.t);
      p.needs.rate = ctx.params.rates.move;
      leave(state, e.move.from, e.agent);
      p.loc = { k: 'move', move: e.move };
      p.tallyT = e.t;
      break;
    }

    case 'arrived': {
      const p = person(e.agent);
      settle(p.needs, e.t);
      p.needs.rate = ctx.params.rates.wait;
      tallyInto(p.today.use, null, true, p.tallyT, e.t, ctx.params);
      p.tallyT = e.t;
      p.loc = { k: 'in', place: e.place };
      state.here[e.place]!.push(e.agent);
      break;
    }

    case 'act_started': {
      const p = person(e.agent);
      settle(p.needs, e.t);
      p.needs.rate = ratesFor(e.act, ctx.params);
      p.act = { ...e.act };
      p.tallyT = e.t;
      p.carrying = false;
      if (e.act.anchor >= 0) state.occupied[e.act.place]![e.act.anchor] = e.agent;
      if (e.act.commit) p.done[e.act.commit] = 1;
      const key = e.act.kind === 'hobby' ? e.act.hobby : e.act.kind === 'chores' || e.act.kind === 'wash' ? e.act.kind : undefined;
      if (key) p.hobbyToday[key] = (p.hobbyToday[key] ?? 0) + 1;
      if (e.act.kind === 'work' && p.lastWorkDay !== state.day) {
        p.lastWorkDay = state.day;
        p.workedDays += 1;
      }
      break;
    }

    case 'act_ended': {
      const p = person(e.agent);
      const act = p.act;
      if (!act || act.id !== e.actId) throw new Error(`活动对不上: ${e.agent} ${e.actId}`);
      settle(p.needs, e.t);
      p.needs.rate = ctx.params.rates.wait;
      tallyInto(p.today.use, act, false, p.tallyT, e.t, ctx.params);
      p.tallyT = e.t;
      if (act.anchor >= 0) delete state.occupied[act.place]![act.anchor];
      if (act.kind === 'shop') p.carrying = true;
      p.act = null;
      break;
    }

    case 'decision':
      person(e.agent).choiceN = e.n + 1;
      break;

    case 'commit_missed':
      person(e.agent).done[e.commit] = 2;
      break;

    case 'plan_failed':
      person(e.agent).avoid[e.place] = e.t + HOUR;
      break;

    case 'transfer': {
      state.accounts[e.from] = round2((state.accounts[e.from] ?? 0) - e.amount);
      state.accounts[e.to] = round2((state.accounts[e.to] ?? 0) + e.amount);
      const from = state.people[e.from];
      const to = state.people[e.to];
      if (from && SPENT.has(e.kind)) from.today.spent = round2(from.today.spent + e.amount);
      if (to && EARNED.has(e.kind)) to.today.earned = round2(to.today.earned + e.amount);
      if (to && e.kind === 'wage') to.workedDays = 0;
      break;
    }

    case 'stock': {
      if (e.holder.startsWith('hh:')) {
        const h = state.households[e.holder.slice(3)]!;
        if (e.item === 'food') h.food = round2(h.food + e.delta);
        else h.supplies = round2(h.supplies + e.delta);
      } else {
        const s = (state.stock[e.holder] ??= {});
        s[e.item] = round2((s[e.item] ?? 0) + e.delta);
      }
      break;
    }

    case 'chat': {
      for (const id of [e.a, e.b]) {
        const p = person(id);
        settle(p.needs, e.t);
        p.needs.v[2] = clamp01(p.needs.v[2] + ctx.params.chatSocial);
        p.today.chats += 1;
        if (p.act) p.act.chatted = true;
      }
      const key = tieKey(e.a, e.b);
      const tie = state.ties[key];
      if (tie) {
        tie.closeness = Math.min(0.98, round4(closenessAt(tie, e.t, ctx.params) + e.d));
        tie.meets += 1;
        tie.lastMet = e.t;
      } else state.co[key] = (state.co[key] ?? 0) + 1;
      break;
    }

    case 'tie_formed': {
      const key = tieKey(e.a, e.b);
      state.ties[key] = { kind: e.kind, closeness: 0.2, trust: 0.5, lastMet: e.t, meets: state.co[key] ?? 1 };
      delete state.co[key];
      break;
    }

    case 'tie_changed':
      state.ties[tieKey(e.a, e.b)]!.kind = e.to;
      break;

    case 'intervention':
      break;

    case 'laid_off':
      person(e.agent).laidOff = true;
      break;

    case 'heard':
      person(e.agent).heard[e.topic] = e.t;
      break;

    case 'day_summary': {
      const p = person(e.agent);
      p.today = emptyTally();
      p.tallyT = e.t;
      break;
    }
  }
}

const round4 = (x: number): number => Math.round(x * 10000) / 10000;
