import { CELL, type PlaceDef } from '../model/def.ts';

/**
 * 室内模板：每类建筑的家具与站位（D68）。
 * 内核按站位安排人，三维层按同一份数据画家具，所以看到的位置就是模型里的位置。
 *
 * 坐标：相对建筑占地西北角的米数（x 向东，y 向南），已按门朝向转好。
 * 朝向 θ：人或家具“正面”指向 (sin θ, cos θ)，θ = 0 朝南。
 *
 * 模板在规范坐标里写：u 沿门所在的墙（从门外看，左 → 右），v 是离门墙的进深；
 * 规范朝向 φ = 0 表示面朝屋里（+v）。
 */

export type Pose = 'stand' | 'sit' | 'lie';

export type AnchorKind =
  // 住家
  | 'bed'
  | 'dine'
  | 'sofa'
  | 'stove'
  | 'desk'
  // 店员与顾客
  | 'counter'
  | 'stall'
  | 'kitchen'
  | 'queue'
  | 'browse'
  | 'table'
  // 茶馆、活动中心、公园里的桌子
  | 'board'
  | 'read'
  // 学校、单位、车间、诊所
  | 'class'
  | 'podium'
  | 'machine'
  | 'wait'
  | 'exam'
  // 开放空间
  | 'bench'
  | 'dance'
  | 'stroll'
  | 'play'
  | 'hoop'
  // 随意站着
  | 'free';

export interface Anchor {
  id: number;
  kind: AnchorKind;
  x: number;
  y: number;
  floor: number;
  /** 住户单元；公共区域为 -1 */
  unit: number;
  face: number;
  pose: Pose;
}

export type FurnitureKind =
  | 'bed'
  | 'table'
  | 'chair'
  | 'sofa'
  | 'tv'
  | 'stove'
  | 'fridge'
  | 'desk'
  | 'wardrobe'
  | 'stairs'
  | 'counter'
  | 'shelf'
  | 'stall'
  | 'bookshelf'
  | 'blackboard'
  | 'machine'
  | 'cot'
  | 'bench'
  | 'stonetable'
  | 'tree'
  | 'pavilion'
  | 'hoop'
  | 'shelter'
  | 'sign'
  | 'planter'
  | 'flagpole'
  | 'plant';

export interface Furniture {
  kind: FurnitureKind;
  x: number;
  y: number;
  floor: number;
  unit: number;
  /** 正面朝向 θ */
  rot: number;
  /** 宽（垂直于正面）与深（沿正面），米 */
  w: number;
  d: number;
}

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  floor: number;
}

export interface UnitRect {
  unit: number;
  floor: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Interior {
  /** 层高（米） */
  floorH: number;
  anchors: Anchor[];
  furniture: Furniture[];
  /** 室内隔墙（外墙由三维层按占地生成） */
  walls: Wall[];
  /** 住户单元的范围 */
  units: UnitRect[];
  /** 门在外墙上的位置（局部米） */
  door: { x: number; y: number };
}

export const FLOOR_H = 3;

interface AOpts {
  floor?: number;
  unit?: number;
  face?: number;
  pose?: Pose;
}

interface FOpts {
  floor?: number;
  unit?: number;
  rot?: number;
  w?: number;
  d?: number;
}

class Builder {
  readonly anchors: Anchor[] = [];
  readonly furniture: Furniture[] = [];
  readonly walls: Wall[] = [];
  readonly units: UnitRect[] = [];
  /** 规范坐标下的宽（沿门墙）与进深 */
  readonly W: number;
  readonly D: number;
  /** 门在门墙上的位置（规范坐标 u）：与布局里“门外那一格”对齐 */
  readonly doorU: number;
  private readonly Wm: number;
  private readonly Hm: number;

  constructor(readonly place: PlaceDef) {
    this.Wm = place.w * CELL;
    this.Hm = place.h * CELL;
    const ns = place.facing === 'n' || place.facing === 's';
    this.W = ns ? this.Wm : this.Hm;
    this.D = ns ? this.Hm : this.Wm;
    this.doorU = (Math.floor((this.W / CELL - 1) / 2) + 0.5) * CELL;
  }

  pt(u: number, v: number): [number, number] {
    switch (this.place.facing) {
      case 's':
        return [u, this.Hm - v];
      case 'n':
        return [this.Wm - u, v];
      case 'e':
        return [this.Wm - v, this.Hm - u];
      default:
        return [v, u];
    }
  }

