import type { CommunityDef, Look } from '@microcity/society';

/**
 * 立体世界的对外契约（D76、D77）。
 * 表现层只读：外面每帧给出每个人的姿态，世界负责画出来；它从不回写内核。
 *
 * 坐标：世界米。x 向东，y 向南（对应 three.js 的 z），h 是离地高度。
 * 朝向 θ：正面指向 (sin θ, cos θ)，θ = 0 朝南；与内核的站位朝向一致。
 */

export type Anim =
  | 'idle'
  | 'walk'
  | 'ride'
  | 'wait'
  // 坐着
  | 'sit'
  | 'sit_eat'
  | 'sit_work'
  | 'sit_study'
  | 'sit_talk'
  | 'sit_play'
  | 'sit_read'
  | 'sit_phone'
  | 'sit_tv'
  // 躺着
  | 'lie'
  // 站着
  | 'stand_work'
  | 'stand_talk'
  | 'teach'
  | 'cook'
  | 'serve'
  | 'browse'
  | 'chores'
  | 'phone'
  | 'dance'
  | 'exercise'
  | 'ball'
  | 'play';

export interface ActorLook extends Look {
  id: string;
  /** 身高系数：成人 1，儿童 0.6–0.9 */
  scale: number;
  elder: boolean;
  gender: 'f' | 'm';
}

export interface ActorPose {
  /** 不可见：去城里了 */
  visible: boolean;
  x: number;
  y: number;
  h: number;
  face: number;
  anim: Anim;
  /** 所在地点；在路上为 null */
  place: string | null;
  /** 室内时所在的楼层与住户单元；公共区域与路上 unit = -1 */
  floor: number;
  unit: number;
  /** 手里提着东西（买菜回家） */
  carry: boolean;
  /** 头顶的小图标；null 不显示 */
  emote: 'chat' | 'eat' | 'sleep' | 'pay' | 'work' | 'think' | null;
}

export type Weather = 'sun' | 'cloud' | 'rain';
export type CameraMode = 'overview' | 'street' | 'follow';

export interface Pick {
  kind: 'actor' | 'place';
  id: string;
}

export interface World3DOptions {
  canvas: HTMLCanvasElement;
  def: CommunityDef;
  /** 顺序固定；setPoses 的数组与之一一对应 */
  looks: ActorLook[];
  onPick?: (hit: Pick | null) => void;
  /** 相机档位被用户手势改变（例如在跟随时拖动地图） */
  onCameraMode?: (mode: CameraMode) => void;
  quality?: 'high' | 'low';
}

export interface World3DApi {
  /** 当天秒数（0–86400）与天气：决定太阳、天色、灯光 */
  setEnvironment(secOfDay: number, weather: Weather): void;
  /** 每帧调用。数组可复用；世界内部不保留引用 */
  setPoses(poses: readonly ActorPose[]): void;
  /** 跟随某人（null 取消）。被跟随的人进屋时自动出现室内剖面 */
  setFollow(id: string | null): void;
  setCameraMode(mode: CameraMode): void;
  getCameraMode(): CameraMode;
  /** 把镜头移到某个地点上方 */
  focusPlace(id: string): void;
  /** 某人头顶在画布上的像素位置；看不见返回 null */
  screenOf(id: string): { x: number; y: number } | null;
  resize(width: number, height: number, pixelRatio: number): void;
  /** 画一帧；dt 是墙钟毫秒（只用于镜头缓动与动画相位） */
  render(dtMs: number): void;
  dispose(): void;
}
