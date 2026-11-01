import { rand, r3, weightedIndex, rngKeyString } from '../core/rng.ts';
import { MinHeap, type Keyed } from '../core/pq.ts';
import { at, clock, dayOf, dayStart, HOUR, isWeekend, MIN, overlap, timeOfDay, weekday, type SimTime } from '../core/time.ts';
import { SECONDS_PER_TILE, TownMap, isOpenAt, type Tile } from '../world/map.ts';
import type { ScenarioDef, ScriptEvent } from '../scenario/types.ts';
import type { OutageTruth } from '../scenario/events.ts';
import { buildInitialState, buildMap } from '../scenario/build.ts';
import { CHANNEL_LABEL, makeVersion, transmitSlots, versionIdFor } from '../info/claims.ts';
import { comprehend, credibility, mergeBelief } from '../info/belief.ts';
import { describeSlots, slotNames, windowInterval } from '../info/slots.ts';
import type { Channel, ClaimVersion, Fragment, NewsDraft, NewsItem, Slots } from '../info/types.ts';
import { applyEvent, findItemAny } from '../state/reducer.ts';
import type { DecisionKind, DomainEvent, EventBody, Exchange } from '../state/events.ts';
import type { ActKind, Agent, PlanItem, WorldState } from '../state/types.ts';
import { makeDayPlan, openSpaceNear, wakeTime } from '../life/plans.ts';
import { falseAlarmVerdict, trustVerdict } from '../mind/social.ts';
import { areaMatches, atRiskItems, attentionOf, chatOf, districtOf, fatigueOf, mentionOf, relationBetween, relevanceOf } from '../mind/assess.ts';
import { buildNotify, buildReaction, POLICY_VERSION, scoreNotify, scoreReaction } from '../mind/reaction.ts';
import type { Candidate, DecisionRecord, DecisionRequest, SemanticAnswer } from '../mind/types.ts';
import { isDefaultPatch, resolveParams, type ParamPatch, type RuleParams } from '../params.ts';

export type DecisionMode = 'rule' | 'external';

export interface EngineOptions {
  seed: number;
  decisionMode: DecisionMode;
  /** 场景脚本（实验分支可替换渠道、加澄清） */
  script?: ScriptEvent[];
  thinkTime?: { reaction: number; notify: number };
  /** 规则参数覆盖（空 = 默认参数）；随快照保存 */
  params?: ParamPatch;
}

type TaskBody =
  | { k: 'item'; a: string; itemId: string }
  | { k: 'arrive'; a: string; walkId: string }
  | { k: 'act_end'; a: string; actId: string }
  | { k: 'board'; a: string; walkId?: string; board: string; tile: Tile }
  | { k: 'phone'; a: string; slot: 'wake' | 'lunch' | 'evening' | 'extra' }
  | { k: 'social'; a: string; itemId: string }
  | { k: 'commit'; id: string }
  | { k: 'script'; ev: ScriptEvent }
  | { k: 'midnight' }
  | { k: 'settle' };
type Task = Keyed & TaskBody;

const PRIO: Record<TaskBody['k'], number> = { script: 0, midnight: 0, commit: 1, act_end: 2, arrive: 3, board: 3, item: 4, social: 5, phone: 6, settle: 7 };

export interface EngineSnapshot {
  v: 1;
  seed: number;
  decisionMode: DecisionMode;
  now: SimTime;
  state: WorldState;
  tasks: Task[];
  tseq: number;
  requests: Record<string, DecisionRequest>;
  priv: EnginePrivate;
  script: ScriptEvent[];
  params?: ParamPatch;
}

interface EnginePrivate {
  talkLog: Record<string, SimTime>;
  reactCount: Record<string, number>;
  verified: Record<string, number>;
  dirty: Record<string, boolean>;
  powerOffUntil: Record<string, SimTime>;
  /** 区域 → 正在进行的停电事件 id */
  activeOutage: Record<string, string>;
}

export interface AdvanceResult {
  t: SimTime;
  blockedOn?: string;
}

const HOMEISH: ActKind[] = ['home', 'care', 'nap', 'sleep'];

export class Engine {
  readonly scenario: ScenarioDef;
  readonly map: TownMap;
  readonly seed: number;
  readonly mode: DecisionMode;
  /** 规则参数：覆盖（用于记录）与合并后的完整值 */
  readonly paramPatch: ParamPatch | undefined;
  readonly P: RuleParams;
  state: WorldState;
  now: SimTime;
  private q = new MinHeap<Task>();
  private tseq = 0;
  private requests: Record<string, DecisionRequest> = {};
  private priv: EnginePrivate = { talkLog: {}, reactCount: {}, verified: {}, dirty: {}, powerOffUntil: {}, activeOutage: {} };
  private script: ScriptEvent[];
  private think: { reaction: number; notify: number };
  private eventListeners: Array<(e: DomainEvent) => void> = [];
  private recordListeners: Array<(r: DecisionRecord) => void> = [];
  /** 还没有监听者时产生的事件（例如启动时的初始计划），交给第一个订阅者，保证事件日志从 seq 1 起完整 */
  private unclaimed: DomainEvent[] = [];
  private unclaimedRecords: DecisionRecord[] = [];

  private constructor(scenario: ScenarioDef, opts: EngineOptions, state: WorldState, now: SimTime) {
    this.scenario = scenario;
    this.map = buildMap(scenario);
    this.seed = opts.seed;
    this.mode = opts.decisionMode;
    this.paramPatch = isDefaultPatch(opts.params) ? undefined : structuredClone(opts.params);
    this.P = resolveParams(this.paramPatch);
    this.state = state;
    this.now = now;
    this.script = opts.script ?? scenario.script;
    this.think = opts.thinkTime ?? { reaction: 3 * MIN, notify: 2 * MIN };
  }

  // ---------- 生命周期 ----------

  static create(scenario: ScenarioDef, opts: EngineOptions): Engine {
    const state = buildInitialState(scenario, opts.seed);
    const e = new Engine(scenario, opts, state, scenario.start);
    e.boot();
    return e;
  }

  static restore(snap: EngineSnapshot, scenario: ScenarioDef, overrides: Partial<EngineOptions> = {}): Engine {
    const params = overrides.params ?? snap.params;
    const e = new Engine(scenario, { seed: snap.seed, decisionMode: overrides.decisionMode ?? snap.decisionMode, script: overrides.script ?? snap.script, ...(overrides.thinkTime ? { thinkTime: overrides.thinkTime } : {}), ...(params ? { params } : {}) }, structuredClone(snap.state), snap.now);
    e.q = MinHeap.from(structuredClone(snap.tasks));
    e.tseq = snap.tseq;
    e.requests = structuredClone(snap.requests);
    e.priv = structuredClone(snap.priv);
    e.priv.activeOutage ??= {};
    if (overrides.script) e.replaceScript(overrides.script);
    return e;
  }

  snapshot(): EngineSnapshot {
    return {
      v: 1,
      seed: this.seed,
      decisionMode: this.mode,
      now: this.now,
      state: structuredClone(this.state),
      tasks: structuredClone(this.q.toArray()),
      tseq: this.tseq,
      requests: structuredClone(this.requests),
      priv: structuredClone(this.priv),
      script: structuredClone(this.script),
      ...(this.paramPatch ? { params: structuredClone(this.paramPatch) } : {}),
    };
  }

  onEvent(fn: (e: DomainEvent) => void): () => void {
    this.eventListeners.push(fn);
    if (this.unclaimed.length > 0) {
      const early = this.unclaimed;
      this.unclaimed = [];
      for (const e of early) fn(e);
    }
    return () => (this.eventListeners = this.eventListeners.filter((x) => x !== fn));
  }

  onRecord(fn: (r: DecisionRecord) => void): () => void {
    this.recordListeners.push(fn);
    if (this.unclaimedRecords.length > 0) {
      const early = this.unclaimedRecords;
      this.unclaimedRecords = [];
      for (const r of early) fn(r);
    }
    return () => (this.recordListeners = this.recordListeners.filter((x) => x !== fn));
  }

  /** 用新脚本替换尚未执行的脚本事件（分支注入干预） */
  replaceScript(script: ScriptEvent[]): void {
    this.q.removeWhere((t) => t.k === 'script');
    this.script = script;
    for (const ev of script) if (ev.at >= this.now) this.schedule(ev.at, { k: 'script', ev });
  }

  get scriptEvents(): readonly ScriptEvent[] {
    return this.script;
  }

  private boot(): void {
    const s = this.state;
    this.emit({ type: 'run_started', scenario: this.scenario.id, seed: this.seed });
    const d = dayOf(this.now);
    for (const a of Object.values(s.agents)) {
      this.emit({ type: 'plan_set', agent: a.id, day: d, items: makeDayPlan(this.ctx(), a, d), reason: 'daily' });
      this.emit({ type: 'plan_set', agent: a.id, day: d + 1, items: makeDayPlan(this.ctx(), a, d + 1), reason: 'daily' });
      const wake = Math.max(this.now + MIN, wakeTime(this.seed, a, d));
      this.emit({ type: 'activity_started', agent: a.id, act: { id: `ac0-${a.id}`, kind: 'sleep', place: a.home, startedAt: this.now, endsAt: wake, label: '睡觉', needsPower: false } });
      this.schedule(wake, { k: 'act_end', a: a.id, actId: `ac0-${a.id}` });
    }
    for (const ev of this.script) if (ev.at >= this.now) this.schedule(ev.at, { k: 'script', ev });
    this.schedule(dayStart(d + 1), { k: 'midnight' });
    this.schedule(at(d, 23, 50), { k: 'settle' });
  }

