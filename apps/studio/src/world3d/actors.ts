import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ActorLook, ActorPose, Anim } from './types.ts';

/**
 * 角色：有脸、有肘有膝的玩偶，全部实例化（D75）。
 * 身体拆成躯干、头、脸、头发、上臂、前臂、手、大腿、小腿（带鞋）几种零件，各是一个实例网格；
 * 动作由程序生成：每帧按 Anim 解出一组关节角，再沿骨骼链拼出每个零件的矩阵。
 * 颜色 = 零件自带的明暗（顶点色）× 这个人的衣服或肤色（实例色）。
 */

const HIP = 0.86;
const THIGH = 0.42;
const SIT_HIP = 0.53;
const SHOULDER_Y = 0.47;
const SHOULDER_X = 0.225;
const HEAD_Y = 0.71;
const UPPER = 0.27;
const FORE = 0.25;
const HEAD_R = 0.185;

/** 手里拿的小东西：一个按需缩放的盒子 */
type Held = 0 | 'phone' | 'book' | 'fan' | 'broom' | 'spatula' | 'cards';
const HELD: Record<Exclude<Held, 0>, { s: [number, number, number]; c: string; o: [number, number, number] }> = {
  phone: { s: [0.075, 0.15, 0.014], c: '#2E2F33', o: [0, -0.04, 0.03] },
  book: { s: [0.2, 0.27, 0.035], c: '#EFE4CC', o: [-0.08, -0.02, 0.04] },
  fan: { s: [0.3, 0.2, 0.012], c: '#D2473A', o: [0, -0.12, 0.02] },
  broom: { s: [0.035, 1.25, 0.035], c: '#B98F62', o: [0, -0.5, 0.04] },
  spatula: { s: [0.03, 0.34, 0.03], c: '#8A8F93', o: [0, -0.16, 0.03] },
  cards: { s: [0.13, 0.1, 0.012], c: '#F4EDE0', o: [0, -0.03, 0.03] },
};

/** 关节解：单位是弧度与米 */
interface Joints {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hip: number;
  /** 骨盆左右摆 */
  sway: number;
  pitch: number;
  roll: number;
  /** 肩相对骨盆的扭转 */
  twist: number;
  headYaw: number;
  headPitch: number;
  /** 上臂前摆、外展、肘弯 */
  aL: number;
  aR: number;
  rL: number;
  rR: number;
  eL: number;
  eR: number;
  /** 大腿前摆、膝弯 */
  tL: number;
  tR: number;
  kL: number;
  kR: number;
  lie: boolean;
  sit: boolean;
  held: Held;
}

const J: Joints = { x: 0, y: 0, z: 0, yaw: 0, hip: HIP, sway: 0, pitch: 0, roll: 0, twist: 0, headYaw: 0, headPitch: 0, aL: 0, aR: 0, rL: 0, rR: 0, eL: 0, eR: 0, tL: 0, tR: 0, kL: 0, kR: 0, lie: false, sit: false, held: 0 };
const pos = (v: number) => (v > 0 ? v : 0);
/** 偶尔发生一次的小动作：周期 period 秒里有 on 秒为 0→1→0 */
const pulse = (t: number, period: number, on: number): number => {
  const u = (((t % period) + period) % period) / on;
  return u < 1 ? Math.sin(u * Math.PI) : 0;
};