  /** 规范朝向 φ → 局部朝向 θ */
  dir(phi: number): number {
    const du = Math.sin(phi);
    const dv = Math.cos(phi);
    const [x0, y0] = this.pt(0, 0);
    const [x1, y1] = this.pt(du, dv);
    return round3(Math.atan2(x1 - x0, y1 - y0));
  }

  anchor(kind: AnchorKind, u: number, v: number, o: AOpts = {}): void {
    const [x, y] = this.pt(u, v);
    this.anchors.push({ id: this.anchors.length, kind, x: round3(x), y: round3(y), floor: o.floor ?? 0, unit: o.unit ?? -1, face: this.dir(o.face ?? 0), pose: o.pose ?? 'stand' });
  }

  furn(kind: FurnitureKind, u: number, v: number, o: FOpts = {}): void {
    const [x, y] = this.pt(u, v);
    this.furniture.push({ kind, x: round3(x), y: round3(y), floor: o.floor ?? 0, unit: o.unit ?? -1, rot: this.dir(o.rot ?? 0), w: o.w ?? 1, d: o.d ?? 1 });
  }

  wall(u1: number, v1: number, u2: number, v2: number, floor = 0): void {
    const [x1, y1] = this.pt(u1, v1);
    const [x2, y2] = this.pt(u2, v2);
    this.walls.push({ x1: round3(x1), y1: round3(y1), x2: round3(x2), y2: round3(y2), floor });
  }

  unit(unit: number, floor: number, u: number, v: number, w: number, d: number): void {
    const [xa, ya] = this.pt(u, v);
    const [xb, yb] = this.pt(u + w, v + d);
    this.units.push({ unit, floor, x: round3(Math.min(xa, xb)), y: round3(Math.min(ya, yb)), w: round3(Math.abs(xb - xa)), h: round3(Math.abs(yb - ya)) });
  }

  /** 围着 (cu, cv) 的一个座位，面朝中心 */
  seat(kind: AnchorKind, cu: number, cv: number, du: number, dv: number, o: AOpts = {}, chair = true): void {
    const face = Math.atan2(-du, -dv);
    this.anchor(kind, cu + du, cv + dv, { pose: 'sit', ...o, face });
    if (chair) this.furn('chair', cu + du, cv + dv, { floor: o.floor, unit: o.unit, rot: face, w: 0.45, d: 0.45 });
  }

