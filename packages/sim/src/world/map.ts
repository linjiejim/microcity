import { MinHeap } from '../core/pq.ts';

export type TileKind = 'grass' | 'park' | 'road' | 'path' | 'plaza' | 'water' | 'bridge' | 'lot' | 'tree' | 'flower';
export type District = 'north' | 'south';

export interface Tile {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PlaceKind =
  | 'residence'
  | 'gov'
  | 'clinic'
  | 'library'
  | 'utility'
  | 'newsroom'
  | 'supermarket'
  | 'cafe'
  | 'restaurant'
  | 'convenience'
  | 'studio'
  | 'plaza'
  | 'park';

export interface PlaceStyle {
  /** 调色板颜色（Endesga 32 的十六进制） */
  wall: string;
  roof: string;
  trim: string;
  floors: number;
  sign?: string;
}

export interface PlaceDef {
  id: string;
  name: string;
  short: string;
  district: District;
  kind: PlaceKind;
  rect: Rect;
  /** 建筑：门前可步行瓦片；开放空间：入口参考点 */
  door: Tile;
  /** 开放空间（公园/广场）：可站立位置 */
  open: boolean;
  /** 营业时段（当天秒数区间），null 表示全天 */
  hours: Array<[number, number]> | null;
  needsPower: boolean;
  capacity: number;
  units?: number;
  style: PlaceStyle;
  board?: { id: string; tile: Tile };
}

export interface Prop {
  kind: 'tree' | 'flower' | 'lamp' | 'bench' | 'board' | 'fountain';
  x: number;
  y: number;
  /** 公告栏 id */
  ref?: string;
}

export const WALKABLE: Record<TileKind, number> = {
  road: 1,
  path: 1,
  bridge: 1,
  plaza: 1,
  park: 1.3,
  grass: 3,
  water: Infinity,
  lot: Infinity,
  tree: Infinity,
  flower: Infinity,
};

/** 1 瓦片步行秒数（约 10 米，1.25 m/s） */
export const SECONDS_PER_TILE = 8;

export class TownMap {
  readonly w: number;
  readonly h: number;
  readonly tiles: TileKind[];
  readonly places: Record<string, PlaceDef>;
  readonly props: Prop[];
  /** 河道占据的行（含桥）：[上沿, 下沿]；没有河时为 null */
  readonly river: [number, number] | null;
  private pathCache = new Map<string, Tile[] | null>();
  private placeSlots = new Map<string, Tile[]>();
  private nearestCache = new Map<string, string | null>();
  /** 公告栏、喷泉等占地道具不可穿行 */
  private blocked = new Set<number>();

  constructor(w: number, h: number, tiles: TileKind[], places: PlaceDef[], props: Prop[]) {
    this.w = w;
    this.h = h;
    this.tiles = tiles;
    this.places = Object.fromEntries(places.map((p) => [p.id, p]));
    this.props = props;
    for (const p of props) if (p.kind === 'board' || p.kind === 'fountain') this.blocked.add(p.y * w + p.x);
    this.river = findRiver(w, h, tiles);
  }

  /** 某类地点（按定义顺序） */
  placesOfKind(kinds: PlaceKind | readonly PlaceKind[]): PlaceDef[] {
    const ks: readonly PlaceKind[] = typeof kinds === 'string' ? [kinds] : kinds;
    return Object.values(this.places).filter((p) => ks.includes(p.kind));
  }

  /**
   * 离 from 最近的某类地点（门到门步行时间；同时间按 id）。
   * district：只在该区找；avoid：不要该区的。按类型顺序优先（例如先公园、后广场）。
   */
  nearestOf(kinds: PlaceKind | readonly PlaceKind[], from: string, opts: { district?: District; avoid?: District; filter?: (p: PlaceDef) => boolean } = {}): PlaceDef | undefined {
    const ks: readonly PlaceKind[] = typeof kinds === 'string' ? [kinds] : kinds;
    const key = opts.filter ? '' : `${ks.join('+')}|${from}|${opts.district ?? ''}|${opts.avoid ?? ''}`;
    if (key && this.nearestCache.has(key)) {
      const id = this.nearestCache.get(key);
      return id ? this.places[id] : undefined;
    }
    let best: PlaceDef | undefined;
    for (const k of ks) {
      let bestT = Infinity;
      for (const p of this.placesOfKind(k)) {
        if (opts.district && p.district !== opts.district) continue;
        if (opts.avoid && p.district === opts.avoid) continue;
        if (opts.filter && !opts.filter(p)) continue;
        const t = this.places[from] ? this.travelSeconds(from, p.id) : 0;
        if (t < bestT || (t === bestT && best && p.id < best.id)) {
          bestT = t;
          best = p;
        }
      }
      if (best) break;
    }
    if (key) this.nearestCache.set(key, best?.id ?? null);
    return best;
  }

  /** 区域的矩形范围（河上下两侧） */
  districtBounds(d: District): Rect {
    if (!this.river) return { x: 0, y: 0, w: this.w, h: this.h };
    const [top, bottom] = this.river;
    return d === 'north' ? { x: 0, y: 0, w: this.w, h: top } : { x: 0, y: bottom + 1, w: this.w, h: this.h - bottom - 1 };
  }

