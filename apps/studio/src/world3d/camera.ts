import * as THREE from 'three';
import type { CameraMode } from './types.ts';

/**
 * 镜头：绕目标点的轨道相机，三档（俯瞰、街道、跟随）之间平滑过渡。
 * 视场角很小，离得远，所以近大远小很弱——这是“微缩模型”观感的来源之一。
 */

interface Orbit {
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
}

const PRESET: Record<CameraMode | 'interior', Orbit> = {
  overview: { yaw: 0.5, pitch: 0.86, dist: 400, fov: 22 },
  street: { yaw: 0.5, pitch: 0.62, dist: 110, fov: 24 },
  follow: { yaw: 0.45, pitch: 0.66, dist: 32, fov: 26 },
  interior: { yaw: 0.45, pitch: 0.92, dist: 27, fov: 26 },
};

const LIMIT = { minDist: 9, maxDist: 560, minPitch: 0.2, maxPitch: 1.45 };

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(22, 1, 1, 4000);
  readonly target = new THREE.Vector3();
  mode: CameraMode = 'overview';
  /** 当前值与目标值 */
  private cur: Orbit = { ...PRESET.overview };
  private goal: Orbit = { ...PRESET.overview };
  private readonly goalTarget = new THREE.Vector3();
  private interior = false;
  /** 用户在跟随时自己调过的距离与角度（进出屋时保留相对偏移） */
  private userDist = 1;
  private readonly bounds: { w: number; h: number };
  private dragging: null | { x: number; y: number; orbit: boolean; moved: number } = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private readonly el: HTMLElement;
  private readonly onMode: (m: CameraMode) => void;
  private readonly onClick: (x: number, y: number) => void;
  private readonly off: Array<() => void> = [];

  constructor(el: HTMLElement, bounds: { w: number; h: number }, onMode: (m: CameraMode) => void, onClick: (x: number, y: number) => void) {
    this.el = el;
    this.bounds = bounds;
    this.onMode = onMode;
    this.onClick = onClick;
    this.target.set(bounds.w / 2, 0, bounds.h / 2);
    this.goalTarget.copy(this.target);
    this.bind();
    this.apply();
  }

  get distance(): number {
    return this.cur.dist;
  }

  get yaw(): number {
    return this.cur.yaw;
  }

  setMode(mode: CameraMode, keepTarget = true): void {
    const p = PRESET[mode] ?? PRESET.overview;
    this.mode = PRESET[mode] ? mode : 'overview';
    this.goal.pitch = p.pitch;
    this.goal.dist = p.dist;
    this.goal.fov = p.fov;
    this.userDist = 1;
    this.interior = false;
    if (!keepTarget || mode === 'overview') this.goalTarget.set(this.bounds.w / 2, 0, this.bounds.h / 2);
  }

  focus(x: number, z: number): void {
    this.goalTarget.set(x, 0, z);
    if (this.mode === 'overview') this.setMode('street');
  }

  /** 跟随：每帧给出目标的位置；indoor 表示目标在屋里（镜头抬高、拉近，好往屋里看） */
  track(x: number, y: number, z: number, indoor: boolean): void {
    this.goalTarget.set(x, y + 1.0, z);
    if (indoor !== this.interior) {
      this.interior = indoor;
      const p = indoor ? PRESET.interior : PRESET.follow;
      this.goal.pitch = p.pitch;
      this.goal.dist = p.dist * this.userDist;
    }
  }

  update(dtMs: number): void {
    const dt = Math.min(0.1, dtMs / 1000);
    const k = 1 - Math.exp(-dt / 0.28);
    const kt = 1 - Math.exp(-dt / (this.mode === 'follow' ? 0.22 : 0.3));
    this.target.lerp(this.goalTarget, kt);
    let dy = this.goal.yaw - this.cur.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.cur.yaw += dy * k;
    this.cur.pitch += (this.goal.pitch - this.cur.pitch) * k;
    this.cur.dist += (this.goal.dist - this.cur.dist) * k;
    this.cur.fov += (this.goal.fov - this.cur.fov) * k;
    this.apply();
  }

  private apply(): void {
    const { yaw, pitch, dist, fov } = this.cur;
    const cp = Math.cos(pitch);
    this.camera.position.set(this.target.x + Math.sin(yaw) * cp * dist, this.target.y + Math.sin(pitch) * dist, this.target.z + Math.cos(yaw) * cp * dist);
    this.camera.lookAt(this.target);
    if (Math.abs(this.camera.fov - fov) > 0.01) this.camera.fov = fov;
    this.camera.near = Math.max(0.5, dist * 0.08);
    this.camera.far = dist * 3 + 2600;
    this.camera.updateProjectionMatrix();
  }

  /** 验收与截图用：直接摆镜头 */
  debugOrbit(o: { yaw?: number; pitch?: number; dist?: number; x?: number; z?: number; snap?: boolean }): void {
    if (o.yaw !== undefined) this.goal.yaw = o.yaw;
    if (o.pitch !== undefined) this.goal.pitch = o.pitch;
    if (o.dist !== undefined) this.goal.dist = o.dist;
    if (o.x !== undefined) this.goalTarget.x = o.x;
    if (o.z !== undefined) this.goalTarget.z = o.z;
    if (o.snap) {
      this.cur = { ...this.goal };
      this.target.copy(this.goalTarget);
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private zoom(factor: number): void {
    const d = Math.max(LIMIT.minDist, Math.min(LIMIT.maxDist, this.goal.dist * factor));
    if (this.mode === 'follow') {
      this.userDist *= d / this.goal.dist;
      this.goal.dist = d;
      return;
    }
    this.goal.dist = d;
    // 缩放越过阈值就换档（带回差，免得来回跳）
    if (this.mode === 'overview' && d < 200) {
      this.mode = 'street';
      this.goal.pitch = PRESET.street.pitch;
      this.goal.fov = PRESET.street.fov;
      this.onMode('street');
    } else if (this.mode === 'street' && d > 260) {
      this.mode = 'overview';
      this.goal.pitch = PRESET.overview.pitch;
      this.goal.fov = PRESET.overview.fov;
      this.onMode('overview');
    }
  }

  private pan(dx: number, dy: number): void {
    // 屏幕上拖一个像素，地面上移动多少米：按视场角与距离换算
    const perPx = (2 * Math.tan((this.cur.fov * Math.PI) / 360) * this.cur.dist) / Math.max(1, this.el.clientHeight);
    const sx = -dx * perPx;
    const sz = (-dy * perPx) / Math.max(0.35, Math.sin(this.cur.pitch));
    const c = Math.cos(this.cur.yaw);
    const s = Math.sin(this.cur.yaw);
    this.goalTarget.x += sx * c + sz * s;
    this.goalTarget.z += -sx * s + sz * c;
    const m = 30;
    this.goalTarget.x = Math.max(-m, Math.min(this.bounds.w + m, this.goalTarget.x));
    this.goalTarget.z = Math.max(-m, Math.min(this.bounds.h + m, this.goalTarget.z));
  }

  private orbit(dx: number, dy: number): void {
    this.goal.yaw -= dx * 0.006;
    this.goal.pitch = Math.max(LIMIT.minPitch, Math.min(LIMIT.maxPitch, this.goal.pitch + dy * 0.005));
  }

  private bind(): void {
    const el = this.el;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, opts);
      this.off.push(() => el.removeEventListener(type, fn, opts));
    };
    on('contextmenu', (e) => e.preventDefault());
    on('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        this.dragging = null;
        return;
      }
      this.dragging = { x: e.clientX, y: e.clientY, orbit: e.button === 2 || e.shiftKey || e.altKey || this.mode === 'follow', moved: 0 };
    });
    on('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
      }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (this.pinch > 0 && d > 0) this.zoom(this.pinch / d);
        this.pinch = d;
        return;
      }
      const g = this.dragging;
      if (!g) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      g.x = e.clientX;
      g.y = e.clientY;
      g.moved += Math.abs(dx) + Math.abs(dy);
      if (g.moved < 4) return;
      if (g.orbit) this.orbit(dx, dy);
      else this.pan(dx, dy);
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      const g = this.dragging;
      this.dragging = null;
      if (g && g.moved < 5 && e.type === 'pointerup') {
        const r = el.getBoundingClientRect();
        this.onClick(e.clientX - r.left, e.clientY - r.top);
      }
    };
    on('pointerup', up);
    on('pointercancel', up);
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey) this.zoom(Math.exp(e.deltaY * 0.01));
        else if (e.shiftKey) this.orbit(e.deltaY * 0.4 + e.deltaX * 0.4, 0);
        else this.zoom(Math.exp(e.deltaY * 0.0016));
      },
      { passive: false },
    );
  }

  dispose(): void {
    for (const f of this.off) f();
  }
}