function solve(anim: Anim, t: number, ph: number, elder: boolean, child: boolean, carry: boolean): void {
  J.x = J.y = J.z = J.yaw = J.sway = J.pitch = J.roll = J.twist = J.headYaw = J.headPitch = 0;
  J.aL = J.aR = J.tL = J.tR = J.kL = J.kR = 0;
  J.rL = J.rR = 0.07;
  J.eL = J.eR = 0.14;
  J.hip = HIP;
  J.lie = false;
  J.sit = false;
  J.held = 0;
  const sit = () => {
    J.sit = true;
    J.hip = SIT_HIP;
    J.tL = J.tR = 1.5;
    J.kL = J.kR = 1.5;
    J.pitch = 0.04;
    // 手搭在腿上
    J.aL = J.aR = 0.32;
    J.eL = J.eR = 0.95;
    J.rL = J.rR = 0.04;
  };
  switch (anim) {
    case 'walk': {
      const w = t * (elder ? 5.6 : child ? 9 : 7.4) + ph;
      const s = Math.sin(w);
      const amp = elder ? 0.36 : 0.56;
      J.tL = amp * s;
      J.tR = -amp * s;
      // 摆动腿在向前迈时屈膝，支撑腿几乎伸直
      J.kL = 0.08 + pos(Math.sin(w + 2.2)) * (elder ? 0.6 : 0.95);
      J.kR = 0.08 + pos(Math.sin(w + 2.2 + Math.PI)) * (elder ? 0.6 : 0.95);
      J.aL = -0.48 * s * (elder ? 0.6 : 1);
      J.aR = 0.48 * s * (elder ? 0.6 : 1);
      J.eL = 0.32 + 0.3 * pos(-s);
      J.eR = 0.32 + 0.3 * pos(s);
      J.y = Math.abs(Math.cos(w)) * (child ? 0.05 : 0.032) - 0.012;
      J.sway = 0.018 * Math.sin(w);
      J.roll = 0.025 * Math.sin(w);
      J.twist = -0.13 * s;
      J.headYaw = 0.1 * s;
      J.pitch = 0.05;
      break;
    }
    case 'ride':
      J.hip = 0.84;
      J.tL = J.tR = 1.0;
      J.kL = J.kR = 1.25;
      J.aL = J.aR = 0.85;
      J.eL = J.eR = 0.55;
      J.rL = J.rR = 0.16;
      J.pitch = 0.16;
      J.headPitch = -0.1;
      break;
    case 'idle':
    case 'wait': {
      const s = Math.sin(t * 0.55 + ph);
      J.sway = 0.03 * s;
      J.roll = 0.022 * s;
      J.tL = 0.04 * s;
      J.tR = -0.04 * s;
      J.aL = 0.03 * Math.sin(t * 0.7 + ph);
      J.aR = -0.03 * Math.sin(t * 0.7 + ph);
      J.y = 0.004 * Math.sin(t * 1.6 + ph);
      J.headYaw = 0.35 * Math.sin(t * 0.23 + ph * 1.7) * (anim === 'wait' ? 1 : 0.5);
      if (anim === 'wait') {
        // 等人的时候抱着胳膊，隔一阵看一眼表
        const look = pulse(t + ph * 3, 9, 1.6);
        J.aL = 0.35;
        J.eL = 1.5;
        J.rL = -0.25;
        J.aR = 0.3 + 0.5 * look;
        J.eR = 1.45 + 0.4 * look;
        J.rR = -0.3;
        J.headPitch = 0.25 * look;
      }
      break;
    }
    case 'sit':
      sit();
      J.headYaw = 0.25 * Math.sin(t * 0.21 + ph);
      J.pitch = 0.04 + 0.012 * Math.sin(t * 1.4 + ph);
      break;
    case 'sit_eat': {
      sit();
      // 左手扶碗，右手一筷一筷往嘴边送
      const u = pos(Math.sin(t * 2.3 + ph));
      J.pitch = 0.14 + 0.07 * u;
      J.aL = 0.55;
      J.eL = 1.25;
      J.rL = -0.12;
      J.aR = 0.5 + 0.35 * u;
      J.eR = 1.35 + 0.85 * u;
      J.rR = -0.05 - 0.12 * u;
      J.headPitch = 0.12 + 0.14 * u;
      break;
    }
    case 'sit_work':
      sit();
      J.pitch = 0.1;
      J.aL = 0.5 + 0.03 * Math.sin(t * 9 + ph);
      J.aR = 0.5 + 0.03 * Math.sin(t * 8 + ph + 1);
      J.eL = 1.3 + 0.06 * Math.sin(t * 11 + ph);
      J.eR = 1.3 + 0.06 * Math.sin(t * 10 + ph + 2);
      J.headPitch = 0.1;
      break;
    case 'sit_study':
      sit();
      J.pitch = 0.2;
      J.aL = 0.55;
      J.eL = 1.2;
      J.rL = -0.15;
      J.aR = 0.55 + 0.03 * Math.sin(t * 7 + ph);
      J.eR = 1.25 + 0.05 * Math.sin(t * 9 + ph);
      J.headPitch = 0.32 - 0.3 * pulse(t + ph * 5, 11, 2.4);
      break;
    case 'sit_talk': {
      sit();
      const g = pos(Math.sin(t * 2.1 + ph));
      const g2 = pos(Math.sin(t * 1.6 + ph + 2));
      J.pitch = 0.05 + 0.04 * Math.sin(t * 1.3 + ph);
      J.aR = 0.35 + 0.3 * g;
      J.eR = 1.0 + 0.8 * g;
      J.rR = 0.05 + 0.2 * g;
      J.aL = 0.32 + 0.2 * g2;
      J.eL = 0.95 + 0.5 * g2;
      J.twist = 0.14 * Math.sin(t * 0.7 + ph);
      J.headYaw = 0.22 * Math.sin(t * 0.7 + ph) + 0.08 * Math.sin(t * 2.6 + ph);
      J.headPitch = 0.06 * Math.sin(t * 2.9 + ph);
      break;
    }
    case 'sit_play': {
      sit();
      // 下棋、打牌：一手拿牌，另一只手隔一阵伸出去落子
      const reach = pulse(t + ph * 2, 5.5, 1.3);
      J.pitch = 0.14 + 0.12 * reach;
      J.aL = 0.5;
      J.eL = 1.5;
      J.rL = -0.1;
      J.aR = 0.45 + 0.75 * reach;
      J.eR = 1.35 - 0.95 * reach;
      J.headPitch = 0.22;
      J.headYaw = 0.12 * Math.sin(t * 0.5 + ph);
      J.held = 'cards';
      break;
    }
    case 'sit_read':
      sit();
      J.pitch = 0.12;
      J.aL = J.aR = 0.55;
      J.eL = J.eR = 1.55;
      J.rL = J.rR = -0.16;
      J.headPitch = 0.3;
      J.held = 'book';
      break;
    case 'sit_phone':
      sit();
      J.pitch = 0.16;
      J.aR = 0.45;
      J.eR = 1.85 + 0.04 * Math.sin(t * 5 + ph);
      J.rR = -0.14;
      J.headPitch = 0.34;
      J.held = 'phone';
      break;
    case 'sit_tv':
      sit();
      J.pitch = -0.16;
      J.tL = J.tR = 1.32;
      J.kL = 1.2;
      J.kR = 1.35;
      J.aL = J.aR = 0.2;
      J.eL = J.eR = 0.8;
      J.headPitch = 0.12;
      break;
    case 'lie':
      J.lie = true;
      J.aL = J.aR = 0.05;
      J.rL = J.rR = 0.16;
      J.eL = J.eR = 0.3;
      J.kL = 0.12;
      break;
    case 'stand_work': {
      const s = Math.sin(t * 3.4 + ph);
      J.pitch = 0.14;
      J.aL = 0.55 + 0.14 * s;
      J.aR = 0.55 - 0.14 * s;
      J.eL = 1.15 - 0.2 * s;
      J.eR = 1.15 + 0.2 * s;
      J.headPitch = 0.22;
      J.kL = J.kR = 0.08;
      break;
    }
    case 'stand_talk': {
      const g = pos(Math.sin(t * 2.1 + ph));
      const g2 = pos(Math.sin(t * 1.5 + ph + 2));
      J.sway = 0.025 * Math.sin(t * 0.6 + ph);
      J.pitch = 0.03 * Math.sin(t * 1.3 + ph);
      J.aR = 0.2 + 0.4 * g;
      J.eR = 0.7 + 1.0 * g;
      J.rR = 0.08 + 0.22 * g;
      J.aL = 0.12 + 0.25 * g2;
      J.eL = 0.5 + 0.7 * g2;
      J.twist = 0.16 * Math.sin(t * 0.7 + ph);
      J.headYaw = 0.2 * Math.sin(t * 0.7 + ph);
      J.headPitch = 0.07 * Math.sin(t * 2.7 + ph);
      break;
    }
    case 'teach': {
      // 讲课：走两步，抬手指黑板，再转回来对着学生
      const walk = Math.sin(t * 0.4 + ph);
      const point = pos(Math.sin(t * 0.8 + ph));
      J.x = 0.6 * walk;
      J.yaw = 0.5 * walk;
      J.aR = 0.4 + 1.5 * point;
      J.eR = 1.0 - 0.75 * point;
      J.rR = 0.3 * point;
      J.aL = 0.4;
      J.eL = 1.4;
      J.headYaw = -0.4 * walk;
      J.held = 'book';
      break;
    }
    case 'cook': {
      // 颠勺：右手在锅上画圈，左手扶着锅沿
      const c = t * 5 + ph;
      J.pitch = 0.14;
      J.aR = 0.62 + 0.1 * Math.sin(c);
      J.eR = 1.1 + 0.12 * Math.cos(c);
      J.rR = 0.02 + 0.1 * Math.cos(c);
      J.aL = 0.5;
      J.eL = 1.0;
      J.rL = 0.12;
      J.headPitch = 0.25;
      J.held = 'spatula';
      break;
    }
    case 'serve': {
      const turn = Math.sin(t * 0.5 + ph);
      J.aL = J.aR = 0.3;
      J.eL = J.eR = 1.35;
      J.twist = 0.35 * turn;
      J.headYaw = 0.25 * turn;
      J.sway = 0.02 * Math.sin(t * 0.8 + ph);
      // 递东西
      J.aR += 0.5 * pulse(t + ph * 2, 6, 1.4);
      J.eR -= 0.7 * pulse(t + ph * 2, 6, 1.4);
      break;
    }
    case 'browse': {
      const reach = pulse(t + ph * 2, 6.5, 1.8);
      J.pitch = 0.06 + 0.12 * reach;
      J.aR = 0.25 + 0.95 * reach;
      J.eR = 0.9 - 0.55 * reach;
      J.aL = 0.3;
      J.eL = 1.2;
      J.twist = 0.25 * Math.sin(t * 0.35 + ph);
      J.headYaw = 0.3 * Math.sin(t * 0.35 + ph);
      J.headPitch = 0.15;
      break;
    }
    case 'chores': {
      // 扫地：握着扫帚左右来回
      const s = Math.sin(t * 2.2 + ph);
      J.pitch = 0.24;
      J.twist = 0.3 * s;
      J.aR = 0.55 + 0.12 * s;
      J.eR = 0.8;
      J.rR = -0.25;
      J.aL = 0.75 + 0.12 * s;
      J.eL = 0.55;
      J.rL = -0.3;
      J.x = 0.3 * Math.sin(t * 0.45 + ph);
      J.yaw = 0.4 * Math.sin(t * 0.45 + ph);
      J.kL = J.kR = 0.12;
      J.headPitch = 0.25;
      J.held = 'broom';
      break;
    }
    case 'phone':
      J.pitch = 0.1;
      J.aR = 0.4;
      J.eR = 1.95 + 0.04 * Math.sin(t * 5 + ph);
      J.rR = -0.12;
      J.aL = 0.05;
      J.headPitch = 0.36;
      J.sway = 0.02 * Math.sin(t * 0.5 + ph);
      J.held = 'phone';
      break;
    case 'dance': {
      // 广场舞：全场同一个拍子、同一套动作——四拍一组，左右踏步，扇子举过头顶再收回
      const b = t * 2.5;
      const step = Math.sin(b);
      const bar = Math.sin(b * 0.5);
      J.x = 0.4 * Math.sin(b * 0.5);
      J.sway = 0.03 * step;
      J.aR = 1.25 + 1.2 * pos(bar) + 0.15 * step;
      J.eR = 0.9 - 0.55 * pos(bar);
      J.rR = 0.25 + 0.3 * pos(bar);
      J.aL = 1.25 + 1.2 * pos(-bar) - 0.15 * step;
      J.eL = 0.9 - 0.55 * pos(-bar);
      J.rL = 0.25 + 0.3 * pos(-bar);
      J.tL = 0.32 * pos(step);
      J.tR = 0.32 * pos(-step);
      J.kL = 0.6 * pos(step);
      J.kR = 0.6 * pos(-step);
      J.twist = 0.22 * bar;
      J.headYaw = 0.15 * bar;
      J.y = 0.03 * Math.abs(step);
      J.held = 'fan';
      break;
    }
    case 'exercise': {
      // 晨练：马步、云手，慢
      const s = t * 0.75 + ph * 0.2;
      J.hip = HIP - 0.09;
      J.tL = 0.4;
      J.tR = 0.4;
      J.kL = J.kR = 0.75;
      J.rL = 0.25 + 0.2 * Math.sin(s);
      J.rR = 0.25 - 0.2 * Math.sin(s);
      J.aL = 0.9 + 0.5 * Math.sin(s);
      J.aR = 0.9 + 0.5 * Math.sin(s + Math.PI);
      J.eL = 0.9 + 0.4 * Math.cos(s);
      J.eR = 0.9 - 0.4 * Math.cos(s);
      J.twist = 0.35 * Math.sin(s * 0.5);
      J.sway = 0.06 * Math.sin(s * 0.5);
      J.headYaw = 0.2 * Math.sin(s * 0.5);
      J.pitch = 0.04;
      break;
    }
    case 'ball': {
      const s = t * 3 + ph;
      const jump = pos(Math.sin(s * 0.5)) ** 4;
      J.y = jump * 0.36;
      J.aR = 0.6 + 1.9 * jump + 0.3 * pos(Math.sin(s * 2));
      J.eR = 1.2 - 0.9 * jump;
      J.aL = 0.4 + 1.4 * jump;
      J.eL = 1.0 - 0.6 * jump;
      J.tL = 0.5 * Math.sin(s * 2);
      J.tR = -0.5 * Math.sin(s * 2);
      J.kL = 0.3 + 0.6 * pos(Math.sin(s * 2 + 2));
      J.kR = 0.3 + 0.6 * pos(-Math.sin(s * 2 + 2));
      J.pitch = 0.12;
      J.x = 0.8 * Math.sin(s * 0.3);
      J.z = 0.8 * Math.cos(s * 0.37);
      J.yaw = 0.9 * Math.sin(s * 0.3);
      break;
    }
    case 'play': {
      // 孩子们绕着圈追跑
      const s = t * 0.8 + ph;
      const r = t * 8.5 + ph;
      J.y = Math.abs(Math.sin(r)) * 0.09;
      J.aL = -0.8 * Math.sin(r);
      J.aR = 0.8 * Math.sin(r);
      J.eL = J.eR = 1.3;
      J.tL = 0.75 * Math.sin(r);
      J.tR = -0.75 * Math.sin(r);
      J.kL = 0.2 + pos(Math.sin(r + 2.2)) * 1.1;
      J.kR = 0.2 + pos(Math.sin(r + 2.2 + Math.PI)) * 1.1;
      J.pitch = 0.2;
      J.x = 0.6 * Math.sin(s);
      J.z = 0.6 * Math.cos(s);
      J.yaw = s + Math.PI / 2;
      break;
    }
  }
  if (carry && !J.lie && !J.sit) {
    // 提着东西的那只手垂着，少摆一点
    J.aR *= 0.25;
    J.eR = 0.12;
    J.rR = 0.12;
    J.held = 0;
  }
  if (elder && !J.lie) {
    J.pitch += 0.15;
    J.headPitch -= 0.1;
    if (!J.sit) {
      J.kL += 0.1;
      J.kR += 0.1;
      J.tL += 0.06;
      J.tR += 0.06;
    }
  }
}