  kind(x: number, y: number): TileKind | undefined {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return undefined;
    return this.tiles[y * this.w + x];
  }

  cost(x: number, y: number): number {
    const k = this.kind(x, y);
    if (k === undefined || this.blocked.has(y * this.w + x)) return Infinity;
    return WALKABLE[k];
  }

  districtOf(tile: Tile): District {
    if (!this.river) return 'north';
    const [top, bottom] = this.river;
    return tile.y <= (top + bottom) / 2 ? 'north' : 'south';
  }

  /** 开放空间的站位（确定性顺序） */
  slots(placeId: string): Tile[] {
    const cached = this.placeSlots.get(placeId);
    if (cached) return cached;
    const p = this.places[placeId];
    if (!p) throw new Error(`未知地点 ${placeId}`);
    const out: Tile[] = [];
    if (p.open) {
      for (let y = p.rect.y; y < p.rect.y + p.rect.h; y++) {
        for (let x = p.rect.x; x < p.rect.x + p.rect.w; x++) {
          if (Number.isFinite(this.cost(x, y))) out.push({ x, y });
        }
      }
    }
    this.placeSlots.set(placeId, out);
    return out;
  }

  /** A* 4 邻域；同代价时按固定方向顺序展开，保证确定性 */
  path(from: Tile, to: Tile): Tile[] | null {
    const key = `${from.x},${from.y}>${to.x},${to.y}`;
    if (this.pathCache.has(key)) return this.pathCache.get(key)!;
    const res = this.astar(from, to);
    this.pathCache.set(key, res);
    return res;
  }

  private astar(from: Tile, to: Tile): Tile[] | null {
    const W = this.w;
    const idx = (x: number, y: number) => y * W + x;
    const start = idx(from.x, from.y);
    const goal = idx(to.x, to.y);
    if (start === goal) return [from];
    if (!Number.isFinite(this.cost(to.x, to.y))) return null;
    const g = new Float64Array(W * this.h).fill(Infinity);
    const came = new Int32Array(W * this.h).fill(-1);
    const closed = new Uint8Array(W * this.h);
    const heap = new MinHeap<{ t: number; prio: number; seq: number; i: number }>();
    let seq = 0;
    g[start] = 0;
    const hfn = (i: number) => Math.abs((i % W) - to.x) + Math.abs(Math.floor(i / W) - to.y);
    heap.push({ t: hfn(start), prio: 0, seq: seq++, i: start });
    const dirs = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const;
    while (heap.size > 0) {
      const cur = heap.pop()!;
      const i = cur.i;
      if (closed[i]) continue;
      if (i === goal) break;
      closed[i] = 1;
      const cx = i % W;
      const cy = Math.floor(i / W);
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        const c = this.cost(nx, ny);
        if (!Number.isFinite(c)) continue;
        const ni = idx(nx, ny);
        const ng = g[i]! + c;
        if (ng < g[ni]!) {
          g[ni] = ng;
          came[ni] = i;
          heap.push({ t: ng + hfn(ni), prio: Math.round(hfn(ni) * 100), seq: seq++, i: ni });
        }
      }
    }
    if (came[goal] === -1) return null;
    const out: Tile[] = [];
    for (let i = goal; i !== -1; i = came[i]!) {
      out.push({ x: i % W, y: Math.floor(i / W) });
      if (i === start) break;
    }
    return out.reverse();
  }

  /** 路径步行耗时（秒） */
  static walkSeconds(path: Tile[]): number {
    return Math.max(SECONDS_PER_TILE, (path.length - 1) * SECONDS_PER_TILE);
  }

  /** 两个地点之间的步行秒数（门到门） */
  travelSeconds(fromPlace: string, toPlace: string): number {
    if (fromPlace === toPlace) return 0;
    const a = this.places[fromPlace];
    const b = this.places[toPlace];
    if (!a || !b) throw new Error(`未知地点 ${fromPlace} / ${toPlace}`);
    const p = this.path(a.door, b.door);
    return p ? TownMap.walkSeconds(p) : 3600;
  }

  toAscii(): string {
    const ch: Record<TileKind, string> = {
      grass: '.',
      park: ',',
      road: '#',
      path: '=',
      plaza: '*',
      water: '~',
      bridge: 'H',
      lot: 'B',
      tree: 'T',
      flower: 'f',
    };
    const rows: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let row = '';
      for (let x = 0; x < this.w; x++) row += ch[this.kind(x, y)!];
      rows.push(row);
    }
    return rows.join('\n');
  }
}

/** 河道：整行都是水或桥的连续行 */
function findRiver(w: number, h: number, tiles: TileKind[]): [number, number] | null {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    let all = true;
    for (let x = 0; x < w; x++) {
      const k = tiles[y * w + x];
      if (k !== 'water' && k !== 'bridge') {
        all = false;
        break;
      }
    }
    if (all) {
      if (top < 0) top = y;
      bottom = y;
    } else if (top >= 0) break;
  }
  return top >= 0 ? [top, bottom] : null;
}

export const DISTRICT_LABEL: Record<District, string> = { north: '北区', south: '南区' };

/** 地点当天是否营业 */
export function isOpenAt(place: PlaceDef, secOfDay: number): boolean {
  if (!place.hours) return true;
  return place.hours.some(([a, b]) => secOfDay >= a && secOfDay < b);
}
