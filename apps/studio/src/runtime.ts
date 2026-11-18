import { dayOf, dayStart, DEFAULT_PARAMS, generateCommunity, hm, OLDTOWN, timeOfDay, type CommunityDef, type DayAgg, type PersonDef } from '@microcity/society';
import { SimClient } from './sim/client.ts';
import type { DayPack, WorldConfig } from './sim/protocol.ts';
import { set, useApp } from './store.ts';
import { Cursor } from './timeline/cursor.ts';
import { computePoses, makeStage, type Stage } from './timeline/poses.ts';
import { dayStory, type DayStory } from './timeline/segments.ts';
import type { ActorPose, World3DApi } from './world3d/types.ts';

/** 开场先算几天；之后在后台算到多少天 */
const FIRST_DAYS = 3;
const TARGET_DAYS = 30;
/** “一分钟看完一天”：没有跟随对象时的倍速 */
const DAY_PER_MINUTE = 1440;

/**
 * 运行时：把 Worker 算好的数据、游标、播放时钟、立体世界接在一起。
 * 每帧：推进时钟 → 游标移到这一刻 → 算出每个人的姿态 → 交给世界去画（D70、D77）。
 * 逐帧变化的东西放在这里，不进 React 状态；界面要的时刻每秒同步几次。
 */
class Runtime {
  config: WorldConfig = { spec: OLDTOWN, seed: 1, interventions: [] };
  /** 已经算完的每一天的统计（画像用） */
  aggs: DayAgg[] = [];
  def!: CommunityDef;
  stage!: Stage;
  people: Record<string, PersonDef> = {};
  client: SimClient | null = null;
  cursor: Cursor | null = null;
  world: World3DApi | null = null;
  /** 模拟时刻（秒，带小数） */
  t = hm(6, 40);
  poses: ActorPose[] = [];
  story: DayStory | null = null;
  private storyKey = '';
  private speedNow = 60;
  private lastSync = 0;
  private wall = 0;
  private wantDay = 0;

  /** 打开一个世界；at 是想停在的时刻（不给就从第一天清晨开始） */
  boot(config: WorldConfig, at?: number): void {
    this.config = config;
    this.aggs = [];
    this.story = null;
    this.storyKey = '';
    this.wantDay = 0;
    this.poses = [];
    this.t = at ?? hm(6, 40);
    this.def = generateCommunity(config.spec);
    this.stage = makeStage(this.def);
    this.people = Object.fromEntries(this.def.people.map((p) => [p.id, p]));
    this.client?.dispose();
    this.cursor = null;
    this.client = new SimClient(
      (p) => {
        this.aggs[p.agg.day - 1] = p.agg;
        set({ computed: p.computed, target: p.target });
        if (!this.cursor && p.computed >= 1) void this.ensure(dayOf(this.t));
        if (p.computed === FIRST_DAYS) this.client?.extend(TARGET_DAYS);
      },
      (message) => set({ phase: 'error', error: message }),
    );
    const s = useApp.getState();
    set({ phase: 'loading', error: null, computed: 0, target: FIRST_DAYS, now: this.t, follow: null, place: null, waiting: false, worldKey: s.worldKey + 1 });
    this.client.start(config, FIRST_DAYS);
  }

  dispose(): void {
    this.client?.dispose();
    this.client = null;
  }

  nameOf = (id: string): string => this.people[id]?.name ?? id;
  placeName = (id: string): string => this.stage.places[id]?.name ?? id;

  private use(pack: DayPack): void {
    this.cursor = new Cursor(pack, DEFAULT_PARAMS);
    this.storyKey = '';
    set({ phase: 'ready', waiting: false, now: this.t, weather: pack.snapshot.weather });
  }

  /** 确保某一天的数据在手；还没算到就等 */
  private async ensure(day: number): Promise<void> {
    if (!this.client || this.wantDay === day) return;
    this.wantDay = day;
    const pack = await this.client.load(day);
    if (this.wantDay !== day) return;
    this.wantDay = 0;
    if (pack && dayOf(this.t) === day) this.use(pack);
  }

  /** 能看到的最晚时刻 */
  get horizon(): number {
    return dayStart(useApp.getState().computed + 1) - 1;
  }

  seek(t: number): void {
    this.t = Math.max(0, Math.min(this.horizon, t));
    this.lastSync = 0;
  }

  seekDay(day: number): void {
    this.seek(dayStart(day) + timeOfDay(this.t));
  }

  follow(id: string | null): void {
    set({ follow: id, place: null, whyOpen: false, ...(id ? { camera: 'follow' as const } : useApp.getState().camera === 'follow' ? { camera: 'street' as const } : {}) });
    this.world?.setFollow(id);
    this.world?.setCameraMode(useApp.getState().camera);
    this.storyKey = '';
  }

  /** 导演：睡觉、上班时快进，在路上、聊天、花钱时放慢 */
  private directorSpeed(): number {
    const id = useApp.getState().follow;
    const ps = id ? this.cursor?.state.people[id] : undefined;
    if (!ps) return DAY_PER_MINUTE;
    if (ps.loc.k === 'move') return 90;
    const recent = this.story?.marks.some((m) => this.t >= m.t && this.t - m.t < 240);
    if (recent) return 120;
    const act = ps.act;
    if (!act) return 300;
    if (act.kind === 'sleep') return 5400;
    if (act.away || act.kind === 'work' || act.kind === 'school') return 2700;
    if (this.t - act.t0 < 120) return 150;
    return 720;
  }

  /** 画一帧。dt 是墙钟毫秒 */
  frame(dt: number): void {
    const s = useApp.getState();
    this.wall += dt;
    const cur = this.cursor;
    if (cur && s.playing && !s.waiting) {
      const want = s.director ? this.directorSpeed() : s.speed;
      this.speedNow += (want - this.speedNow) * Math.min(1, dt / 350);
      const next = this.t + (dt / 1000) * this.speedNow;
      if (next >= this.horizon) {
        this.t = this.horizon;
        if (s.computed >= s.target) set({ playing: false });
      } else this.t = next;
    }
    if (cur) {
      const day = dayOf(this.t);
      if (day !== cur.pack.day) {
        const pack = this.client?.cached(day);
        if (pack) this.use(pack);
        else {
          if (!s.waiting) set({ waiting: true });
          void this.ensure(day);
        }
      }
      const c = this.cursor!;
      if (dayOf(this.t) === c.pack.day) {
        if (s.waiting) set({ waiting: false });
        c.seek(this.t);
        computePoses(this.stage, c.state, this.t, c.lastChat, c.lastSpot, this.poses);
        if (timeOfDay(this.t) > hm(18) && day < s.computed) void this.client?.load(day + 1);
        const key = `${s.follow}@${c.pack.day}`;
        if (key !== this.storyKey) {
          this.storyKey = key;
          this.story = s.follow ? dayStory(c.pack, s.follow, this.nameOf, this.placeName) : null;
          set({ storyRev: s.storyRev + 1 });
        }
      }
      if (this.world) {
        this.world.setEnvironment(timeOfDay(this.t), c.state.weather);
        if (this.poses.length) this.world.setPoses(this.poses);
      }
      if (this.wall - this.lastSync > 125) {
        this.lastSync = this.wall;
        if (s.now !== this.t || s.weather !== c.state.weather) set({ now: this.t, weather: c.state.weather });
      }
    }
    this.world?.render(dt);
  }
}

export const runtime = new Runtime();