// ───────────────────────── 几何

type G = THREE.BufferGeometry;
const cap = (r: number, total: number, seg = 8): G => new THREE.CapsuleGeometry(r, Math.max(0.001, total - 2 * r), 3, seg);

/** 给几何体一个统一的顶点色（灰度 v，或具体颜色） */
function tint<T extends G>(g: T, v: number | string): T {
  const n = g.getAttribute('position').count;
  const c = typeof v === 'number' ? new THREE.Color(v, v, v) : new THREE.Color(v);
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

const join = (parts: G[]): G => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;

function geometries() {
  // 躯干：身体 + 下摆 + 领口
  const body = tint(cap(0.172, 0.6, 12).scale(1.08, 1, 0.74).translate(0, 0.27, 0), 1);
  const hem = tint(new THREE.CylinderGeometry(0.186, 0.2, 0.13, 12, 1, true).scale(1.06, 1, 0.76).translate(0, 0.03, 0), 0.84);
  const collar = tint(new THREE.TorusGeometry(0.082, 0.026, 5, 12).rotateX(Math.PI / 2).scale(1, 1, 0.9).translate(0, 0.53, 0.005), 1.16);
  const placket = tint(new THREE.BoxGeometry(0.018, 0.34, 0.01).translate(0, 0.32, 0.128), 0.8);
  const torso = join([body, hem, collar, placket]);

  // 头：脑袋 + 脖子 + 耳朵（都是肤色）
  const skull = new THREE.SphereGeometry(HEAD_R, 18, 14).scale(1, 1.04, 0.98);
  const neck = new THREE.CylinderGeometry(0.06, 0.068, 0.16, 8).translate(0, -0.2, -0.005);
  const ear = (s: number) => new THREE.SphereGeometry(0.036, 6, 5).scale(0.5, 1, 0.8).translate(s * 0.182, -0.01, 0);
  const nose = new THREE.SphereGeometry(0.022, 6, 5).translate(0, -0.035, 0.182);
  const head = tint(join([skull, neck, ear(-1), ear(1), nose]), 1);

  // 脸：眼睛、腮红、嘴
  const eye = (s: number) => tint(new THREE.SphereGeometry(0.023, 8, 6).scale(1, 1.25, 0.5).translate(s * 0.068, 0.012, 0.169), '#2A2523');
  const brow = (s: number) => tint(new THREE.BoxGeometry(0.05, 0.01, 0.01).rotateZ(-s * 0.12).translate(s * 0.068, 0.062, 0.17), '#3A2E28');
  const blush = (s: number) => tint(new THREE.SphereGeometry(0.036, 8, 6).scale(1, 0.7, 0.25).translate(s * 0.108, -0.048, 0.146), '#EFA79B');
  const mouth = tint(new THREE.TorusGeometry(0.028, 0.0065, 4, 8, Math.PI).rotateZ(Math.PI).translate(0, -0.068, 0.171), '#A8554B');
  const face = join([eye(-1), eye(1), brow(-1), brow(1), blush(-1), blush(1), mouth]);

  const hair = tint(new THREE.SphereGeometry(0.202, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56).rotateX(-0.3).translate(0, 0.008, -0.014), 1);
  const hairX = tint(new THREE.SphereGeometry(1, 10, 8), 1);

  const upper = tint(cap(0.06, UPPER + 0.1, 8).translate(0, -(UPPER + 0.1) / 2 + 0.06, 0), 1);
  const sleeve = tint(cap(0.052, FORE + 0.06, 8).translate(0, -(FORE + 0.06) / 2 + 0.05, 0), 1);
  const cuff = tint(new THREE.CylinderGeometry(0.056, 0.056, 0.035, 8).translate(0, -FORE + 0.045, 0), 0.82);
  const fore = join([sleeve, cuff]);
  const palm = new THREE.SphereGeometry(0.054, 8, 6).scale(0.8, 1.15, 1).translate(0, -FORE - 0.035, 0);
  const thumb = new THREE.SphereGeometry(0.022, 5, 4).translate(0, -FORE - 0.02, 0.05);
  const hand = tint(join([palm, thumb]), 1);

  const thigh = tint(cap(0.088, THIGH + 0.09, 8).translate(0, -(THIGH + 0.09) / 2 + 0.088, 0), 1);
  const calf = tint(cap(0.07, 0.42, 8).translate(0, -0.21 + 0.06, 0), 0.9);
  const shoe = tint(new THREE.BoxGeometry(0.115, 0.075, 0.24, 2, 1, 2).translate(0, -0.4, 0.05), 0.3);
  const toe = tint(new THREE.SphereGeometry(0.058, 6, 4).scale(1, 0.65, 1.1).translate(0, -0.4, 0.15), 0.3);
  const sole = tint(new THREE.BoxGeometry(0.125, 0.02, 0.26).translate(0, -0.44, 0.055), 1.4);
  const shin = join([calf, shoe, toe, sole]);

  // 购物袋：袋身 + 两根提手
  const sack = tint(new THREE.BoxGeometry(0.3, 0.3, 0.13, 1, 2, 1).translate(0, -0.2, 0), 1);
  const handle = (z: number) => tint(new THREE.TorusGeometry(0.07, 0.008, 4, 8, Math.PI).translate(0, -0.05, z), 0.7);
  const leek = tint(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 5).rotateZ(0.3).translate(0.06, -0.04, 0), '#7FA56A');
  const bag = join([sack, handle(-0.03), handle(0.03), leek]);

  // 电动车
  const wheel = (z: number) => tint(new THREE.TorusGeometry(0.24, 0.055, 6, 14).rotateY(Math.PI / 2).translate(0, 0.29, z), 0.12);
  const hub = (z: number) => tint(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8).rotateZ(Math.PI / 2).translate(0, 0.29, z), 0.55);
  const deck = tint(new THREE.BoxGeometry(0.3, 0.09, 0.62).translate(0, 0.36, 0.02), 0.25);
  const tail = tint(new THREE.BoxGeometry(0.28, 0.3, 0.62, 2, 2, 2).translate(0, 0.5, -0.42), 1);
  const seat = tint(new THREE.BoxGeometry(0.27, 0.09, 0.56).translate(0, 0.7, -0.38), 0.14);
  const shield = tint(new THREE.BoxGeometry(0.32, 0.56, 0.08).rotateX(-0.28).translate(0, 0.62, 0.42), 1);
  const stem = tint(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6).rotateX(-0.28).translate(0, 0.98, 0.36), 0.35);
  const bar = tint(new THREE.CylinderGeometry(0.022, 0.022, 0.56, 6).rotateZ(Math.PI / 2).translate(0, 1.2, 0.3), 0.2);
  const lamp = tint(new THREE.SphereGeometry(0.06, 6, 5).translate(0, 0.86, 0.5), 1.6);
  const fender = tint(new THREE.BoxGeometry(0.14, 0.04, 0.4).translate(0, 0.56, 0.62), 1);
  const bike = join([wheel(0.62), wheel(-0.6), hub(0.62), hub(-0.6), deck, tail, seat, shield, stem, bar, lamp, fender]);

  // 配饰
  const apron = join([tint(new THREE.BoxGeometry(0.27, 0.5, 0.016).translate(0, 0.14, 0.136), 1), tint(new THREE.BoxGeometry(0.2, 0.2, 0.016).translate(0, 0.4, 0.132), 1), tint(new THREE.BoxGeometry(0.36, 0.03, 0.26).translate(0, 0.2, 0), 0.88)]);
  const lens = (s: number) => tint(new THREE.TorusGeometry(0.034, 0.006, 4, 10).translate(s * 0.068, 0.012, 0.182), 1);
  const bridge = tint(new THREE.BoxGeometry(0.04, 0.008, 0.008).translate(0, 0.018, 0.184), 1);
  const temple = (s: number) => tint(new THREE.BoxGeometry(0.008, 0.008, 0.16).translate(s * 0.108, 0.018, 0.1), 1);
  const glasses = join([lens(-1), lens(1), bridge, temple(-1), temple(1)]);
  const brim = tint(new THREE.CylinderGeometry(0.3, 0.31, 0.018, 16).translate(0, 0.1, 0), 0.92);
  const crown = tint(new THREE.CylinderGeometry(0.13, 0.19, 0.14, 12).translate(0, 0.17, 0), 1);
  const band = tint(new THREE.CylinderGeometry(0.192, 0.195, 0.03, 12).translate(0, 0.12, 0), 0.45);
  const hat = join([brim, crown, band]);
  const wrap = tint(new THREE.TorusGeometry(0.1, 0.045, 6, 12).rotateX(Math.PI / 2).scale(1, 0.9, 0.95).translate(0, 0.53, 0.005), 1);
  const tail2 = tint(new THREE.BoxGeometry(0.075, 0.24, 0.03).translate(0.05, 0.4, 0.125), 0.9);
  const scarf = join([wrap, tail2]);

  const held = tint(new THREE.BoxGeometry(1, 1, 1), 1);
  return { torso, head, face, hair, hairX, upper, fore, hand, thigh, shin, bag, bike, apron, glasses, hat, scarf, held };
}