  private ctx() {
    return { seed: this.seed, map: this.map, state: this.state };
  }

  // ---------- 推进 ----------

  nextTaskTime(): SimTime | undefined {
    return this.q.peek()?.t;
  }

  /** 推进到 until；遇到答案未回的决策提交则停下（slow_world） */
  advance(until: SimTime): AdvanceResult {
    for (;;) {
      const top = this.q.peek();
      if (!top || top.t > until) {
        this.now = Math.max(this.now, until);
        return { t: this.now };
      }
      if (top.k === 'commit') {
        const req = this.requests[top.id];
        if (req && !req.answer) {
          this.now = Math.max(this.now, top.t);
          return { t: this.now, blockedOn: top.id };
        }
      }
      this.q.pop();
      this.now = top.t;
      this.handle(top);
    }
  }

  /** 待外部 provider 回答的请求 */
  pendingRequests(): DecisionRequest[] {
    return Object.values(this.requests).filter((r) => !r.answer);
  }

  getRequest(id: string): DecisionRequest | undefined {
    return this.requests[id];
  }

  resolve(id: string, answer: SemanticAnswer): void {
    const r = this.requests[id];
    if (r && !r.answer) r.answer = answer;
  }

  private schedule(t: SimTime, body: TaskBody): void {
    this.q.push({ ...body, t, prio: PRIO[body.k], seq: ++this.tseq } as Task);
  }

  private emit(body: EventBody, cause?: number): DomainEvent {
    const e = { ...body, seq: this.state.meta.seq + 1, t: this.now, ...(cause ? { cause } : {}) } as DomainEvent;
    applyEvent(this.state, e);
    if (this.eventListeners.length === 0) this.unclaimed.push(e);
    for (const fn of this.eventListeners) fn(e);
    return e;
  }

  /** 下一个事件的序号（用于生成确定性 id） */
  private nextSeq(): number {
    return this.state.meta.seq + 1;
  }

  private handle(t: Task): void {
    switch (t.k) {
      case 'item': {
        const a = this.agent(t.a);
        if (a.act || a.loc.k === 'walk') return;
        const it = findItemAny(a, t.itemId);
        if (it && it.status === 'planned') this.startItem(a, it);
        else this.proceed(a);
        return;
      }
      case 'arrive':
        return this.onArrive(t.a, t.walkId);
      case 'act_end':
        return this.onActEnd(t.a, t.actId);
      case 'board':
        return this.onBoard(t.a, t.board, t.tile, t.walkId);
      case 'phone':
        return this.phoneCheck(this.agent(t.a), t.slot);
      case 'social':
        return this.onSocial(t.a, t.itemId);
      case 'commit':
        return this.commit(t.id);
      case 'script':
        return this.runScript(t.ev);
      case 'midnight': {
        const d = dayOf(this.now);
        this.emit({ type: 'day_started', day: d });
        this.schedule(dayStart(d + 1), { k: 'midnight' });
        return;
      }
      case 'settle':
        return this.settle();
    }
  }

  private agent(id: string): Agent {
    const a = this.state.agents[id];
    if (!a) throw new Error(`未知居民 ${id}`);
    return a;
  }

  // ---------- 日程执行 ----------

  private nextItem(a: Agent): PlanItem | undefined {
    const d = dayOf(this.now);
    for (const day of [d - 1, d, d + 1]) {
      for (const it of a.plans[day] ?? []) if (it.status === 'planned' && it.end > this.now) return it;
    }
    return undefined;
  }

  private proceed(a: Agent): void {
    if (a.act || a.loc.k === 'walk') return;
    const it = this.nextItem(a);
    if (!it) {
      // 计划用尽：生成明天的计划后重试
      const d = dayOf(this.now) + 1;
      if (!a.plans[d]) this.emit({ type: 'plan_set', agent: a.id, day: d, items: makeDayPlan(this.ctx(), a, d), reason: 'daily' });
      this.schedule(this.now + 30 * MIN, { k: 'item', a: a.id, itemId: '' });
      return;
    }
    if (it.start > this.now) {
      this.schedule(it.start, { k: 'item', a: a.id, itemId: it.id });
      return;
    }
    this.startItem(a, it);
  }

  private startItem(a: Agent, it: PlanItem): void {
    if (it.end <= this.now + MIN) {
      this.emit({ type: 'item_status', agent: a.id, day: dayOf(it.start), itemId: it.id, status: 'cancelled', reason: '来不及了' });
      return this.proceed(a);
    }
    if (a.loc.k === 'in' && a.loc.place === it.place) return this.begin(a, it);
    this.walkTo(a, it.place, it.id);
  }

  private targetTile(a: Agent, placeId: string): Tile {
    const p = this.map.places[placeId]!;
    if (!p.open) return p.door;
    const slots = this.map.slots(placeId);
    const ids = Object.keys(this.state.agents);
    return slots[(ids.indexOf(a.id) * 7) % slots.length] ?? p.door;
  }

  private walkTo(a: Agent, toPlace: string, itemId?: string): void {
    const from = a.loc.k === 'in' ? a.loc.tile : a.loc.k === 'street' ? a.loc.tile : a.loc.walk.to;
    const to = this.targetTile(a, toPlace);
    const path = this.map.path(from, to) ?? [from, to];
    const dur = TownMap.walkSeconds(path);
    const walk = { id: `w${this.nextSeq()}`, from, to, toPlace, path, t0: this.now, t1: this.now + dur, ...(itemId ? { itemId } : {}) };
    this.emit({ type: 'walk_started', agent: a.id, walk });
    this.updatePhone(a);
    this.schedule(walk.t1, { k: 'arrive', a: a.id, walkId: walk.id });
    // 路过公告栏
    for (const b of Object.values(this.state.boards)) {
      if (b.posters.length === 0 || b.place === toPlace) continue;
      const i = path.findIndex((p) => Math.max(Math.abs(p.x - b.tile.x), Math.abs(p.y - b.tile.y)) <= 2);
      if (i >= 0 && i < path.length - 1) this.schedule(walk.t0 + i * SECONDS_PER_TILE, { k: 'board', a: a.id, walkId: walk.id, board: b.id, tile: path[i]! });
    }
  }

  private onArrive(id: string, walkId: string): void {
    const a = this.agent(id);
    if (a.loc.k !== 'walk' || a.loc.walk.id !== walkId) return;
    const w = a.loc.walk;
    this.emit({ type: 'arrived', agent: a.id, place: w.toPlace, tile: w.to });
    this.updatePhone(a);
    const board = Object.values(this.state.boards).find((b) => b.place === w.toPlace && b.posters.length > 0);
    if (board) this.schedule(this.now + MIN, { k: 'board', a: a.id, board: board.id, tile: w.to });
    const it = w.itemId ? findItemAny(a, w.itemId) : undefined;
    if (it && it.status === 'planned' && it.place === w.toPlace && it.end > this.now + MIN) this.begin(a, it);
    else this.proceed(a);
  }

  /** 开始一项活动：检查营业、停电、容量、钱与库存 */
  private begin(a: Agent, it: PlanItem): void {
    const p = this.map.places[it.place]!;
    const ps = this.state.places[it.place]!;
    const tod = timeOfDay(this.now);
    const isHome = it.place === a.home;
    const staff = !!a.workplace && a.workplace === it.place;
    const mode = ps.mode;
    const inWindow = mode.kind !== 'normal' && this.now >= mode.from && this.now < mode.to;
    let fail: string | undefined;
    if (!isHome && !p.open && !staff && !isOpenAt(p, tod)) fail = 'closed';
    else if (inWindow && mode.kind === 'closed_window' && !isHome) fail = 'closed_for_outage';
    else if (it.needsPower && !ps.powered && !(inWindow && mode.kind === 'cold_menu')) fail = 'no_power';
    else if (!isHome && ps.occupants.length > p.capacity) fail = 'full';
    let price = 0;
    if (!fail && it.purchase) {
      price = (this.state.prices[it.place]?.[it.purchase.item] ?? 0) * it.purchase.qty;
      const stock = this.state.stock[it.place]?.[it.purchase.item] ?? 0;
      if (stock < it.purchase.qty) fail = 'sold_out';
      else if ((this.state.accounts[a.wallet] ?? 0) < price) fail = 'no_money';
    }
    if (fail) return this.failItem(a, it, fail);

    const actId = `ac${this.nextSeq()}`;
    this.emit({ type: 'activity_started', agent: a.id, act: { id: actId, kind: it.kind, place: it.place, itemId: it.id, startedAt: this.now, endsAt: it.end, label: it.label, needsPower: it.needsPower } });
    if (it.purchase && price > 0) {
      const org = Object.values(this.state.orgs).find((o) => o.place === it.place);
      this.emit({ type: 'transfer', from: a.wallet, to: org?.account ?? 'ext:suppliers', amount: price, memo: `${this.itemName(it.purchase.item)}×${it.purchase.qty}`, agent: a.id });
      this.emit({ type: 'stock', holder: it.place, item: it.purchase.item, delta: -it.purchase.qty, memo: '售出', agent: a.id });
      const holder = it.purchase.for === 'household' ? a.householdId : it.purchase.item === 'power_bank' ? a.id : undefined;
      if (holder) this.emit({ type: 'stock', holder, item: it.purchase.item, delta: it.purchase.qty, memo: '购入', agent: a.id });
    }
    if (it.kind === 'breakfast' || it.kind === 'lunch' || it.kind === 'dinner') {
      if (isHome) {
        const food = this.state.stock[a.householdId]?.groceries ?? 0;
        if (food > 0) this.emit({ type: 'stock', holder: a.householdId, item: 'groceries', delta: -1, memo: '做饭', agent: a.id });
        this.emit({ type: 'meal', agent: a.id, source: 'home', place: it.place });
      } else this.emit({ type: 'meal', agent: a.id, source: it.purchase ? 'place' : 'bring', place: it.place });
    }
    this.schedule(it.end, { k: 'act_end', a: a.id, actId });
    if (it.social && it.end - this.now > 5 * MIN) this.schedule(this.now + 3 * MIN, { k: 'social', a: a.id, itemId: it.id });
    if (it.kind === 'lunch' && a.habits.website.includes('lunch')) this.schedule(this.now + 10 * MIN, { k: 'phone', a: a.id, slot: 'lunch' });
  }

