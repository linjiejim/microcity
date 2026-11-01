import type { SimTime } from '../core/time.ts';
import type { Tile } from '../world/map.ts';
import type { Belief, ClaimVersion, NewsItem } from '../info/types.ts';
import type { Habits, Look, RoleId, Traits } from '../scenario/types.ts';

export type ActKind =
  | 'sleep'
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'work'
  | 'wfh'
  | 'class'
  | 'study'
  | 'shop'
  | 'leisure'
  | 'walk'
  | 'nap'
  | 'tv'
  | 'home'
  | 'care'
  | 'jobsearch'
  | 'read_board'
  | 'wait';

export type ItemStatus = 'planned' | 'active' | 'done' | 'failed' | 'interrupted' | 'cancelled';

export interface PlanItem {
  id: string;
  kind: ActKind;
  place: string;
  /** 出发/开始时刻（含步行） */
  start: SimTime;
  end: SimTime;
  punctual: boolean;
  flexible: boolean;
  needsPower: boolean;
  social: boolean;
  purchase?: { item: string; qty: number; for: 'self' | 'household' };
  status: ItemStatus;
  label: string;
  /** 改计划来源 */
  origin?: {
    decisionId?: string;
    reason: string;
    replaces?: string;
    family?: string;
    /** 被替换前的原安排（用于恢复） */
    orig?: { kind: ActKind; place: string; needsPower: boolean; label: string };
  };
}

export interface Walk {
  id: string;
  from: Tile;
  to: Tile;
  toPlace: string;
  path: Tile[];
  t0: SimTime;
  t1: SimTime;
  itemId?: string;
}

export type Loc = { k: 'in'; place: string; tile: Tile } | { k: 'walk'; walk: Walk } | { k: 'street'; tile: Tile };

export interface Activity {
  id: string;
  kind: ActKind;
  place: string;
  itemId?: string;
  startedAt: SimTime;
  endsAt: SimTime;
  label: string;
  needsPower: boolean;
}

export interface Phone {
  battery: number;
  at: SimTime;
  charging: boolean;
  awake: boolean;
  drain: number;
}

export type FunnelStop = 'not_reached' | 'ignored' | 'not_understood' | 'disbelieved' | 'irrelevant' | 'blocked' | 'no_change';

/** 七阶段漏斗：每阶段首次到达的时刻 */
export interface FunnelState {
  reached?: SimTime;
  exposed?: SimTime;
  attended?: SimTime;
  comprehended?: SimTime;
  believed?: SimTime;
  intended?: SimTime;
  acted?: SimTime;
  relayed?: SimTime;
  stop?: FunnelStop;
  stopReason?: string;
}

export interface SeenState {
  count: number;
  lastAt: SimTime;
  headlines: string[];
  bodies: string[];
}

export interface OutageStats {
  /** 因停电失败/中断的计划项数 */
  inconvenience: number;
  disruptedSec: number;
  /** 其中事先不知情（措手不及）的项数与秒数 */
  surprised: number;
  surprisedSec: number;
  /** 真实停电窗口之外被取消/挪走的计划秒数 */
  overreactSec: number;
}

export interface AgentStats extends OutageStats {
  prepSpent: number;
  /** 按停电轮次（事件 id）分别累计 */
  byOutage: Record<string, OutageStats>;
}

export interface Agent {
  id: string;
  name: string;
  age: number;
  gender: 'f' | 'm';
  role: RoleId;
  roleLabel: string;
  householdId: string;
  home: string;
  unit: number;
  org?: string;
  workplace?: string;
  bio: string;
  speech: string;
  traits: Traits;
  /** 对官方通知的信任：初值 = 特质 trustOfficial，随经历变化（social_v1） */
  trustGov: number;
  /** 对某人的信任（有向）；缺省回落到关系的 trust */
  trustIn: Record<string, number>;
  /** 历次停电留下的经历（social_v2）；第一次有经历时才出现 */
  memory?: Experience[];
  habits: Habits;
  look: Look;
  wallet: string;
  loc: Loc;
  act: Activity | null;
  /** day → 计划 */
  plans: Record<number, PlanItem[]>;
  wokeAt: SimTime;
  lastMealAt: SimTime;
  phone: Phone;
  pendingPush: string[];
  inbox: string[];
  beliefs: Record<string, Belief>;
  funnel: Record<string, FunnelState>;
  seen: Record<string, SeenState>;
  told: Record<string, string[]>;
  /** 决策局部计数（随机数键） */
  dcount: Record<string, number>;
  stats: AgentStats;
}

/** 一轮停电对见证者意味着什么（与信任面板的经历一一对应，见实验记录 C4） */
export type ExperienceKind = 'surprised_uninformed' | 'surprised_informed' | 'vague_overreact' | 'clarified' | 'accurate' | 'false_alarm_costly' | 'false_alarm';

export interface Experience {
  outage: string;
  kind: ExperienceKind;
  text: string;
  t: SimTime;
}

/** family：因哪条主张调整（v2，用于把“为停电关门”造成的不便记到对应的那一轮） */
export type PlaceMode = { kind: 'normal' } | { kind: 'cold_menu'; from: SimTime; to: SimTime; by: string; family?: string } | { kind: 'closed_window'; from: SimTime; to: SimTime; by: string; family?: string };

export interface PlaceState {
  id: string;
  powered: boolean;
  mode: PlaceMode;
  occupants: string[];
}

export interface Relation {
  a: string;
  b: string;
  kind: 'family' | 'friend' | 'coworker' | 'neighbor';
  strength: number;
  trust: number;
  note?: string;
}

export interface Dm {
  id: string;
  from: string;
  to: string;
  familyId: string;
  versionId: string;
  sentAt: SimTime;
  readAt?: SimTime;
  decisionId?: string;
}

export interface WorldState {
  meta: {
    scenario: string;
    scenarioVersion: string;
    seed: number;
    rulesVersion: string;
    t: SimTime;
    seq: number;
  };
  agents: Record<string, Agent>;
  households: Record<string, { id: string; label: string; place: string; unit: number; members: string[] }>;
  places: Record<string, PlaceState>;
  orgs: Record<string, { id: string; name: string; place: string; manager?: string; staff: string[]; account: string }>;
  relations: Relation[];
  accounts: Record<string, number>;
  stock: Record<string, Record<string, number>>;
  prices: Record<string, Record<string, number>>;
  news: Record<string, NewsItem>;
  versions: Record<string, ClaimVersion>;
  boards: Record<string, { id: string; place: string; tile: Tile; posters: string[] }>;
  website: string[];
  dms: Record<string, Dm>;
  /** 挂起中的异步决策 */
  pending: Record<string, { agent: string; kind: 'reaction' | 'notify'; family?: string; commitAt: SimTime; provider: string }>;
}
