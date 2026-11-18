import type { SimTime } from '../core/time.ts';
import type { Bucket } from '../data/tables.ts';
import type { TieKind } from './def.ts';
import type { ActState, MoveState, Weather } from './state.ts';

/** 一个候选在决策记录里的样子：各项因子相加得效用 u，softmax 得概率 p */
export interface OptionTrace {
  id: string;
  label: string;
  place?: string;
  u: number;
  p: number;
  /** 因子：need 需求、like 兴趣、habit 时段、company 同伴、travel 路程、cost 花费、weather 天气、repeat 重复、late 太晚、base 底数 */
  f: Record<string, number>;
}

export type TransferKind = 'wage' | 'pension' | 'family' | 'allowance' | 'rent' | 'utilities' | 'purchase' | 'restock' | 'grant' | 'profit' | 'lunch';

export type EventBody =
  | { type: 'run_started'; community: string; seed: number; versions: { params: string; policy: string; social: string } }
  | { type: 'day_started'; day: number; weather: Weather }
  | { type: 'move_started'; agent: string; move: MoveState }
  | { type: 'arrived'; agent: string; place: string }
  | { type: 'act_started'; agent: string; act: ActState }
  | { type: 'act_ended'; agent: string; actId: string; outcome: 'done' | 'cut' }
  /** 自由选择：候选（最多留 6 个）、选中的、抽样用的随机数 */
  | { type: 'decision'; agent: string; n: number; options: OptionTrace[]; chosen: string; u: number; total: number }
  /** 错过了固定安排 */
  | { type: 'commit_missed'; agent: string; commit: string; label: string; reason: string }
  /** 到了地方发现做不成 */
  | { type: 'plan_failed'; agent: string; place: string; label: string; reason: string }
  | { type: 'transfer'; from: string; to: string; amount: number; kind: TransferKind; memo: string }
  /** 库存或存粮的变化；holder 是单位 id 或家庭账户名 */
  | { type: 'stock'; holder: string; item: string; delta: number; memo: string }
  | { type: 'chat'; a: string; b: string; place: string; topic: string; d: number }
  | { type: 'tie_formed'; a: string; b: string; kind: TieKind; via: string }
  | { type: 'tie_changed'; a: string; b: string; from: TieKind; to: TieKind }
  /** 干预开始或结束（时间轴上的记号；规则的改变由运行配置给出） */
  | { type: 'intervention'; index: number; kind: string; phase: 'start' | 'end'; label: string }
  | { type: 'laid_off'; agent: string; firm: string }
  /** 听说了一条传言；from 是告诉此人的人（最初的几个人没有） */
  | { type: 'heard'; agent: string; topic: string; from?: string }
  /** 每人每天的小结（午夜） */
  | { type: 'day_summary'; agent: string; day: number; use: Record<Bucket, number>; spent: number; earned: number; chats: number; mood: number; needs: [number, number, number, number] };

export type DomainEvent = EventBody & { seq: number; t: SimTime };
export type EventType = DomainEvent['type'];

/** 事件涉及的人（按人查时间线用） */
export function eventAgents(e: DomainEvent): string[] {
  switch (e.type) {
    case 'chat':
    case 'tie_formed':
    case 'tie_changed':
      return [e.a, e.b];
    case 'transfer':
      return [e.from, e.to];
    case 'heard':
      return e.from ? [e.agent, e.from] : [e.agent];
    default:
      return 'agent' in e ? [e.agent] : [];
  }
}