  private itemName(item: string): string {
    return this.scenario.items.find((x) => x.id === item)?.name ?? item;
  }

  private onActEnd(id: string, actId: string): void {
    const a = this.agent(id);
    if (!a.act || a.act.id !== actId) return;
    const act = a.act;
    this.emit({ type: 'activity_ended', agent: a.id, actId, kind: act.kind, place: act.place, ...(act.itemId ? { itemId: act.itemId } : {}), outcome: 'done' });
    if (act.kind === 'sleep') this.onWake(a);
    this.proceed(a);
  }

  private onWake(a: Agent): void {
    this.emit({ type: 'woke', agent: a.id });
    this.updatePhone(a);
    const d = dayOf(this.now);
    if (!a.plans[d + 1]) this.emit({ type: 'plan_set', agent: a.id, day: d + 1, items: makeDayPlan(this.ctx(), a, d + 1), reason: 'daily' });
    // 看手机的时刻
    const j = (k: string, spread: number) => Math.round((rand(this.seed, 'phone', a.id, d, k) - 0.5) * 2 * spread) * MIN;
    this.schedule(this.now + 8 * MIN, { k: 'phone', a: a.id, slot: 'wake' });
    this.schedule(Math.max(this.now + HOUR, at(d, 20, 30) + j('eve', 40)), { k: 'phone', a: a.id, slot: 'evening' });
    const extra = a.habits.phone === 'high' ? [10.5, 13.5, 15.5, 17.5, 22] : a.habits.phone === 'mid' ? [11, 15, 18.5] : [16];
    for (const h of extra) {
      const tt = at(d, Math.floor(h), Math.round((h % 1) * 60)) + j(`x${h}`, 25);
      if (tt > this.now) this.schedule(tt, { k: 'phone', a: a.id, slot: 'extra' });
    }
  }

  /** 失败：记原因；若因停电则记"不便"；按规则给出替代安排 */
  private failItem(a: Agent, it: PlanItem, reason: string): void {
    const day = dayOf(it.start);
    this.emit({ type: 'item_status', agent: a.id, day, itemId: it.id, status: 'failed', reason: this.reasonLabel(reason) });
    if (reason === 'no_power' || reason === 'closed_for_outage') this.recordInconvenience(a, it, this.now, it.end, reason);
    // 按决定改的安排没能落地（没开门、满员、卖完、钱不够）：有意但受阻
    const fam = it.origin?.family;
    if (fam && it.origin?.decisionId && reason !== 'no_power' && reason !== 'closed_for_outage' && !a.funnel[fam]?.acted) {
      this.emit({ type: 'funnel_stop', agent: a.id, family: fam, stop: 'blocked', reason: `改了安排（${it.label}），但${this.reasonLabel(reason)}` });
    }
    this.fallback(a, it, this.now, reason);
  }

  private reasonLabel(r: string): string {
    return ({ closed: '没开门', closed_for_outage: '因停电暂停营业', no_power: '停电', full: '满员', sold_out: '卖完了', no_money: '钱不够' } as Record<string, string>)[r] ?? r;
  }

  private recordInconvenience(a: Agent, it: PlanItem, from: SimTime, to: SimTime, reason: string): void {
    const mode = this.state.places[it.place]?.mode;
    const d = districtOf(this.map, it.place) ?? 'north';
    const until = reason === 'closed_for_outage' && mode && mode.kind !== 'normal' ? mode.to : (this.priv.powerOffUntil[d] ?? from);
    const seconds = Math.max(0, Math.min(to, until) - from);
    const expected = this.expected(a, it.place);
    // 为停电提前关门：记到关门所依据的那条主张所在的一轮（即使那天那个区并没有停电）
    const byFamily = reason === 'closed_for_outage' && mode && mode.kind !== 'normal' && mode.family ? this.scenario.outages.find((o) => this.familiesOf(o).has(mode.family!))?.id : undefined;
    const outage = this.priv.activeOutage[d] ?? this.outageOn(d, dayOf(this.now))?.id ?? byFamily;
    // 恰好在断电那一刻结束的安排不算受影响（0 分钟的“不便”只会虚增人数）
    if (seconds < MIN) return;
    this.emit({ type: 'inconvenience', agent: a.id, itemId: it.id, kind: it.kind, place: it.place, seconds, expected, reason: expected ? `${this.reasonLabel(reason)}（事先知情）` : `${this.reasonLabel(reason)}（措手不及）`, ...(outage ? { outage } : {}) });
  }

  /** 某区某天的停电事件（世界真相） */
  private outageOn(area: string, day: number) {
    return this.scenario.outages.find((o) => o.area === area && o.day === day);
  }

  /** 此人当时是否相信这里此刻会停电 */
  private expected(a: Agent, place: string): boolean {
    for (const b of Object.values(a.beliefs)) {
      if (b.status !== 'believe' || b.slots.event !== 'power_outage') continue;
      if (b.slots.day && b.slots.day !== dayOf(this.now)) continue;
      if (!areaMatches(b.slots.area, districtOf(this.map, place))) continue;
      const [w0, w1] = windowInterval(b.slots.window);
      const tod = timeOfDay(this.now);
      if (tod >= w0 && tod < w1) return true;
    }
    return false;
  }

  /** 规则回退：停电时等电、换不用电的事、或去附近开放空间 */
  private fallback(a: Agent, it: PlanItem, from: SimTime, reason: string): void {
    const day = dayOf(it.start);
    const plan = [...(a.plans[day] ?? [])];
    const idx = plan.findIndex((x) => x.id === it.id);
    if (idx < 0) return this.proceed(a);
    const offUntil = this.priv.powerOffUntil[districtOf(this.map, it.place) ?? 'north'];
    const powerBack = offUntil && offUntil > from ? Math.min(offUntil, it.end) : undefined;
    const mk = (kind: ActKind, place: string, s: SimTime, e: SimTime, label: string, needsPower = false): PlanItem => ({
      id: `${it.id}-f${this.nextSeq()}-${kind}`,
      kind,
      place,
      start: s,
      end: e,
      punctual: false,
      flexible: true,
      needsPower,
      social: false,
      status: 'planned',
      label,
      origin: { reason: 'fallback', replaces: it.id },
    });
    const repl: PlanItem[] = [];
    const outageish = reason === 'no_power' || reason === 'closed_for_outage';
    if (it.origin?.reason === 'fallback' || it.kind === 'wait') {
      // 替代安排也失败了：回家（家里不设门槛，不会再失败）
      repl.push(mk('home', a.home, from, it.end, '回家待着'));
    } else if (outageish && (it.kind === 'work' || it.kind === 'wfh') && powerBack && powerBack < it.end) {
      repl.push(mk('wait', it.place, from, powerBack, '等来电'));
      repl.push({ ...mk(it.kind, it.place, powerBack, it.end, `${it.label}（来电后）`, true) });
    } else if (outageish && it.place === a.home) {
      if (it.kind === 'breakfast' || it.kind === 'lunch' || it.kind === 'dinner') repl.push(mk('home', a.home, from, it.end, '吃冷食'));
      else repl.push(mk('home', a.home, from, it.end, '停电在家干等'));
    } else if (it.kind === 'lunch' || it.kind === 'dinner' || it.kind === 'breakfast') {
      repl.push(mk('home', a.home, from, it.end, '回家随便对付一口'));
    } else if (it.end - from > 25 * MIN && (it.kind === 'leisure' || it.kind === 'shop' || it.kind === 'walk' || it.kind === 'work' || it.kind === 'study')) {
      const open = openSpaceNear(this.map, it.place, districtOf(this.map, it.place));
      if (open) repl.push(mk('walk', open.id, from, it.end, `只好去${open.short}转转`));
      else repl.push(mk('home', a.home, from, it.end, '回家待着'));
    } else repl.push(mk('home', a.home, from, it.end, '回家待着'));
    plan.splice(idx + 1, 0, ...repl.filter((x) => x.end - x.start >= 3 * MIN));
    plan.sort((x, y) => x.start - y.start);
    this.emit({ type: 'plan_set', agent: a.id, day, items: plan, reason: 'fallback', note: this.reasonLabel(reason) });
    this.proceed(a);
  }

  // ---------- 手机 ----------

  private phoneAt(a: Agent, t: SimTime): number {
    const ph = a.phone;
    const hrs = (t - ph.at) / HOUR;
    const bank = (this.state.stock[a.id]?.power_bank ?? 0) > 0;
    const rate = ph.charging ? 30 : ph.awake ? -ph.drain * (bank ? 0.2 : 1) : -1;
    return Math.max(0, Math.min(100, ph.battery + rate * hrs));
  }

