import { contentHash } from '../core/hash.ts';
import { MinHeap, type Keyed } from '../core/pq.ts';
import { rand, type RngKey } from '../core/rng.ts';
import { DAY, dayOf, dayStart, hm, MIN, timeOfDay, type SimTime } from '../core/time.ts';
import { GOODS_LABEL, HOBBIES, SHIFTS } from '../data/tables.ts';
import { EXT, householdAccount, type CommunityDef, type FirmDef, type HouseholdDef, type OfferDef, type PersonDef, type PlaceDef } from '../model/def.ts';
import type { Intervention } from '../model/intervention.ts';
import type { DomainEvent, EventBody, TransferKind } from '../model/events.ts';
import type { ActState, Intent, PersonState, WorldState } from '../model/state.ts';
import { DEFAULT_PARAMS, PARAMS_VERSION, POLICY_VERSION, SOCIAL_RULES_VERSION, type RuleParams } from '../params.ts';
import { initialState, moodOf, needsAt, reduce, tallyInto, weatherOf } from '../reduce.ts';
import { budgetOf } from '../systems/budget.ts';
import { choose, type Deadline } from '../systems/choose.ts';
import { commitsFor, habitWake, type Commit, type CommitCtx } from '../systems/commits.ts';
import { payroll, pensions, restock, weekly } from '../systems/economy.ts';
import { applyIntervention } from '../systems/interventions.ts';
import { pantryLines, Rules } from '../systems/rules.ts';
import { maybeChat } from '../systems/social.ts';
import { interiorOf, type AnchorKind } from '../world/interiors.ts';
import { WorldMap } from '../world/map.ts';

export interface EngineOptions {
  seed: number;
  /** 覆盖默认参数（实验用）；只做一层合并，rates 与 needWeight 再合并一层 */
  params?: Partial<RuleParams>;
  /** 干预（D88）：对规则的补丁；不给就是基线 */
  interventions?: Intervention[];
  /** 从第一个事件起就要收到的监听者（开局的事件在 create 里就发出了） */
  onEvent?: (e: DomainEvent) => void;
}

type TaskBody =
  | { k: 'midnight'; day: number }
  | { k: 'econ'; what: 'restock' | 'weekly' | 'payroll' | 'pension' }
  | { k: 'iv'; index: number; phase: 'start' | 'end' }
  | { k: 'end'; agent: string; actId: string }
  | { k: 'arrive'; agent: string; moveId: string };
type Task = Keyed & TaskBody;

const PRIO: Record<TaskBody['k'], number> = { midnight: 0, iv: 1, econ: 2, end: 3, arrive: 4 };

export interface EngineSnapshot {
  seed: number;
  params: RuleParams;
  interventions: Intervention[];
  now: SimTime;
  seq: number;
  taskSeq: number;
  actSeq: number;
  tasks: Task[];
  state: WorldState;
}

export function mergeParams(over?: Partial<RuleParams>): RuleParams {
  if (!over) return DEFAULT_PARAMS;
  return { ...DEFAULT_PARAMS, ...over, rates: { ...DEFAULT_PARAMS.rates, ...over.rates }, needWeight: { ...DEFAULT_PARAMS.needWeight, ...over.needWeight } };
}

/** 需要有店员在才能做买卖的地点 */
const SERVICE = new Set<PlaceDef['kind']>(['market', 'grocery', 'eatery', 'teahouse', 'clinic']);

/**
 * 引擎：离散事件。核心只管时钟、任务队列与发事件；
 * 人的行为是“做完一件选下一件”（D64）：先看有没有固定安排到点，没有就按效用选。
 */
export class Engine {
  readonly def: CommunityDef;
  readonly map: WorldMap;
  readonly seed: number;
  readonly params: RuleParams;
  readonly P: Record<string, PersonDef>;
  readonly H: Record<string, HouseholdDef>;
  readonly F: Record<string, FirmDef>;
  readonly rules: Rules;
  state: WorldState;
  now: SimTime;

