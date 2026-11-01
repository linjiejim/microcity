import type {
  Agent,
  Beat,
  BeliefCensus,
  BranchSpec,
  ClaimVersion,
  DecisionRecord,
  DomainEvent,
  ExperimentManifest,
  FunnelMetrics,
  Look,
  NewsItem,
  OutageEventSpec,
  OutageTruth,
  OutcomeMetrics,
  PersonCard,
  PlaceDef,
  Prediction,
  Prop,
  PublishChannel,
  SeriesPoint,
  Slots,
  TileKind,
  TownSpec,
  TownStats,
  Transmission,
  TrustSummary,
  WorldState,
} from '@microcity/sim';

export interface RunStatus {
  id: string;
  name: string;
  scenario: string;
  provider: 'rule' | 'jev';
  seed: number;
  t: number;
  seq: number;
  speed: number;
  paused: boolean;
  blocked: boolean;
  pending: number;
  spend: number;
  parent: string | null;
  forkT: number | null;
  branch: string | null;
  experimentId: string | null;
  dialogue: boolean;
}

export interface RunRow {
  id: string;
  name: string;
  scenario: string;
  scenarioName: string;
  seed: number;
  provider: 'rule' | 'jev';
  parent_run_id: string | null;
  fork_seq: number | null;
  fork_t: number | null;
  status: string;
  created_at: string;
  experiment_id: string | null;
  branch: string | null;
  live: boolean;
}

export interface Health {
  ok: boolean;
  /** 演示站：访客只能跑规则模式，操作有限额 */
  public: { limits: { maxSeeds: number; maxRunningExperiments: number; experimentsPerHour: number; runsPerHour: number; modelCallsPerHour: number; keepHours: number } } | null;
  models: { access: boolean; jevAllowed: boolean; jev: string; generative: string };
  budget: { spentUsd: number; globalCapUsd: number; runCapUsd: number };
  speeds: number[];
}

export interface ScenarioView {
  id: string;
  name: string;
  version: string;
  start: number;
  map: { w: number; h: number; tiles: TileKind[]; places: PlaceDef[]; props: Prop[] };
  items: Array<{ id: string; name: string }>;
  outages: OutageTruth[];
  events: OutageEventSpec[];
  eventText: string[];
  script: Array<{ at: number; kind: string; note: string; news?: string; family?: string; headline?: string; channels?: PublishChannel[]; area?: string; on?: boolean; outage?: string }>;
  stats: TownStats;
}

export interface AgentDetail {
  agent: Agent;
  relations: Array<{ other: string; name: string; kind: string; strength: number; trust: number; baseTrust: number; note: string | null }>;
  decisions: Array<{ id: string; t: number; commitAt: number; kind: string; family: string; provider: string; model: string; chosen: string[]; chosenLabels: string[]; outcome: string; fallback: string | null; summary: string }>;
  timeline: DomainEvent[];
}

export interface ModelCallView {
  id: string;
  provider: string;
  model: string;
  cached: boolean;
  costUsd: number;
  latencyMs: number;
  error: string | null;
  request: unknown;
  response: unknown;
}

export interface Metrics {
  family: string;
  funnel: FunnelMetrics;
  t50: number | null;
  t80: number | null;
  census: BeliefCensus;
  outcome: OutcomeMetrics;
  trust: TrustSummary;
  places: Array<{ id: string; occupants: number; powered: boolean; mode: string }>;
  health: { decisions: { total: number; byProvider: Record<string, number>; fallbacks: number }; calls: { calls: number; cached: number; errors: number; cost: number; avgLatency: number }; pending: number; blocked: boolean };
}

export interface Lineage {
  family: string;
  versions: ClaimVersion[];
  transmissions: Transmission[];
  news: NewsItem[];
  holders: Record<string, string[]>;
}

export interface Trajectory {
  agent: string;
  family: string;
  samples: Array<{ t: number; label: string; card: PersonCard }>;
  beats: Beat[];
  trust: Array<{ t: number; target: string; name: string; from: number; to: number; reason: string }>;
}

export interface BuilderMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string;
  source?: 'model' | 'offline' | 'form' | 'preset' | 'error';
  changes?: string[];
  warnings?: string[];
  suggestions?: string[];
}

export interface TownPreview {
  hash: string;
  name: string;
  stats: TownStats;
  map: { w: number; h: number; tiles: TileKind[]; places: PlaceDef[]; props: Prop[] };
  people: Array<{ id: string; name: string; age: number; gender: 'f' | 'm'; role: string; district: string; household: string; look: Look; bio: string }>;
  events: string[];
}

export interface BuilderView {
  id: string;
  spec: TownSpec;
  messages: BuilderMessage[];
  preview: TownPreview;
  modelAccess: boolean;
  warnings?: string[];
  reply?: BuilderMessage;
}

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  spec: TownSpec;
  preview: TownPreview;
}

export interface Stat {
  n: number;
  missing: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  values: Array<number | null>;
}

