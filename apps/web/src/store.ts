import { create } from 'zustand';
import { TownMap, applyAll, type Beat, type DomainEvent, type ExperimentManifest, type WorldState } from '@microcity/sim';
import { api, type Health, type RunRow, type RunStatus, type ScenarioView } from './lib/api.ts';
import { registerPlaceNames } from './lib/format.ts';

export type Workspace = 'gallery' | 'design' | 'observe' | 'review';

export type Modal =
  | null
  | { kind: 'news' }
  | { kind: 'experiment' }
  | { kind: 'decision'; id: string; runId?: string }
  | { kind: 'runs' }
  | { kind: 'lineage'; family: string }
  | { kind: 'help' }
  | { kind: 'diagnostics' }
  /** 实验清单（JSON）：复制、修改、导入、导出 */
  | { kind: 'manifest'; scenario: string; manifest: Partial<ExperimentManifest>; title?: string };

export interface ClockSync {
  t: number;
  at: number;
  speed: number;
  paused: boolean;
  blocked: boolean;
}

export interface Transient {
  icon: 'talk' | 'push' | 'web' | 'board' | 'dm' | 'org' | 'exclaim' | 'question' | 'boltOff' | 'rumor';
  until: number;
}

interface AppState {
  health?: Health;
  runs: RunRow[];
  runId?: string;
  run?: RunStatus;
  state?: WorldState;
  /** 本运行的场景（地图、剧本）与由它建的地图 */
  scenario?: ScenarioView;
  map?: TownMap;
  rev: number;
  clock: ClockSync;
  connected: boolean;
  workspace: Workspace;
  /** 最近事件（环形缓冲，用于城市气泡与时间轴实时追加） */
  recent: DomainEvent[];
  /** 时间轴用的历史事件（关键类型） */
  timeline: DomainEvent[];
  /** 服务端合成的现场叙事（节拍） */
  beats: Beat[];
  transient: Record<string, Transient>;
  dialogues: Record<string, { lines: Array<{ speaker: string; text: string }>; model: string }>;
  bubbles: Record<string, { convId: string; until: number }>;
  history?: { seq: number; t: number; state: WorldState };
  selectedAgent?: string;
  selectedPlace?: string;
  selectedFamily?: string;
  roofs: boolean;
  labels: boolean;
  overlay: 'spread' | 'none';
  /** 城市视图：3D 微缩小镇或平面地图（v4） */
  cityMode: '3d' | 'map';
  /** 观察：城市是否已挂载过（按需加载三维场景，v4 D60） */
  cityMounted: boolean;
  sideTab: 'feed' | 'people' | 'news';
  inspectorTab: 'overview' | 'mind' | 'memory' | 'relations' | 'decisions' | 'timeline';
  /** 完整档案抽屉（观察工作区） */
  profile?: string;
  reviewTab: 'wall' | 'society' | 'compare' | 'report';
  /** 复盘：查看时刻与对比基准（null = 此刻 / 首次发布前） */
  reviewT: number | null;
  reviewBase: number | null;
  /** 复盘：人物轨迹抽屉 */
  trajectory?: string;
  /** 对照：当前查看的实验 */
  experimentId?: string;
  /** 设计：建镇会话 */
  sessionId?: string;
  modal: Modal;
  toasts: Array<{ id: number; text: string; tone: 'info' | 'ok' | 'bad' }>;
  set: (p: Partial<AppState>) => void;
  toast: (text: string, tone?: 'info' | 'ok' | 'bad') => void;
}

let toastId = 0;

const savedWs = (localStorage.getItem('microcity.ws') as Workspace | null) ?? 'observe';

