import type { SimTime } from '../core/time.ts';

/** 渠道：设备不是渠道（原方案第 20 页） */
export type Channel = 'website' | 'push' | 'board' | 'talk' | 'dm' | 'org';
export const PUBLISH_CHANNELS = ['website', 'push', 'board'] as const;
export type PublishChannel = (typeof PUBLISH_CHANNELS)[number];

export type WindowSlot =
  | { kind: 'exact'; from: number; to: number } // 当天秒数
  | { kind: 'coarse'; label: 'morning' | 'afternoon' | 'evening' }
  | { kind: 'all_day' };

export type Advice = 'charge_devices' | 'plan_elsewhere' | 'store_food';

/** 主张槽位：传播的最小单位 */
export interface Slots {
  event?: string;
  area?: 'north' | 'south' | 'town';
  day?: number;
  window?: WindowSlot;
  source?: 'gov' | 'press' | 'org' | 'person';
  certainty?: 'confirmed' | 'likely' | 'rumor';
  advice?: Advice[];
}

export type SlotKey = keyof Slots;
export const SLOT_KEYS: SlotKey[] = ['event', 'area', 'day', 'window', 'source', 'certainty', 'advice'];

export interface Mutation {
  slot: SlotKey;
  op: 'drop' | 'coarsen' | 'fill_worst_case' | 'weaken' | 'strengthen';
  from?: unknown;
  to?: unknown;
  because: Record<string, number | string>;
}

export interface ClaimVersion {
  id: string;
  familyId: string;
  parentId?: string;
  slots: Slots;
  contentHash: string;
  origin: { kind: 'publish' | 'relay' | 'correction' | 'org'; by: string; channel: Channel };
  /** 独立根源（发布 id），用于"同一根源重复不叠加"的置信度计算 */
  root: string;
  mutations: Mutation[];
  createdAt: SimTime;
}

export interface Publisher {
  kind: 'org' | 'admin';
  id: string;
  name: string;
}

export interface NewsDraft {
  id: string;
  familyId: string;
  headline: { text: string; slots: Slots };
  body: { text: string; slots: Slots };
  publisher: Publisher;
  correctionOf?: string;
}

export interface NewsItem {
  id: string;
  familyId: string;
  headline: { text: string; versionId: string };
  body: { text: string; versionId: string };
  publisher: Publisher;
  channels: Channel[];
  publishedAt: SimTime;
  correctionOf?: string;
  /** 管理员干预必须显式标记，不伪装成自然传播 */
  intervention: boolean;
}

export type Fragment = 'headline' | 'body' | 'poster_title' | 'poster_full' | 'speech' | 'text';

export type BeliefStatus = 'believe' | 'doubt' | 'disbelieve';

export interface BeliefSource {
  versionId: string;
  channel: Channel;
  from?: string;
  t: SimTime;
  root: string;
  credibility: number;
}

export interface Belief {
  familyId: string;
  /** 合并后此人相信的槽位 */
  slots: Slots;
  /** 每个槽位来自哪个版本（可追溯） */
  slotFrom: Partial<Record<SlotKey, string>>;
  /** 每个槽位的来源可信度（冲突裁决用） */
  slotCred: Partial<Record<SlotKey, number>>;
  /** 此人"持有"的版本（转述时以它为父版本） */
  versionId: string;
  confidence: number;
  status: BeliefStatus;
  sources: BeliefSource[];
  firstAt: SimTime;
  updatedAt: SimTime;
}

export interface Transmission {
  id: string;
  familyId: string;
  from: string;
  to: string;
  versionId: string;
  channel: Channel;
  t: SimTime;
}