  private updatePhone(a: Agent): void {
    const battery = r3(this.phoneAt(a, this.now));
    const awake = a.act?.kind !== 'sleep';
    let charging = false;
    if (a.loc.k === 'in') {
      const ps = this.state.places[a.loc.place];
      charging = !!ps?.powered && (a.loc.place === a.home || a.loc.place === a.workplace);
    }
    const ph = a.phone;
    if (ph.awake === awake && ph.charging === charging && Math.abs(ph.battery - battery) < 0.5) return;
    this.emit({ type: 'phone', agent: a.id, phone: { battery, at: this.now, charging, awake, drain: ph.drain } });
  }

  private phoneCheck(a: Agent, slot: 'wake' | 'lunch' | 'evening' | 'extra' | 'verify'): void {
    if (a.act?.kind === 'sleep') return;
    this.updatePhone(a);
    if (a.phone.battery <= 0.5) return;
    // reducer 用 filter 重新赋值，遍历旧数组是安全的
    for (const nid of a.pendingPush) {
      this.emit({ type: 'push_cleared', agent: a.id, news: nid });
      const n = this.state.news[nid];
      if (n) this.exposeNews(a, n, 'push');
    }
    for (const dmId of a.inbox) {
      const dm = this.state.dms[dmId];
      this.emit({ type: 'dm_read', agent: a.id, dm: dmId });
      if (dm) this.expose(a, { family: dm.familyId, channel: 'dm', fragment: 'text', versionId: dm.versionId, from: dm.from });
    }
    if (slot === 'verify' || (slot !== 'extra' && a.habits.website.includes(slot))) {
      for (const nid of [...this.state.website].reverse()) {
        const n = this.state.news[nid];
        if (!n) continue;
        const seen = a.seen[n.familyId];
        if (slot === 'verify' ? seen?.bodies.includes(nid) : seen?.headlines.includes(nid)) continue;
        this.exposeNews(a, n, 'website', slot === 'verify');
      }
    }
  }

  /** 查证：上镇网站重读该主张族最新的官方全文（澄清优先），即使以前读过 */
  private verifyNews(a: Agent, family: string): void {
    if (this.phoneAt(a, this.now) <= 0.5) return;
    const candidates = this.state.website.map((id) => this.state.news[id]).filter((n): n is NewsItem => !!n && n.familyId === family);
    if (candidates.length === 0) return;
    const latest = candidates.reduce((x, y) => (y.publishedAt > x.publishedAt || (y.publishedAt === x.publishedAt && !!y.correctionOf) ? y : x));
    this.expose(a, { family, channel: 'website', fragment: 'headline', versionId: latest.headline.versionId, news: latest.id, forceOpen: true, deferComprehension: true });
    this.expose(a, { family, channel: 'website', fragment: 'body', versionId: latest.body.versionId, news: latest.id, forceOpen: true });
  }

  // ---------- 信息：发布、曝光、理解、信念 ----------

  publish(draft: NewsDraft, channels: Channel[], by: 'script' | 'admin' | 'experiment'): NewsItem {
    const t = this.now;
    const vh = makeVersion({ familyId: draft.familyId, slots: draft.headline.slots, origin: { kind: draft.correctionOf ? 'correction' : 'publish', by: draft.publisher.id, channel: 'website' }, root: draft.id, mutations: [], t });
    const vb = makeVersion({ familyId: draft.familyId, slots: draft.body.slots, origin: { kind: draft.correctionOf ? 'correction' : 'publish', by: draft.publisher.id, channel: 'website' }, root: draft.id, mutations: [], t });
    if (!this.state.versions[vh.id]) this.emit({ type: 'version_created', version: vh });
    if (!this.state.versions[vb.id]) this.emit({ type: 'version_created', version: vb });
    const news: NewsItem = {
      id: draft.id,
      familyId: draft.familyId,
      headline: { text: draft.headline.text, versionId: vh.id },
      body: { text: draft.body.text, versionId: vb.id },
      publisher: draft.publisher,
      channels,
      publishedAt: t,
      ...(draft.correctionOf ? { correctionOf: draft.correctionOf } : {}),
      intervention: by === 'admin',
    };
    if (by === 'admin') this.emit({ type: 'intervention', by, note: `管理员发布新闻 ${draft.id}（${channels.join('/')}）`, payload: { newsId: draft.id, channels } });
    this.emit({ type: 'news_published', news });
    if (channels.includes('board')) {
      for (const b of Object.values(this.state.boards)) {
        this.emit({ type: 'board_posted', board: b.id, news: news.id });
        for (const id of this.state.places[b.place]?.occupants ?? []) {
          const a = this.agent(id);
          if (a.act && a.act.kind !== 'sleep') this.schedule(this.now + MIN, { k: 'board', a: id, board: b.id, tile: b.tile });
        }
      }
    }
    if (channels.includes('push')) {
      for (const a of Object.values(this.state.agents)) {
        if (!a.habits.push) continue;
        this.emit({ type: 'reached', agent: a.id, family: news.familyId, channel: 'push', news: news.id });
        const battery = this.phoneAt(a, this.now);
        if (a.act?.kind === 'sleep' || battery <= 0.5) this.emit({ type: 'push_pending', agent: a.id, news: news.id });
        else this.exposeNews(a, news, 'push');
      }
    }
    return news;
  }

  /** 新闻曝光：先标题，注意到了再看全文 */
  private exposeNews(a: Agent, n: NewsItem, channel: 'push' | 'website', forceOpen = false): void {
    const opened = this.expose(a, { family: n.familyId, channel, fragment: 'headline', versionId: n.headline.versionId, news: n.id, forceOpen, deferComprehension: true });
    if (opened) this.expose(a, { family: n.familyId, channel, fragment: 'body', versionId: n.body.versionId, news: n.id, forceOpen: true });
    else this.comprehendAndBelieve(a, { family: n.familyId, channel, fragment: 'headline', versionId: n.headline.versionId, opened: false, exposureId: `x${this.state.meta.seq}` });
  }

  private onBoard(id: string, boardId: string, tile: Tile, walkId?: string): void {
    const a = this.agent(id);
    const b = this.state.boards[boardId];
    if (!b || b.posters.length === 0) return;
    if (walkId && (a.loc.k !== 'walk' || a.loc.walk.id !== walkId)) return;
    if (!walkId && (a.loc.k !== 'in' || a.loc.place !== b.place || a.act?.kind === 'sleep')) return;
    for (const nid of [...b.posters].reverse()) {
      const n = this.state.news[nid];
      if (!n) continue;
      if (a.seen[n.familyId]?.bodies.includes(nid)) continue;
      const opened = this.expose(a, { family: n.familyId, channel: 'board', fragment: 'poster_title', versionId: n.headline.versionId, news: n.id, deferComprehension: true });
      if (!opened) {
        this.comprehendAndBelieve(a, { family: n.familyId, channel: 'board', fragment: 'poster_title', versionId: n.headline.versionId, opened: false, exposureId: `x${this.state.meta.seq}` });
        continue;
      }
      if (walkId && a.loc.k === 'walk') {
        // 驻足读海报：打断步行 2 分钟
        this.emit({ type: 'walk_stopped', agent: a.id, walkId, tile, reason: '驻足看公告' });
        const actId = `ac${this.nextSeq()}`;
        this.emit({ type: 'activity_started', agent: a.id, act: { id: actId, kind: 'read_board', place: b.place, startedAt: this.now, endsAt: this.now + 2 * MIN, label: '看公告', needsPower: false } });
        this.schedule(this.now + 2 * MIN, { k: 'act_end', a: a.id, actId });
      }
      this.expose(a, { family: n.familyId, channel: 'board', fragment: 'poster_full', versionId: n.body.versionId, news: n.id, forceOpen: true });
      break;
    }
  }

  /** 一次曝光：记录注意（同步规则）；除非延后，否则接着理解与更新信念。返回是否注意到 */
  private expose(a: Agent, x: { family: string; channel: Channel; fragment: Fragment; versionId: string; news?: string; from?: string; forceOpen?: boolean; deferComprehension?: boolean }): boolean {
    const v = this.state.versions[x.versionId];
    if (!v) return false;
    const seen = a.seen[x.family];
    const novelty = !seen ? 1 : x.news && !seen.headlines.includes(x.news) ? 0.6 : 0.2;
    const repeat = Math.min(1, (seen?.count ?? 0) / 4);
    const rel = relevanceOf(this.state, this.map, a, v.slots, this.now);
    const att = attentionOf({ a, channel: x.channel, relevance: rel.score, novelty, repeat, t: this.now }, this.P);
    const exposureId = `x${this.nextSeq()}`;
    const u = r3(rand(this.seed, 'att', a.id, x.family, x.channel, x.fragment, x.news ?? '', x.from ?? '', this.now));
    const opened = x.forceOpen ? true : u < att.p;
    this.emit({
      type: 'exposure',
      id: exposureId,
      agent: a.id,
      family: x.family,
      channel: x.channel,
      fragment: x.fragment,
      versionId: x.versionId,
      ...(x.news ? { news: x.news } : {}),
      ...(x.from ? { from: x.from } : {}),
      attention: { p: att.p, u, opened, factors: att.factors },
    });
    if (!x.deferComprehension) this.comprehendAndBelieve(a, { family: x.family, channel: x.channel, fragment: x.fragment, versionId: x.versionId, opened, exposureId, ...(x.from ? { from: x.from } : {}) });
    return opened;
  }

