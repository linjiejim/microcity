import * as THREE from 'three';
import { CELL, FLOOR_H, type PlaceDef } from '@microcity/society';
import { Actors } from './actors.ts';
import { Bus } from './bus.ts';
import { buildCutParts, buildExterior, drawOpenPlace, makeSign, type CutPart, type GlassDef, type Side } from './buildings.ts';
import { CameraRig } from './camera.ts';
import { detailMaterial, detailUniforms } from './detail.ts';
import { Environment } from './env.ts';
import { Geo } from './geo.ts';
import { buildGround, buildProps, type LampDef } from './ground.ts';
import { Post } from './post.ts';
import type { ActorPose, CameraMode, Pick, Weather, World3DApi, World3DOptions } from './types.ts';

export type * from './types.ts';

/**
 * 立体世界（D74–D77）：命令式 three.js。
 * 外面每帧给姿态，这里只负责画；窗亮不亮、谁被墙挡住、屋子剖不剖开，都从姿态推出来。
 */

interface Built {
  place: PlaceDef;
  exterior: THREE.Mesh | null;
  sign: THREE.Mesh | null;
  /** 这栋楼的玻璃在实例网格里的区间 */
  glass0: number;
  glassN: number;
  box: THREE.Box3;
  cut: CutPart[] | null;
  cutShown: boolean;
  /** 挡住被跟随者时变成半透明：1 实心 … 0.12 几乎透明 */
  ghost: number;
  ghostMat: THREE.MeshStandardMaterial | null;
  glassHidden: boolean;
}

const SIDE_NORMAL: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const LIT_COLORS = ['#FFCB82', '#FFD9A0', '#FFC56E', '#FFE2B4', '#FFD08A', '#FFC98A', '#FFD9A0', '#9DBCF5'];
const EMOTES = ['chat', 'eat', 'sleep', 'pay', 'work', 'think'] as const;
const OCC = 32;

class World3D implements World3DApi {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly env: Environment;
  private readonly rig: CameraRig;
  private readonly post: Post;
  private readonly actors: Actors;
  private readonly bus: Bus;
  private readonly material = detailMaterial();
  private readonly built: Built[] = [];
  private readonly placeIndex = new Map<string, number>();
  private readonly glassDefs: GlassDef[] = [];
  private readonly glassPlace: number[] = [];
  private readonly glass: THREE.InstancedMesh;
  private readonly glassLit: Uint8Array;
  private readonly lampGlow: THREE.InstancedMesh;
  private readonly pools: THREE.InstancedMesh;
  private readonly noAo = new THREE.Group();
  private readonly rain: THREE.LineSegments;
  private readonly rainSeed: Float32Array;
  private readonly emotes: THREE.Sprite[] = [];
  private readonly emoteMats: Record<string, THREE.SpriteMaterial> = {};
  private readonly roomLight = new THREE.PointLight('#FFD9A8', 0, 18, 1.6);
  /** 镜头附近最近的几盏路灯是真的点光源（照亮人和墙）；其余只有灯头和地上的光斑 */
  private readonly lampLights: THREE.PointLight[] = [];
  private lamps: LampDef[] = [];
  private readonly occ: Uint8Array;
  private readonly opts: World3DOptions;
  private readonly high: boolean;
  private readonly ray = new THREE.Raycaster();
  private clock = 0;
  private secOfDay = 12 * 3600;
  private glassBucket = -1;
  private occDirty = true;
  private followIndex = -1;
  private followPose: { x: number; y: number; h: number; place: string | null; floor: number; visible: boolean } | null = null;
  private cutPlace = -1;
  private cutFloor = 0;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private pixelCap = 1.5;
  private frameMs = 16;
  private slowFor = 0;
  private lockQuality = false;

