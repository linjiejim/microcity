import { DAY, dayStart, HOUR } from '../core/time.ts';
import { ACT_BUCKET, BUCKETS } from '../data/tables.ts';
import { EXT, householdAccount, type CommunityDef, type PlaceKind, type TieKind } from '../model/def.ts';
import type { DomainEvent } from '../model/events.ts';
import type { Intervention } from '../model/intervention.ts';
import type { PersonState, Weather, WorldState } from '../model/state.ts';
import type { RuleParams } from '../params.ts';
import { rand } from '../core/rng.ts';
import { initialState, moodOf, needsAt } from '../reduce.ts';
import { Engine, mergeParams } from '../engine/engine.ts';

/**
 * 每日统计（D86）：把一天的事件与状态压成一份紧凑的汇总。
 * 画像、校准、实验指标都从这里算，不需要把事件搬来搬去。
 */

/** 一个人一天的小结；use 的顺序同 BUCKETS，单位秒 */
export interface DaySum {
  use: number[];
  spent: number;
  earned: number;
  chats: number;
  mood: number;
}

/** 分时段人数的列：各类地点，加上“在路上”与“去城里了” */
export const OCC_SLOTS: Array<PlaceKind | 'street' | 'away'> = ['house', 'apartment', 'market', 'grocery', 'eatery', 'teahouse', 'center', 'clinic', 'school', 'office', 'workshop', 'park', 'square', 'court', 'busstop', 'street', 'away'];

export interface DayAgg {
  day: number;
  weather: Weather;
  /** 与 def.people 一一对应 */
  people: DaySum[];
  /** [小时 0–23][OCC_SLOTS 的序号]：整点时各处的人数 */
  occupancy: number[][];
  /** 钱的流向：`${付方}>${收方}:${种类}` → 金额；付方收方是 person / household / ext / firm:<地点类型> */
  flows: Record<string, number>;
  /** 各单位当天的营业收入 */
  revenue: Record<string, number>;
  /** 开始了多少次：活动种类，或 hobby:<兴趣> */
  acts: Record<string, number>;
  /** 各类地点的到访人次（不算自己家、不算上班上学） */
  visits: Partial<Record<PlaceKind, number>>;
  chats: number;
  newTies: number;
  newFriends: number;
  /** 到了地方做不成的次数；其中没买到东西的次数 */
  failed: number;
  stockouts: number;
  missed: number;
  /** 当天结束时各种关系的条数 */
  ties: Partial<Record<TieKind, number>>;
  /** 当天结束时：每个人的钱包、每户的账户（与 def 一一对应） */
  wallets: number[];
  households: number[];
  /** 当天结束时：各单位账上的钱、人均存粮（份） */
  firms: Record<string, number>;
  pantry: number;
  /** 当天结束时：听说过各条传言的人数、被裁的人数 */
  heard: Record<string, number>;
  laidOff: number;
  /** 当天生效或发生的干预的说明 */
  marks: string[];
}