export interface Paired {
  better: number;
  worse: number;
  same: number;
  medianDiff: number | null;
}

export interface OutageMetrics {
  family: string;
  t50: number | null;
  t80: number | null;
  aware: number;
  exact: number;
  allDay: number;
  believed: number;
  intended: number;
  relayed: number;
  surprisedPeople: number;
  surprisedMin: number;
  affected: number;
  overreactMin: number;
  versions: number;
}

export interface BranchMetrics {
  seed: number;
  outages: Record<string, OutageMetrics>;
  trust: TrustSummary;
  decisions: { total: number; byProvider: Record<string, number>; fallbacks: number };
  calls: { calls: number; cached: number; errors: number; cost: number; avgLatency: number };
  finalHash: string;
}

export interface ExperimentResult {
  version: 2 | 3;
  forkT: number;
  forkSeq: number;
  forkHash: string;
  baseRunId: string;
  seeds: number[];
  reference: string;
  outages: Array<{ id: string; family: string; area: string; day: number; from: number; to: number }>;
  branches: Record<string, { label: string; runId: string; perSeed: BranchMetrics[]; scenario?: string; changes?: string[] }>;
  stats: Record<string, Record<string, Stat>>;
  paired: Record<string, Record<string, Paired>>;
  predictions?: PredictionVerdict[];
}

export interface PredictionVerdict {
  id: string;
  verdict: '支持' | '部分支持' | '不支持' | '无法判定';
  median: number | null;
  higher: number;
  lower: number;
  n: number;
}

/** 实验广场的一张卡片 */
/** 广场卡片的示意图（与 apps/server/src/gallery.ts 的 GalleryFigure 一致） */
export type GalleryFigure =
  | { kind: 'dots'; total: number; unit: string; a: { label: string; value: number }; b: { label: string; value: number }; note: string }
  | { kind: 'race'; unit: string; aLabel: string; bLabel: string; rows: Array<{ label: string; a: number; b: number; aText: string; bText: string }>; note: string }
  | { kind: 'chain'; hops: string[]; rows: Array<{ label: string; values: number[] }>; note: string }
  | { kind: 'robust'; rows: Array<{ label: string; rule: number; jev: number }>; note: string }
  | { kind: 'diverge'; unit: string; rows: Array<{ label: string; value: number; text: string }>; note: string };

export interface GalleryCard {
  id: string;
  version: number;
  title: string;
  classic: string;
  question: string;
  guess: { prompt: string; options: string[]; answer: number; explain: string };
  findings: Array<{ text: string; rule?: string; jev?: string }>;
  doc?: string;
  figure?: GalleryFigure;
  branches: Record<string, BranchSpec>;
  predictions?: Prediction[];
  seeds: number[];
  scenario: string;
  town: { name: string; population: number };
  experiment: { id: string; status: string } | null;
}

export interface Experiment {
  id: string;
  manifest: ExperimentManifest;
  status: 'running' | 'done' | 'failed';
  created_at: string;
  error: string | null;
  result: ExperimentResult | null;
  live: { status: string; seedIndex: number; seeds: number; progress: Record<string, number> } | null;
}

