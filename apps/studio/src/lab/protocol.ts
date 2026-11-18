import type { DayAgg, Intervention } from '@microcity/society';
import type { DayPack, WorldConfig } from '../sim/protocol.ts';

export type LabIn =
  /** 跑一条世界线，只要每天的统计 */
  | { type: 'line'; job: number; config: WorldConfig; days: number }
  /** 取某条世界线某一天的快照与事件（微观镜头用） */
  | { type: 'pack'; job: number; config: WorldConfig; day: number };

export type LabOut = { type: 'day'; job: number; day: number } | { type: 'line'; job: number; aggs: DayAgg[] } | { type: 'pack'; job: number; pack: DayPack } | { type: 'error'; job: number; message: string };

export const lineKey = (c: WorldConfig): string => JSON.stringify([c.spec, c.seed, c.interventions satisfies Intervention[]]);
