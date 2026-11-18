import * as THREE from 'three';

/**
 * 几何拼装器：把许多小零件（盒子、圆柱、球团、斜面）合并成一个带顶点色的网格。
 * 整个静态世界只用一种材质，绘制次数很少。
 */

const colorCache = new Map<string, [number, number, number]>();
const tmpColor = new THREE.Color();

/** '#rrggbb' → 线性空间的 rgb */
export function rgb(hex: string): [number, number, number] {
  let c = colorCache.get(hex);
  if (!c) {
    tmpColor.set(hex);
    c = [tmpColor.r, tmpColor.g, tmpColor.b];
    colorCache.set(hex, c);
  }
  return c;
}

/** 在 HSL 里调明度与饱和度，返回 '#rrggbb' */
export function tone(hex: string, dl: number, ds = 0): string {
  const key = `${hex}|${dl}|${ds}`;
  const hit = toneCache.get(key);
  if (hit) return hit;
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, Math.max(0, Math.min(1, hsl.s + ds)), Math.max(0, Math.min(1, hsl.l + dl)), THREE.SRGBColorSpace);
  const out = `#${c.getHexString(THREE.SRGBColorSpace)}`;
  toneCache.set(key, out);
  return out;
}
const toneCache = new Map<string, string>();

export function mix(a: string, b: string, k: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  ca.lerp(cb, k);
  return `#${ca.getHexString(THREE.SRGBColorSpace)}`;
}

const prim = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g);
const BOX = prim(new THREE.BoxGeometry(1, 1, 1));
const CYL = new Map<string, THREE.BufferGeometry>();
const BLOB = prim(new THREE.IcosahedronGeometry(1, 1));
const BALL = prim(new THREE.SphereGeometry(1, 12, 8));

const cyl = (seg: number, top: number): THREE.BufferGeometry => {
  const key = `${seg}|${top}`;
  let g = CYL.get(key);
  if (!g) {
    g = prim(new THREE.CylinderGeometry(top, 1, 1, seg));
    CYL.set(key, g);
  }
  return g;
};

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const E = new THREE.Euler();
const N3 = new THREE.Matrix3();
const V = new THREE.Vector3();

export class Geo {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private knd: number[] = [];
  /** 表面种类（见 detail.ts）：之后加入的零件都带上它 */
  kind = 0;
  /** 当前的局部坐标系：之后加入的零件都先经过它 */
  private frame = new THREE.Matrix4();
  private stack: THREE.Matrix4[] = [];

  get empty(): boolean {
    return this.pos.length === 0;
  }

  /** 进入一个局部坐标系（平移 + 绕 Y 旋转） */
  push(x: number, y: number, z: number, rotY = 0): this {
    this.stack.push(this.frame.clone());
    M.compose(P.set(x, y, z), Q.setFromEuler(E.set(0, rotY, 0)), S.set(1, 1, 1));
    this.frame.multiply(M);
    return this;
  }

  pop(): this {
    const f = this.stack.pop();
    if (f) this.frame = f;
    return this;
  }

  /** 加入任意几何体（需带法线） */
  add(src: THREE.BufferGeometry, local: THREE.Matrix4, color: string): this {
    const m = new THREE.Matrix4().multiplyMatrices(this.frame, local);
    N3.getNormalMatrix(m);
    const p = src.getAttribute('position');
    const n = src.getAttribute('normal');
    const [r, g, b] = rgb(color);
    for (let i = 0; i < p.count; i++) {
      V.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(V.x, V.y, V.z);
      V.fromBufferAttribute(n, i).applyMatrix3(N3).normalize();
      this.nor.push(V.x, V.y, V.z);
      this.col.push(r, g, b);
      this.knd.push(this.kind);
    }
    return this;
  }

  /** 以某个表面种类画一段，画完恢复 */
  as(kind: number, draw: () => void): this {
    const was = this.kind;
    this.kind = kind;
    draw();
    this.kind = was;
    return this;
  }

  /** 盒子：中心 + 尺寸；rot 绕 Y，tilt 绕 X（先 tilt 后 rot） */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: string, rot = 0, tilt = 0, roll = 0): this {
    M.compose(P.set(cx, cy, cz), Q.setFromEuler(E.set(tilt, rot, roll, 'YXZ')), S.set(sx, sy, sz));
    return this.add(BOX, M, color);
  }

  /** 立在地上的盒子：底面中心 + 尺寸 */
  block(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: string, rot = 0): this {
    return this.box(cx, y0 + sy / 2, cz, sx, sy, sz, color, rot);
  }

  /** 竖直圆柱（可收顶成锥台）：底面中心、半径、高 */
  cyl(cx: number, y0: number, cz: number, r: number, h: number, color: string, seg = 10, top = 1): this {
    M.compose(P.set(cx, y0 + h / 2, cz), Q.identity(), S.set(r, h, r));
    return this.add(cyl(seg, top), M, color);
  }

  /** 任意朝向的圆柱：从 a 到 b */
  rod(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, color: string, seg = 6): this {
    const d = V.set(bx - ax, by - ay, bz - az);
    const len = d.length();
    Q.setFromUnitVectors(P.set(0, 1, 0), d.clone().normalize());
    M.compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), Q, S.set(r, len, r));
    return this.add(cyl(seg, 1), M, color);
  }

  /** 低面数的球团（树冠、灌木） */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: string, rot = 0): this {
    M.compose(P.set(cx, cy, cz), Q.setFromEuler(E.set(0, rot, 0)), S.set(rx, ry, rz));
    return this.add(BLOB, M, color);
  }

  ball(cx: number, cy: number, cz: number, r: number, color: string): this {
    M.compose(P.set(cx, cy, cz), Q.identity(), S.set(r, r, r));
    return this.add(BALL, M, color);
  }

  /** 一个平面多边形（凸，逆时针为正面），平直法线 */
  poly(pts: ReadonlyArray<readonly [number, number, number]>, color: string, twoSided = false): this {
    if (pts.length < 3) return this;
    const [r, g, b] = rgb(color);
    const a = new THREE.Vector3(...pts[0]!).applyMatrix4(this.frame);
    const w = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.frame));
    const n = new THREE.Vector3().subVectors(w[1]!, a).cross(new THREE.Vector3().subVectors(w[2]!, a)).normalize();
    const emit = (v: THREE.Vector3[], nn: THREE.Vector3) => {
      for (let i = 1; i < v.length - 1; i++)
        for (const q of [v[0]!, v[i]!, v[i + 1]!]) {
          this.pos.push(q.x, q.y, q.z);
          this.nor.push(nn.x, nn.y, nn.z);
          this.col.push(r, g, b);
          this.knd.push(this.kind);
        }
    };
    emit(w, n);
    if (twoSided) emit([...w].reverse(), n.clone().negate());
    return this;
  }

  /** 一块有厚度的板：顶面四个角（逆时针，从上看），向下挤出 t */
  slab(pts: ReadonlyArray<readonly [number, number, number]>, t: number, color: string, edge = color): this {
    const low = pts.map((p) => [p[0], p[1] - t, p[2]] as const);
    this.poly(pts, color);
    this.poly([...low].reverse(), edge);
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      this.poly([pts[i]!, low[i]!, low[j]!, pts[j]!], edge);
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(this.knd, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** 确定性的小哈希：外观上的随机变化都从它来（不影响内核） */
export function hash01(...key: Array<string | number>): number {
  let h = 2166136261;
  const s = key.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export const pickOf = <T>(arr: readonly T[], ...key: Array<string | number>): T => arr[Math.floor(hash01(...key) * arr.length) % arr.length]!;
