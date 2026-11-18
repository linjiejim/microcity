import type { CommunitySpec, DayAgg, DomainEvent, Intervention, WorldState } from '@microcity/society';

/** 一个世界由什么决定：社区规格、运行种子、干预。同样的配置永远得到同样的世界。 */
export interface WorldConfig {
  spec: CommunitySpec;
  seed: number;
  interventions: Intervention[];
}

/** 一天的数据：这一天开始时的状态快照 + 这一天里的全部事件 */
export interface DayPack {
  day: number;
  snapshot: WorldState;
  events: DomainEvent[];
}

export type ToWorker = { type: 'start'; config: WorldConfig; days: number } | { type: 'extend'; days: number } | { type: 'load'; day: number; req: number };

export type FromWorker =
  /** 又算完一天：附上这一天的统计（画像用，D86） */
  | { type: 'progress'; computed: number; target: number; ms: number; agg: DayAgg }
  | { type: 'pack'; req: number; pack: DayPack | null }
  | { type: 'error'; message: string };
