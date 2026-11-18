import { dayStart, DEFAULT_PARAMS, Engine, initialState, rand, type CommunityDef, type DomainEvent } from '@microcity/society';
import type { DayPack } from './protocol.ts';

/**
 * 按天推进内核（D70 先算后看）。
 * 第 d 天的数据 = 这一天开始前的状态快照 + 时刻落在这一天里的事件；
 * 从快照起把事件依次交给 reducer，就能得到这一天任一时刻的状态。
 */
export class DayRunner {
  private engine: Engine | undefined;
  private buffer: DomainEvent[] = [];
  private day = 0;

  constructor(
    private readonly def: CommunityDef,
    private readonly seed: number,
  ) {}

  get computed(): number {
    return this.day;
  }

  next(): DayPack {
    const day = this.day + 1;
    let snapshot;
    if (!this.engine) {
      // 第一天的快照是开局之前的状态：开局事件（所有人入睡）也在这一天的事件里
      snapshot = initialState(this.def, DEFAULT_PARAMS, this.seed, rand);
      this.engine = Engine.create(this.def, { seed: this.seed, onEvent: (e) => this.buffer.push(e) });
    } else snapshot = structuredClone(this.engine.state);
    this.engine.advance(dayStart(day + 1) - 1);
    const events = this.buffer;
    this.buffer = [];
    this.day = day;
    return { day, snapshot, events };
  }
}