  private comprehendAndBelieve(a: Agent, x: { family: string; channel: Channel; fragment: Fragment; versionId: string; opened: boolean; exposureId: string; from?: string }): void {
    const v = this.state.versions[x.versionId];
    if (!v) return;
    const comp = comprehend({ seed: this.seed, agent: a.id, exposureId: x.exposureId, slots: v.slots, fragment: x.fragment, opened: x.opened, habits: a.habits, traits: a.traits, fatigue: fatigueOf(a, this.now) });
    this.emit({ type: 'comprehended', agent: a.id, exposureId: x.exposureId, family: x.family, heardVersionId: x.versionId, extracted: comp.extracted, missed: comp.missed, coarsened: comp.coarsened });
    if (comp.extracted.length === 0 || !comp.slots.event) {
      if (!a.beliefs[x.family]) {
        this.emit(
          x.opened
            ? { type: 'funnel_stop', agent: a.id, family: x.family, stop: 'not_understood', reason: '看了，但没弄明白说的是什么' }
            : { type: 'funnel_stop', agent: a.id, family: x.family, stop: 'ignored', reason: `${x.channel === 'board' ? '路过公告栏' : '扫到标题'}，没往心里去` },
        );
      }
      return;
    }
    const tie = x.from ? (a.trustIn[x.from] ?? relationBetween(this.state, a.id, x.from)?.trust) : undefined;
    const cred = credibility({ channel: x.channel, slots: comp.slots, trustGov: a.trustGov, ...(tie !== undefined ? { tieTrust: tie } : {}) }, this.P);
    const prev = a.beliefs[x.family];
    const { belief, changed } = mergeBelief(prev, { familyId: x.family, slots: comp.slots, versionId: x.versionId, t: this.now, source: { versionId: x.versionId, channel: x.channel, ...(x.from ? { from: x.from } : {}), t: this.now, root: v.root, credibility: cred } }, this.P);
    this.emit({ type: 'belief_set', agent: a.id, family: x.family, belief, ...(prev ? { prev: { status: prev.status, confidence: prev.confidence, versionId: prev.versionId } } : {}), exposureId: x.exposureId, reason: changed.length ? `更新了${slotNames(changed)}` : '再次听到，置信度调整' });
    if (belief.status === 'disbelieve') {
      this.emit({ type: 'funnel_stop', agent: a.id, family: x.family, stop: 'disbelieved', reason: `可信度 ${belief.confidence} 太低` });
      return;
    }
    const becameBelieve = belief.status === 'believe' && prev?.status !== 'believe';
    const keyChange = changed.some((k) => k === 'window' || k === 'area' || k === 'day');
    if (belief.status === 'believe' && (becameBelieve || keyChange)) {
      this.requestDecision(a, 'reaction', x.family, `${CHANNEL_LABEL[x.channel]}：${becameBelieve ? '开始相信' : `更新了${slotNames(changed)}`}`);
    }
    if (becameBelieve) this.requestDecision(a, 'notify', x.family, '开始相信，考虑告诉谁');
  }

  // ---------- 对话与私信 ----------

  private onSocial(id: string, itemId: string): void {
    const a = this.agent(id);
    if (!a.act || a.act.itemId !== itemId || a.loc.k !== 'in') return;
    const place = a.loc.place;
    const others = (this.state.places[place]?.occupants ?? []).filter((o) => o !== a.id).sort();
    for (const oid of others) {
      const b = this.agent(oid);
      if (!b.act || b.act.kind === 'sleep' || b.act.kind === 'read_board') continue;
      const rel = relationBetween(this.state, a.id, b.id);
      if (!rel) continue;
      const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if ((this.priv.talkLog[pair] ?? -Infinity) > this.now - 45 * MIN) continue;
      const pc = chatOf(a, rel.strength);
      if (rand(this.seed, 'chat', pair, this.now) >= pc) continue;
      this.priv.talkLog[pair] = this.now;
      this.converse(a, b, place, rel.strength);
    }
  }