const M_ROOT = new THREE.Matrix4();
const M_LEG = new THREE.Matrix4();
const M_PEL = new THREE.Matrix4();
const M_TOR = new THREE.Matrix4();
const M_HEAD = new THREE.Matrix4();
const M_A = new THREE.Matrix4();
const M_B = new THREE.Matrix4();
const M_C = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const V = new THREE.Vector3();
const C = new THREE.Color();

const BIKE_COLORS = ['#4B7EAD', '#C2553A', '#5C9E6E', '#E3A13A', '#8A6A9A', '#5E5A52', '#E9E2D0'];
const BAG_COLORS = ['#E9E2D0', '#D9776A', '#8FB27A', '#7FA8C9'];
const HELD_COLORS = Object.fromEntries(Object.entries(HELD).map(([k, v]) => [k, new THREE.Color(v.c)])) as Record<Exclude<Held, 0>, THREE.Color>;

export class Actors {
  readonly group = new THREE.Group();
  private readonly n: number;
  private readonly looks: ActorLook[];
  private readonly ids = new Map<string, number>();
  private readonly torso: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly face: THREE.InstancedMesh;
  private readonly hair: THREE.InstancedMesh;
  private readonly hairX: THREE.InstancedMesh;
  private readonly upper: THREE.InstancedMesh;
  private readonly fore: THREE.InstancedMesh;
  private readonly hand: THREE.InstancedMesh;
  private readonly thigh: THREE.InstancedMesh;
  private readonly shin: THREE.InstancedMesh;
  private readonly bag: THREE.InstancedMesh;
  private readonly bike: THREE.InstancedMesh;
  private readonly apron: THREE.InstancedMesh;
  private readonly glasses: THREE.InstancedMesh;
  private readonly hat: THREE.InstancedMesh;
  private readonly scarf: THREE.InstancedMesh;
  private readonly held: THREE.InstancedMesh;
  private readonly all: THREE.InstancedMesh[];
  private readonly heldKind: Held[];
  private readonly headScale: Float32Array;
  /** 每个人头顶的世界坐标与是否画出来（拾取、标注用） */
  readonly top: Float32Array;
  readonly shown: Uint8Array;
  /** 每个人眼睛的世界坐标与实际朝向（pov 镜头用） */
  readonly eye: Float32Array;

