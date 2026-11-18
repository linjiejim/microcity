import type { CommunitySpec, DomainEvent, WorldState } from '@microcity/society';

/** 一天的数据：这一天开始时的状态快照 + 这一天里的全部事件 */
export interface DayPack {
  day: number;
  snapshot: WorldState;
  events: DomainEvent[];
}

export type ToWorker = { type: 'start'; spec: CommunitySpec; seed: number; days: number } | { type: 'extend'; days: number } | { type: 'load'; day: number; req: number };

export type FromWorker =
  | { type: 'progress'; computed: number; target: number; ms: number; events: number }
  | { type: 'pack'; req: number; pack: DayPack | null }
  | { type: 'error'; message: string };