  /** 一张四人方桌 */
  table4(kind: AnchorKind, cu: number, cv: number, o: AOpts = {}, size = 1.0, furniture: FurnitureKind = 'table'): void {
    this.furn(furniture, cu, cv, { floor: o.floor, unit: o.unit, w: size, d: size });
    const r = size / 2 + 0.35;
    this.seat(kind, cu, cv, 0, -r, o);
    this.seat(kind, cu, cv, 0, r, o);
    this.seat(kind, cu, cv, -r, 0, o);
    this.seat(kind, cu, cv, r, 0, o);
  }
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const PI = Math.PI;

/** 一套住房：客厅兼餐厅在前，厨房在后左，卧室在后右 */
function homeUnit(b: Builder, u0: number, v0: number, w: number, d: number, floor: number, unit: number): void {
  const o = { floor, unit };
  b.unit(unit, floor, u0, v0, w, d);

  // 餐桌：四个座位 + 一个加座
  const tu = u0 + 0.3 * w;
  const tv = v0 + 0.36 * d;
  b.furn('table', tu, tv, { ...o, w: 1.3, d: 0.9 });
  b.seat('dine', tu, tv, -0.4, -0.8, o);
  b.seat('dine', tu, tv, 0.4, -0.8, o);
  b.seat('dine', tu, tv, -0.4, 0.8, o);
  b.seat('dine', tu, tv, 0.4, 0.8, o);
  b.seat('dine', tu, tv, -1.05, 0, o);

  // 沙发对着电视
  const su = u0 + 0.74 * w;
  b.furn('sofa', su, v0 + 0.45 * d, { ...o, rot: PI, w: 2.0, d: 0.8 });
  b.furn('tv', su, v0 + 0.06 * d, { ...o, rot: 0, w: 1.2, d: 0.3 });
  for (const du of [-0.62, 0, 0.62]) b.anchor('sofa', su + du, v0 + 0.45 * d, { ...o, face: PI, pose: 'sit' });

  // 厨房：灶台靠后墙
  const ku = u0 + 0.17 * w;
  b.furn('stove', ku, v0 + d - 0.42, { ...o, rot: PI, w: 1.5, d: 0.6 });
  b.furn('fridge', u0 + 0.37 * w, v0 + d - 0.45, { ...o, rot: PI, w: 0.7, d: 0.7 });
  b.anchor('stove', ku, v0 + d - 1.15, { ...o, face: 0 });

  // 卧室隔墙（留门洞）
  const wu = u0 + 0.46 * w;
  const wv = v0 + 0.6 * d;
  b.wall(wu, wv, u0 + 0.6 * w, wv, floor);
  b.wall(u0 + 0.76 * w, wv, u0 + w, wv, floor);
  b.wall(wu, wv, wu, v0 + d, floor);

  // 床：头靠后墙，最多四张；第五张是靠左墙的小床
  const span = (u0 + w - wu - 0.2) / 4;
  for (let i = 0; i < 4; i++) {
    const bu = wu + 0.1 + span * (i + 0.5);
    b.furn('bed', bu, v0 + d - 1.1, { ...o, rot: PI, w: Math.min(0.95, span - 0.08), d: 2.0 });
    b.anchor('bed', bu, v0 + d - 1.1, { ...o, face: PI, pose: 'lie' });
  }
  b.furn('cot', u0 + 0.45, v0 + 0.72 * d, { ...o, rot: PI, w: 0.8, d: 1.8 });
  b.anchor('bed', u0 + 0.45, v0 + 0.72 * d, { ...o, face: PI, pose: 'lie' });

  // 书桌靠前墙的右角（门在左半边）
  const du = u0 + w - 0.75;
  b.furn('desk', du, v0 + 0.32, { ...o, rot: 0, w: 1.1, d: 0.55 });
  b.anchor('desk', du, v0 + 0.95, { ...o, face: PI, pose: 'sit' });
  b.furn('chair', du, v0 + 0.95, { ...o, rot: PI, w: 0.45, d: 0.45 });

  b.furn('wardrobe', u0 + w - 0.35, v0 + 0.66 * d, { ...o, rot: -PI / 2, w: 1.0, d: 0.55 });

  // 做家务、走动的空位
  b.anchor('free', u0 + 0.52 * w, v0 + 0.22 * d, { ...o, face: PI });
  b.anchor('free', u0 + 0.36 * w, v0 + 0.7 * d, { ...o, face: 0 });
}

type Template = (b: Builder) => void;

const TEMPLATES: Record<PlaceDef['kind'], Template> = {
  house(b) {
    homeUnit(b, 0.3, 0.3, b.W - 0.6, b.D - 0.6, 0, 0);
  },

  apartment(b) {
    const half = b.W / 2;
    for (let f = 0; f < b.place.floors; f++) {
      homeUnit(b, 0.3, 0.3, half - 1.5, b.D - 0.6, f, f * 2);
      homeUnit(b, half + 1.2, 0.3, half - 1.5, b.D - 0.6, f, f * 2 + 1);
      b.furn('stairs', half, b.D * 0.55, { floor: f, w: 2.0, d: 4.5 });
      b.wall(half - 1.2, 0.3, half - 1.2, b.D - 0.3, f);
      b.wall(half + 1.2, 0.3, half + 1.2, b.D - 0.3, f);
    }
  },

  grocery(b) {
    b.furn('counter', 1.9, 1.9, { rot: PI, w: 2.2, d: 0.7 });
    b.anchor('counter', 1.4, 2.7, { face: PI });
    b.anchor('counter', 2.5, 2.7, { face: PI });
    for (const u of [1.9, 3.0, 4.1]) b.anchor('queue', u, 1.1, { face: 0 });
    b.furn('shelf', 4.7, 4.8, { rot: PI / 2, w: 4.2, d: 0.6 });
    b.furn('shelf', 6.7, 4.8, { rot: PI / 2, w: 4.2, d: 0.6 });
    b.furn('shelf', 0.6, 5.6, { rot: PI / 2, w: 3.0, d: 0.5 });
    b.furn('fridge', 2.6, b.D - 0.6, { rot: PI, w: 1.6, d: 0.7 });
    for (const u of [3.8, 5.7]) for (const v of [3.2, 4.8, 6.4]) b.anchor('browse', u, v, { face: PI / 2 });
  },

  eatery(b) {
    for (const [u, v] of [
      [2.0, 1.9],
      [6.0, 1.9],
      [2.0, 4.1],
      [6.0, 4.1],
    ] as const)
      b.table4('table', u, v, {}, 0.9);
    b.furn('counter', b.W / 2, 5.75, { rot: PI, w: b.W - 1.4, d: 0.5 });
    b.anchor('counter', b.W - 1.5, 5.1, { face: PI });
    b.furn('stove', 2.4, b.D - 0.5, { rot: PI, w: 1.8, d: 0.6 });
    b.furn('stove', 5.4, b.D - 0.5, { rot: PI, w: 1.8, d: 0.6 });
    b.anchor('kitchen', 2.4, b.D - 1.25, { face: 0 });
    b.anchor('kitchen', 5.4, b.D - 1.25, { face: 0 });
  },

  teahouse(b) {
    for (const u of [2.2, 6.0, 9.8]) for (const v of [2.2, 5.0]) b.table4('board', u, v, {}, 1.0);
    b.furn('counter', b.W - 1.4, b.D - 0.7, { rot: PI, w: 2.2, d: 0.6 });
    b.anchor('counter', b.W - 2.0, b.D - 1.45, { face: PI });
    b.anchor('counter', b.W - 0.9, b.D - 1.45, { face: PI });
    b.furn('plant', 0.6, b.D - 0.6, { w: 0.6, d: 0.6 });
  },

  center(b) {
    b.furn('bookshelf', 0.45, b.D / 2, { rot: PI / 2, w: b.D - 2, d: 0.45 });
    for (const v of [2.4, 5.3]) {
      b.furn('table', 2.8, v, { w: 2.4, d: 0.9 });
      for (const du of [-0.6, 0.6]) for (const dv of [-0.8, 0.8]) b.seat('read', 2.8, v, du, dv);
    }
    for (const v of [2.4, 5.3]) b.table4('board', 6.8, v, {}, 1.0);
    b.furn('desk', b.W - 1.4, 1.5, { rot: PI, w: 1.6, d: 0.7 });
    b.anchor('counter', b.W - 1.8, 2.3, { face: PI });
    b.anchor('counter', b.W - 1.0, 2.3, { face: PI });
    for (const u of [b.W - 2.6, b.W - 1.0]) for (const v of [4.4, 5.6, 6.8]) b.anchor('free', u, v, { face: PI });
  },

  clinic(b) {
    b.furn('counter', 2.0, 1.8, { rot: PI, w: 2.2, d: 0.6 });
    b.anchor('counter', 2.0, 2.6, { face: PI });
    for (let i = 0; i < 6; i++) {
      b.anchor('wait', b.W - 0.8, 1.0 + 0.62 * i, { face: -PI / 2, pose: 'sit' });
      b.furn('chair', b.W - 0.8, 1.0 + 0.62 * i, { rot: -PI / 2, w: 0.45, d: 0.45 });
    }
    b.wall(0, 5.0, 3.0, 5.0);
    b.wall(4.4, 5.0, b.W, 5.0);
    for (const u of [2.0, 6.0]) {
      b.furn('desk', u, 6.4, { rot: PI, w: 1.3, d: 0.6 });
      b.anchor('desk', u, 7.1, { face: PI, pose: 'sit' });
      b.furn('chair', u, 7.1, { rot: PI, w: 0.45, d: 0.45 });
      b.anchor('exam', u, 5.7, { face: 0, pose: 'sit' });
      b.furn('chair', u, 5.7, { rot: 0, w: 0.45, d: 0.45 });
    }
  },

  market(b) {
    const us = [2.6, 6.2, 9.8, 13.4].map((u) => (u / 16) * b.W);
    for (const u of us) {
      // 前排：摊主背靠门墙，面朝过道
      b.furn('stall', u, 3.2, { rot: 0, w: 2.4, d: 1.0 });
      b.anchor('stall', u, 2.2, { face: 0 });
      b.anchor('browse', u - 0.6, 4.4, { face: PI });
      b.anchor('browse', u + 0.6, 4.4, { face: PI });
      // 后排：摊主背靠后墙
      b.furn('stall', u, b.D - 3.2, { rot: PI, w: 2.4, d: 1.0 });
      b.anchor('stall', u, b.D - 2.2, { face: PI });
      b.anchor('browse', u - 0.6, b.D - 4.4, { face: 0 });
      b.anchor('browse', u + 0.6, b.D - 4.4, { face: 0 });
    }
  },

  school(b) {
    const half = b.W / 2;
    for (let f = 0; f < b.place.floors; f++) {
      b.wall(half, 4, half, b.D, f);
      b.wall(0, 4, half - 2.4, 4, f);
      b.wall(half - 1.2, 4, b.W - 2.4, 4, f);
      for (const a0 of [0.3, half + 0.3]) {
        for (let r = 0; r < 3; r++)
          for (let c = 0; c < 4; c++) {
            const u = a0 + 1.9 + 2.3 * c;
            const v = 6.4 + 2.2 * r;
            b.furn('desk', u, v + 0.55, { floor: f, rot: PI, w: 1.0, d: 0.5 });
            b.anchor('class', u, v, { floor: f, face: 0, pose: 'sit' });
            b.furn('chair', u, v, { floor: f, rot: 0, w: 0.4, d: 0.4 });
          }
        b.furn('blackboard', a0 + 5.3, b.D - 0.3, { floor: f, rot: PI, w: 5.0, d: 0.12 });
        b.anchor('podium', a0 + 5.3, b.D - 1.5, { floor: f, face: PI });
      }
    }
    for (const u of [2.0, 5.0]) {
      b.furn('desk', u, 1.3, { rot: 0, w: 1.3, d: 0.6 });
      b.anchor('desk', u, 2.0, { face: PI, pose: 'sit' });
      b.furn('chair', u, 2.0, { rot: PI, w: 0.45, d: 0.45 });
    }
  },

  office(b) {
    for (let f = 0; f < b.place.floors; f++)
      for (const v of [4.0, 8.4])
        for (const u of [2.0, 4.6, 7.4, 10.0]) {
          const uu = (u / 12) * b.W;
          b.furn('desk', uu, v, { floor: f, rot: 0, w: 1.4, d: 0.7 });
          b.anchor('desk', uu, v + 0.7, { floor: f, face: PI, pose: 'sit' });
          b.furn('chair', uu, v + 0.7, { floor: f, rot: PI, w: 0.45, d: 0.45 });
        }
    b.furn('counter', b.W / 2, 1.6, { rot: PI, w: 2.6, d: 0.6 });
    b.anchor('counter', b.W / 2, 2.3, { face: PI });
    b.furn('stairs', b.W - 1.4, b.D - 2.4, { w: 2.0, d: 4.0 });
  },

  workshop(b) {
    for (const v of [3.4, 7.8])
      for (let i = 0; i < 7; i++) {
        const u = ((2.0 + 2.6 * i) / 20) * b.W;
        b.furn('machine', u, v, { rot: 0, w: 1.6, d: 1.0 });
        b.anchor('machine', u, v + 1.05, { face: PI });
      }
    for (const u of [b.W - 3.2, b.W - 1.2]) {
      b.furn('desk', u, b.D - 0.7, { rot: PI, w: 1.3, d: 0.6 });
      b.anchor('desk', u, b.D - 1.4, { face: 0, pose: 'sit' });
      b.furn('chair', u, b.D - 1.4, { rot: 0, w: 0.45, d: 0.45 });
    }
  },

  park(b) {
    const cu = b.W / 2;
    const cv = b.D / 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * PI;
      b.anchor('stroll', cu + Math.sin(a) * 0.4 * b.W, cv + Math.cos(a) * 0.38 * b.D, { face: a + PI / 2 });
    }
    for (let i = 0; i < 10; i++) {
      const a = ((i + 0.5) / 10) * 2 * PI;
      const u = cu + Math.sin(a) * 0.31 * b.W;
      const v = cv + Math.cos(a) * 0.29 * b.D;
      b.furn('bench', u, v, { rot: a + PI, w: 1.5, d: 0.5 });
      b.anchor('bench', u, v, { face: a + PI, pose: 'sit' });
    }
    for (const u of [0.2 * b.W, 0.8 * b.W]) b.table4('board', u, 0.24 * b.D, {}, 0.9, 'stonetable');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) b.anchor('free', cu - 3.3 + 2.2 * c, cv - 2.2 + 2.2 * r, { face: PI });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * PI;
      b.anchor('play', cu + Math.sin(a) * 2.4, 0.8 * b.D + Math.cos(a) * 1.6, { face: a + PI });
    }
    b.furn('pavilion', 0.16 * b.W, 0.76 * b.D, { w: 4, d: 4 });
    // 树：沿边一圈，再在草地上点几棵
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.3) / n) * 2 * PI;
      b.furn('tree', cu + Math.sin(a) * 0.47 * b.W, cv + Math.cos(a) * 0.46 * b.D, { w: 2.6 + (i % 3) * 0.5, d: 2.6 });
    }
    b.furn('tree', 0.84 * b.W, 0.72 * b.D, { w: 3.4, d: 3.4 });
    b.furn('tree', 0.5 * b.W, 0.16 * b.D, { w: 3.0, d: 3.0 });
  },

  square(b) {
    const cu = b.W / 2;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) b.anchor('dance', cu - 5.5 + 2.2 * c, 0.3 * b.D + 2.2 * r, { face: PI });
    for (let i = 0; i < 4; i++) {
      const u = (0.14 + 0.24 * i) * b.W;
      b.furn('bench', u, b.D - 1.0, { rot: PI, w: 1.5, d: 0.5 });
      b.anchor('bench', u, b.D - 1.0, { face: PI, pose: 'sit' });
    }
    for (const v of [0.34 * b.D, 0.62 * b.D]) {
      b.furn('bench', 0.9, v, { rot: PI / 2, w: 1.5, d: 0.5 });
      b.anchor('bench', 0.9, v, { face: PI / 2, pose: 'sit' });
      b.furn('bench', b.W - 0.9, v, { rot: -PI / 2, w: 1.5, d: 0.5 });
      b.anchor('bench', b.W - 0.9, v, { face: -PI / 2, pose: 'sit' });
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 2 * PI;
      b.anchor('play', 0.26 * b.W + Math.sin(a) * 2.6, 0.78 * b.D + Math.cos(a) * 1.7, { face: a + PI });
    }
    for (let i = 0; i < 10; i++) b.anchor('free', 0.58 * b.W + (i % 5) * 1.9, 0.72 * b.D + Math.floor(i / 5) * 2.0, { face: PI });
    b.furn('flagpole', cu, 0.12 * b.D, { w: 0.3, d: 0.3 });
    for (const [u, v] of [
      [0.08, 0.08],
      [0.92, 0.08],
      [0.08, 0.92],
      [0.92, 0.92],
    ] as const)
      b.furn('planter', u * b.W, v * b.D, { w: 2.2, d: 2.2 });
  },

  court(b) {
    const spots: Array<[number, number]> = [
      [0.2, 0.3],
      [0.32, 0.6],
      [0.14, 0.7],
      [0.4, 0.35],
      [0.28, 0.45],
      [0.8, 0.3],
      [0.68, 0.6],
      [0.86, 0.7],
      [0.6, 0.4],
      [0.72, 0.5],
    ];
    for (const [u, v] of spots) b.anchor('hoop', u * b.W, v * b.D, { face: u < 0.5 ? -PI / 2 : PI / 2 });
    for (let i = 0; i < 4; i++) {
      const u = (0.2 + 0.2 * i) * b.W;
      b.furn('bench', u, 0.6, { rot: 0, w: 1.5, d: 0.5 });
      b.anchor('bench', u, 0.6, { face: 0, pose: 'sit' });
    }
    b.furn('hoop', 0.8, b.D / 2 + 0.3, { rot: PI / 2, w: 1.8, d: 1.2 });
    b.furn('hoop', b.W - 0.8, b.D / 2 + 0.3, { rot: -PI / 2, w: 1.8, d: 1.2 });
  },

  busstop(b) {
    b.furn('shelter', b.W / 2, b.D - 1.2, { rot: PI, w: Math.min(6, b.W - 1), d: 1.6 });
    b.furn('sign', b.W - 0.6, 0.8, { w: 0.3, d: 0.3 });
    for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) b.anchor('wait', 1.0 + c * ((b.W - 2) / 5), 0.9 + r * 1.1, { face: PI });
  },
};

const cache = new WeakMap<PlaceDef, Interior>();

/** 一栋建筑的室内（纯函数，按对象缓存） */
export function interiorOf(place: PlaceDef): Interior {
  const hit = cache.get(place);
  if (hit) return hit;
  const b = new Builder(place);
  TEMPLATES[place.kind](b);
  const [dx, dy] = b.pt(b.doorU, 0);
  const it: Interior = { floorH: FLOOR_H, anchors: b.anchors, furniture: b.furniture, walls: b.walls, units: b.units, door: { x: round3(dx), y: round3(dy) } };
  cache.set(place, it);
  return it;
}

/** 站位的世界坐标（米）与高度 */
export function anchorWorld(place: PlaceDef, a: Anchor): { x: number; y: number; h: number } {
  return { x: place.x * CELL + a.x, y: place.y * CELL + a.y, h: a.floor * FLOOR_H };
}