export const useApp = create<AppState>((set, get) => ({
  runs: [],
  rev: 0,
  clock: { t: 0, at: performance.now(), speed: 60, paused: true, blocked: false },
  connected: false,
  workspace: savedWs,
  recent: [],
  timeline: [],
  beats: [],
  transient: {},
  dialogues: {},
  bubbles: {},
  roofs: true,
  labels: true,
  overlay: 'spread',
  cityMode: (localStorage.getItem('microcity.city') as '3d' | 'map' | null) ?? '3d',
  cityMounted: savedWs === 'observe',
  sideTab: 'feed',
  inspectorTab: 'overview',
  reviewTab: 'wall',
  reviewT: null,
  reviewBase: null,
  modal: null,
  toasts: [],
  set: (p) => {
    if (p.workspace) localStorage.setItem('microcity.ws', p.workspace);
    if (p.cityMode) localStorage.setItem('microcity.city', p.cityMode);
    if (p.workspace === 'observe') p = { ...p, cityMounted: true };
    set(p);
  },
  toast: (text, tone = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3600);
  },
}));

/** 当前显示的状态：历史模式下是回放状态，否则是实时镜像 */
export const viewState = (s: Pick<AppState, 'history' | 'state'>): WorldState | undefined => s.history?.state ?? s.state;

/** 当前关注的主张族：选中的，或者剧本第一轮 */
export const focusFamily = (s: Pick<AppState, 'selectedFamily' | 'scenario'>): string => s.selectedFamily ?? s.scenario?.outages[0]?.family ?? 'F_OUTAGE';

/** 客户端插值的模拟时钟（服务端每 100ms 同步一次） */
export function displayTime(c: ClockSync, now = performance.now()): number {
  if (c.paused || c.blocked) return c.t;
  const dt = Math.min(0.2, (now - c.at) / 1000);
  return c.t + dt * c.speed;
}

export const TIMELINE_TYPES = ['news_published', 'power', 'decision', 'transmission', 'exposure', 'inconvenience', 'place_mode', 'org_notice', 'dm_sent', 'intervention', 'belief_set', 'trust_changed'] as const;

// ---------- 实时流 ----------
let ws: WebSocket | undefined;
let wsRun: string | undefined;
let retry = 0;
let closing = false;