  private converse(a: Agent, b: Agent, place: string, strength: number): void {
    const convSeq = this.nextSeq();
    const convId = `cv${convSeq}`;
    const exchanges: Exchange[] = [];
    // 先按对话开始时各自的信念算出“说出口的版本”，写进对话事件；之后再逐条落地
    const planned: Array<{ from: Agent; to: Agent; family: string; version: ClaimVersion }> = [];
    for (const [sp, li] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const [fam, bel] of Object.entries(sp.beliefs)) {
        if (bel.status === 'disbelieve') continue;
        const relL = relevanceOf(this.state, this.map, li, bel.slots, this.now).score;
        const told = (sp.told[fam] ?? []).includes(li.id);
        const personal = atRiskItems(this.map, sp, bel.slots, this.now).length > 0 ? 1 : 0;
        const m = mentionOf({ speaker: sp, listener: li, belief: bel, relevanceToListener: relL, strength, told, toldCount: (sp.told[fam] ?? []).length, personal, t: this.now }, this.P);
        const u = r3(rand(this.seed, 'mention', sp.id, li.id, fam, this.now));
        const mentioned = u < m.p;
        let versionId: string | undefined;
        if (mentioned) {
          const { slots, mutations } = transmitSlots({ seed: this.seed, speaker: sp.id, listener: li.id, familyId: fam, n: convSeq, slots: bel.slots, traits: sp.traits, medium: 'speech' }, this.P);
          const parent = this.state.versions[bel.versionId];
          const version = makeVersion({ familyId: fam, slots, origin: { kind: 'relay', by: sp.id, channel: 'talk' }, ...(parent ? { parentId: parent.id } : {}), root: parent?.root ?? fam, mutations, t: this.now });
          versionId = version.id;
          planned.push({ from: sp, to: li, family: fam, version });
        }
        exchanges.push({ from: sp.id, to: li.id, family: fam, mentioned, p: m.p, u, factors: m.factors, ...(versionId ? { versionId } : {}) });
      }
    }
    this.emit({ type: 'conversation', id: convId, place, participants: [a.id, b.id], exchanges, topic: planned.length > 0 ? 'news' : 'chat' });
    for (const x of planned) {
      if (!this.state.versions[x.version.id]) this.emit({ type: 'version_created', version: x.version });
      this.transmit(x.from, x.to, x.family, 'speech', { conv: convId, n: convSeq, versionId: x.version.id });
    }
  }

  /** 转述：生成（可能变形的）版本 → 转述边 → 听者曝光 */
  private transmit(sp: Agent, li: Agent, family: string, medium: 'speech' | 'text' | 'org', ref: { conv?: string; dm?: string; n: number; versionId?: string }): string | undefined {
    const bel = sp.beliefs[family];
    if (!bel) return undefined;
    const parent = this.state.versions[bel.versionId];
    let versionId = ref.versionId;
    if (!versionId) {
      const { slots, mutations } = transmitSlots({ seed: this.seed, speaker: sp.id, listener: li.id, familyId: family, n: ref.n, slots: bel.slots, traits: sp.traits, medium }, this.P);
      const vid = versionIdFor(family, slots);
      if (!this.state.versions[vid]) {
        const v = makeVersion({ familyId: family, slots, origin: { kind: 'relay', by: sp.id, channel: medium === 'speech' ? 'talk' : medium === 'text' ? 'dm' : 'org' }, ...(parent ? { parentId: parent.id } : {}), root: parent?.root ?? family, mutations, t: this.now });
        this.emit({ type: 'version_created', version: v });
      }
      versionId = vid;
    }
    const channel: Channel = medium === 'speech' ? 'talk' : medium === 'text' ? 'dm' : 'org';
    this.emit({ type: 'transmission', tr: { id: `tr${this.nextSeq()}`, familyId: family, from: sp.id, to: li.id, versionId, channel, t: this.now }, ...(ref.conv ? { conv: ref.conv } : {}), ...(ref.dm ? { dm: ref.dm } : {}) });
    if (medium !== 'text') this.expose(li, { family, channel, fragment: medium === 'speech' ? 'speech' : 'text', versionId, from: sp.id, forceOpen: medium === 'org' });
    return versionId;
  }

  private sendDm(sp: Agent, to: Agent, family: string, decisionId: string): void {
    const n = this.nextSeq();
    const bel = sp.beliefs[family];
    if (!bel) return;
    const { slots, mutations } = transmitSlots({ seed: this.seed, speaker: sp.id, listener: to.id, familyId: family, n, slots: bel.slots, traits: sp.traits, medium: 'text' }, this.P);
    const vid = versionIdFor(family, slots);
    const parent = this.state.versions[bel.versionId];
    if (!this.state.versions[vid]) this.emit({ type: 'version_created', version: makeVersion({ familyId: family, slots, origin: { kind: 'relay', by: sp.id, channel: 'dm' }, ...(parent ? { parentId: parent.id } : {}), root: parent?.root ?? family, mutations, t: this.now }) });
    const dmId = `dm${this.nextSeq()}`;
    this.emit({ type: 'dm_sent', dm: { id: dmId, from: sp.id, to: to.id, familyId: family, versionId: vid, sentAt: this.now, decisionId } });
    this.transmit(sp, to, family, 'text', { dm: dmId, n, versionId: vid });
    // 对方醒着且有电：马上看到
    if (to.act?.kind !== 'sleep' && this.phoneAt(to, this.now) > 0.5 && rand(this.seed, 'dmnow', dmId) < (to.habits.phone === 'high' ? 0.8 : to.habits.phone === 'mid' ? 0.5 : 0.25)) {
      this.schedule(this.now + 2 * MIN, { k: 'phone', a: to.id, slot: 'extra' });
    }
  }

  // ---------- 决策 ----------

  private requestDecision(a: Agent, kind: DecisionKind, family: string, reason: string): void {
    const pendingKey = `${a.id}:${kind}:${family}`;
    if (Object.values(this.requests).some((r) => r.agent === a.id && r.kind === kind && r.family === family)) {
      this.priv.dirty[pendingKey] = true;
      return;
    }
    const day = dayOf(this.now);
    const cntKey = `${a.id}:${kind}:${family}:${day}`;
    const n = this.priv.reactCount[cntKey] ?? 0;
    if (n >= (kind === 'reaction' ? 3 : 2)) return;
    const b = a.beliefs[family];
    if (!b) return;
    const verifiedToday = (this.priv.verified[`${a.id}:${day}`] ?? 0) > 0;
    let build;
    if (kind === 'reaction') {
      build = buildReaction(this.state, this.map, a, b, this.now, verifiedToday, this.P);
      if (build.candidates.length <= 1) {
        const f = a.funnel[family];
        if (!f?.intended) {
          // 自己的安排受影响、但所有改法都被规则排除（例如岗位在店里）：有意但受阻，而不是“与己无关”
          const why = build.atRisk.length > 0 ? build.rejected[0]?.reason : undefined;
          this.emit(why ? { type: 'funnel_stop', agent: a.id, family, stop: 'blocked', reason: `安排受影响，但${why}` } : { type: 'funnel_stop', agent: a.id, family, stop: 'irrelevant', reason: '相信了，但自己的安排不受影响' });
        }
        return;
      }
    } else {
      build = buildNotify(this.state, this.map, a, b, this.now, this.P);
      if (build.candidates.length <= 1) return;
    }
    this.priv.reactCount[cntKey] = n + 1;
    const id = `d${this.nextSeq()}`;
    const commitAt = this.now + (kind === 'reaction' ? this.think.reaction : this.think.notify);
    const req: DecisionRequest = {
      id,
      agent: a.id,
      kind,
      family,
      t: this.now,
      commitAt,
      n,
      trigger: { seq: this.state.meta.seq, reason },
      candidates: build.candidates,
      rejected: build.rejected,
      ruleFactors: build.ruleFactors,
      observation: build.observation,
      observationHash: build.observationHash,
      belief: structuredClone(b),
      semanticRule: build.semanticRule,
      ...(this.mode === 'rule' ? { answer: build.semanticRule } : {}),
    };
    this.requests[id] = req;
    this.emit({ type: 'decision', id, agent: a.id, kind, family, phase: 'requested', provider: this.mode === 'rule' ? 'rule' : 'jev', commitAt });
    this.schedule(commitAt, { k: 'commit', id });
  }

  private commit(id: string): void {
    const req = this.requests[id];
    if (!req || !req.answer) return;
    delete this.requests[id];
    const a = this.agent(req.agent);
    const sem = req.answer;
    const day = dayOf(this.now);
    const verifiedToday = (this.priv.verified[`${a.id}:${day}`] ?? 0) > 0;
    let chosen: string[] = [];
    let outcome: DecisionRecord['commit']['outcome'] = 'applied';
    let reason: string | undefined;
    let scored;
    let rngKey: string;
    let u: number;
    if (req.kind === 'reaction') {
      scored = scoreReaction(a, req.belief, req.candidates, req.ruleFactors, sem, verifiedToday, this.P);
      const key = [a.id, 'reaction', req.family, req.n] as const;
      rngKey = rngKeyString(['decide', ...key]);
      u = r3(rand(this.seed, 'decide', ...key));
      const idx = weightedIndex(req.candidates.map((c) => scored!.probabilities[c.id] ?? 0), u);
      let c = req.candidates[idx]!;
      const invalid = this.invalid(a, c);
      if (invalid) {
        outcome = 'invalidated';
        reason = invalid;
        if (c.kind !== 'keep' && c.kind !== 'verify' && !a.funnel[req.family]?.intended) this.emit({ type: 'funnel_stop', agent: a.id, family: req.family, stop: 'blocked', reason: `想${c.label.replace(/^\S+ \S+ /, '')}，但${invalid}` });
        c = req.candidates[0]!;
      }
      chosen = [c.id];
      this.applyReaction(a, req, c);
    } else {
      scored = scoreNotify(a, req.candidates, req.ruleFactors, sem);
      rngKey = rngKeyString(['decide', a.id, 'notify', req.family, req.n, '<contact>']);
      u = 0;
      for (const c of req.candidates) {
        if (c.kind !== 'dm') continue;
        const uc = r3(rand(this.seed, 'decide', a.id, 'notify', req.family, req.n, c.id));
        if (uc < (scored.probabilities[c.id] ?? 0)) {
          const to = this.state.agents[String(c.params.to)];
          if (to && !(a.told[req.family] ?? []).includes(to.id)) {
            chosen.push(c.id);
            this.sendDm(a, to, req.family, id);
          }
        }
      }
      if (chosen.length === 0) chosen = ['skip'];
    }
    const label = chosen.map((cid) => req.candidates.find((c) => c.id === cid)?.label ?? cid).join('；');
    this.emit({ type: 'decision', id, agent: a.id, kind: req.kind, family: req.family, phase: 'committed', provider: sem.provider, chosen: chosen.join(','), chosenLabel: label, outcome });
    const record: DecisionRecord = {
      id,
      agent: a.id,
      agentName: a.name,
      kind: req.kind,
      family: req.family,
      t: req.t,
      commitAt: this.now,
      trigger: req.trigger,
      observation: req.observation,
      observationHash: req.observationHash,
      provider: sem.provider,
      model: sem.model,
      modelCallIds: sem.callIds,
      policyVersion: POLICY_VERSION,
      candidates: req.candidates,
      rejected: req.rejected,
      factors: scored.factors,
      utilities: scored.utilities,
      probabilities: scored.probabilities,
      rng: { key: rngKey, value: u },
      chosen,
      commit: { at: this.now, outcome, ...(reason ? { reason } : {}) },
      summary: this.summarize(a, req, chosen, scored.probabilities, sem),
      ...(sem.fallback ? { fallback: sem.fallback } : {}),
    };
    if (this.recordListeners.length === 0) this.unclaimedRecords.push(record);
    for (const fn of this.recordListeners) fn(record);
    const dirtyKey = `${a.id}:${req.kind}:${req.family}`;
    if (this.priv.dirty[dirtyKey]) {
      delete this.priv.dirty[dirtyKey];
      this.requestDecision(a, req.kind, req.family, '思考期间信念又变了');
    }
  }

  private invalid(a: Agent, c: Candidate): string | undefined {
    if (c.kind === 'move' || c.kind === 'adapt' || c.kind === 'restore') {
      const it = findItemAny(a, String(c.params.item));
      if (!it || it.status !== 'planned') return '原安排已经开始或结束';
    }
    if (c.kind === 'prepare') {
      const store = String(c.params.store);
      if ((this.state.stock[store]?.power_bank ?? 0) <= 0) return '充电宝卖完了';
    }
    return undefined;
  }

  private summarize(a: Agent, req: DecisionRequest, chosen: string[], probs: Record<string, number>, sem: SemanticAnswer): string {
    const b = req.belief;
    const labels = chosen.map((c) => req.candidates.find((x) => x.id === c)?.label ?? c).join('、');
    const top = chosen[0] ? probs[chosen[0]] : undefined;
    const src = sem.provider === 'rule' ? '规则因子' : sem.fallback ? `规则回退（${sem.fallback}）` : 'Jev 语义因子';
    return `${a.name}相信“${describeSlots(b.slots)}”（置信 ${b.confidence}），在 ${req.candidates.length} 个合法候选中${top !== undefined ? `以 ${Math.round(top * 100)}% 的概率` : ''}选了：${labels}。依据：${src} + 规则成本。（解释性摘要，非内部推理）`;
  }

  private applyReaction(a: Agent, req: DecisionRequest, c: Candidate): void {
    const family = req.family;
    const decisionId = req.id;
    switch (c.kind) {
      case 'keep':
        if (!a.funnel[family]?.intended) this.emit({ type: 'funnel_stop', agent: a.id, family, stop: 'no_change', reason: '知道了，但决定照常' });
        return;
      case 'verify': {
        const day = dayOf(this.now);
        this.priv.verified[`${a.id}:${day}`] = (this.priv.verified[`${a.id}:${day}`] ?? 0) + 1;
        this.verifyNews(a, family);
        // 查证是为了做决定：无论信念变没变，都再做一次决定（这次不再提供“查证”）
        this.requestDecision(a, 'reaction', family, '查证之后再决定');
        return;
      }
      case 'move':
      case 'adapt':
      case 'restore':
        return this.revisePlan(a, c, decisionId, family);
      case 'prepare':
        return this.insertErrand(a, String(c.params.store), decisionId, family);
      case 'service':
        return this.adjustService(a, c, decisionId, family);
      default:
        return;
    }
  }

  private revisePlan(a: Agent, c: Candidate, decisionId: string, family: string): void {
    const it = findItemAny(a, String(c.params.item));
    if (!it) return;
    const day = dayOf(it.start);
    const plan = [...(a.plans[day] ?? [])];
    const idx = plan.findIndex((x) => x.id === it.id);
    if (idx < 0) return;
    const orig = { kind: it.kind, place: it.place, needsPower: it.needsPower, label: it.label };
    const nid = (suffix: string) => `${it.id}-r${this.nextSeq()}${suffix}`;
    let repl: PlanItem[];
    if (c.kind === 'adapt') {
      // 只改所信的停电时段；前后两段保留原安排（v0 把整项都标成“不用电”）
      const from = Math.max(Number(c.params.from ?? it.start), it.start);
      const to = Math.min(Number(c.params.to ?? it.end), it.end);
      const label = it.kind === 'tv' ? '改做不用电的事' : it.kind === 'study' ? '看纸质材料' : '吃提前备好的饭';
      repl = [];
      if (from - it.start >= 10 * MIN) repl.push({ ...it, id: nid('a'), end: from });
      repl.push({ ...it, id: nid(repl.length ? 'b' : ''), start: from, end: to, kind: it.kind === 'tv' ? 'home' : it.kind, needsPower: false, label, origin: { decisionId, family, reason: 'adapt', replaces: it.id, orig } });
      if (it.end - to >= 10 * MIN) repl.push({ ...it, id: nid('c'), start: to, end: it.end });
    } else if (c.kind === 'restore') {
      const o = it.origin?.orig;
      if (!o) return;
      const back = (start: SimTime, end: SimTime, suffix: string): PlanItem => ({ ...it, id: nid(suffix), start, end, kind: o.kind, place: o.place, needsPower: o.needsPower, label: o.label, origin: { decisionId, family, reason: 'restore', replaces: it.id } });
      if (c.params.narrow) {
        // 缩小：只在所信时段保留挪动，前后段恢复原安排
        const from = Math.max(Number(c.params.from), it.start);
        const to = Math.min(Number(c.params.to), it.end);
        repl = [];
        if (from - it.start >= 10 * MIN) repl.push(back(it.start, from, 'a'));
        repl.push({ ...it, id: nid('b'), start: from, end: to });
        if (it.end - to >= 10 * MIN) repl.push(back(to, it.end, 'c'));
      } else repl = [back(it.start, it.end, '')];
    } else {
      const from = Math.max(Number(c.params.from), it.start);
      const to = Math.min(Number(c.params.to), it.end);
      repl = [];
      if (from - it.start >= 10 * MIN) repl.push({ ...it, id: nid('a'), end: from });
      repl.push({ ...it, id: nid('b'), start: from - (from > it.start ? 0 : 0), end: to, kind: String(c.params.kind) as ActKind, place: String(c.params.place), needsPower: true, label: c.label.replace(/^\S+ \S+ /, ''), punctual: false, origin: { decisionId, family, reason: 'move', replaces: it.id, orig } });
      if (it.end - to >= 10 * MIN) repl.push({ ...it, id: nid('c'), start: to, end: it.end });
    }
    plan.splice(idx, 1, ...repl);
    this.emit({ type: 'item_status', agent: a.id, day, itemId: it.id, status: 'cancelled', reason: '按决定改了安排' });
    this.emit({ type: 'plan_set', agent: a.id, day, items: plan.map((x) => (x.id === it.id ? { ...x, status: 'cancelled' as const } : x)), reason: 'revision', decisionId, note: c.label });
  }

  private insertErrand(a: Agent, store: string, decisionId: string, family: string): void {
    const d = dayOf(this.now);
    for (const day of [d, d + 1]) {
      const plan = [...(a.plans[day] ?? [])];
      const idx = plan.findIndex((x) => x.status === 'planned' && x.flexible && HOMEISH.concat(['walk', 'leisure']).includes(x.kind) && x.start >= this.now - 60 && x.end - Math.max(x.start, this.now) >= 45 * MIN && timeOfDay(x.start) < 20 * HOUR);
      if (idx < 0) continue;
      const x = plan[idx]!;
      const s0 = Math.max(x.start, this.now + 5 * MIN);
      const errand: PlanItem = {
        id: `${x.id}-e${this.nextSeq()}`,
        kind: 'shop',
        place: store,
        start: s0,
        end: s0 + 30 * MIN,
        punctual: false,
        flexible: true,
        needsPower: true,
        social: false,
        purchase: { item: 'power_bank', qty: 1, for: 'self' },
        status: 'planned',
        label: '买充电宝',
        origin: { decisionId, family, reason: 'prepare' },
      };
      const before = { ...x, end: s0 };
      const after = { ...x, id: `${x.id}-e${this.nextSeq()}b`, start: s0 + 30 * MIN };
      const parts = [before, errand, after].filter((p) => p.end - p.start >= 3 * MIN);
      plan.splice(idx, 1, ...parts);
      this.emit({ type: 'plan_set', agent: a.id, day, items: plan, reason: 'revision', decisionId, note: '去买充电宝' });
      return;
    }
  }

  private adjustService(a: Agent, c: Candidate, decisionId: string, family: string): void {
    const place = String(c.params.place);
    const mode = String(c.params.mode);
    const from = Number(c.params.from);
    const to = Number(c.params.to);
    const org = Object.values(this.state.orgs).find((o) => o.place === place);
    if (!org) return;
    if (mode === 'cold_menu' || mode === 'closed_window') {
      this.emit({ type: 'place_mode', place, mode: { kind: mode, from, to, by: a.id, family }, decisionId });
    }
    const text = `${org.name}：${c.label}`;
    const staff = org.staff.filter((s) => s !== a.id);
    this.emit({ type: 'org_notice', org: org.id, from: a.id, to: staff, text, decisionId, versionId: a.beliefs[family]?.versionId ?? '' });
    const dest = c.params.dest ? String(c.params.dest) : undefined;
    for (const sid of org.staff) {
      const s = this.agent(sid);
      if (mode !== 'cold_menu') this.shiftStaff(s, place, from, to, mode, decisionId, family, dest);
      if (sid !== a.id && a.beliefs[family]) this.transmit(a, s, family, 'org', { n: this.nextSeq() });
    }
  }

  private shiftStaff(s: Agent, place: string, from: SimTime, to: SimTime, mode: string, decisionId: string, family: string, dest?: string): void {
    const day = dayOf(from);
    const plan = [...(s.plans[day] ?? [])];
    let changed = false;
    const out: PlanItem[] = [];
    for (const it of plan) {
      if (it.status !== 'planned' || it.kind !== 'work' || it.place !== place || overlap(it.start, it.end, from, to) <= 0) {
        out.push(it);
        continue;
      }
      changed = true;
      const f = Math.max(from, it.start);
      const t = Math.min(to, it.end);
      const nid = (x: string) => `${it.id}-o${this.nextSeq()}${x}`;
      if (f - it.start >= 5 * MIN) out.push({ ...it, id: nid('a'), end: f });
      const orig = { kind: it.kind, place: it.place, needsPower: it.needsPower, label: it.label };
      out.push(
        mode === 'relocate_team' && dest
          ? { ...it, id: nid('b'), start: f, end: t, kind: 'wfh', place: dest, needsPower: true, punctual: false, label: `团队去${this.map.places[dest]?.short ?? dest}办公`, origin: { decisionId, family, reason: 'org', replaces: it.id, orig } }
          : { ...it, id: nid('b'), start: f, end: t, kind: 'home', place: s.home, needsPower: false, punctual: false, social: false, label: '店里停业，回家休息', origin: { decisionId, family, reason: 'org', replaces: it.id, orig } },
      );
      if (it.end - t >= 5 * MIN) out.push({ ...it, id: nid('c'), start: t, end: it.end });
    }
    if (changed) this.emit({ type: 'plan_set', agent: s.id, day, items: out, reason: 'org', decisionId, note: mode });
  }

  // ---------- 脚本与日结 ----------

  private runScript(ev: ScriptEvent): void {
    switch (ev.kind) {
      case 'reveal': {
        // 虚惊：到原定恢复供电的时刻，大家看见电一直没断——结算白挪的安排，再裁决信任
        const o = this.scenario.outages.find((x) => x.id === ev.outage);
        if (!o) return;
        this.emit({ type: 'false_alarm', area: ev.area, outage: ev.outage });
        this.accountFalseAlarm(o);
        this.resolveTrust(o, true);
        return;
      }
      case 'publish':
        this.emit({ type: 'intervention', by: 'script', note: ev.note, payload: { newsId: ev.news.id, channels: ev.channels } });
        this.publish(ev.news, ev.channels, 'script');
        return;
      case 'org_notice': {
        const org = this.state.orgs[ev.org];
        if (!org) return;
        const vb = makeVersion({ familyId: ev.news.familyId, slots: ev.news.body.slots, origin: { kind: 'org', by: org.id, channel: 'org' }, root: ev.news.id, mutations: [], t: this.now });
        if (!this.state.versions[vb.id]) this.emit({ type: 'version_created', version: vb });
        this.emit({ type: 'org_notice', org: org.id, from: org.manager ?? org.id, to: org.staff, text: ev.news.body.text, versionId: vb.id });
        for (const sid of org.staff) {
          const s = this.agent(sid);
          if (s.act?.kind === 'sleep') continue;
          this.expose(s, { family: ev.news.familyId, channel: 'org', fragment: 'text', versionId: vb.id, forceOpen: true });
        }
        return;
      }
      case 'power': {
        const places = Object.values(this.map.places)
          .filter((p) => p.district === ev.area)
          .map((p) => p.id);
        const outage = ev.outage ?? this.outageOn(ev.area, dayOf(this.now))?.id;
        if (!ev.on) {
          const back = this.script.find((x) => x.kind === 'power' && x.area === ev.area && x.on && x.at > this.now);
          this.priv.powerOffUntil[ev.area] = back?.at ?? this.now + 24 * HOUR;
          if (outage) this.priv.activeOutage[ev.area] = outage;
        } else {
          delete this.priv.powerOffUntil[ev.area];
          delete this.priv.activeOutage[ev.area];
        }
        this.emit({ type: 'power', area: ev.area, on: ev.on, places, ...(outage ? { outage } : {}) });
        if (ev.on) {
          this.accountOverreaction(dayOf(this.now), outage);
          const o = outage ? this.scenario.outages.find((x) => x.id === outage) : undefined;
          if (o) this.resolveTrust(o);
        }
        for (const a of Object.values(this.state.agents)) {
          if (a.loc.k === 'in' && places.includes(a.loc.place)) this.updatePhone(a);
          if (!ev.on && a.act && a.act.needsPower && places.includes(a.act.place) && a.act.endsAt > this.now) {
            const ps = this.state.places[a.act.place]!;
            const cold = ps.mode.kind === 'cold_menu' && this.now >= ps.mode.from && this.now < ps.mode.to;
            if (cold) continue;
            const act = a.act;
            const it = act.itemId ? findItemAny(a, act.itemId) : undefined;
            this.emit({ type: 'activity_ended', agent: a.id, actId: act.id, kind: act.kind, place: act.place, ...(act.itemId ? { itemId: act.itemId } : {}), outcome: 'interrupted', reason: '停电' });
            if (it) {
              this.recordInconvenience(a, it, this.now, it.end, 'no_power');
              this.fallback(a, it, this.now, 'no_power');
            } else this.proceed(a);
          }
        }
        return;
      }
    }
  }

  private settle(): void {
    const s = this.state;
    const d = dayOf(this.now);
    for (const o of this.scenario.orgs) {
      const st = s.orgs[o.id]!;
      for (const sid of o.staff) {
        const worked = (s.agents[sid]?.plans[d] ?? []).some((it) => (it.kind === 'work' || (it.kind === 'wfh' && it.origin?.reason === 'org')) && (it.status === 'done' || it.status === 'interrupted' || it.status === 'active'));
        const wage = Math.round((o.wages[sid] ?? 0) * 100);
        if (worked && wage > 0) this.emit({ type: 'transfer', from: st.account, to: `ag:${sid}`, amount: wage, memo: `${d} 日工资`, agent: sid });
      }
      const kind = this.map.places[o.place]?.kind;
      if (!isWeekend(d) || kind === 'cafe' || kind === 'restaurant' || kind === 'convenience' || kind === 'supermarket') {
        this.emit({ type: 'transfer', from: o.externalSource, to: st.account, amount: Math.round(o.externalDaily * 100), memo: '外部流入' });
      }
    }
    for (const sp of this.scenario.stipends) this.emit({ type: 'transfer', from: sp.source, to: `ag:${sp.agent}`, amount: Math.round(sp.amount * 100), memo: '补助/收入', agent: sp.agent });
    for (const off of this.scenario.offers) {
      const cur = s.stock[off.place]?.[off.item] ?? 0;
      const delta = off.restockTo - cur;
      if (delta <= 0) continue;
      const org = Object.values(s.orgs).find((o) => o.place === off.place);
      this.emit({ type: 'stock', holder: off.place, item: off.item, delta, memo: '补货' });
      if (org) this.emit({ type: 'transfer', from: org.account, to: 'ext:suppliers', amount: Math.round(off.price * 50 * delta), memo: `补货 ${this.itemName(off.item)}×${delta}` });
    }
    this.schedule(at(d + 1, 23, 50), { k: 'settle' });
  }

  /**
   * 过度反应：来电时结算——当天因这轮停电相关的主张被挪走/改掉的安排中，落在真实停电窗口之外（或不在停电区）的分钟。
   * 有 outage 时只结算与它关联的主张族（多轮事件互不串账）。
   */
  private accountOverreaction(day: number, outage?: string): void {
    const offs = this.script.filter((x) => x.kind === 'power' && !x.on && dayOf(x.at) === day && x.at <= this.now);
    if (offs.length === 0) return;
    const truth = offs.map((off) => {
      const on = this.script.find((x) => x.kind === 'power' && x.on && x.at > off.at);
      return { area: (off as { area: 'north' | 'south' }).area, from: off.at, to: on?.at ?? off.at + 2 * HOUR };
    });
    const o = outage ? this.scenario.outages.find((x) => x.id === outage) : undefined;
    const fams = o ? this.familiesOf(o) : undefined;
    for (const a of Object.values(this.state.agents)) {
      for (const it of a.plans[day] ?? []) {
        const org = it.origin;
        if (!org?.family || !(org.reason === 'move' || org.reason === 'adapt' || org.reason === 'org')) continue;
        if (fams && !fams.has(org.family)) continue;
        if (it.status === 'cancelled' || it.status === 'failed') continue;
        // 只有原安排所在的区真的停电，那段挪动才算“必要”；为别的区的停电挪动，整段都是过度调整
        const origD = this.map.places[org.orig?.place ?? it.place]?.district;
        const inside = truth.reduce((acc, tr) => acc + (tr.area === origD ? overlap(it.start, it.end, tr.from, tr.to) : 0), 0);
        const outside = it.end - it.start - inside;
        if (outside >= 5 * MIN) this.emit({ type: 'overreaction', agent: a.id, itemId: it.id, seconds: outside, reason: `${it.label}：${clock(it.start)}–${clock(it.end)} 中有 ${Math.round(outside / 60)} 分钟在真实停电时段之外`, ...(outage ? { outage } : {}) });
      }
    }
  }

  /** 虚惊的后果：为这轮挪动或改掉的安排，整段都是过度调整（没有人会措手不及） */
  private accountFalseAlarm(o: OutageTruth): void {
    const fams = this.familiesOf(o);
    for (const a of Object.values(this.state.agents)) {
      for (const it of a.plans[o.day] ?? []) {
        const org = it.origin;
        if (!org?.family || !(org.reason === 'move' || org.reason === 'adapt' || org.reason === 'org')) continue;
        if (!fams.has(org.family)) continue;
        if (it.status === 'cancelled' || it.status === 'failed') continue;
        const sec = it.end - it.start;
        if (sec >= 5 * MIN) this.emit({ type: 'overreaction', agent: a.id, itemId: it.id, seconds: sec, reason: `${it.label}：${clock(it.start)}–${clock(it.end)} 为一场没有发生的停电挪了 ${Math.round(sec / 60)} 分钟`, outage: o.id });
      }
    }
  }

  /** 与一轮停电有关的主张族：事件自己的族 + 任何说的是同区同日停电的新闻所在的族 */
  private familiesOf(o: OutageTruth): Set<string> {
    const fams = new Set<string>([o.family]);
    for (const n of Object.values(this.state.news)) {
      const v = this.state.versions[n.body.versionId];
      if (v && v.slots.event === 'power_outage' && v.slots.area === o.area && v.slots.day === o.day) fams.add(n.familyId);
    }
    return fams;
  }

  /**
   * 信任裁决（social_v2，spec v1 §2.3、v2 §2.5）：来电后，见证了这轮停电的人按自己的经历调整
   * 对官方通知的信任、对告诉过他的人的信任，并记下这次经历（下一轮的担心与查证会用到）。
   * 每次调整都写成事件，前端同构重建。
   */
  private resolveTrust(o: OutageTruth, falseAlarm = false): void {
    const fams = this.familiesOf(o);
    const winFrom = dayStart(o.day) + o.from;
    const winTo = dayStart(o.day) + o.to;
    const where = `${weekday(o.day)}${o.area === 'north' ? '北区' : '南区'}${falseAlarm ? '' : '停电'}`;
    for (const a of Object.values(this.state.agents)) {
      const verdict = falseAlarm ? falseAlarmVerdict(this.map, a, o, fams, winFrom, winTo, this.P) : trustVerdict(this.state, this.map, a, o, fams, winFrom, winTo, this.P);
      for (const v of verdict) {
        if (v.kind) this.emit({ type: 'experience', agent: a.id, outage: o.id, kind: v.kind, text: `${where}：${v.reason}` });
        const from = v.target === 'gov' ? a.trustGov : (a.trustIn[v.target] ?? relationBetween(this.state, a.id, v.target)?.trust ?? 0.4);
        const to = r3(Math.max(0.05, Math.min(0.95, from + v.delta)));
        if (Math.abs(to - from) < 0.005) continue;
        this.emit({ type: 'trust_changed', agent: a.id, target: v.target, from: r3(from), to, reason: v.reason, outage: o.id, family: v.family });
      }
    }
  }

  // ---------- 干预（管理员） ----------

  /** 管理员发布新闻：必须标记为干预，不伪装成自然传播 */
  intervenePublish(draft: NewsDraft, channels: Channel[]): NewsItem {
    return this.publish(draft, channels, 'admin');
  }

  /** 供 UI 显示：某人某刻的坐标（瓦片，可为小数） */
  static positionAt(a: Agent, t: SimTime): { x: number; y: number } {
    if (a.loc.k === 'walk') {
      const w = a.loc.walk;
      const f = Math.max(0, Math.min(1, (t - w.t0) / Math.max(1, w.t1 - w.t0)));
      const n = w.path.length - 1;
      if (n <= 0) return { ...w.to };
      const pos = f * n;
      const i = Math.min(n - 1, Math.floor(pos));
      const p0 = w.path[i]!;
      const p1 = w.path[i + 1]!;
      const k = pos - i;
      return { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k };
    }
    return { ...a.loc.tile };
  }
}

export const SLOT_CHANNELS: Record<string, Channel> = { website: 'website', push: 'push', board: 'board' };
export type { Slots };