export interface Fact {
  id: string;
  text: string;
}
export interface FactGroup {
  key: string;
  title: string;
  facts: Fact[];
}
export interface ReportView {
  id: string;
  subject: string;
  source: 'model' | 'template';
  model: string;
  report: {
    title: string;
    summary: string;
    findings: Array<{ text: string; cites: string[] }>;
    stories: Array<{ person: string; text: string; cites: string[] }>;
    socialChange: { text: string; cites: string[] };
    caveats: string[];
  };
  facts: { subject: { kind: string; id: string; name: string; at: string }; groups: FactGroup[]; people: string[] };
  validation: { ok: boolean; problems: string[]; attempts: number } | null;
  cost: number;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`);
  return data as T;
}

const key = () => `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const api = {
  health: () => req<Health>('GET', '/api/health'),
  runs: () => req<RunRow[]>('GET', '/api/runs'),
  createRun: (p: { seed: number; provider: 'rule' | 'jev'; name?: string; script?: 'outage' | 'quiet'; scenario?: string }) => req<RunStatus>('POST', '/api/runs', { ...p, idempotencyKey: key() }),
  run: (id: string) => req<RunStatus>('GET', `/api/runs/${id}`),
  scenario: (id: string) => req<ScenarioView>('GET', `/api/runs/${id}/scenario`),
  control: (id: string, body: { op: 'play' | 'pause' | 'speed' | 'step' | 'jump'; speed?: number; step?: 'event' | '10min'; to?: string }) => req<RunStatus>('POST', `/api/runs/${id}/control`, body),
  stateAt: (id: string, t: number) => req<{ seq: number; historical: boolean; state: WorldState; t: number }>('GET', `/api/runs/${id}/state?t=${t}`),
  state: (id: string, seq?: number) => req<{ seq: number; historical: boolean; state: WorldState }>('GET', `/api/runs/${id}/state${seq !== undefined ? `?seq=${seq}` : ''}`),
  agent: (id: string, aid: string) => req<AgentDetail>('GET', `/api/runs/${id}/agents/${aid}`),
  decision: (id: string, did: string) => req<{ record: DecisionRecord; calls: ModelCallView[] }>('GET', `/api/runs/${id}/decisions/${did}`),
  news: (id: string) => req<Array<NewsItem & { headlineSlots?: Slots; bodySlots?: Slots }>>('GET', `/api/runs/${id}/news`),
  publish: (id: string, p: { headline: string; body: string; slots: Slots; headlineSlots: Slots; channels: PublishChannel[]; correctionOf?: string }) => req<{ id: string; familyId: string }>('POST', `/api/runs/${id}/news`, { ...p, idempotencyKey: key() }),
  lineage: (id: string, fid: string) => req<Lineage>('GET', `/api/runs/${id}/families/${fid}/lineage`),
  metrics: (id: string, family?: string) => req<Metrics>('GET', `/api/runs/${id}/metrics${family ? `?family=${family}` : ''}`),
  events: (id: string, p: { after?: number; limit?: number; types?: string[] } = {}) =>
    req<DomainEvent[]>('GET', `/api/runs/${id}/events?after=${p.after ?? 0}&limit=${p.limit ?? 20000}${p.types ? `&types=${p.types.join(',')}` : ''}`),
  replayCheck: (id: string) => req<{ ok: boolean; events: number; rebuilt: string; live: string; checkpoints: Array<{ seq: number; ok: boolean }> }>('GET', `/api/runs/${id}/replay-check`),
  dialogue: (id: string, cid: string) => req<{ lines: Array<{ speaker: string; text: string }>; model: string; source: string }>('GET', `/api/runs/${id}/dialogues/${cid}`),
  fork: (id: string, p: { at?: string; name?: string }) => req<RunStatus>('POST', `/api/runs/${id}/fork`, { ...p, idempotencyKey: key() }),
  chronicle: (id: string, level: 'key' | 'feed' = 'key') => req<Beat[]>('GET', `/api/runs/${id}/chronicle?level=${level}`),
  series: (id: string, step = 1800, family?: string) => req<{ family: string; step: number; points: SeriesPoint[] }>('GET', `/api/runs/${id}/series?step=${step}${family ? `&family=${family}` : ''}`),
  trajectory: (id: string, aid: string, family?: string) => req<Trajectory>('GET', `/api/runs/${id}/agents/${aid}/trajectory${family ? `?family=${family}` : ''}`),
  monologue: (id: string, aid: string, p: { t?: number; family?: string }) => req<{ card: PersonCard; text: string; source: 'model' | 'template'; model: string; problems?: string[] }>('POST', `/api/runs/${id}/agents/${aid}/monologue`, p),
  report: (id: string) => req<ReportView | null>('GET', `/api/runs/${id}/report`),
  makeReport: (id: string, force = false) => req<ReportView>('POST', `/api/runs/${id}/report`, { force }),
  presets: () => req<Preset[]>('GET', '/api/presets'),
  newSession: (preset?: string) => req<BuilderView>('POST', '/api/builder/sessions', { preset }),
  session: (id: string) => req<BuilderView>('GET', `/api/builder/sessions/${id}`),
  say: (id: string, text: string) => req<BuilderView>('POST', `/api/builder/sessions/${id}/messages`, { text }),
  setSpec: (id: string, spec: TownSpec, source: 'form' | 'preset' = 'form') => req<BuilderView>('PUT', `/api/builder/sessions/${id}/spec`, { spec, source }),
  launch: (id: string, p: { seed: number; provider: 'rule' | 'jev'; script?: 'outage' | 'quiet' }) => req<RunStatus>('POST', `/api/builder/sessions/${id}/launch`, { ...p, idempotencyKey: key() }),
  gallery: () => req<GalleryCard[]>('GET', '/api/gallery'),
  runGallery: (id: string) => req<{ id: string; status: string }>('POST', `/api/gallery/${id}/run`),
  startExperiment: (p: { scenario?: string; builderSession?: string; seed?: number; seeds?: number[]; seedCount?: number; provider?: 'rule' | 'jev'; branches?: Record<string, BranchSpec>; name?: string; manifest?: Partial<ExperimentManifest> }) =>
    req<{ id: string; manifest: ExperimentManifest }>('POST', '/api/experiments', { ...p, idempotencyKey: key() }),
  experiment: (id: string) => req<Experiment>('GET', `/api/experiments/${id}`),
  experiments: () => req<Array<Omit<Experiment, 'result' | 'error'> & { scenarioName: string }>>('GET', '/api/experiments'),
  expReport: (id: string) => req<ReportView | null>('GET', `/api/experiments/${id}/report`),
  makeExpReport: (id: string, force = false) => req<ReportView>('POST', `/api/experiments/${id}/report`, { force }),
};