export function connect(runId: string): void {
  if (wsRun === runId && ws && ws.readyState <= 1) return;
  closing = true;
  ws?.close();
  closing = false;
  wsRun = runId;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/api/runs/${runId}/stream`);
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    useApp.getState().set({ connected: true });
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    useApp.getState().set({ connected: false });
    if (closing || wsRun !== runId) return;
    const wait = Math.min(8000, 500 * 2 ** retry++);
    setTimeout(() => wsRun === runId && connect(runId), wait);
    ws = undefined;
  };
  sock.onmessage = (m) => {
    if (ws !== sock) return;
    const msg = JSON.parse(m.data as string);
    const st = useApp.getState();
    switch (msg.type) {
      case 'hello':
        st.set({ state: msg.state as WorldState, run: msg.run, beats: (msg.beats as Beat[]) ?? [], rev: st.rev + 1, clock: { t: msg.run.t, at: performance.now(), speed: msg.run.speed, paused: msg.run.paused, blocked: msg.run.blocked } });
        void loadTimeline(runId);
        break;
      case 'events':
        onEvents(msg.events as DomainEvent[]);
        break;
      case 'beats': {
        const incoming = msg.beats as Beat[];
        const beats = [...st.beats];
        for (const b of incoming) {
          const i = beats.findIndex((x) => x.id === b.id);
          if (i >= 0) beats[i] = b;
          else beats.push(b);
        }
        st.set({ beats: beats.slice(-500) });
        break;
      }
      case 'clock':
        st.set({ run: msg.run, clock: { t: msg.run.t, at: performance.now(), speed: msg.run.speed, paused: msg.run.paused, blocked: msg.run.blocked } });
        break;
      case 'dialogue':
        st.set({ dialogues: { ...st.dialogues, [msg.convId]: { lines: msg.lines, model: msg.model } } });
        break;
      case 'decision':
        break;
    }
  };
}

export function disconnect(): void {
  closing = true;
  wsRun = undefined;
  ws?.close();
  ws = undefined;
  closing = false;
}

const TL = new Set<string>(TIMELINE_TYPES);

function onEvents(events: DomainEvent[]): void {
  const st = useApp.getState();
  if (!st.state) return;
  // 丢弃已应用过的事件（重连补发时可能重复）
  const fresh = events.filter((e) => e.seq > st.state!.meta.seq);
  if (fresh.length === 0) return;
  applyAll(st.state, fresh);
  const transient = { ...st.transient };
  const bubbles = { ...st.bubbles };
  const now = performance.now();
  for (const e of fresh) {
    switch (e.type) {
      case 'exposure': {
        const icon = e.channel === 'push' ? 'push' : e.channel === 'website' ? 'web' : e.channel === 'board' ? 'board' : e.channel === 'dm' ? 'dm' : e.channel === 'org' ? 'org' : 'talk';
        transient[e.agent] = { icon, until: now + 2600 };
        break;
      }
      case 'belief_set':
        if (e.belief.status === 'believe' && e.prev?.status !== 'believe') transient[e.agent] = { icon: e.belief.slots.window?.kind === 'all_day' ? 'rumor' : 'exclaim', until: now + 3000 };
        break;
      case 'decision':
        if (e.phase === 'requested') transient[e.agent] = { icon: 'question', until: now + 3000 };
        break;
      case 'conversation':
        if (e.topic === 'news') for (const p of e.participants) bubbles[p] = { convId: e.id, until: now + 5000 };
        else for (const p of e.participants) if (!transient[p] || transient[p]!.until < now) transient[p] = { icon: 'talk', until: now + 1600 };
        break;
      case 'inconvenience':
        transient[e.agent] = { icon: 'boltOff', until: now + 4000 };
        break;
    }
  }
  const recent = [...st.recent, ...fresh].slice(-1500);
  const timeline = [...st.timeline, ...fresh.filter((e) => TL.has(e.type) && keepForTimeline(e))];
  st.set({ rev: st.rev + 1, recent, transient, bubbles, timeline });
}

function keepForTimeline(e: DomainEvent): boolean {
  if (e.type === 'decision') return e.phase === 'committed';
  if (e.type === 'belief_set') return e.belief.status === 'believe' && e.prev?.status !== 'believe';
  return true;
}

export async function loadTimeline(runId: string): Promise<void> {
  try {
    const evs = await api.events(runId, { types: [...TIMELINE_TYPES], limit: 20000 });
    const st = useApp.getState();
    if (st.runId !== runId) return;
    const maxSeq = evs.at(-1)?.seq ?? 0;
    const live = st.timeline.filter((e) => e.seq > maxSeq);
    st.set({ timeline: [...evs.filter(keepForTimeline), ...live] });
  } catch {
    /* 时间轴加载失败不影响主视图 */
  }
}

/** 打开一条运行：先取场景（地图与剧本），再接实时流 */
export async function openRun(runId: string): Promise<void> {
  const st = useApp.getState();
  st.set({ runId, state: undefined, history: undefined, timeline: [], recent: [], beats: [], transient: {}, bubbles: {}, dialogues: {}, selectedFamily: undefined, selectedAgent: undefined, selectedPlace: undefined, profile: undefined, trajectory: undefined, reviewT: null, reviewBase: null });
  localStorage.setItem('microcity.run', runId);
  try {
    const scenario = await api.scenario(runId);
    if (useApp.getState().runId !== runId) return;
    const map = new TownMap(scenario.map.w, scenario.map.h, scenario.map.tiles, scenario.map.places, scenario.map.props);
    registerPlaceNames(scenario.map.places);
    useApp.getState().set({ scenario, map });
  } catch (e) {
    useApp.getState().toast(`载入场景失败：${(e as Error).message}`, 'bad');
  }
  connect(runId);
}

export async function refreshRuns(): Promise<RunRow[]> {
  const runs = await api.runs();
  useApp.getState().set({ runs });
  return runs;
}
