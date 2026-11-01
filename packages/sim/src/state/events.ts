import type { SimTime } from '../core/time.ts';
import type { Tile } from '../world/map.ts';
import type { Belief, Channel, ClaimVersion, Fragment, NewsItem, SlotKey, Transmission } from '../info/types.ts';
import type { ActKind, Activity, Dm, ExperienceKind, FunnelStop, ItemStatus, Phone, PlaceMode, PlanItem, Walk } from './types.ts';

export interface AttentionTrace {
  p: number;
  u: number;
  opened: boolean;
  factors: Record<string, number>;
}

export type DecisionKind = 'reaction' | 'notify';

export interface Exchange {
  from: string;
  to: string;
  family: string;
  mentioned: boolean;
  p: number;
  u: number;
  versionId?: string;
  factors: Record<string, number>;
}

export type EventBody =
  | { type: 'run_started'; scenario: string; seed: number }
  | { type: 'day_started'; day: number }
  | { type: 'plan_set'; agent: string; day: number; items: PlanItem[]; reason: 'daily' | 'revision' | 'fallback' | 'org'; decisionId?: string; note?: string }
  | { type: 'item_status'; agent: string; day: number; itemId: string; status: ItemStatus; reason?: string }
  | { type: 'walk_started'; agent: string; walk: Walk }
  | { type: 'walk_stopped'; agent: string; walkId: string; tile: Tile; reason: string }
  | { type: 'arrived'; agent: string; place: string; tile: Tile }
  | { type: 'activity_started'; agent: string; act: Activity }
  | { type: 'activity_ended'; agent: string; actId: string; kind: ActKind; place: string; itemId?: string; outcome: 'done' | 'interrupted' | 'failed'; reason?: string }
  | { type: 'woke'; agent: string }
  | { type: 'meal'; agent: string; source: 'home' | 'place' | 'bring'; place: string }
  | { type: 'phone'; agent: string; phone: Phone }
  | { type: 'transfer'; from: string; to: string; amount: number; memo: string; agent?: string }
  | { type: 'stock'; holder: string; item: string; delta: number; memo: string; agent?: string }
  | { type: 'purchase_failed'; agent: string; place: string; item: string; reason: string }
  | { type: 'power'; area: 'north' | 'south'; on: boolean; places: string[]; outage?: string }
  | { type: 'place_mode'; place: string; mode: PlaceMode; decisionId?: string }
  | { type: 'version_created'; version: ClaimVersion }
  | { type: 'news_published'; news: NewsItem }
  | { type: 'board_posted'; board: string; news: string }
  | { type: 'reached'; agent: string; family: string; channel: Channel; news?: string }
  | { type: 'exposure'; id: string; agent: string; family: string; channel: Channel; fragment: Fragment; versionId: string; news?: string; from?: string; attention: AttentionTrace }
  | { type: 'comprehended'; agent: string; exposureId: string; family: string; heardVersionId: string; extracted: SlotKey[]; missed: SlotKey[]; coarsened: SlotKey[] }
  | { type: 'belief_set'; agent: string; family: string; belief: Belief; prev?: { status: string; confidence: number; versionId: string }; exposureId?: string; reason: string }
  | { type: 'funnel_stop'; agent: string; family: string; stop: FunnelStop; reason: string }
  | { type: 'transmission'; tr: Transmission; conv?: string; dm?: string }
  | { type: 'conversation'; id: string; place: string; participants: string[]; exchanges: Exchange[]; topic: 'chat' | 'news' }
  | { type: 'dm_sent'; dm: Dm }
  | { type: 'dm_read'; agent: string; dm: string }
  | { type: 'push_pending'; agent: string; news: string }
  | { type: 'push_cleared'; agent: string; news: string }
  | { type: 'decision'; id: string; agent: string; kind: DecisionKind; family?: string; phase: 'requested' | 'committed'; provider: string; commitAt?: SimTime; chosen?: string; chosenLabel?: string; outcome?: string }
  | { type: 'org_notice'; org: string; from: string; to: string[]; text: string; versionId?: string; decisionId?: string }
  | { type: 'inconvenience'; agent: string; itemId: string; kind: ActKind; place: string; seconds: number; expected: boolean; reason: string; outage?: string }
  | { type: 'overreaction'; agent: string; itemId: string; seconds: number; reason: string; outage?: string }
  | { type: 'trust_changed'; agent: string; target: string; from: number; to: number; reason: string; outage?: string; family?: string }
  /** 一轮停电在此人心里留下的经历（social_v2）：下一轮的担心、查证与 Jev 观察都会用到 */
  | { type: 'experience'; agent: string; outage: string; kind: ExperienceKind; text: string }
  /** 虚惊一场：通知说要停的电一直没断（不改状态，只记录真相可见的时刻） */
  | { type: 'false_alarm'; area: 'north' | 'south'; outage: string }
  | { type: 'intervention'; by: 'admin' | 'script' | 'experiment'; note: string; payload?: unknown };

export type DomainEvent = EventBody & { seq: number; t: SimTime; cause?: number };
export type EventType = DomainEvent['type'];

/** 事件涉及的居民（用于按人查询时间线） */
export function eventAgents(e: DomainEvent): string[] {
  switch (e.type) {
    case 'conversation':
      return e.participants;
    case 'transmission':
      return [e.tr.from, e.tr.to];
    case 'dm_sent':
      return [e.dm.from, e.dm.to];
    case 'org_notice':
      return [e.from, ...e.to];
    case 'trust_changed':
      return e.target === 'gov' ? [e.agent] : [e.agent, e.target];
    default:
      return 'agent' in e && typeof e.agent === 'string' ? [e.agent] : [];
  }
}
