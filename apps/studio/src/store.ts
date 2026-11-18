import { create } from 'zustand';
import type { Weather } from '@microcity/society';
import type { CameraMode } from './world3d/types.ts';

/** 倍速档位：1 秒过多少模拟秒 */
export const SPEEDS = [1, 10, 60, 300, 1200] as const;
export type Speed = (typeof SPEEDS)[number];

/** 三个工作区：看世界、看画像、做实验 */
export type View = 'world' | 'portrait' | 'lab';

export interface AppState {
  view: View;
  /** 换了一个世界（社区、种子或干预变了）就加一 */
  worldKey: number;
  communityOpen: boolean;
  phase: 'loading' | 'ready' | 'error';
  error: string | null;
  /** 已经算完的天数 / 目标天数 */
  computed: number;
  target: number;
  /** 画面上的时刻（模拟秒）；每秒更新几次，够界面用 */
  now: number;
  weather: Weather;
  /** 正在等某一天的数据 */
  waiting: boolean;
  playing: boolean;
  speed: Speed;
  /** 一分钟看完一天：自动在无聊处快进、在有事处放慢 */
  director: boolean;
  follow: string | null;
  place: string | null;
  camera: CameraMode;
  /** 被跟随者的当天故事重算了一次（时间轴、人物卡据此刷新） */
  storyRev: number;
  peopleOpen: boolean;
  settingsOpen: boolean;
  whyOpen: boolean;
}

export const useApp = create<AppState>(() => ({
  view: 'world',
  worldKey: 0,
  communityOpen: false,
  phase: 'loading',
  error: null,
  computed: 0,
  target: 0,
  now: 0,
  weather: 'sun',
  waiting: false,
  playing: true,
  speed: 60,
  director: false,
  follow: null,
  place: null,
  camera: 'overview',
  storyRev: 0,
  peopleOpen: false,
  settingsOpen: false,
  whyOpen: false,
}));

export const set = useApp.setState;