  constructor(opts: World3DOptions) {
    this.opts = opts;
    this.high = (opts.quality ?? 'high') === 'high';
    const { def, canvas } = opts;
    const map = def.map;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.env = new Environment(this.high ? 4096 : 2048);
    this.scene.fog = this.env.fog;
    this.scene.add(this.env.hemi, this.env.sun, this.env.sun.target);
    this.noAo.add(this.env.dome);
    this.scene.add(this.noAo);

    this.scene.add(buildGround(map));

    // 静态世界：陈设 + 开放空间的家具，合成一个网格
    const stat = new Geo();
    const lamps = buildProps(stat, map);
    map.places.forEach((p, i) => {
      this.placeIndex.set(p.id, i);
      if (p.open) drawOpenPlace(stat, p);
    });
    const statMesh = new THREE.Mesh(stat.build(), this.material);
    statMesh.castShadow = true;
    statMesh.receiveShadow = true;
    this.scene.add(statMesh);

    // 建筑外观
    for (const p of map.places) {
      const box = new THREE.Box3(new THREE.Vector3(p.x * CELL, 0, p.y * CELL), new THREE.Vector3((p.x + p.w) * CELL, Math.max(0.3, p.floors * FLOOR_H + 2.6), (p.y + p.h) * CELL));
      const b: Built = { place: p, exterior: null, sign: null, glass0: this.glassDefs.length, glassN: 0, box, cut: null, cutShown: false, ghost: 1, ghostMat: null, glassHidden: false };
      if (!p.open) {
        const ex = buildExterior(p);
        b.exterior = new THREE.Mesh(ex.geometry, this.material);
        b.exterior.castShadow = true;
        b.exterior.receiveShadow = true;
        this.scene.add(b.exterior);
        for (const g of ex.glass) {
          this.glassDefs.push(g);
          this.glassPlace.push(this.built.length);
        }
        b.glassN = ex.glass.length;
        if (ex.sign) {
          b.sign = makeSign(ex.sign);
          this.scene.add(b.sign);
        }
      }
      this.built.push(b);
    }
    this.occ = new Uint8Array(this.built.length * OCC);

    // 玻璃：一个实例网格，颜色逐扇变化（白天映天色，夜里亮灯）
    this.glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.03), new THREE.MeshBasicMaterial({ toneMapped: true }), Math.max(1, this.glassDefs.length));
    this.glassLit = new Uint8Array(this.glassDefs.length).fill(255);
    this.glassDefs.forEach((_, i) => this.placeGlass(i, true));
    this.glass.frustumCulled = false;
    this.scene.add(this.glass);

    // 路灯：灯头 + 地上的光斑
    this.lampGlow = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: '#FFF4DC' }), Math.max(1, lamps.length));
    this.pools = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, color: '#FFC98A' }), Math.max(1, lamps.length));
    this.setLamps(lamps);
    this.lamps = lamps;
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#FFC27A', 0, 17, 1.5);
      this.lampLights.push(l);
      this.scene.add(l);
    }
    this.scene.add(this.lampGlow);
    this.noAo.add(this.pools);

    this.actors = new Actors(opts.looks);
    this.scene.add(this.actors.group);
    this.bus = new Bus(def, this.material);
    this.scene.add(this.bus.group);
    this.scene.add(this.roomLight);

    // 雨
    const N = 1500;
    this.rainSeed = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) this.rainSeed[i] = (Math.sin(i * 127.1) * 43758.5453) % 1;
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#E8F0F4', transparent: true, opacity: 0.42, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.noAo.add(this.rain);

    this.makeEmotes();

    this.rig = new CameraRig(canvas, { w: map.w * CELL, h: map.h * CELL }, (m) => opts.onCameraMode?.(m), (x, y) => this.pick(x, y));
    this.post = new Post(this.renderer, this.scene, this.rig.camera, this.high, this.noAo);
    this.setEnvironment(this.secOfDay, 'sun');
    this.resize(canvas.clientWidth || 800, canvas.clientHeight || 600, Math.min(2, window.devicePixelRatio || 1));
  }

  // ---------- 对外 ----------

  setEnvironment(secOfDay: number, weather: Weather): void {
    this.secOfDay = secOfDay;
    this.env.set(secOfDay, weather);
    this.renderer.toneMappingExposure = this.env.exposure;
    this.rain.visible = weather === 'rain';
    const n = this.env.night;
    this.bus.update(secOfDay, n, this.env.fog.color);
    detailUniforms.uGlow.value = Math.max(0, (n - 0.3) / 0.7);
    detailUniforms.uSky.value.copy(this.env.fog.color).multiplyScalar(1 - 0.55 * n);
    (this.lampGlow.material as THREE.MeshBasicMaterial).color.set('#FFF1D8').multiplyScalar(0.85 + 2.2 * n);
    (this.pools.material as THREE.MeshBasicMaterial).opacity = 0.42 * n;
    this.pools.visible = n > 0.02;
    for (const b of this.built) if (b.sign) (b.sign.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.75 * n * (this.isOpen(b.place) ? 1 : 0.25);
  }

  setPoses(poses: readonly ActorPose[]): void {
    const cutId = this.cutPlace >= 0 ? this.built[this.cutPlace]!.place.id : null;
    const cutFloor = this.cutFloor;
    this.actors.update(poses, this.clock, (p) => {
      if (p.place === null) return false;
      const i = this.placeIndex.get(p.place);
      if (i === undefined || this.built[i]!.place.open) return false;
      return !(p.place === cutId && p.floor === cutFloor);
    });

    // 谁家有人醒着
    const before = this.occ.slice();
    this.occ.fill(0);
    for (const p of poses) {
      if (!p.visible || p.place === null) continue;
      const i = this.placeIndex.get(p.place);
      if (i === undefined) continue;
      this.occ[i * OCC + OCC - 1] = 1;
      if (p.anim !== 'lie' && p.unit >= 0 && p.unit < OCC - 2) this.occ[i * OCC + p.unit] = 1;
    }
    for (let i = 0; i < before.length; i++)
      if (before[i] !== this.occ[i]) {
        this.occDirty = true;
        break;
      }

    if (this.followIndex >= 0 && this.followIndex < poses.length) {
      const p = poses[this.followIndex]!;
      this.followPose = { x: p.x, y: p.y, h: p.h, place: p.place, floor: p.floor, visible: p.visible };
    } else this.followPose = null;

    this.placeEmotes(poses);
  }

  setFollow(id: string | null): void {
    this.followIndex = id === null ? -1 : this.actors.indexOf(id);
    if (this.followIndex < 0) this.followPose = null;
  }

  setCameraMode(mode: CameraMode): void {
    this.rig.setMode(mode);
  }

  getCameraMode(): CameraMode {
    return this.rig.mode;
  }

  focusPlace(id: string): void {
    const i = this.placeIndex.get(id);
    if (i === undefined) return;
    const p = this.built[i]!.place;
    this.rig.focus((p.x + p.w / 2) * CELL, (p.y + p.h / 2) * CELL);
  }

  screenOf(id: string): { x: number; y: number } | null {
    const i = this.actors.indexOf(id);
    if (i < 0 || !this.actors.shown[i]) return null;
    const v = new THREE.Vector3(this.actors.top[i * 3]!, this.actors.top[i * 3 + 1]!, this.actors.top[i * 3 + 2]!).project(this.rig.camera);
    if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height };
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelCap = this.high ? Math.min(1.5, pixelRatio) : 1;
    const pr = this.pixelCap;
    this.pixelRatio = pr;
    this.slowFor = 0;
    this.frameMs = 16;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.post.resize(this.width, this.height, pr);
    this.rig.resize(this.width / this.height);
  }

  render(dtMs: number): void {
    const dt = Math.min(100, Math.max(0, dtMs));
    this.clock += dt / 1000;

    // 镜头
    const f = this.followPose;
    const mode = this.rig.mode;
    const following = (mode === 'follow' || mode === 'pov') && f !== null;
    let indoor = false;
    if (following) {
      const pi = f.place === null ? undefined : this.placeIndex.get(f.place);
      indoor = pi !== undefined && !this.built[pi]!.place.open && f.visible;
      if (f.visible) {
        const i = this.followIndex;
        if (mode === 'pov' && this.actors.shown[i]) this.rig.trackPov(this.actors.eye[i * 4]!, this.actors.eye[i * 4 + 1]!, this.actors.eye[i * 4 + 2]!, this.actors.eye[i * 4 + 3]!, indoor);
        else this.rig.track(f.x, f.h, f.y, indoor);
      }
      this.cutPlace = indoor ? pi! : -1;
      this.cutFloor = f.floor;
    } else this.cutPlace = -1;
    this.rig.update(dt);
    // 地面湿不湿：下雨慢慢湿，雨停慢慢干
    const wet = detailUniforms.uWet;
    wet.value += ((this.env.weather === 'rain' ? 1 : 0) - wet.value) * Math.min(1, dt / 1500);
    this.updateCut(dt / 1000);
    this.updateGhosts(dt / 1000, following && f.visible ? f : null);
    this.adapt(dt);

    const dist = this.rig.distance;
    this.env.follow(this.rig.target, Math.max(30, Math.min(170, dist * 0.42)));
    this.env.fog.near = dist + 160;
    this.env.fog.far = dist + (this.env.weather === 'rain' ? 650 : 1150);

    // 屋里的灯：只给被剖开的那一层
    if (this.cutPlace >= 0 && f) {
      this.roomLight.position.set(f.x, f.h + 2.3, f.y);
      this.roomLight.intensity = 26 * this.env.night;
    } else this.roomLight.intensity = 0;

    this.updateLampLights(dist);
    this.updateGlass();
    if (this.rain.visible) this.updateRain(dist);

    const k = Math.max(0, Math.min(1, (dist - 30) / 300));
    // 齐眼高的视角不要移轴：那是俯拍微缩模型才有的效果
    if (this.rig.povActive) this.post.tune(this.env.night, 0.25, 0.5, 0.7);
    else this.post.tune(this.env.night, indoor ? 0.5 : 1.0 + 1.7 * k, indoor ? 0.34 : 0.3 - 0.12 * k, Math.max(0.6, Math.min(3.5, dist * 0.012)));
    this.post.render(dt / 1000);
  }

  /** 验收与截图用（不在契约里） */
  debugOrbit(o: Parameters<CameraRig['debugOrbit']>[0]): void {
    this.rig.debugOrbit(o);
  }

  /** 截图时锁住画质，不让自适应降分辨率 */
  debugLockQuality(on: boolean): void {
    this.lockQuality = on;
    if (on && this.pixelRatio !== this.pixelCap) {
      this.pixelRatio = this.pixelCap;
      this.renderer.setPixelRatio(this.pixelCap);
      this.renderer.setSize(this.width, this.height, false);
      this.post.resize(this.width, this.height, this.pixelCap);
    }
  }

  dispose(): void {
    this.rig.dispose();
    this.post.dispose();
    this.actors.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        const tex = (x as THREE.MeshStandardMaterial).map;
        if (tex) tex.dispose();
        x.dispose();
      }
    });
    this.renderer.dispose();
  }

  // ---------- 内部 ----------

  private isOpen(p: PlaceDef): boolean {
    return p.hours !== null && this.secOfDay >= p.hours[0] && this.secOfDay <= p.hours[1];
  }

  private placeGlass(i: number, show: boolean): void {
    const g = this.glassDefs[i]!;
    const m = new THREE.Matrix4();
    if (show) m.compose(new THREE.Vector3(g.x, g.y, g.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, g.rot, 0)), new THREE.Vector3(g.w, g.h, 1));
    else m.makeScale(0, 0, 0);
    this.glass.setMatrixAt(i, m);
    this.glass.instanceMatrix.needsUpdate = true;
  }

  private setLamps(lamps: LampDef[]): void {
    const m = new THREE.Matrix4();
    lamps.forEach((l, i) => {
      this.lampGlow.setMatrixAt(i, m.makeTranslation(l.x, l.y, l.z));
      m.makeRotationX(-Math.PI / 2);
      m.scale(new THREE.Vector3(7, 7, 1));
      m.setPosition(l.x, 0.07, l.z);
      this.pools.setMatrixAt(i, m);
    });
    this.lampGlow.instanceMatrix.needsUpdate = true;
    this.pools.instanceMatrix.needsUpdate = true;
  }

  private updateLampLights(dist: number): void {
    const n = this.env.night;
    const on = n > 0.05 && dist < 240 ? 34 * n * Math.min(1, (240 - dist) / 80) : 0;
    if (on <= 0) {
      for (const l of this.lampLights) l.intensity = 0;
      return;
    }
    // 取离镜头目标最近的几盏
    const t = this.rig.target;
    const best: Array<[number, LampDef]> = [];
    for (const lamp of this.lamps) {
      const d = (lamp.x - t.x) ** 2 + (lamp.z - t.z) ** 2;
      if (best.length < this.lampLights.length) best.push([d, lamp]);
      else {
        let worst = 0;
        for (let i = 1; i < best.length; i++) if (best[i]![0] > best[worst]![0]) worst = i;
        if (d < best[worst]![0]) best[worst] = [d, lamp];
      }
    }
    best.sort((a, b) => a[1].x - b[1].x || a[1].z - b[1].z);
    this.lampLights.forEach((l, i) => {
      const b = best[i];
      if (!b) {
        l.intensity = 0;
        return;
      }
      l.position.set(b[1].x, b[1].y - 0.3, b[1].z);
      l.intensity = on;
    });
  }

  /** 窗的颜色：白天映天色；天黑后，家里有人醒着就亮 */
  private updateGlass(): void {
    const n = this.env.night;
    const bucket = Math.round(n * 24);
    const all = bucket !== this.glassBucket;
    if (!all && !this.occDirty) return;
    this.glassBucket = bucket;
    this.occDirty = false;
    const dark = n > 0.35;
    // 没亮灯的玻璃映着天：白天是淡蓝，傍晚带一点暖色，夜里是深蓝
    const day = new THREE.Color('#86A9BF').lerp(this.env.fog.color, 0.35).multiplyScalar(0.5 + 0.3 * (1 - n));
    day.lerp(new THREE.Color('#1B2440'), n * 0.9);
    const c = new THREE.Color();
    let changed = false;
    for (let i = 0; i < this.glassDefs.length; i++) {
      const g = this.glassDefs[i]!;
      const pi = this.glassPlace[i]!;
      const b = this.built[pi]!;
      let lit = 0;
      if (dark) {
        if (g.unit >= 0) lit = this.occ[pi * OCC + g.unit] && g.rnd < 0.82 ? 1 : 0;
        else lit = (this.isOpen(b.place) || this.occ[pi * OCC + OCC - 1]) && g.rnd < 0.9 ? 1 : 0;
      }
      if (!all && lit === this.glassLit[i]) continue;
      this.glassLit[i] = lit;
      if (lit) {
        c.set(LIT_COLORS[Math.floor(g.rnd * 97) % LIT_COLORS.length]!).multiplyScalar(1.05 + 0.75 * n);
        this.glass.setColorAt(i, c);
      } else {
        c.copy(day).multiplyScalar(0.85 + 0.3 * g.rnd);
        this.glass.setColorAt(i, c);
      }
      changed = true;
    }
    if (changed && this.glass.instanceColor) this.glass.instanceColor.needsUpdate = true;
  }

  /** 剖面：被跟随的人在屋里时，把那栋楼换成分层零件，朝镜头的墙和上面的楼层淡出 */
  private updateCut(dt: number): void {
    const step = dt / 0.32;
    for (let i = 0; i < this.built.length; i++) {
      const b = this.built[i]!;
      const active = i === this.cutPlace;
      if (!active && !b.cutShown) continue;
      if (active && !b.cutShown) {
        if (!b.cut) b.cut = buildCutParts(b.place, detailMaterial);
        for (const p of b.cut) {
          p.alpha = 1;
          this.scene.add(p.mesh);
        }
        b.cutShown = true;
        if (b.exterior) b.exterior.visible = false;
        if (b.sign) b.sign.visible = false;
        for (let k = 0; k < b.glassN; k++) this.placeGlass(b.glass0 + k, false);
      }
      const parts = b.cut!;
      const cx = (b.place.x + b.place.w / 2) * CELL;
      const cz = (b.place.y + b.place.h / 2) * CELL;
      const dx = this.rig.camera.position.x - cx;
      const dz = this.rig.camera.position.z - cz;
      const len = Math.hypot(dx, dz) || 1;
      let done = true;
      for (const p of parts) {
        let target = 1;
        if (active) {
          if (p.kind === 'roof' || p.floor > this.cutFloor) target = 0;
          else if (p.floor === this.cutFloor && p.kind === 'wall') {
            const nrm = SIDE_NORMAL[p.side!];
            target = (nrm[0] * dx + nrm[1] * dz) / len > 0.12 ? 0 : 1;
          }
        }
        p.target = target;
        if (p.alpha !== target) {
          p.alpha = target > p.alpha ? Math.min(target, p.alpha + step) : Math.max(target, p.alpha - step);
          const m = p.mesh.material as THREE.MeshStandardMaterial;
          m.transparent = p.alpha < 0.999;
          m.opacity = p.alpha;
          m.depthWrite = p.alpha > 0.5;
          p.mesh.visible = p.alpha > 0.01;
          p.mesh.castShadow = p.alpha > 0.6;
        }
        if (p.alpha < 0.999) done = false;
      }
      if (!active && done) {
        for (const p of parts) this.scene.remove(p.mesh);
        b.cutShown = false;
        if (b.exterior) b.exterior.visible = true;
        if (b.sign) b.sign.visible = true;
        for (let k = 0; k < b.glassN; k++) this.placeGlass(b.glass0 + k, true);
        this.glassBucket = -1;
      }
    }
  }

  /** 帧率持续偏低就降一档分辨率（只降不升；窗口大小变化时重新从上限开始） */
  private adapt(dtMs: number): void {
    if (!this.high || this.lockQuality || dtMs <= 0) return;
    this.frameMs += (dtMs - this.frameMs) * 0.05;
    this.slowFor = this.frameMs > 21 ? this.slowFor + dtMs : 0;
    if (this.slowFor > 2500 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.slowFor = 0;
      this.frameMs = 16;
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(this.width, this.height, false);
      this.post.resize(this.width, this.height, this.pixelRatio);
    }
  }

  /** 跟随时，挡在镜头和人之间的建筑变成半透明 */
  private updateGhosts(dt: number, f: { x: number; y: number; h: number } | null): void {
    const cam = this.rig.camera.position;
    let reach = 0;
    if (f) {
      this.ray.ray.origin.copy(cam);
      this.ray.ray.direction.set(f.x - cam.x, f.h + 1.1 - cam.y, f.y - cam.z);
      reach = this.ray.ray.direction.length();
      this.ray.ray.direction.normalize();
    }
    const hit = new THREE.Vector3();
    const step = dt / 0.22;
    for (let i = 0; i < this.built.length; i++) {
      const b = this.built[i]!;
      if (!b.exterior) continue;
      let target = 1;
      if (f && i !== this.cutPlace && !b.cutShown && this.ray.ray.intersectBox(b.box, hit) && hit.distanceTo(cam) < reach - 0.6) target = 0.12;
      if (b.ghost === target) continue;
      b.ghost = target > b.ghost ? Math.min(target, b.ghost + step) : Math.max(target, b.ghost - step);
      if (b.ghost >= 0.999) {
        b.exterior.material = this.material;
        b.exterior.renderOrder = 0;
      } else {
        if (!b.ghostMat) {
          b.ghostMat = detailMaterial();
          b.ghostMat.transparent = true;
          b.ghostMat.depthWrite = false;
        }
        b.ghostMat.opacity = b.ghost;
        b.exterior.material = b.ghostMat;
        b.exterior.renderOrder = 5;
      }
      const hide = b.ghost < 0.6;
      if (hide !== b.glassHidden && !b.cutShown) {
        b.glassHidden = hide;
        for (let k = 0; k < b.glassN; k++) this.placeGlass(b.glass0 + k, !hide);
        if (b.sign) b.sign.visible = !hide;
        if (!hide) this.glassBucket = -1;
      }
    }
  }

  private updateRain(dist: number): void {
    const S = Math.max(40, Math.min(300, dist * 0.9));
    const Hh = S * 0.7;
    const len = S * 0.022;
    const pos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const t = this.clock;
    const n = this.rainSeed.length / 3;
    const fall = S * 1.3;
    for (let i = 0; i < n; i++) {
      const rx = Math.abs(this.rainSeed[i * 3]!);
      const ry = Math.abs(this.rainSeed[i * 3 + 1]!);
      const rz = Math.abs(this.rainSeed[i * 3 + 2]!);
      const x = this.rig.target.x + (rx - 0.5) * S * 1.6;
      const z = this.rig.target.z + (rz - 0.5) * S * 1.6;
      const y = Hh - ((ry * Hh + t * fall) % Hh);
      a[i * 6] = x;
      a[i * 6 + 1] = y;
      a[i * 6 + 2] = z;
      a[i * 6 + 3] = x + len * 0.12;
      a[i * 6 + 4] = y - len;
      a[i * 6 + 5] = z;
    }
    pos.needsUpdate = true;
  }

  private makeEmotes(): void {
    for (const name of EMOTES) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 96;
      const g = cv.getContext('2d')!;
      g.fillStyle = 'rgba(255,253,248,0.96)';
      g.strokeStyle = 'rgba(60,50,40,0.25)';
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(8, 6, 80, 68, 22);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(40, 72);
      g.lineTo(48, 90);
      g.lineTo(56, 72);
      g.fill();
      g.fillStyle = name === 'pay' ? '#C2553A' : name === 'sleep' ? '#4B7EAD' : name === 'eat' ? '#D98A2B' : '#1F5F63';
      g.strokeStyle = g.fillStyle;
      g.font = "700 44px -apple-system, 'PingFang SC', sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (name === 'chat') for (const x of [30, 48, 66]) g.fillRect(x - 5, 36, 10, 10);
      else if (name === 'eat') {
        g.beginPath();
        g.arc(48, 36, 20, 0, Math.PI);
        g.fill();
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(56, 34);
        g.lineTo(72, 14);
        g.moveTo(50, 34);
        g.lineTo(62, 12);
        g.stroke();
      } else g.fillText(name === 'sleep' ? 'Zz' : name === 'pay' ? '¥' : name === 'work' ? '⚒' : '?', 48, 42);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.emoteMats[name] = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
    }
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(this.emoteMats.chat);
      s.visible = false;
      s.center.set(0.5, 0);
      this.emotes.push(s);
      this.noAo.add(s);
    }
  }

  private placeEmotes(poses: readonly ActorPose[]): void {
    let k = 0;
    const dist = this.rig.distance;
    const size = Math.max(0.7, Math.min(7, dist * 0.028));
    const reach = dist * 0.8 + 30;
    for (let i = 0; i < poses.length && k < this.emotes.length; i++) {
      const p = poses[i]!;
      if (!p.emote || !this.actors.shown[i]) continue;
      // 贴在身后看时，自己头顶的图标会挡住视线
      if (i === this.followIndex && this.rig.povActive) continue;
      const x = this.actors.top[i * 3]!;
      const z = this.actors.top[i * 3 + 2]!;
      if (Math.abs(x - this.rig.target.x) + Math.abs(z - this.rig.target.z) > reach) continue;
      const s = this.emotes[k++]!;
      s.material = this.emoteMats[p.emote]!;
      s.position.set(x, this.actors.top[i * 3 + 1]! + 0.05, z);
      s.scale.set(size, size, 1);
      s.visible = true;
    }
    for (; k < this.emotes.length; k++) this.emotes[k]!.visible = false;
  }

  private pick(px: number, py: number): void {
    if (!this.opts.onPick) return;
    this.ray.setFromCamera(new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1), this.rig.camera);
    const r = this.ray.ray;
    const tol = Math.max(0.6, this.rig.distance * 0.011);
    let best: Pick | null = null;
    let bt = Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < this.opts.looks.length; i++) {
      if (!this.actors.shown[i]) continue;
      v.set(this.actors.top[i * 3]!, this.actors.top[i * 3 + 1]! - 0.8, this.actors.top[i * 3 + 2]!);
      const d = r.distanceToPoint(v);
      if (d > tol) continue;
      const t = v.sub(r.origin).dot(r.direction) - (tol - d) * 0.01;
      if (t < bt) {
        bt = t;
        best = { kind: 'actor', id: this.opts.looks[i]!.id };
      }
    }
    if (!best) {
      const hit = new THREE.Vector3();
      for (const b of this.built) {
        if (!r.intersectBox(b.box, hit)) continue;
        const t = hit.distanceTo(r.origin);
        if (t < bt) {
          bt = t;
          best = { kind: 'place', id: b.place.id };
        }
      }
    }
    this.opts.onPick(best);
  }
}

function poolTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.38)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld3D(opts: World3DOptions): World3DApi {
  return new World3D(opts);
}
