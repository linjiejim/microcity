import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ActorLook, ActorPose, Anim } from './types.ts';

/**
 * 角色：带头、躯干、上臂、大腿、小腿、头发的玩偶，全部实例化（D75）。
 * 动作由程序生成：每帧按 Anim 解出几个关节角，再拼成每个零件的矩阵。
 */

const HIP = 0.86;
const THIGH = 0.42;
const SIT_HIP = 0.53;
const SHOULDER_Y = 0.47;
const SHOULDER_X = 0.235;
const HEAD_Y = 0.71;
const ARM_LEN = 0.56;

/** 关节解：单位是弧度与米 */
interface Joints {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hip: number;
  pitch: number;
  roll: number;
  aL: number;
  aR: number;
  rL: number;
  rR: number;
  tL: number;
  tR: number;
  kL: number;
  kR: number;
  lie: boolean;
}

const J: Joints = { x: 0, y: 0, z: 0, yaw: 0, hip: HIP, pitch: 0, roll: 0, aL: 0, aR: 0, rL: 0.06, rR: 0.06, tL: 0, tR: 0, kL: 0, kR: 0, lie: false };
const pos = (v: number) => (v > 0 ? v : 0);

function solve(anim: Anim, t: number, ph: number, elder: boolean, carry: boolean): void {
  J.x = J.y = J.z = J.yaw = J.pitch = J.roll = J.aL = J.aR = J.tL = J.tR = J.kL = J.kR = 0;
  J.rL = J.rR = 0.07;
  J.hip = HIP;
  J.lie = false;
  const sit = () => {
    J.hip = SIT_HIP;
    J.tL = J.tR = 1.5;
    J.kL = J.kR = 1.5;
    J.pitch = 0.04;
    J.aL = J.aR = 0.35;
  };
  switch (anim) {
    case 'walk': {
      const w = t * (elder ? 6 : 7.6) + ph;
      const s = Math.sin(w);
      const amp = elder ? 0.42 : 0.6;
      J.tL = amp * s;
      J.tR = -amp * s;
      J.kL = pos(Math.sin(w + 2.3)) * 0.95;
      J.kR = pos(Math.sin(w + 2.3 + Math.PI)) * 0.95;
      J.aL = -0.5 * s;
      J.aR = 0.5 * s;
      J.y = Math.abs(Math.cos(w)) * 0.035;
      J.pitch = 0.06;
      break;
    }
    case 'ride':
      J.hip = 0.84;
      J.tL = J.tR = 0.95;
      J.kL = J.kR = 1.1;
      J.aL = J.aR = 0.95;
      J.pitch = 0.2;
      J.rL = J.rR = 0.12;
      break;
    case 'idle':
    case 'wait':
      J.roll = Math.sin(t * 0.9 + ph) * 0.025;
      J.aL = J.aR = 0.04 * Math.sin(t * 0.7 + ph);
      if (anim === 'wait') J.yaw = 0.25 * Math.sin(t * 0.3 + ph);
      break;
    case 'sit':
      sit();
      break;
    case 'sit_eat':
      sit();
      J.pitch = 0.17;
      J.aR = 1.0 + 0.45 * Math.sin(t * 3 + ph);
      J.aL = 0.8;
      break;
    case 'sit_work':
      sit();
      J.pitch = 0.12;
      J.aL = 1.0 + 0.05 * Math.sin(t * 9 + ph);
      J.aR = 1.0 + 0.05 * Math.sin(t * 8 + ph + 1);
      break;
    case 'sit_study':
      sit();
      J.pitch = 0.22;
      J.aR = 1.05 + 0.05 * Math.sin(t * 6 + ph);
      J.aL = 0.9;
      break;
    case 'sit_talk':
      sit();
      J.pitch = 0.05 + 0.04 * Math.sin(t * 1.3 + ph);
      J.aR = 0.6 + 0.5 * pos(Math.sin(t * 2.1 + ph));
      J.aL = 0.4 + 0.3 * pos(Math.sin(t * 1.7 + ph + 2));
      J.yaw = 0.16 * Math.sin(t * 0.7 + ph);
      break;
    case 'sit_play':
      sit();
      J.pitch = 0.18;
      J.aR = 0.7 + 0.6 * pos(Math.sin(t * 1.1 + ph)) ** 2;
      J.aL = 0.5;
      break;
    case 'sit_read':
      sit();
      J.pitch = 0.2;
      J.aL = J.aR = 1.05;
      J.rL = J.rR = -0.12;
      break;
    case 'sit_phone':
      sit();
      J.pitch = 0.25;
      J.aR = 1.15;
      J.rR = -0.2;
      J.aL = 0.4;
      break;
    case 'sit_tv':
      sit();
      J.pitch = -0.16;
      J.tL = J.tR = 1.35;
      J.aL = J.aR = 0.3;
      break;
    case 'lie':
      J.lie = true;
      J.aL = J.aR = 0.05;
      break;
    case 'stand_work':
      J.pitch = 0.12;
      J.aL = 0.95 + 0.12 * Math.sin(t * 4 + ph);
      J.aR = 0.95 + 0.12 * Math.sin(t * 4 + ph + 2);
      break;
    case 'stand_talk':
      J.pitch = 0.03 * Math.sin(t * 1.3 + ph);
      J.aR = 0.4 + 0.6 * pos(Math.sin(t * 2.1 + ph));
      J.aL = 0.2 + 0.4 * pos(Math.sin(t * 1.7 + ph + 2));
      J.yaw = 0.16 * Math.sin(t * 0.7 + ph);
      break;
    case 'teach':
      J.aR = 2.3 + 0.2 * Math.sin(t * 1.5 + ph);
      J.aL = 0.3;
      J.x = 0.5 * Math.sin(t * 0.4 + ph);
      J.yaw = 0.3 * Math.sin(t * 0.4 + ph);
      break;
    case 'cook':
      J.pitch = 0.14;
      J.aR = 1.0 + 0.1 * Math.sin(t * 5 + ph);
      J.rR = 0.07 + 0.12 * Math.cos(t * 5 + ph);
      J.aL = 0.9;
      break;
    case 'serve':
      J.aL = J.aR = 1.0;
      J.yaw = 0.4 * Math.sin(t * 0.5 + ph);
      break;
    case 'browse':
      J.pitch = 0.08;
      J.aR = 0.4 + 1.0 * pos(Math.sin(t * 0.9 + ph)) ** 3;
      J.yaw = 0.25 * Math.sin(t * 0.35 + ph);
      break;
    case 'chores':
      J.pitch = 0.3;
      J.aL = J.aR = 0.8 + 0.15 * Math.sin(t * 3 + ph);
      J.x = 0.35 * Math.sin(t * 1.5 + ph);
      J.yaw = 0.3 * Math.sin(t * 1.5 + ph);
      break;
    case 'phone':
      J.pitch = 0.2;
      J.aR = 1.25;
      J.rR = -0.25;
      break;
    case 'dance': {
      // 广场舞：全场同一个拍子
      const b = t * 2.6;
      J.x = 0.35 * Math.sin(b * 0.5);
      J.aL = 1.6 + 1.0 * Math.sin(b);
      J.aR = 1.6 + 1.0 * Math.sin(b + Math.PI);
      J.rL = J.rR = 0.5;
      J.tL = 0.3 * pos(Math.sin(b));
      J.tR = 0.3 * pos(-Math.sin(b));
      J.kL = 0.5 * pos(Math.sin(b));
      J.kR = 0.5 * pos(-Math.sin(b));
      J.yaw = 0.25 * Math.sin(b * 0.25);
      J.y = 0.03 * Math.abs(Math.sin(b));
      break;
    }
    case 'exercise': {
      const s = t * 0.8 + ph;
      J.hip = HIP - 0.06;
      J.tL = J.tR = 0.28;
      J.kL = J.kR = 0.55;
      J.aL = 1.2 + 0.6 * Math.sin(s);
      J.aR = 1.2 + 0.6 * Math.sin(s + 2);
      J.rL = J.rR = 0.3;
      J.yaw = 0.3 * Math.sin(s * 0.5);
      J.pitch = 0.05;
      break;
    }
    case 'ball': {
      const s = t * 3 + ph;
      J.y = pos(Math.sin(s)) * 0.32;
      J.aL = J.aR = 2.3 + 0.4 * Math.sin(s);
      J.tL = 0.5 * Math.sin(s * 2);
      J.tR = -0.5 * Math.sin(s * 2);
      J.kL = 0.6 * pos(Math.sin(s * 2 + 2));
      J.kR = 0.6 * pos(-Math.sin(s * 2 + 2));
      J.x = 0.7 * Math.sin(s * 0.3);
      J.z = 0.7 * Math.cos(s * 0.37);
      J.yaw = 0.8 * Math.sin(s * 0.3);
      break;
    }
    case 'play': {
      const s = t * 0.8 + ph;
      J.y = Math.abs(Math.sin(t * 4 + ph)) * 0.12;
      J.aL = 1.5 + 0.8 * Math.sin(t * 4 + ph);
      J.aR = 1.5 + 0.8 * Math.sin(t * 4 + ph + 2);
      J.rL = J.rR = 0.6;
      J.x = 0.5 * Math.sin(s);
      J.z = 0.5 * Math.cos(s);
      J.yaw = s + Math.PI / 2;
      J.tL = 0.4 * Math.sin(t * 8 + ph);
      J.tR = -0.4 * Math.sin(t * 8 + ph);
      break;
    }
  }
  if (carry && !J.lie) {
    J.aR = 0.08;
    J.rR = 0.14;
  }
  if (elder && !J.lie) J.pitch += 0.15;
}