  private heap = new MinHeap<Task>();
  private seq = 0;
  private taskSeq = 0;
  private actSeq = 0;
  private listeners: Array<(e: DomainEvent) => void> = [];
  private commitCache = new Map<string, Commit[]>();
  private readonly commitCtx: CommitCtx;
  private depth = 0;

  private constructor(def: CommunityDef, seed: number, params: RuleParams, interventions: Intervention[], state: WorldState, now: SimTime) {
    this.def = def;
    this.rules = new Rules(def, interventions);
    this.seed = seed;
    this.params = params;
    this.map = new WorldMap(def.map);
    this.P = Object.fromEntries(def.people.map((p) => [p.id, p]));
    this.H = Object.fromEntries(def.households.map((h) => [h.id, h]));
    this.F = Object.fromEntries(def.firms.map((f) => [f.id, f]));
    this.state = state;
    this.now = now;
    this.commitCtx = { seed, params, map: this.map, P: this.P, H: this.H, idle: (p, day) => !!this.state.people[p.id]?.laidOff || (!!p.job && this.rules.closed(p.job.place, day)) };
  }

  static create(def: CommunityDef, opts: EngineOptions): Engine {
    const params = mergeParams(opts.params);
    const e = new Engine(def, opts.seed, params, opts.interventions ?? [], initialState(def, params, opts.seed, rand), 0);
    if (opts.onEvent) e.listeners.push(opts.onEvent);
    e.boot();
    return e;
  }

  static restore(def: CommunityDef, snap: EngineSnapshot): Engine {
    const e = new Engine(def, snap.seed, snap.params, snap.interventions, structuredClone(snap.state), snap.now);
    e.seq = snap.seq;
    e.taskSeq = snap.taskSeq;
    e.actSeq = snap.actSeq;
    e.heap = MinHeap.from(snap.tasks.map((t) => ({ ...t })));
    return e;
  }

  snapshot(): EngineSnapshot {
    return { seed: this.seed, params: this.params, interventions: this.rules.list, now: this.now, seq: this.seq, taskSeq: this.taskSeq, actSeq: this.actSeq, tasks: this.heap.toArray().map((t) => ({ ...t })), state: structuredClone(this.state) };
  }

  stateHash(): string {
    return contentHash(this.state);
  }

