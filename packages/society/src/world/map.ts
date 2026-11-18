import { MinHeap, type Keyed } from '../core/pq.ts';
import { CELL, G_GREEN, G_LOT, type Cell, type MapDef, type PlaceDef, type PlaceKind } from '../model/def.ts';

/** 一条路线：折线顶点（格坐标，取格心）与长度（格） */
export interface Route {
  /** [x0, y0, x1, y1, …] */
  pts: number[];
  len: number;
}

interface Node extends Keyed {
  /** 格序号 × 4 + 方向 */
  n: number;
}

interface Tree {
  dist: Float64Array;
  prev: Int32Array;
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
/** 拐弯的小代价：让路线尽量走直 */
const TURN = 0.05;

/** 地图：格子寻路与按类型找地点。内容由 MapDef 决定，自身只做缓存。 */
export class WorldMap {
  readonly w: number;
  readonly h: number;
  readonly places: Record<string, PlaceDef>;
  readonly list: PlaceDef[];
  private readonly ground: MapDef['ground'];
  private readonly trees = new Map<number, Tree>();
  private readonly routes = new Map<string, Route | null>();
  private readonly kinds = new Map<string, PlaceDef[]>();

  constructor(def: MapDef) {
    this.w = def.w;
    this.h = def.h;
    this.ground = def.ground;
    this.list = def.places;
    this.places = Object.fromEntries(def.places.map((p) => [p.id, p]));
  }

  place(id: string): PlaceDef {
    const p = this.places[id];
    if (!p) throw new Error(`没有这个地点: ${id}`);
    return p;
  }

  walkable(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.ground[y * this.w + x] !== G_LOT;
  }

  private cost(x: number, y: number): number {
    return this.ground[y * this.w + x] === G_GREEN ? 1.15 : 1;
  }

  /** 从一格出发到所有（格, 方向）的最短代价与前驱 */
  private tree(from: Cell): Tree {
    const key = from.y * this.w + from.x;
    const hit = this.trees.get(key);
    if (hit) return hit;
    const dist = new Float64Array(this.w * this.h * 4).fill(Infinity);
    const prev = new Int32Array(this.w * this.h * 4).fill(-1);
    const heap = new MinHeap<Node>();
    let seq = 0;
    for (let d = 0; d < 4; d++) {
      dist[key * 4 + d] = 0;
      heap.push({ t: 0, prio: 0, seq: seq++, n: key * 4 + d });
    }
    for (let cur = heap.pop(); cur; cur = heap.pop()) {
      if (cur.t > dist[cur.n]!) continue;
      const c = cur.n >> 2;
      const d = cur.n & 3;
      const x = c % this.w;
      const y = (c - x) / this.w;
      for (let nd = 0; nd < 4; nd++) {
        const nx = x + DX[nd]!;
        const ny = y + DY[nd]!;
        if (!this.walkable(nx, ny)) continue;
        const nn = (ny * this.w + nx) * 4 + nd;
        const nt = cur.t + this.cost(nx, ny) + (nd === d ? 0 : TURN);
        if (nt < dist[nn]!) {
          dist[nn] = nt;
          prev[nn] = cur.n;
          heap.push({ t: nt, prio: 0, seq: seq++, n: nn });
        }
      }
    }
    const tree = { dist, prev };
    this.trees.set(key, tree);
    return tree;
  }

  /** 格到格的路线；走不到返回 null */
  routeCells(from: Cell, to: Cell): Route | null {
    const key = `${from.x},${from.y}>${to.x},${to.y}`;
    const hit = this.routes.get(key);
    if (hit !== undefined) return hit;
    let route: Route | null = null;
    if (from.x === to.x && from.y === to.y) route = { pts: [from.x + 0.5, from.y + 0.5], len: 0 };
    else if (this.walkable(from.x, from.y) && this.walkable(to.x, to.y)) {
      const { dist, prev } = this.tree(from);
      const end = to.y * this.w + to.x;
      let n = end * 4;
      for (let k = 1; k < 4; k++) if (dist[end * 4 + k]! < dist[n]!) n = end * 4 + k;
      if (Number.isFinite(dist[n]!)) {
        const cells: number[] = [];
        for (let cur = n; cur >= 0; cur = prev[cur]!) cells.push(cur >> 2);
        cells.reverse();
        route = compress(cells, this.w);
      }
    }
    this.routes.set(key, route);
    return route;
  }

  /** 地点到地点（门到门）的路线 */
  route(from: string, to: string): Route | null {
    return this.routeCells(this.place(from).door, this.place(to).door);
  }

  /** 门到门的路程（米）；走不到返回 Infinity */
  meters(from: string, to: string): number {
    if (from === to) return 0;
    const r = this.route(from, to);
    return r ? r.len * CELL : Infinity;
  }

  ofKind(kind: PlaceKind): PlaceDef[] {
    let hit = this.kinds.get(kind);
    if (!hit) {
      hit = this.list.filter((p) => p.kind === kind);
      this.kinds.set(kind, hit);
    }
    return hit;
  }

  /** 离 from 最近的某类地点（门到门；同距离按 id） */
  nearestOf(kind: PlaceKind, from: string, filter?: (p: PlaceDef) => boolean): PlaceDef | undefined {
    let best: PlaceDef | undefined;
    let bd = Infinity;
    for (const p of this.ofKind(kind)) {
      if (filter && !filter(p)) continue;
      const d = this.meters(from, p.id);
      if (d < bd || (d === bd && best && p.id < best.id)) {
        best = p;
        bd = d;
      }
    }
    return best;
  }
}

/** 一串相邻的格 → 只留拐点的折线 */
function compress(cells: number[], w: number): Route {
  const pts: number[] = [];
  let len = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    const x = c % w;
    const y = (c - x) / w;
    if (i > 0) len += 1;
    if (i > 0 && i < cells.length - 1) {
      const a = cells[i - 1]!;
      const b = cells[i + 1]!;
      if (b - c === c - a) continue;
    }
    pts.push(x + 0.5, y + 0.5);
  }
  return { pts, len };
}

/** 折线上按进度 f（0–1）取点（格坐标）与朝向 θ */
export function alongRoute(pts: readonly number[], f: number): { x: number; y: number; face: number } {
  const n = pts.length / 2;
  if (n <= 1) return { x: pts[0] ?? 0, y: pts[1] ?? 0, face: 0 };
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.abs(pts[i * 2]! - pts[i * 2 - 2]!) + Math.abs(pts[i * 2 + 1]! - pts[i * 2 - 1]!);
  let left = Math.max(0, Math.min(1, f)) * total;
  for (let i = 1; i < n; i++) {
    const x0 = pts[i * 2 - 2]!;
    const y0 = pts[i * 2 - 1]!;
    const x1 = pts[i * 2]!;
    const y1 = pts[i * 2 + 1]!;
    const seg = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (left <= seg || i === n - 1) {
      const k = seg > 0 ? Math.min(1, left / seg) : 0;
      return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, face: Math.atan2(x1 - x0, y1 - y0) };
    }
    left -= seg;
  }
  return { x: pts[n * 2 - 2]!, y: pts[n * 2 - 1]!, face: 0 };
}