/** 一个人截至 t 的当天小结（含还没结束的那一段） */
export function daySumOf(ps: PersonState, t: number): DaySum {
  const use = BUCKETS.map((b) => ps.today.use[b]);
  const bucket = ps.act ? ACT_BUCKET[ps.act.kind] : ps.loc.k === 'move' ? 'travel' : 'other';
  use[BUCKETS.indexOf(bucket)]! += t - ps.tallyT;
  return { use, spent: ps.today.spent, earned: ps.today.earned, chats: ps.today.chats, mood: moodOf(needsAt(ps.needs, t), ps.today.chats) };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

export class StatsCollector {
  private readonly sector: Record<string, string> = { [EXT]: 'ext' };
  private readonly placeKind: Record<string, PlaceKind> = {};
  private readonly homeOf: Record<string, string> = {};
  private cur = this.blank();

  constructor(private readonly def: CommunityDef) {
    for (const p of def.map.places) this.placeKind[p.id] = p.kind;
    for (const p of def.people) {
      this.sector[p.id] = 'person';
      this.homeOf[p.id] = p.home;
    }
    for (const h of def.households) this.sector[householdAccount(h.id)] = 'household';
    for (const f of def.firms) this.sector[f.id] = `firm:${this.placeKind[f.place]}`;
  }

  private blank() {
    return { occupancy: [] as number[][], flows: {} as Record<string, number>, revenue: {} as Record<string, number>, acts: {} as Record<string, number>, visits: {} as Partial<Record<PlaceKind, number>>, chats: 0, newTies: 0, newFriends: 0, failed: 0, stockouts: 0, missed: 0, marks: [] as string[] };
  }

  onEvent(e: DomainEvent): void {
    const c = this.cur;
    switch (e.type) {
      case 'transfer': {
        const key = `${this.sector[e.from] ?? 'ext'}>${this.sector[e.to] ?? 'ext'}:${e.kind}`;
        c.flows[key] = round2((c.flows[key] ?? 0) + e.amount);
        if (e.kind === 'purchase') c.revenue[e.to] = round2((c.revenue[e.to] ?? 0) + e.amount);
        break;
      }
      case 'act_started': {
        const key = e.act.kind === 'hobby' ? `hobby:${e.act.hobby}` : e.act.kind;
        c.acts[key] = (c.acts[key] ?? 0) + 1;
        const fixed = e.act.kind === 'work' || e.act.kind === 'school' || e.act.kind === 'wait';
        if (!fixed && e.act.place !== this.homeOf[e.agent]) {
          const k = this.placeKind[e.act.place]!;
          c.visits[k] = (c.visits[k] ?? 0) + 1;
        }
        break;
      }
      case 'chat':
        c.chats++;
        break;
      case 'tie_formed':
        c.newTies++;
        break;
      case 'tie_changed':
        if (e.to === 'friend') c.newFriends++;
        break;
      case 'plan_failed':
        c.failed++;
        if (e.reason === '没买到东西' || e.reason === '卖完了') c.stockouts++;
        break;
      case 'commit_missed':
        c.missed++;
        break;
      case 'intervention':
        if (e.phase === 'start') c.marks.push(e.label);
        break;
      default:
        break;
    }
  }

  /** 整点时数一数各处有多少人 */
  sampleHour(state: WorldState): void {
    const row = OCC_SLOTS.map(() => 0);
    const street = OCC_SLOTS.indexOf('street');
    const away = OCC_SLOTS.indexOf('away');
    for (const id in state.people) {
      const ps = state.people[id]!;
      if (ps.loc.k === 'move') row[street]!++;
      else if (ps.act?.away) row[away]!++;
      else row[OCC_SLOTS.indexOf(this.placeKind[ps.loc.place]!)]!++;
    }
    this.cur.occupancy.push(row);
  }

  /** 一天结束（午夜前一秒）时收尾 */
  closeDay(state: WorldState, day: number): DayAgg {
    const t = dayStart(day + 1);
    const ties: Partial<Record<TieKind, number>> = {};
    for (const k in state.ties) {
      const kind = state.ties[k]!.kind;
      ties[kind] = (ties[kind] ?? 0) + 1;
    }
    const heard: Record<string, number> = {};
    let laidOff = 0;
    for (const id in state.people) {
      const ps = state.people[id]!;
      if (ps.laidOff) laidOff++;
      for (const topic in ps.heard) heard[topic] = (heard[topic] ?? 0) + 1;
    }
    let food = 0;
    for (const h in state.households) food += state.households[h]!.food;
    const agg: DayAgg = {
      day,
      weather: state.weather,
      people: this.def.people.map((p) => daySumOf(state.people[p.id]!, t)),
      ...this.cur,
      ties,
      wallets: this.def.people.map((p) => state.accounts[p.id] ?? 0),
      households: this.def.households.map((h) => state.accounts[householdAccount(h.id)] ?? 0),
      firms: Object.fromEntries(this.def.firms.map((f) => [f.id, state.accounts[f.id] ?? 0])),
      pantry: round2(food / Math.max(1, this.def.people.length)),
      heard,
      laidOff,
    };
    this.cur = this.blank();
    return agg;
  }
}

export interface RunOptions {
  seed: number;
  params?: Partial<RuleParams>;
  interventions?: Intervention[];
}

export interface DayResult {
  day: number;
  agg: DayAgg;
  /** 这一天开始之前的状态（keep 为真时才有） */
  snapshot?: WorldState;
  events?: DomainEvent[];
}

/**
 * 按天推进引擎并出统计。第 d 天的数据 = 这一天开始前的状态快照 + 时刻落在这一天里的事件（D83）。
 * keep 为真时保留快照与事件（给回放用）；只要统计时不保留，省内存。
 */
export class DayRunner {
  private engine: Engine | undefined;
  private buffer: DomainEvent[] = [];
  private day = 0;
  private readonly stats: StatsCollector;

  constructor(
    private readonly def: CommunityDef,
    private readonly opts: RunOptions,
    private readonly keep: boolean,
  ) {
    this.stats = new StatsCollector(def);
  }

  get computed(): number {
    return this.day;
  }

  next(): DayResult {
    const day = this.day + 1;
    let snapshot: WorldState | undefined;
    if (!this.engine) {
      // 第一天的快照是开局之前的状态：开局事件（所有人入睡）也在这一天的事件里
      if (this.keep) snapshot = initialState(this.def, mergeParams(this.opts.params), this.opts.seed, rand);
      this.engine = Engine.create(this.def, {
        ...this.opts,
        onEvent: (e) => {
          this.stats.onEvent(e);
          if (this.keep) this.buffer.push(e);
        },
      });
    } else if (this.keep) snapshot = structuredClone(this.engine.state);
    const d0 = dayStart(day);
    for (let h = 0; h < 24; h++) {
      // 整点之前的事都处理完再数人；零点的事（跨天结算）属于这一天，要先处理
      this.engine.advance(h === 0 ? d0 : d0 + h * HOUR - 1);
      this.stats.sampleHour(this.engine.state);
    }
    this.engine.advance(d0 + DAY - 1);
    const agg = this.stats.closeDay(this.engine.state, day);
    const events = this.buffer;
    this.buffer = [];
    this.day = day;
    return { day, agg, ...(this.keep ? { snapshot: snapshot!, events } : {}) };
  }
}