  constructor(looks: ActorLook[]) {
    this.looks = looks;
    this.n = Math.max(1, looks.length);
    const n = this.n;
    const g = geometries();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, vertexColors: true });
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
    this.face = mk(g.face, n, false);
    this.hair = mk(g.hair, n, false);
    this.hairX = mk(g.hairX, n, false);
    this.upper = mk(g.upper, n * 2);
    this.fore = mk(g.fore, n * 2);
    this.hand = mk(g.hand, n * 2, false);
    this.thigh = mk(g.thigh, n * 2);
    this.shin = mk(g.shin, n * 2);
    this.bag = mk(g.bag, n);
    this.bike = mk(g.bike, n);
    this.apron = mk(g.apron, n, false);
    this.glasses = mk(g.glasses, n, false);
    this.hat = mk(g.hat, n);
    this.scarf = mk(g.scarf, n, false);
    this.held = mk(g.held, n, false);
    this.all = [this.torso, this.head, this.face, this.hair, this.hairX, this.upper, this.fore, this.hand, this.thigh, this.shin, this.bag, this.bike, this.apron, this.glasses, this.hat, this.scarf, this.held];
    this.top = new Float32Array(n * 3);
    this.eye = new Float32Array(n * 4);
    this.shown = new Uint8Array(n);
    this.heldKind = Array.from({ length: n }, () => 0 as Held);
    this.headScale = new Float32Array(n).fill(1);

    const white = new THREE.Color(1, 1, 1);
    looks.forEach((l, i) => {
      this.ids.set(l.id, i);
      const child = l.scale < 0.95;
      // 孩子头大一点；一部分人穿短袖、孩子多穿短裤
      this.headScale[i] = 1 + (1 - l.scale) * 0.75;
      const short = !l.elder && (i * 7 + 3) % 5 < 2;
      const shorts = child && i % 2 === 0;
      this.torso.setColorAt(i, C.set(l.top));
      this.head.setColorAt(i, C.set(l.skin));
      this.face.setColorAt(i, white);
      this.hair.setColorAt(i, C.set(l.hair));
      this.hairX.setColorAt(i, C.set(l.hairStyle === 'cap' ? '#3F5F7A' : l.hair));
      for (let s = 0; s < 2; s++) {
        this.upper.setColorAt(i * 2 + s, C.set(l.top));
        this.fore.setColorAt(i * 2 + s, C.set(short ? l.skin : l.top));
        this.hand.setColorAt(i * 2 + s, C.set(l.skin));
        this.thigh.setColorAt(i * 2 + s, C.set(l.bottom));
        this.shin.setColorAt(i * 2 + s, C.set(shorts ? l.skin : l.bottom));
      }
      this.bag.setColorAt(i, C.set(BAG_COLORS[i % BAG_COLORS.length]!));
      this.bike.setColorAt(i, C.set(BIKE_COLORS[i % BIKE_COLORS.length]!));
      this.apron.setColorAt(i, C.set(i % 2 ? '#F2ECDD' : '#DCE6E4'));
      this.glasses.setColorAt(i, C.set('#2E2B2A'));
      this.hat.setColorAt(i, C.set(i % 2 ? '#DCC592' : '#B9A98C'));
      this.scarf.setColorAt(i, C.set(['#C2553A', '#4B7EAD', '#D9A75A', '#8A6A9A'][i % 4]!));
      this.held.setColorAt(i, white);
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
   * 每帧更新。hide(pose) 返回 true 的人不画（在没被剖开的楼里、在被剖建筑的别的楼层）。
   * t 是墙钟秒。
   */
  update(poses: readonly ActorPose[], t: number, hide: (pose: ActorPose) => boolean): void {
    const n = Math.min(this.n, poses.length, this.looks.length);
    let heldDirty = false;
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
      const child = k < 0.95;
      const ph = i * 1.618;
      solve(p.anim, t, ph, l.elder, child, p.carry);

      // 根：位置、朝向、身高
      const yaw = p.face + J.yaw;
      const sn = Math.sin(p.face);
      const cs = Math.cos(p.face);
      const wx = p.x + J.x * cs + J.z * sn;
      const wz = p.y - J.x * sn + J.z * cs;
      let wy = p.h + J.y;
      // 坐着时让屁股落在椅面上；孩子腿短，脚够不着地是对的
      if (J.sit) wy += SIT_HIP * (1 - k);
      M_ROOT.makeRotationY(yaw);
      if (J.lie) {
        // 仰面躺下：头朝正面的反方向，身体中点落在站位上
        M_A.makeRotationX(-Math.PI / 2);
        M_ROOT.multiply(M_A);
        M_ROOT.setPosition(p.x + sn * 0.86 * k, p.h + 0.6, p.y + cs * 0.86 * k);
      } else M_ROOT.setPosition(wx, wy, wz);
      M_ROOT.scale(V.set(k, k, k));

      // 骨盆 → 躯干 → 头
      M_LEG.copy(M_ROOT).multiply(M_A.makeTranslation(J.sway, J.hip, 0));
      M_PEL.copy(M_LEG);
      if (J.pitch) M_PEL.multiply(M_A.makeRotationX(J.pitch));
      if (J.roll) M_PEL.multiply(M_A.makeRotationZ(J.roll));
      M_TOR.copy(M_PEL);
      if (J.twist) M_TOR.multiply(M_A.makeRotationY(J.twist));
      this.torso.setMatrixAt(i, M_TOR);
      const hs = this.headScale[i]!;
      M_HEAD.copy(M_TOR).multiply(M_A.makeTranslation(0, HEAD_Y + (hs - 1) * 0.13, 0.012));
      if (J.headYaw || J.twist) M_HEAD.multiply(M_A.makeRotationY(J.headYaw - J.twist * 0.6));
      if (J.headPitch) M_HEAD.multiply(M_A.makeRotationX(J.headPitch));
      if (hs !== 1) M_HEAD.scale(V.set(hs, hs, hs));
      this.head.setMatrixAt(i, M_HEAD);
      this.face.setMatrixAt(i, M_HEAD);
      V.setFromMatrixPosition(M_HEAD);
      this.top[i * 3] = V.x;
      this.top[i * 3 + 1] = V.y + 0.3 * k;
      this.top[i * 3 + 2] = V.z;
      this.eye[i * 4] = V.x;
      this.eye[i * 4 + 1] = V.y;
      this.eye[i * 4 + 2] = V.z;
      this.eye[i * 4 + 3] = yaw;

      if (l.hairStyle === 'bald') this.hair.setMatrixAt(i, ZERO);
      else this.hair.setMatrixAt(i, M_HEAD);
      const hx = HAIR_X[l.hairStyle];
      if (hx) {
        M_B.copy(M_HEAD).multiply(M_A.makeTranslation(hx[0], hx[1], hx[2])).scale(V.set(hx[3], hx[4], hx[5]));
        this.hairX.setMatrixAt(i, M_B);
      } else this.hairX.setMatrixAt(i, ZERO);
      this.glasses.setMatrixAt(i, l.accent === 'glasses' ? M_HEAD : ZERO);
      this.hat.setMatrixAt(i, l.accent === 'hat' && !J.lie ? M_HEAD : ZERO);
      this.apron.setMatrixAt(i, l.accent === 'apron' ? M_TOR : ZERO);
      this.scarf.setMatrixAt(i, l.accent === 'scarf' ? M_TOR : ZERO);

      // 手臂：肩 → 肘 → 手
      let held: Held = J.held;
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? -1 : 1;
        M_B.copy(M_TOR).multiply(M_A.makeTranslation(sign * SHOULDER_X, SHOULDER_Y, 0));
        M_B.multiply(M_A.makeRotationZ(sign * (s === 0 ? J.rL : J.rR)));
        M_B.multiply(M_A.makeRotationX(-(s === 0 ? J.aL : J.aR)));
        this.upper.setMatrixAt(i * 2 + s, M_B);
        M_B.multiply(M_A.makeTranslation(0, -UPPER, 0));
        M_B.multiply(M_A.makeRotationX(-(s === 0 ? J.eL : J.eR)));
        this.fore.setMatrixAt(i * 2 + s, M_B);
        this.hand.setMatrixAt(i * 2 + s, M_B);
        if (s === 1) {
          if (p.carry && !J.lie && !J.sit) {
            this.bag.setMatrixAt(i, M_C.copy(M_B).multiply(M_A.makeTranslation(0, -FORE - 0.03, 0)));
            held = 0;
          } else this.bag.setMatrixAt(i, ZERO);
          if (held) {
            const h = HELD[held];
            M_C.copy(M_B).multiply(M_A.makeTranslation(h.o[0], -FORE - 0.04 + h.o[1], h.o[2]));
            M_C.scale(V.set(h.s[0], h.s[1], h.s[2]));
            this.held.setMatrixAt(i, M_C);
          } else this.held.setMatrixAt(i, ZERO);
        }
      }
      if (held !== this.heldKind[i]) {
        this.heldKind[i] = held;
        if (held) {
          this.held.setColorAt(i, HELD_COLORS[held]);
          heldDirty = true;
        }
      }

      // 腿：髋 → 膝
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? -1 : 1;
        M_B.copy(M_LEG).multiply(M_A.makeTranslation(sign * 0.095, 0, 0));
        M_B.multiply(M_A.makeRotationX(-(s === 0 ? J.tL : J.tR)));
        this.thigh.setMatrixAt(i * 2 + s, M_B);
        M_B.multiply(M_A.makeTranslation(0, -THIGH, 0));
        M_B.multiply(M_A.makeRotationX(s === 0 ? J.kL : J.kR));
        this.shin.setMatrixAt(i * 2 + s, M_B);
      }

      this.bike.setMatrixAt(i, p.anim === 'ride' ? M_ROOT : ZERO);
    }
    for (const m of this.all) m.instanceMatrix.needsUpdate = true;
    if (heldDirty && this.held.instanceColor) this.held.instanceColor.needsUpdate = true;
  }

  private zero(i: number): void {
    for (const m of [this.torso, this.head, this.face, this.hair, this.hairX, this.bag, this.bike, this.apron, this.glasses, this.hat, this.scarf, this.held]) m.setMatrixAt(i, ZERO);
    for (let s = 0; s < 2; s++) for (const m of [this.upper, this.fore, this.hand, this.thigh, this.shin]) m.setMatrixAt(i * 2 + s, ZERO);
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