  onEvent(fn: (e: DomainEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  /** 计数器式随机数，键要说明用途 */
  rand(...key: RngKey): number {
    return rand(this.seed, ...key);
  }

  // ───────────────────────── 时钟

  private boot(): void {
    this.emit({ type: 'run_started', community: this.def.id, seed: this.seed, versions: { params: PARAMS_VERSION, policy: POLICY_VERSION, social: SOCIAL_RULES_VERSION } });
    this.emit({ type: 'day_started', day: 1, weather: this.rules.weather(1) ?? this.state.weather });
    this.rules.list.forEach((iv, index) => {
      const from = 'day' in iv ? iv.day : iv.from;
      // 一次性的干预在当天上午九点发生；有起止的在当天零点生效
      this.schedule(dayStart(from) + ('day' in iv ? hm(9) : 0), { k: 'iv', index, phase: 'start' });
      if ('from' in iv && iv.to !== undefined) this.schedule(dayStart(iv.to + 1), { k: 'iv', index, phase: 'end' });
    });
    for (const p of this.def.people) this.begin(p, this.state.people[p.id]!, this.sleepIntent(p, 0));
    this.schedule(DAY, { k: 'midnight', day: 2 });
    this.schedule(hm(3, 30), { k: 'econ', what: 'restock' });
    this.schedule(hm(9, 0), { k: 'econ', what: 'weekly' });
    this.schedule(dayStart(5) + hm(18, 5), { k: 'econ', what: 'payroll' });
    this.schedule(dayStart(5) + hm(9, 0), { k: 'econ', what: 'pension' });
  }

  schedule(t: SimTime, body: TaskBody): void {
    this.heap.push({ t, prio: PRIO[body.k], seq: this.taskSeq++, ...body });
  }

  emit(body: EventBody): DomainEvent {
    const e = { ...body, seq: this.seq++, t: this.now } as DomainEvent;
    reduce(this.state, e, this);
    for (const fn of this.listeners) fn(e);
    return e;
  }

  /** 推进到 until（含）；返回处理的任务数 */
  advance(until: SimTime): number {
    let n = 0;
    for (let top = this.heap.peek(); top && top.t <= until; top = this.heap.peek()) {
      this.heap.pop();
      this.now = top.t;
      this.handle(top);
      n++;
    }
    this.now = until;
    return n;
  }

  private handle(t: Task): void {
    this.depth = 0;
    switch (t.k) {
      case 'midnight':
        return this.midnight(t.day);
      case 'econ':
        return this.econ(t.what);
      case 'iv':
        return applyIntervention(this, t.index, t.phase);
      case 'end':
        return this.onEnd(t.agent, t.actId);
      case 'arrive':
        return this.onArrive(t.agent, t.moveId);
    }
  }

  private midnight(day: number): void {
    const t = this.now;
    for (const p of this.def.people) {
      const ps = this.state.people[p.id]!;
      const use = { ...ps.today.use };
      tallyInto(use, ps.act, ps.loc.k === 'move', ps.tallyT, t, this.params);
      const n = needsAt(ps.needs, t);
      const mood = moodOf(n, ps.today.chats, budgetOf(this, p, day - 1).stress);
      this.emit({ type: 'day_summary', agent: p.id, day: day - 1, use, spent: ps.today.spent, earned: ps.today.earned, chats: ps.today.chats, mood, needs: n.map((x) => Math.round(x * 1000) / 1000) as [number, number, number, number] });
    }
    this.emit({ type: 'day_started', day, weather: this.rules.weather(day) ?? weatherOf(this.seed, day, rand) });
    for (const h of this.def.households) {
      const used = Math.min(this.state.households[h.id]!.supplies, h.members.length * this.params.suppliesDaily);
      if (used > 0) this.emit({ type: 'stock', holder: householdAccount(h.id), item: 'supplies', delta: -used, memo: '日常消耗' });
    }
    this.schedule(t + DAY, { k: 'midnight', day: day + 1 });
  }

  private econ(what: 'restock' | 'weekly' | 'payroll' | 'pension'): void {
    switch (what) {
      case 'restock':
        restock(this);
        return this.schedule(this.now + DAY, { k: 'econ', what });
      case 'weekly':
        weekly(this);
        return this.schedule(this.now + 7 * DAY, { k: 'econ', what });
      case 'payroll':
        payroll(this);
        return this.schedule(this.now + 7 * DAY, { k: 'econ', what });
      case 'pension':
        pensions(this);
        return this.schedule(this.now + 30 * DAY, { k: 'econ', what });
    }
  }

  // ───────────────────────── 查询（各系统共用）

  hh(p: PersonDef): HouseholdDef {
    return this.H[p.household]!;
  }

  balance(account: string): number {
    return this.state.accounts[account] ?? 0;
  }

  firmAt(place: string): FirmDef | undefined {
    const id = this.map.place(place).firm;
    return id ? this.F[id] : undefined;
  }

  /** 这家店今天卖的东西：固定的商品，加上干预开的伙食 */
  offersAt(place: string, day: number): OfferDef[] {
    const firm = this.firmAt(place);
    const extra = this.rules.canteenAt(place, day);
    if (!firm) return [];
    return extra && !firm.offers.some((o) => o.item === extra.item) ? [...firm.offers, extra] : firm.offers;
  }

  /** 现在的售价（含调价）；不卖返回 undefined */
  priceAt(place: string, item: string, t: SimTime = this.now): number | undefined {
    const day = dayOf(t);
    const offer = this.offersAt(place, day).find((o) => o.item === item);
    return offer ? Math.round(offer.price * this.rules.priceFactor(place, item, day) * 100) / 100 : undefined;
  }

  /** 现在能吃饭的地方：饭馆，加上开了伙的地点 */
  mealPlaces(t: SimTime): PlaceDef[] {
    const extra = this.rules.canteens(dayOf(t)).map((c) => this.map.place(c.place));
    return extra.length ? [...this.map.ofKind('eatery'), ...extra.filter((p) => p.kind !== 'eatery')] : this.map.ofKind('eatery');
  }

  /** 这户人家现在的存粮线（信了传言会更高） */
  pantry(hh: HouseholdDef, t: SimTime = this.now): { low: number; target: number } {
    return pantryLines(this.params, hh.members.map((m) => this.state.people[m]!), t);
  }

  /** 干预让固定安排变了：丢掉缓存（一个人不上班了，家里其他人的饭点安排也跟着变，所以全丢） */
  forgetCommits(): void {
    this.commitCache.clear();
  }

  has(p: PersonDef, item: string): boolean {
    return p.belongings.includes(item) || this.hh(p).belongings.includes(item);
  }

  /** 步行速度（米/秒）：老人与小孩慢一些 */
  private walkSpeed(p: PersonDef): number {
    return this.params.walkSpeed * (p.age >= 70 || p.age < 10 ? this.params.slowFactor : 1);
  }

  private rides(p: PersonDef, meters: number): boolean {
    return meters >= this.params.ebikeMin && p.belongings.includes('ebike');
  }

  /** 门到门的路程（米，按真实街区尺度） */
  meters(from: string, to: string): number {
    return this.map.meters(from, to) * this.params.streetScale;
  }

  /** 门到门要走多久（秒）；pace 是同行时约定的速度 */
  travelSec(p: PersonDef, from: string, to: string, pace?: number): number {
    if (from === to) return 0;
    const m = this.meters(from, to);
    const speed = pace ?? (this.rides(p, m) ? this.params.ebikeSpeed : this.walkSpeed(p));
    return Math.max(30, Math.round(m / speed));
  }

  /** 地点在 [t0, t1] 是否都开着 */
  openDuring(place: string, t0: SimTime, t1: SimTime): boolean {
    if (this.rules.closed(place, dayOf(t0))) return false;
    const h = this.map.place(place).hours;
    if (!h) return true;
    const a = timeOfDay(t0);
    return a >= h[0] && a + (t1 - t0) <= h[1];
  }

  /** 现在有没有店员在岗 */
  served(place: string): boolean {
    const pl = this.map.place(place);
    if (!SERVICE.has(pl.kind)) return true;
    const firm = pl.firm ? this.F[pl.firm] : undefined;
    if (!firm) return false;
    return firm.staff.some((id) => {
      const a = this.state.people[id]!.act;
      return !!a && a.kind === 'work' && a.place === place;
    });
  }

  countAt(place: string): number {
    return this.state.here[place]!.length;
  }

  commitsOf(p: PersonDef, day: number): Commit[] {
    const key = `${p.id}:${day}`;
    let hit = this.commitCache.get(key);
    if (!hit) {
      hit = commitsFor(this.commitCtx, p, day);
      this.commitCache.set(key, hit);
      if (this.commitCache.size > 4000) for (const k of this.commitCache.keys()) if (!k.endsWith(`:${day}`) && !k.endsWith(`:${day + 1}`)) this.commitCache.delete(k);
    }
    return hit;
  }

  /** 下一件还没处理的固定安排（今天或明天） */
  nextCommit(p: PersonDef, ps: PersonState, t: SimTime): Commit | undefined {
    const d = dayOf(t);
    for (const day of [d, d + 1]) for (const c of this.commitsOf(p, day)) if (c.end > t && !ps.done[c.id]) return c;
    return undefined;
  }

  /** 该起床的时刻：平时的起床时间，或者被当天第一件事催着早起（可能已经过了） */
  wakeDue(p: PersonDef, t: SimTime): SimTime {
    const morning = timeOfDay(t) < hm(12) ? dayOf(t) : dayOf(t) + 1;
    let wake = habitWake(this.seed, p, morning);
    const first = this.commitsOf(p, morning).find((c) => c.start > dayStart(morning) + hm(3));
    if (first) wake = Math.min(wake, first.start - this.travelSec(p, p.home, first.place, first.pace) - this.params.lead - this.params.morningPrep);
    return wake;
  }

  /** 这一觉睡到几点（至少睡一个小时） */
  wakeTime(p: PersonDef, t: SimTime): SimTime {
    return Math.max(this.wakeDue(p, t), t + 60 * MIN);
  }

  sleepIntent(p: PersonDef, t: SimTime): Intent {
    return { kind: 'sleep', dur: this.wakeTime(p, t) - t, label: '睡觉', anchors: ['bed'] };
  }

  // ───────────────────────── 行为

  private onEnd(agent: string, actId: string): void {
    const ps = this.state.people[agent]!;
    const act = ps.act;
    if (!act || act.id !== actId) return;
    this.emit({ type: 'act_ended', agent, actId, outcome: 'done' });
    const p = this.P[agent]!;
    if (act.kind === 'sleep') {
      const [a, b] = this.params.washMorning;
      return this.begin(p, ps, { kind: 'wash', dur: (a + Math.floor(this.rand('wash', agent, dayOf(this.now)) * (b - a + 1))) * MIN, label: '洗漱', anchors: ['free'] });
    }
    // 接着做的事（做完饭吃饭、洗漱完睡觉）
    if (act.next) return this.begin(p, ps, act.next);
    this.step(p, ps);
  }

  private onArrive(agent: string, moveId: string): void {
    const ps = this.state.people[agent]!;
    if (ps.loc.k !== 'move' || ps.loc.move.id !== moveId) return;
    const { to, intent } = ps.loc.move;
    this.emit({ type: 'arrived', agent, place: to });
    const p = this.P[agent]!;
    // 固定安排交给 step 重新核对时间；自由选择到了地方再核对一次还能不能做
    if (!intent || intent.commit) return this.step(p, ps);
    const why = this.cannot(p, ps, to, intent);
    if (why) {
      this.emit({ type: 'plan_failed', agent, place: to, label: intent.label, reason: why });
      return this.step(p, ps);
    }
    this.begin(p, ps, intent);
  }

  /** 到了地方发现做不成的原因；能做返回 undefined */
  private cannot(_p: PersonDef, _ps: PersonState, place: string, intent: Intent): string | undefined {
    if (this.rules.closed(place, dayOf(this.now))) return '停业了';
    if (!this.openDuring(place, this.now, this.now + Math.min(intent.dur, 10 * MIN))) return '已经关门了';
    const needsService = intent.kind === 'eat_out' || intent.kind === 'shop' || (intent.kind === 'hobby' && this.map.place(place).kind === 'teahouse');
    if (needsService && !this.served(place)) return '没有人看店';
    return undefined;
  }

  /** 做完一件事之后：先看固定安排，再自由选择 */
  step(p: PersonDef, ps: PersonState): void {
    if (ps.loc.k !== 'in' || ps.act) return;
    const t = this.now;
    const cur = ps.loc.place;
    if (++this.depth > 12) return this.begin(p, ps, { kind: 'wait', dur: 10 * MIN, label: '发呆', anchors: ['free'] });
    const c = this.nextCommit(p, ps, t);
    let deadline: Deadline | undefined;
    if (c) {
      if (t >= c.end - MIN) {
        this.emit({ type: 'commit_missed', agent: p.id, commit: c.id, label: c.label, reason: '没赶上' });
        return this.step(p, ps);
      }
      const travel = this.travelSec(p, cur, c.place, c.pace);
      const leaveAt = c.start - travel - (cur === c.place ? 0 : this.params.lead);
      const intent: Intent = { kind: c.kind, dur: c.end - t, until: c.end, label: c.label, anchors: c.anchors, commit: c.id, ...(c.away ? { away: true } : {}), ...(c.family ? { family: true } : {}) };
      if (t >= leaveAt - 30) {
        if (cur !== c.place) return this.go(p, ps, c.place, intent, c.pace);
        if (c.start - t >= 30) return this.begin(p, ps, { kind: 'wait', dur: c.start - t, label: `等着${c.label}`, anchors: ['free'] });
        return this.begin(p, ps, intent);
      }
      // 剩下的时间不够做别的：原地等到该出发
      if (leaveAt - t < 6 * MIN) return this.begin(p, ps, { kind: 'wait', dur: leaveAt - t, label: `准备${c.label}`, anchors: ['free'] });
      deadline = { at: c.start - this.params.lead, place: c.place, ...(c.pace ? { pace: c.pace } : {}), ...(c.family && c.kind === 'eat_home' ? { meal: true } : {}) };
    }
    const pick = choose(this, p, ps, t, deadline);
    if (!pick) {
      const dur = deadline ? Math.max(MIN, Math.min(15 * MIN, deadline.at - t)) : 15 * MIN;
      return this.begin(p, ps, { kind: 'wait', dur, label: '歇一会儿', anchors: ['free'] });
    }
    if (pick.place !== cur) return this.go(p, ps, pick.place, pick.intent);
    this.begin(p, ps, pick.intent);
  }

  private go(p: PersonDef, ps: PersonState, to: string, intent: Intent | undefined, pace?: number): void {
    if (ps.loc.k !== 'in') return;
    const from = ps.loc.place;
    const route = this.map.route(from, to);
    if (!route) {
      this.emit({ type: 'plan_failed', agent: p.id, place: to, label: intent?.label ?? '', reason: '走不到' });
      return this.step(p, ps);
    }
    const meters = this.meters(from, to);
    const t0 = this.now;
    const t1 = t0 + this.travelSec(p, from, to, pace);
    const id = `m${this.actSeq++}`;
    this.emit({ type: 'move_started', agent: p.id, move: { id, from, to, pts: route.pts, t0, t1, mode: !pace && this.rides(p, meters) ? 'ebike' : 'walk', ...(intent ? { intent } : {}) } });
    this.schedule(t1, { k: 'arrive', agent: p.id, moveId: id });
  }

  /** 找一个空站位：按种类的先后，再从偏好的序号起找 */
  private alloc(place: string, kinds: AnchorKind[], unit: number, prefer: number): number {
    const taken = this.state.occupied[place]!;
    const anchors = interiorOf(this.map.place(place)).anchors;
    for (const kind of kinds) {
      const list = anchors.filter((a) => a.kind === kind && a.unit === unit);
      for (let i = 0; i < list.length; i++) {
        const a = list[(i + prefer) % list.length]!;
        if (taken[a.id] === undefined) return a.id;
      }
    }
    return -1;
  }

  pay(from: string, to: string, amount: number, kind: TransferKind, memo: string): void {
    const a = Math.round(amount * 100) / 100;
    if (a > 0) this.emit({ type: 'transfer', from, to, amount: a, kind, memo });
  }

  /** 开始做一件事（人已经在地方了）。买东西、付钱、占站位都在这里。 */
  begin(p: PersonDef, ps: PersonState, intentIn: Intent): void {
    if (ps.loc.k !== 'in' || ps.act) return;
    const t = this.now;
    // 睡多久要按真正躺下的时刻算（前面可能先洗漱了）
    const intent = intentIn.kind === 'sleep' && !intentIn.commit ? { ...this.sleepIntent(p, t), ...(intentIn.next ? { next: intentIn.next } : {}) } : intentIn;
    const place = ps.loc.place;
    const dur = Math.round(intent.until ? intent.until - t : intent.dur);
    if (dur < 30) return this.step(p, ps);
    const hh = this.hh(p);
    const hhAcc = householdAccount(hh.id);
    const fail = (reason: string) => {
      if (intent.commit) this.emit({ type: 'commit_missed', agent: p.id, commit: intent.commit, label: intent.label, reason });
      else this.emit({ type: 'plan_failed', agent: p.id, place, label: intent.label, reason });
      this.step(p, ps);
    };

    switch (intent.kind) {
      case 'eat_home':
      case 'eat_work': {
        if (this.state.households[hh.id]!.food < 1) return fail('家里没有吃的了');
        this.emit({ type: 'stock', holder: hhAcc, item: 'food', delta: -1, memo: `${p.name}吃了一份` });
        break;
      }
      case 'eat_out': {
        const firm = this.firmAt(place);
        const price = this.priceAt(place, 'meal');
        if (!firm || price === undefined) return fail('这里不卖饭');
        if ((this.state.stock[firm.id]?.meal ?? 0) < 1) return fail('卖完了');
        if (this.balance(p.id) < price) return fail('钱不够');
        this.emit({ type: 'stock', holder: firm.id, item: 'meal', delta: -1, memo: `卖给${p.name}` });
        this.pay(p.id, firm.id, price, 'purchase', `在${firm.name}吃饭`);
        break;
      }
      case 'shop': {
        const firm = this.firmAt(place);
        if (!firm) return fail('这里不卖东西');
        const n = hh.members.length;
        const home = this.state.households[hh.id]!;
        const lines = this.pantry(hh);
        let bought = 0;
        for (const [item, have, target] of [
          ['food', home.food, n * lines.target],
          ['supplies', home.supplies, n * this.params.suppliesTarget],
        ] as const) {
          const price = this.priceAt(place, item);
          if (price === undefined) continue;
          const qty = Math.min(Math.ceil(target - have), Math.floor(this.state.stock[firm.id]?.[item] ?? 0));
          if (qty <= 0) continue;
          this.emit({ type: 'stock', holder: firm.id, item, delta: -qty, memo: `卖给${hh.label}` });
          this.emit({ type: 'stock', holder: hhAcc, item, delta: qty, memo: `${p.name}在${firm.name}买的` });
          this.pay(hhAcc, firm.id, qty * price, 'purchase', `${GOODS_LABEL[item]} × ${qty}（${firm.name}）`);
          bought += qty;
        }
        if (bought === 0) return fail('没买到东西');
        break;
      }
      case 'hobby': {
        const h = intent.hobby ? HOBBIES[intent.hobby] : undefined;
        const base = h?.cost[this.map.place(place).kind] ?? 0;
        const firm = this.firmAt(place);
        if (base > 0 && firm) {
          const cost = Math.round(base * (h?.item ? this.rules.priceFactor(place, h.item, dayOf(t)) : 1) * 100) / 100;
          if (this.balance(p.id) < cost) return fail('钱不够');
          if (h?.item) this.emit({ type: 'stock', holder: firm.id, item: h.item, delta: -1, memo: `${p.name}的茶位` });
          this.pay(p.id, firm.id, cost, 'purchase', `在${firm.name}${h?.label ?? ''}`);
        }
        break;
      }
      case 'work':
        if (intent.away && intent.commit?.endsWith('work0') && this.balance(p.id) >= this.params.cityLunch) this.pay(p.id, EXT, this.params.cityLunch, 'lunch', '在城里吃午饭');
        break;
      case 'school':
        this.pay(hhAcc, EXT, this.params.schoolLunch, 'lunch', `${p.name}在学校的午饭`);
        break;
      default:
        break;
    }

    const unit = place === p.home ? p.unit : -1;
    const anchor = intent.away ? -1 : this.alloc(place, intent.anchors, unit, intent.kind === 'sleep' || intent.kind === 'eat_home' ? p.slot : Math.floor(this.rand('anchor', p.id, this.actSeq) * 97));
    const act: ActState = {
      id: `a${this.actSeq++}`,
      kind: intent.kind,
      place,
      unit,
      anchor,
      t0: t,
      t1: t + dur,
      label: intent.label,
      ...(intent.hobby ? { hobby: intent.hobby } : {}),
      ...(intent.commit ? { commit: intent.commit } : {}),
      ...(intent.away ? { away: true } : {}),
      ...(intent.family ? { family: true } : {}),
      ...(intent.next ? { next: intent.next } : {}),
    };
    this.emit({ type: 'act_started', agent: p.id, act });
    this.schedule(act.t1, { k: 'end', agent: p.id, actId: act.id });
    maybeChat(this, p, ps);
  }

  /** 班次是否离开社区（给外部查询用） */
  static awayShift(p: PersonDef): boolean {
    return !!p.job && !!SHIFTS[p.job.shift]!.away;
  }
}
