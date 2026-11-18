import { rand } from '../core/rng.ts';
import { hm } from '../core/time.ts';
import { CELL, G_GREEN, G_LOT, G_PLAZA, G_STREET, type Cell, type Facing, type Ground, type MapDef, type PlaceDef, type PlaceKind, type PropDef } from '../model/def.ts';
import type { CommunitySpec } from './spec.ts';

/** 一个可住的单元 */
export interface HomeSlot {
  place: string;
  unit: number;
  apartment: boolean;
}

export interface Layout {
  map: MapDef;
  /** 住房单元，按离中心由近到远 */
  homes: HomeSlot[];
}

const WALLS = ['#EFE3D0', '#E8D5BC', '#F2E8DA', '#E3CDB5', '#DCC6AC', '#F0DCC8', '#E6DCCB', '#DDD2C2', '#E9D9C6'];
const ROOFS = ['#B5654A', '#8F6B55', '#6F7F86', '#A6714F', '#7C8C7A', '#9A5B4E', '#77665A'];
const TRIMS = ['#1F5F63', '#E3A13A', '#C2553A', '#4B7EAD', '#5C9E6E', '#8A6A9A', '#9C6B4E'];

const CAPACITY: Record<PlaceKind, number> = {
  house: 12,
  apartment: 64,
  market: 24,
  grocery: 10,
  eatery: 16,
  teahouse: 24,
  center: 22,
  clinic: 8,
  school: 64,
  office: 22,
  workshop: 18,
  park: 50,
  square: 54,
  court: 14,
  busstop: 40,
};

const OPEN_KINDS: PlaceKind[] = ['park', 'square', 'court', 'busstop'];

/** 门外那一格：从门外看，取门墙上居中偏左的一格（室内模板的 doorU 与之对齐） */
function doorOf(x: number, y: number, w: number, h: number, facing: Facing): Cell {
  switch (facing) {
    case 's':
      return { x: x + Math.floor((w - 1) / 2), y: y + h };
    case 'n':
      return { x: x + Math.floor(w / 2), y: y - 1 };
    case 'e':
      return { x: x + w, y: y + Math.floor(h / 2) };
    default:
      return { x: x - 1, y: y + Math.floor((h - 1) / 2) };
  }
}

/**
 * 老城街坊的布局：4 × 4 个街块，一条东西向的主街。
 * 主街两侧是菜市场、饭馆、广场、茶馆、学校、街道办；其余街块是住宅，离中心近的先盖。
 */
