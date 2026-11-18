import { reduce, type DomainEvent, type RuleParams, type WorldState } from '@microcity/society';
import type { DayPack } from '../sim/protocol.ts';

/** 一个人上一处落脚的地方：进屋、换座位时从这里走过去（只影响画面） */
export interface LastSpot {
  place: string;
  /** 站位序号；-1 没有站位；-2 表示刚从门口进来 */
  anchor: number;
  unit: number;
  t: number;
}

/**
 * 游标：某一天里任一时刻的世界状态。
 * 从当天的快照起，把时刻不晚于 t 的事件依次交给 reducer；往回拖就从快照重来。
 */
export class Cursor {
  state: WorldState;
  t: number;
  private i = 0;
  /** 每个人最近一次聊天的时刻与对象 */
  readonly lastChat = new Map<string, { t: number; with: string }>();
  readonly lastSpot = new Map<string, LastSpot>();

  constructor(
    readonly pack: DayPack,
    private readonly params: RuleParams,
  ) {
    this.state = structuredClone(pack.snapshot);
    this.t = this.state.t;
  }

  private reset(): void {
    this.state = structuredClone(this.pack.snapshot);
    this.i = 0;
    this.lastChat.clear();
    this.lastSpot.clear();
  }

  /** 移到 t；返回这次新应用的事件（往回拖时为空） */
  seek(t: number): DomainEvent[] {
    let applied: DomainEvent[] = [];
    if (t < this.t) {
      this.reset();
      applied = [];
    }
    const events = this.pack.events;
    const from = this.i;
    while (this.i < events.length && events[this.i]!.t <= t) {
      const e = events[this.i++]!;
      this.note(e);
      reduce(this.state, e, { params: this.params });
    }
    if (t >= this.t) applied = events.slice(from, this.i);
    this.t = t;
    return applied;
  }

  private note(e: DomainEvent): void {
    if (e.type === 'chat') {
      this.lastChat.set(e.a, { t: e.t, with: e.b });
      this.lastChat.set(e.b, { t: e.t, with: e.a });
    } else if (e.type === 'arrived') this.lastSpot.set(e.agent, { place: e.place, anchor: -2, unit: -1, t: e.t });
    else if (e.type === 'act_ended') {
      const act = this.state.people[e.agent]?.act;
      if (act) this.lastSpot.set(e.agent, { place: act.place, anchor: act.anchor, unit: act.unit, t: e.t });
    }
  }
}