const cap = (r: number, total: number, seg = 8): THREE.BufferGeometry => new THREE.CapsuleGeometry(r, Math.max(0.001, total - 2 * r), 3, seg);

function geometries() {
  const torso = cap(0.175, 0.6, 12);
  torso.scale(1.08, 1, 0.74);
  torso.translate(0, 0.27, 0);
  const head = new THREE.SphereGeometry(0.185, 16, 12);
  const hair = new THREE.SphereGeometry(0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
  hair.rotateX(-0.28);
  hair.translate(0, 0.005, -0.012);
  const hairX = new THREE.SphereGeometry(1, 10, 8);
  const arm = cap(0.058, ARM_LEN, 8);
  arm.translate(0, -ARM_LEN / 2 + 0.058, 0);
  const thigh = cap(0.088, THIGH + 0.09, 8);
  thigh.translate(0, -(THIGH + 0.09) / 2 + 0.088, 0);
  const shinLeg = cap(0.072, 0.44, 8);
  shinLeg.translate(0, -0.22 + 0.06, 0);
  const foot = new THREE.BoxGeometry(0.12, 0.07, 0.22);
  foot.translate(0, -0.4, 0.05);
  const shin = mergeGeometries([shinLeg.toNonIndexed(), foot.toNonIndexed()])!;
  const bag = new THREE.BoxGeometry(0.3, 0.28, 0.14);
  bag.translate(0, -0.14, 0);
  // 电动车：两个轮子 + 车身 + 车把
  const wheel = () => {
    const w = new THREE.TorusGeometry(0.24, 0.05, 6, 14);
    w.rotateY(Math.PI / 2);
    return w;
  };
  const w1 = wheel();
  w1.translate(0, 0.29, 0.62);
  const w2 = wheel();
  w2.translate(0, 0.29, -0.6);
  const body = new THREE.BoxGeometry(0.26, 0.2, 1.0);
  body.translate(0, 0.42, -0.05);
  const seat = new THREE.BoxGeometry(0.28, 0.1, 0.56);
  seat.translate(0, 0.72, -0.28);
  const stem = new THREE.BoxGeometry(0.07, 0.75, 0.07);
  stem.rotateX(-0.25);
  stem.translate(0, 0.72, 0.5);
  const bar = new THREE.BoxGeometry(0.56, 0.05, 0.05);
  bar.translate(0, 1.08, 0.4);
  const shield = new THREE.BoxGeometry(0.3, 0.42, 0.06);
  shield.rotateX(-0.25);
  shield.translate(0, 0.62, 0.42);
  const bike = mergeGeometries([w1, w2, body, seat, stem, bar, shield].map((g) => g.toNonIndexed()))!;
  const hand = new THREE.SphereGeometry(0.062, 8, 6);
  hand.translate(0, -ARM_LEN + 0.075, 0);
  return { torso, head, hair, hairX, arm, hand, thigh, shin, bag, bike };
}

const M_ROOT = new THREE.Matrix4();
const M_PEL = new THREE.Matrix4();
const M_HEAD = new THREE.Matrix4();
const M_A = new THREE.Matrix4();
const M_B = new THREE.Matrix4();
const M_C = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const V = new THREE.Vector3();
const C = new THREE.Color();

const BIKE_COLORS = ['#4B7EAD', '#C2553A', '#5C9E6E', '#E3A13A', '#8A6A9A', '#5E5A52'];

export class Actors {
  readonly group = new THREE.Group();
  private readonly n: number;
  private readonly looks: ActorLook[];
  private readonly ids = new Map<string, number>();
  private readonly torso: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly hair: THREE.InstancedMesh;
  private readonly hairX: THREE.InstancedMesh;
  private readonly arm: THREE.InstancedMesh;
  private readonly hand: THREE.InstancedMesh;
  private readonly thigh: THREE.InstancedMesh;
  private readonly shin: THREE.InstancedMesh;
  private readonly bag: THREE.InstancedMesh;
  private readonly bike: THREE.InstancedMesh;
  private readonly all: THREE.InstancedMesh[];
  /** 每个人头顶的世界坐标与是否画出来（拾取、标注用） */
  readonly top: Float32Array;
  readonly shown: Uint8Array;

  constructor(looks: ActorLook[]) {
    this.looks = looks;
    this.n = Math.max(1, looks.length);
    const n = this.n;
    const g = geometries();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    const mk = (geo: THREE.BufferGeometry, count: number, shadow = true) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.torso = mk(g.torso, n);
    this.head = mk(g.head, n);
    this.hair = mk(g.hair, n, false);
    this.hairX = mk(g.hairX, n, false);
    this.arm = mk(g.arm, n * 2);
    this.hand = mk(g.hand, n * 2, false);
    this.thigh = mk(g.thigh, n * 2);
    this.shin = mk(g.shin, n * 2);
    this.bag = mk(g.bag, n);
    this.bike = mk(g.bike, n);
    this.all = [this.torso, this.head, this.hair, this.hairX, this.arm, this.hand, this.thigh, this.shin, this.bag, this.bike];
    this.top = new Float32Array(n * 3);
    this.shown = new Uint8Array(n);

    looks.forEach((l, i) => {
      this.ids.set(l.id, i);
      this.torso.setColorAt(i, C.set(l.top));
      this.head.setColorAt(i, C.set(l.skin));
      this.hair.setColorAt(i, C.set(l.hair));
      this.hairX.setColorAt(i, C.set(l.hair));
      this.arm.setColorAt(i * 2, C.set(l.top));
      this.arm.setColorAt(i * 2 + 1, C.set(l.top));
      this.hand.setColorAt(i * 2, C.set(l.skin));
      this.hand.setColorAt(i * 2 + 1, C.set(l.skin));
      this.thigh.setColorAt(i * 2, C.set(l.bottom));
      this.thigh.setColorAt(i * 2 + 1, C.set(l.bottom));
      C.set(l.bottom).multiplyScalar(0.82);
      this.shin.setColorAt(i * 2, C);
      this.shin.setColorAt(i * 2 + 1, C);
      this.bag.setColorAt(i, C.set(i % 3 === 0 ? '#E9E2D0' : i % 3 === 1 ? '#D9776A' : '#8FB27A'));
      this.bike.setColorAt(i, C.set(BIKE_COLORS[i % BIKE_COLORS.length]!));
    });
    for (const m of this.all) {
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, ZERO);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  indexOf(id: string): number {
    return this.ids.get(id) ?? -1;
  }

  /**
   * 每帧更新。hide(i, pose) 返回 true 的人不画（在没被剖开的楼里、在被剖建筑的别的楼层）。
   * t 是墙钟秒。
   */
  update(poses: readonly ActorPose[], t: number, hide: (pose: ActorPose) => boolean): void {
    const n = Math.min(this.n, poses.length, this.looks.length);
    for (let i = 0; i < n; i++) {
      const p = poses[i]!;
      const l = this.looks[i]!;
      if (!p.visible || hide(p)) {
        if (this.shown[i]) this.zero(i);
        this.shown[i] = 0;
        continue;
      }
      this.shown[i] = 1;
      const k = l.scale;
      const ph = i * 1.618;
      solve(p.anim, t, ph, l.elder, p.carry);

      // 根：位置、朝向、身高
      const yaw = p.face + J.yaw;
      const sn = Math.sin(p.face);
      const cs = Math.cos(p.face);
      const wx = p.x + J.x * cs + J.z * sn;
      const wz = p.y - J.x * sn + J.z * cs;
      let wy = p.h + J.y;
      if (J.hip === SIT_HIP) wy += SIT_HIP * (1 - k);
      M_ROOT.makeRotationY(yaw);
      if (J.lie) {
        // 仰面躺下：头朝正面的反方向，身体中点落在站位上
        M_A.makeRotationX(-Math.PI / 2);
        M_ROOT.multiply(M_A);
        M_ROOT.setPosition(p.x + sn * 0.86 * k, p.h + 0.6, p.y + cs * 0.86 * k);
      } else M_ROOT.setPosition(wx, wy, wz);
      M_ROOT.scale(V.set(k, k, k));

      // 躯干与头
      M_PEL.copy(M_ROOT).multiply(M_A.makeTranslation(0, J.hip, 0));
      if (J.pitch) M_PEL.multiply(M_A.makeRotationX(J.pitch));
      if (J.roll) M_PEL.multiply(M_A.makeRotationZ(J.roll));
      this.torso.setMatrixAt(i, M_PEL);
      M_HEAD.copy(M_PEL).multiply(M_A.makeTranslation(0, HEAD_Y, 0.01));
      this.head.setMatrixAt(i, M_HEAD);
      V.setFromMatrixPosition(M_HEAD);
      this.top[i * 3] = V.x;
      this.top[i * 3 + 1] = V.y + 0.3 * k;
      this.top[i * 3 + 2] = V.z;

      if (l.hairStyle === 'bald') this.hair.setMatrixAt(i, ZERO);
      else this.hair.setMatrixAt(i, M_HEAD);
      const hx = HAIR_X[l.hairStyle];
      if (hx) {
        M_B.copy(M_HEAD).multiply(M_A.makeTranslation(hx[0], hx[1], hx[2])).scale(V.set(hx[3], hx[4], hx[5]));
        this.hairX.setMatrixAt(i, M_B);
      } else this.hairX.setMatrixAt(i, ZERO);

      // 手臂
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? -1 : 1;
        M_B.copy(M_PEL).multiply(M_A.makeTranslation(sign * SHOULDER_X, SHOULDER_Y, 0));
        M_B.multiply(M_A.makeRotationZ(sign * (s === 0 ? J.rL : J.rR)));
        M_B.multiply(M_A.makeRotationX(-(s === 0 ? J.aL : J.aR)));
        this.arm.setMatrixAt(i * 2 + s, M_B);
        this.hand.setMatrixAt(i * 2 + s, M_B);
        if (s === 1) {
          if (p.carry && !J.lie) this.bag.setMatrixAt(i, M_C.copy(M_B).multiply(M_A.makeTranslation(0, -ARM_LEN + 0.04, 0)));
          else this.bag.setMatrixAt(i, ZERO);
        }
      }

      // 腿
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? -1 : 1;
        M_B.copy(M_ROOT).multiply(M_A.makeTranslation(sign * 0.095, J.hip, 0));
        M_B.multiply(M_A.makeRotationX(-(s === 0 ? J.tL : J.tR)));
        this.thigh.setMatrixAt(i * 2 + s, M_B);
        M_B.multiply(M_A.makeTranslation(0, -THIGH, 0));
        M_B.multiply(M_A.makeRotationX(s === 0 ? J.kL : J.kR));
        this.shin.setMatrixAt(i * 2 + s, M_B);
      }

      this.bike.setMatrixAt(i, p.anim === 'ride' ? M_ROOT : ZERO);
    }
    for (const m of this.all) m.instanceMatrix.needsUpdate = true;
  }

  private zero(i: number): void {
    this.torso.setMatrixAt(i, ZERO);
    this.head.setMatrixAt(i, ZERO);
    this.hair.setMatrixAt(i, ZERO);
    this.hairX.setMatrixAt(i, ZERO);
    this.bag.setMatrixAt(i, ZERO);
    this.bike.setMatrixAt(i, ZERO);
    for (let s = 0; s < 2; s++) {
      this.arm.setMatrixAt(i * 2 + s, ZERO);
      this.hand.setMatrixAt(i * 2 + s, ZERO);
      this.thigh.setMatrixAt(i * 2 + s, ZERO);
      this.shin.setMatrixAt(i * 2 + s, ZERO);
    }
  }

  dispose(): void {
    for (const m of this.all) {
      m.geometry.dispose();
      m.dispose();
    }
    (this.torso.material as THREE.Material).dispose();
  }
}

/** 发型的附加部分：相对头心的位置与三轴半径 */
const HAIR_X: Partial<Record<ActorLook['hairStyle'], [number, number, number, number, number, number]>> = {
  long: [0, -0.13, -0.09, 0.19, 0.27, 0.12],
  bun: [0, 0.19, -0.05, 0.085, 0.085, 0.085],
  bob: [0, -0.05, -0.035, 0.205, 0.17, 0.175],
  ponytail: [0, -0.06, -0.22, 0.06, 0.17, 0.06],
  cap: [0, 0.1, 0.13, 0.14, 0.03, 0.1],
};