export function layoutOldtown(spec: CommunitySpec, unitsNeeded: number): Layout {
  const W = 44;
  const H = 36;
  const ground: Ground[] = Array.from({ length: W * H }, () => G_LOT);
  const set = (x: number, y: number, g: Ground) => {
    if (x >= 0 && y >= 0 && x < W && y < H) ground[y * W + x] = g;
  };

  const VX = [2, 12, 21, 22, 32, 41];
  const HY = [2, 10, 17, 18, 26, 33];
  for (const x of VX) for (let y = 2; y <= 33; y++) set(x, y, G_STREET);
  for (const y of HY) for (let x = 2; x <= 41; x++) set(x, y, G_STREET);
  // 主街通到地图两端（去城里的方向）
  for (const y of [17, 18]) for (let x = 0; x < W; x++) set(x, y, G_STREET);

  const places: PlaceDef[] = [];
  const taken = new Uint8Array(W * H);
  const counters: Partial<Record<PlaceKind, number>> = {};
  const seed = spec.seed;

  const add = (kind: PlaceKind, name: string, x: number, y: number, w: number, h: number, facing: Facing, o: { floors?: number; units?: number; hours?: [number, number] | null } = {}): PlaceDef => {
    const n = (counters[kind] = (counters[kind] ?? 0) + 1);
    const id = `${kind}${n}`;
    const open = OPEN_KINDS.includes(kind);
    const p: PlaceDef = {
      id,
      kind,
      name,
      x,
      y,
      w,
      h,
      facing,
      door: doorOf(x, y, w, h, facing),
      floors: open ? 0 : (o.floors ?? 1),
      units: o.units ?? 0,
      open,
      hours: o.hours ?? null,
      capacity: CAPACITY[kind],
      style: {
        wall: WALLS[Math.floor(rand(seed, 'wall', id) * WALLS.length)]!,
        roof: ROOFS[Math.floor(rand(seed, 'roof', id) * ROOFS.length)]!,
        trim: TRIMS[Math.floor(rand(seed, 'trim', id) * TRIMS.length)]!,
        variant: Math.floor(rand(seed, 'variant', id) * 4),
      },
    };
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        taken[yy * W + xx] = 1;
        if (open) set(xx, yy, kind === 'square' || kind === 'busstop' ? G_PLAZA : G_GREEN);
      }
    places.push(p);
    return p;
  };

  // 公共与商业
  add('park', '口袋公园', 3, 3, 9, 7, 'e');
  add('market', '和平里菜市场', 13, 14, 4, 3, 's', { hours: [hm(5, 30), hm(13, 0)] });
  add('eatery', '顺发小馆', 17, 15, 2, 2, 's', { hours: [hm(10, 30), hm(21, 0)] });
  add('eatery', '老周早点', 19, 15, 2, 2, 's', { hours: [hm(5, 30), hm(14, 0)] });
  add('grocery', '便民超市', 13, 11, 2, 2, 'n', { hours: [hm(7, 30), hm(21, 30)] });
  add('clinic', '社区卫生站', 16, 11, 2, 2, 'n', { hours: [hm(8, 0), hm(17, 30)] });
  add('square', '文化广场', 23, 11, 6, 6, 's');
  add('teahouse', '聚福茶馆', 29, 15, 3, 2, 's', { hours: [hm(9, 0), hm(21, 30)] });
  add('center', '街坊活动中心', 29, 11, 3, 2, 'n', { hours: [hm(8, 30), hm(20, 30)] });
  add('eatery', '巷口面馆', 13, 19, 2, 2, 'n', { hours: [hm(6, 30), hm(20, 30)] });
  add('grocery', '好邻居小卖部', 16, 19, 2, 2, 'n', { hours: [hm(7, 30), hm(21, 30)] });
  add('office', '和平里街道办', 18, 19, 3, 3, 'n', { floors: 2, hours: [hm(8, 30), hm(18, 0)] });
  add('school', '和平里小学', 23, 19, 6, 4, 'n', { floors: 2, hours: [hm(7, 20), hm(18, 30)] });
  add('court', '球场', 23, 23, 4, 3, 's');
  add('workshop', '永兴五金加工厂', 33, 27, 5, 3, 'n', { hours: [hm(7, 40), hm(17, 30)] });
  add('busstop', '和平里公交站', 42, 15, 2, 2, 's');

  // 住宅：先列出所有可盖的位置，再按离中心的远近取用
  interface Lot {
    apt: boolean;
    x: number;
    y: number;
    facing: Facing;
    dist: number;
    key: string;
  }
  const cx = 22;
  const cy = 17.5;
  const dist = (x: number, y: number, w: number) => Math.abs(x + w / 2 - cx) + Math.abs(y + 1 - cy);
  const fixed: Array<[number, number, Facing]> = [
    [19, 11, 'n'],
    [13, 24, 's'],
    [16, 24, 's'],
    [19, 24, 's'],
    [28, 24, 's'],
    [30, 24, 's'],
    [39, 27, 'n'],
    [33, 31, 's'],
    [36, 31, 's'],
    [39, 31, 's'],
  ];
  const BX: Array<[number, number]> = [
    [3, 11],
    [13, 20],
    [23, 31],
    [33, 40],
  ];
  const BY: Array<[number, number]> = [
    [3, 9],
    [11, 16],
    [19, 25],
    [27, 32],
  ];
  const RES: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 0],
    [1, 3],
    [2, 0],
    [2, 3],
    [3, 0],
    [3, 1],
    [3, 2],
  ];
  interface Row {
    x0: number;
    w: number;
    y: number;
    facing: Facing;
    dist: number;
    key: string;
  }
  const rows: Row[] = [];
  for (const [bx, by] of RES) {
    const [x0, x1] = BX[bx]!;
    const [y0, y1] = BY[by]!;
    const w = x1 - x0 + 1;
    rows.push({ x0, w, y: y0, facing: 'n', dist: dist(x0, y0, w), key: `${bx}${by}n` });
    rows.push({ x0, w, y: y1 - 1, facing: 's', dist: dist(x0, y1 - 1, w), key: `${bx}${by}s` });
  }
  rows.sort((a, b) => a.dist - b.dist || (a.key < b.key ? -1 : 1));

  const UNITS_PER_APT = 8;
  const nApt = Math.min(rows.length, Math.round((unitsNeeded * spec.apartments) / UNITS_PER_APT));
  const lots: Lot[] = fixed.map(([x, y, f]) => ({ apt: false, x, y, facing: f, dist: dist(x, y, 2), key: `f${x}_${y}` }));
  rows.forEach((r, i) => {
    const mirror = rand(seed, 'mirror', r.key) < 0.5;
    const at = (off: number, bw: number) => r.x0 + (mirror ? r.w - off - bw : off);
    if (i < nApt) {
      lots.push({ apt: true, x: at(0, 4), y: r.y, facing: r.facing, dist: r.dist - 100, key: `${r.key}a` });
      const offs = r.w >= 9 ? [5, 7] : [4, 6];
      offs.forEach((o, k) => lots.push({ apt: false, x: at(o, 2), y: r.y, facing: r.facing, dist: dist(at(o, 2), r.y, 2), key: `${r.key}h${k}` }));
    } else {
      [0, 3, 6].forEach((o, k) => lots.push({ apt: false, x: at(o, 2), y: r.y, facing: r.facing, dist: dist(at(o, 2), r.y, 2), key: `${r.key}h${k}` }));
    }
  });
  lots.sort((a, b) => a.dist - b.dist || (a.key < b.key ? -1 : 1));

  const homes: HomeSlot[] = [];
  const target = Math.ceil(unitsNeeded * 1.06);
  const spare: Lot[] = [];
  let houseNo = 0;
  let aptNo = 0;
  for (const lot of lots) {
    if (homes.length >= target) {
      spare.push(lot);
      continue;
    }
    if (lot.apt) {
      const p = add('apartment', `${++aptNo} 号楼`, lot.x, lot.y, 4, 2, lot.facing, { floors: UNITS_PER_APT / 2, units: UNITS_PER_APT });
      for (let u = 0; u < UNITS_PER_APT; u++) homes.push({ place: p.id, unit: u, apartment: true });
    } else {
      const p = add('house', `${++houseNo} 号院`, lot.x, lot.y, 2, 2, lot.facing, { floors: rand(seed, 'floors', lot.key) < 0.55 ? 2 : 1, units: 1 });
      homes.push({ place: p.id, unit: 0, apartment: false });
    }
  }

  // 陈设：没盖的宅基地是菜地；街边、四周是树；路口与主街有路灯
  const props: PropDef[] = [];
  const prop = (kind: PropDef['kind'], x: number, y: number, key: string) => props.push({ kind, x: r2(x), y: r2(y), s: r2(0.8 + rand(seed, 'ps', key) * 0.5), r: r2(rand(seed, 'pr', key) * 6.28) });
  for (const lot of spare) {
    const w = lot.apt ? 4 : 2;
    for (let yy = lot.y; yy < lot.y + 2; yy++)
      for (let xx = lot.x; xx < lot.x + w; xx++) {
        taken[yy * W + xx] = 1;
        prop(rand(seed, 'plot', xx, yy) < 0.7 ? 'plot' : 'bush', (xx + 0.5) * CELL, (yy + 0.5) * CELL, `plot${xx}_${yy}`);
      }
  }
  const isStreet = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && ground[y * W + x] === G_STREET;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (ground[y * W + x] !== G_LOT || taken[y * W + x]) continue;
      const border = x < 2 || y < 2 || x > 41 || y > 33;
      const nearStreet = isStreet(x + 1, y) || isStreet(x - 1, y) || isStreet(x, y + 1) || isStreet(x, y - 1);
      const u = rand(seed, 'tree', x, y);
      if (border ? u < 0.42 : nearStreet ? u < 0.3 : u < 0.5) {
        const jx = (rand(seed, 'tx', x, y) - 0.5) * 1.6;
        const jy = (rand(seed, 'ty', x, y) - 0.5) * 1.6;
        prop(!border && !nearStreet && u < 0.12 ? 'bush' : 'tree', (x + 0.5) * CELL + jx, (y + 0.5) * CELL + jy, `t${x}_${y}`);
      }
    }
  for (const x of VX) for (const y of HY) if (x !== 22 && y !== 18) prop('lamp', x * CELL + 0.3, y * CELL + 0.3, `l${x}_${y}`);
  for (let x = 5; x < 41; x += 4) {
    if (!VX.includes(x)) {
      prop('lamp', (x + 0.5) * CELL, 17 * CELL + 0.3, `lm${x}a`);
      prop('lamp', (x + 0.5) * CELL + 6, 19 * CELL - 0.3, `lm${x}b`);
    }
  }
  for (const p of places) {
    if (p.open || p.kind === 'house') continue;
    const wx = (p.door.x + 0.5) * CELL;
    const wy = (p.door.y + 0.5) * CELL;
    const side = p.facing === 's' ? -1.6 : p.facing === 'n' ? 1.6 : 0;
    if (rand(seed, 'bike', p.id) < 0.7) prop('bike', wx + 2.4, wy + side, `bike${p.id}`);
    if (rand(seed, 'bin', p.id) < 0.4) prop('bin', wx - 2.6, wy + side, `bin${p.id}`);
  }

  return { map: { w: W, h: H, ground, places, props }, homes };
}

const r2 = (x: number): number => Math.round(x * 100) / 100;
