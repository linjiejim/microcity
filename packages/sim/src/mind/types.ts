import type { SimTime } from '../core/time.ts';
import type { Belief } from '../info/types.ts';
import type { DecisionKind } from '../state/events.ts';

export type CandidateKind = 'keep' | 'verify' | 'move' | 'adapt' | 'service' | 'prepare' | 'restore' | 'dm';

export interface Candidate {
  id: string;
  kind: CandidateKind;
  label: string;
  params: Record<string, string | number | boolean>;
}

export interface Rejected {
  id: string;
  label: string;
  reason: string;
}

/** 因子值与来源：rule:<规则 id> | model:<调用 id> | fallback:<原因> */
export interface FactorValue {
  value: number;
  source: string;
}

export interface SemanticAnswer {
  provider: 'rule' | 'jev';
  model: string;
  callIds: string[];
  fallback?: string;
  /** reaction：每个候选的人格契合概率 */
  fit?: Record<string, number>;
  concern?: number;
  verifyNeed?: number;
  /** notify：每个联系人“会主动发消息”的概率 */
  wouldMessage?: Record<string, number>;
  /** 规则心智：历次停电经历对“照常”的效用加减（v3；Jev 的答案里没有这一项） */
  keepBias?: number;
  cost?: number;
  latencyMs?: number;
  cached?: boolean;
}

/** 居民可见的观察（只含主观信息，不含世界真相） */
export interface Observation {
  person: { name: string; age: number; role: string; bio: string; traits: Record<string, string> };
  now: string;
  location: string;
  activity: string;
  belief: { summary: string; slots: Record<string, string>; confidence: number; heardFrom: string[] };
  atRisk: Array<{ item: string; time: string; place: string; overlapMin: number }>;
  options: Record<string, string>;
  contacts?: Array<{ id: string; name: string; relation: string; livesOrWorksInArea: boolean }>;
  /** 此人经历过的停电（最近两次，social_v2）；没有经历时省略 */
  pastExperience?: string[];
}

export interface DecisionRequest {
  id: string;
  agent: string;
  kind: DecisionKind;
  family: string;
  t: SimTime;
  commitAt: SimTime;
  n: number;
  trigger: { seq: number; reason: string };
  candidates: Candidate[];
  rejected: Rejected[];
  ruleFactors: Record<string, Record<string, FactorValue>>;
  observation: Observation;
  observationHash: string;
  belief: Belief;
  semanticRule: SemanticAnswer;
  answer?: SemanticAnswer;
}

export interface DecisionRecord {
  id: string;
  agent: string;
  agentName: string;
  kind: DecisionKind;
  family: string;
  t: SimTime;
  commitAt: SimTime;
  trigger: { seq: number; reason: string };
  observation: Observation;
  observationHash: string;
  provider: string;
  model: string;
  modelCallIds: string[];
  policyVersion: string;
  candidates: Candidate[];
  rejected: Rejected[];
  factors: Record<string, Record<string, FactorValue>>;
  utilities: Record<string, number>;
  probabilities: Record<string, number>;
  rng: { key: string; value: number };
  chosen: string[];
  commit: { at: SimTime; outcome: 'applied' | 'invalidated' | 'fallback'; reason?: string };
  summary: string;
  fallback?: string;
}
