import type { SimTime } from '../core/time.ts';
import type { ActKind, Bucket } from '../data/tables.ts';
import type { Rates } from '../params.ts';
import type { AnchorKind } from '../world/interiors.ts';
import type { TieKind } from './def.ts';

/**
 * 世界状态：只由事件经 reduce.ts 改变；引擎与前端用同一个 reducer。
 * 需求与位置在两个事件之间按闭式计算（D66）。
 */

export type Weather = 'sun' | 'cloud' | 'rain';

/** 需求：在 t 时刻的值与此后的每小时变化量 */
export interface NeedsState {
  /** 顺序同 params.NEEDS：吃饱、精力、社交、乐趣 */
  v: [number, number, number, number];
  t: SimTime;
  rate: Rates;
}

/** 到了地方要做的事（出发时就定好，到了再核对一次还能不能做） */
export interface Intent {
  kind: ActKind;
  hobby?: string;
  /** 做多久（秒） */
  dur: number;
  label: string;
  anchors: AnchorKind[];
  /** 承诺的 id（固定安排）；自由选择没有 */
  commit?: string;
  /** 做到这个时刻为止（承诺的结束时刻） */
  until?: SimTime;
  away?: boolean;
  /** 一家人一起吃 */
  family?: boolean;
}

export interface MoveState {
  id: string;
  from: string;
  to: string;
  /** 折线顶点（格坐标） */
  pts: number[];
  t0: SimTime;
  t1: SimTime;
  mode: 'walk' | 'ebike';
  intent?: Intent;
}

export type Loc = { k: 'in'; place: string } | { k: 'move'; move: MoveState };

export interface ActState {
  id: string;
  kind: ActKind;
  hobby?: string;
  place: string;
  /** 所在的住户单元；公共区域 -1 */
  unit: number;
  /** 站位序号；-1 表示没占到位置 */
  anchor: number;
  t0: SimTime;
  /** 计划结束的时刻 */
  t1: SimTime;
  label: string;
  commit?: string;
  away?: boolean;
  family?: boolean;
  /** 这一段里已经聊过天 */
  chatted?: boolean;
}

export interface DayTally {
  use: Record<Bucket, number>;
  spent: number;
  earned: number;
  chats: number;
}

export interface PersonState {
  id: string;
  loc: Loc;
  act: ActState | null;
  needs: NeedsState;
  /** 承诺的处理结果：1 做了，2 错过 */
  done: Record<string, 1 | 2>;
  /** 自由选择的序号（随机数的键） */
  choiceN: number;
  /** 最近碰壁的地点：到这个时刻之前不再考虑 */
  avoid: Record<string, SimTime>;
  /** 今天各项消遣做了几次 */
  hobbyToday: Record<string, number>;
  today: DayTally;
  /** 当前这一段从何时起还没计入时间利用 */
  tallyT: SimTime;
  /** 本周已上班的天数；最后一次上班是哪天 */
  workedDays: number;
  lastWorkDay: number;
  /** 买完东西还没回家 */
  carrying: boolean;
  /** 被裁了：不再有班上，也没有工资 */
  laidOff?: boolean;
  /** 听说过的传言：话题 → 听到的时刻 */
  heard: Record<string, SimTime>;
}

export interface TieState {
  kind: TieKind;
  closeness: number;
  trust: number;
  /** 上次见面的时刻；-1 表示还没在运行里见过 */
  lastMet: SimTime;
  meets: number;
}

export interface HouseholdState {
  food: number;
  supplies: number;
}

export interface WorldState {
  t: SimTime;
  day: number;
  weather: Weather;
  people: Record<string, PersonState>;
  households: Record<string, HouseholdState>;
  /** 各单位的库存：商品 → 数量 */
  stock: Record<string, Record<string, number>>;
  /** 所有账户（人、家庭、单位、外部）的余额 */
  accounts: Record<string, number>;
  ties: Record<string, TieState>;
  /** 还不认识的两个人聊过几次 */
  co: Record<string, number>;
  /** 站位占用：地点 → 站位序号 → 人 */
  occupied: Record<string, Record<number, string>>;
  /** 各地点现在有谁（按到达顺序） */
  here: Record<string, string[]>;
}

export const emptyTally = (): DayTally => ({ use: { sleep: 0, work: 0, study: 0, meal: 0, chores: 0, leisure: 0, travel: 0, other: 0 }, spent: 0, earned: 0, chats: 0 });
