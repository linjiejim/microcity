import * as THREE from 'three';
import { CELL, FLOOR_H, interiorOf, type Interior, type PlaceDef } from '@microcity/society';
import { Geo, hash01, mix, pickOf, tone } from './geo.ts';
import { CREAM, DARK, METAL, STONE, WHITE, WOOD, WOOD_D, WOOD_L, drawFurniture } from './furniture.ts';

/**
 * 建筑套件：外观（墙、门窗、屋顶、雨棚、阳台、招牌）与剖面用的分层零件。
 * 平时每栋楼只有一个合并好的外观网格；被跟随的人进屋时，才换成按楼层、按墙面拆开的零件，
 * 这样可以让朝向镜头的墙和上面的楼层淡出（D68、D75）。
 */

export type Side = 'n' | 's' | 'e' | 'w';
export const SIDES: Side[] = ['n', 's', 'e', 'w'];
const INSET = 0.12;
const THICK = 0.16;
const FH = FLOOR_H;
const INNER = '#F6F0E6';
const GLASS_BAKED = '#B5CCD6';
const FABRIC = ['#C97B63', '#6F9C9A', '#D9A75A', '#8A9CB8', '#F4EDE0', '#D38A7A'];
const SHOPS: PlaceDef['kind'][] = ['grocery', 'eatery', 'teahouse', 'center', 'clinic'];
const FLAT: PlaceDef['kind'][] = ['apartment', 'office'];
/** 小店：平房上再起一圈门头墙，招牌挂在上面，顶上是矮坡屋顶 */
const BAND_KINDS: PlaceDef['kind'][] = ['grocery', 'eatery', 'clinic'];
const BAND = 0.8;
const FLOOR_COLOR: Record<string, string> = {
  house: '#D8B98E',
  apartment: '#D8B98E',
  grocery: '#E7DFD2',
  eatery: '#E2CDB2',
  teahouse: '#C9A27A',
  center: '#E3D6C0',
  clinic: '#E4EAE8',
  market: '#D9D2C6',
  school: '#DCCFB8',
  office: '#D9D4CB',
  workshop: '#C8C6C0',
};

interface Frame {
  ox: number;
  oz: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  L: number;
  rot: number;
}

interface Ctx {
  place: PlaceDef;
  interior: Interior;
  /** 占地西北角的世界坐标 */
  ox: number;
  oz: number;
  Wm: number;
  Hm: number;
  top: number;
  wall: string;
  roof: string;
  trim: string;
  v: number;
}

export interface GlassDef {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  rot: number;
  unit: number;
  /** 0–1：决定这扇窗亮不亮、什么颜色 */
  rnd: number;
}

export interface SignDef {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  rot: number;
  text: string;
  bg: string;
  fg: string;
}

const ctxOf = (place: PlaceDef): Ctx => ({
  place,
  interior: interiorOf(place),
  ox: place.x * CELL,
  oz: place.y * CELL,
  Wm: place.w * CELL,
  Hm: place.h * CELL,
  top: place.floors * FH,
  // 住宅的墙带一点门窗色的色相：一条街上不至于全是同一种米色
  wall: mix(place.style.wall, tone(place.style.trim, 0.24, -0.16), place.kind === 'house' ? 0.38 : place.kind === 'apartment' ? 0.16 : SHOPS.includes(place.kind) ? 0.22 : 0.06),
  roof: place.style.roof,
  trim: place.style.trim,
  v: place.style.variant,
});

function frameOf(c: Ctx, side: Side): Frame {
  const { ox, oz, Wm, Hm } = c;
  switch (side) {
    case 's':
      return { ox: ox + INSET, oz: oz + Hm - INSET, tx: 1, tz: 0, nx: 0, nz: 1, L: Wm - 2 * INSET, rot: 0 };
    case 'n':
      return { ox: ox + Wm - INSET, oz: oz + INSET, tx: -1, tz: 0, nx: 0, nz: -1, L: Wm - 2 * INSET, rot: Math.PI };
    case 'e':
      return { ox: ox + Wm - INSET, oz: oz + Hm - INSET, tx: 0, tz: -1, nx: 1, nz: 0, L: Hm - 2 * INSET, rot: Math.PI / 2 };
    default:
      return { ox: ox + INSET, oz: oz + INSET, tx: 0, tz: 1, nx: -1, nz: 0, L: Hm - 2 * INSET, rot: -Math.PI / 2 };
  }
}

/** 门在门墙上的位置（沿墙的米数） */
function doorU(c: Ctx): number {
  const fr = frameOf(c, c.place.facing);
  if (c.place.kind === 'apartment') return fr.L / 2;
  const d = c.interior.door;
  return (c.ox + d.x - fr.ox) * fr.tx + (c.oz + d.y - fr.oz) * fr.tz;
}

interface Opening {
  kind: 'window' | 'shop' | 'door' | 'gate' | 'arch';
  u: number;
  w: number;
  h: number;
  sill: number;
}

function openings(c: Ctx, side: Side, floor: number, L: number): Opening[] {
  const k = c.place.kind;
  const front = side === c.place.facing;
  const out: Opening[] = [];
  if (front && floor === 0) {
    if (k === 'market') for (let i = 0; i < 3; i++) out.push({ kind: 'arch', u: (L * (i + 0.5)) / 3, w: 3.8, h: 2.6, sill: 0 });
    else if (k === 'workshop') out.push({ kind: 'gate', u: doorU(c), w: 3.2, h: 2.6, sill: 0 });
    else out.push({ kind: 'door', u: doorU(c), w: k === 'apartment' || k === 'school' || k === 'office' ? 1.6 : SHOPS.includes(k) ? 1.25 : 1.0, h: 2.15, sill: 0 });
  }
  let spec = { w: 1.0, h: 1.2, sill: 0.95, gap: 3.1 };
  if (SHOPS.includes(k)) spec = front && floor === 0 ? { w: 1.7, h: 1.5, sill: 0.65, gap: 2.4 } : { w: 0.9, h: 0.8, sill: 1.5, gap: 3.3 };
  else if (k === 'market') spec = { w: 1.6, h: 0.7, sill: 1.95, gap: 3.0 };
  else if (k === 'workshop') spec = { w: 2.0, h: 0.9, sill: 1.6, gap: 3.1 };
  else if (k === 'school' || k === 'office') spec = { w: 1.5, h: 1.4, sill: 0.9, gap: 2.7 };
  else if (k === 'apartment') spec = { w: 1.2, h: 1.3, sill: 0.9, gap: 2.6 };
  const n = Math.max(1, Math.round((L - 1.0) / spec.gap));
  for (let i = 0; i < n; i++) {
    const u = (L * (i + 0.5)) / n;
    if (out.some((o) => o.kind !== 'window' && o.kind !== 'shop' && Math.abs(o.u - u) < o.w / 2 + spec.w / 2 + 0.25)) continue;
    out.push({ kind: SHOPS.includes(k) && front && floor === 0 ? 'shop' : 'window', u, ...spec });
  }
  return out;
}

/** 窗属于哪个住户单元：取同层里最近的单元 */
function unitAt(c: Ctx, lx: number, lz: number, floor: number): number {
  const us = c.interior.units;
  if (us.length === 0) return -1;
  let best = -1;
  let bd = Infinity;
  for (const u of us) {
    if (u.floor !== floor && us.some((x) => x.floor === floor)) continue;
    const d = Math.abs(u.x + u.w / 2 - lx) + Math.abs(u.y + u.h / 2 - lz);
    if (d < bd) {
      bd = d;
      best = u.unit;
    }
  }
  return best;
}

/** 一面墙的一层：墙体、踢脚、窗框、门。glass 收集可发光的玻璃（外观模式）；剖面模式里玻璃直接烘进墙里 */
function wallSide(g: Geo, c: Ctx, side: Side, floor: number, cut: boolean, glass?: GlassDef[]): void {
  const fr = frameOf(c, side);
  const { L } = fr;
  const y0 = floor * FH;
  const k = c.place.kind;
  const doorColor = k === 'house' || k === 'apartment' ? tone(c.trim, -0.06, -0.1) : tone(c.trim, -0.02);
  g.push(fr.ox, 0, fr.oz, fr.rot);
  g.box(L / 2, y0 + FH / 2, -THICK / 2, L, FH, THICK, c.wall);
  if (cut) g.box(L / 2, y0 + FH / 2, -THICK - 0.012, L - 2 * THICK, FH - 0.06, 0.02, INNER);
  if (floor === 0) g.box(L / 2, 0.24, 0.02, L + 0.05, 0.48, 0.05, tone(c.wall, -0.14, -0.04));
  else g.box(L / 2, y0, 0.02, L + 0.05, 0.14, 0.06, tone(c.wall, 0.05));

  for (const o of openings(c, side, floor, L)) {
    const yc = y0 + o.sill + o.h / 2;
    if (o.kind === 'window' || o.kind === 'shop') {
      g.box(o.u, yc, 0.03, o.w + 0.18, o.h + 0.18, 0.07, CREAM);
      g.box(o.u, y0 + o.sill - 0.08, 0.08, o.w + 0.3, 0.08, 0.16, tone(c.wall, 0.08));
      if (o.kind === 'window' && o.w > 0.95) g.box(o.u, yc, 0.075, 0.05, o.h, 0.02, CREAM);
      if (cut) {
        g.box(o.u, yc, 0.06, o.w, o.h, 0.03, GLASS_BAKED);
        g.box(o.u, yc, -THICK - 0.03, o.w, o.h, 0.02, GLASS_BAKED);
      } else if (glass) {
        const lx = fr.ox + fr.tx * o.u - c.ox;
        const lz = fr.oz + fr.tz * o.u - c.oz;
        glass.push({
          x: fr.ox + fr.tx * o.u + fr.nx * 0.062,
          y: yc,
          z: fr.oz + fr.tz * o.u + fr.nz * 0.062,
          w: o.w,
          h: o.h,
          rot: fr.rot,
          unit: unitAt(c, lx, lz, floor),
          rnd: hash01(c.place.id, side, floor, Math.round(o.u * 10)),
        });
      }
      // 住家的窗台花箱
      if ((k === 'house' || k === 'apartment') && hash01(c.place.id, side, floor, o.u, 'fl') < 0.22) {
        g.box(o.u, y0 + o.sill - 0.02, 0.2, o.w * 0.8, 0.14, 0.18, '#B5654A');
        for (let i = 0; i < 3; i++) g.blob(o.u + (i - 1) * o.w * 0.25, y0 + o.sill + 0.12, 0.2, 0.14, 0.12, 0.12, pickOf(['#7FA56A', '#D9776A', '#F2D06B', '#8FB27A'], c.place.id, side, floor, i), i);
      }
    } else if (o.kind === 'door') {
      g.box(o.u, o.h / 2 + 0.02, 0.03, o.w + 0.2, o.h + 0.12, 0.07, CREAM);
      g.box(o.u, o.h / 2, 0.06, o.w, o.h, 0.05, doorColor);
      if (o.w > 1.1) g.box(o.u, o.h * 0.62, 0.09, o.w - 0.3, o.h * 0.45, 0.02, cut ? GLASS_BAKED : '#8FA9B5');
      else g.box(o.u + o.w * 0.3, 1.05, 0.1, 0.05, 0.14, 0.04, '#D8B25A');
      g.box(o.u, 0.07, 0.42, o.w + 0.7, 0.14, 0.7, STONE);
    } else if (o.kind === 'gate') {
      g.box(o.u, o.h / 2, 0.04, o.w, o.h, 0.06, '#7E8F96');
      for (let i = -1; i <= 1; i++) g.box(o.u + (i * o.w) / 3.2, o.h / 2, 0.08, 0.06, o.h, 0.03, '#6B7C83');
      g.box(o.u, o.h + 0.08, 0.04, o.w + 0.3, 0.16, 0.1, tone(c.wall, -0.1));
    } else {
      g.box(o.u, o.h / 2, 0.012, o.w, o.h, 0.03, cut ? '#C9C0B2' : '#5B544C');
      g.box(o.u, o.h + 0.1, 0.04, o.w + 0.4, 0.2, 0.1, tone(c.wall, 0.06));
      g.box(o.u - o.w / 2 - 0.12, o.h / 2, 0.04, 0.24, o.h, 0.1, tone(c.wall, 0.06));
      g.box(o.u + o.w / 2 + 0.12, o.h / 2, 0.04, 0.24, o.h, 0.1, tone(c.wall, 0.06));
    }
  }
  g.pop();
}

/** 双坡屋顶：局部坐标里屋脊沿 x；hx、hz 是含出檐的半宽 */
function gable(g: Geo, hx: number, hz: number, y: number, rise: number, color: string, wall: string, wallHz: number, wallHx: number): void {
  const t = 0.16;
  const dark = tone(color, -0.07);
  g.slab(
    [
      [-hx, y, hz],
      [hx, y, hz],
      [hx, y + rise, 0],
      [-hx, y + rise, 0],
    ],
    t,
    color,
    dark,
  );
  g.slab(
    [
      [hx, y, -hz],
      [-hx, y, -hz],
      [-hx, y + rise, 0],
      [hx, y + rise, 0],
    ],
    t,
    tone(color, -0.025),
    dark,
  );
  g.box(0, y + rise + 0.02, 0, hx * 2 + 0.1, 0.14, 0.3, dark);
  // 瓦垄：几道浅色的横线，让大面不发平
  for (const k of [0.3, 0.6]) {
    g.box(0, y + rise * (1 - k) + 0.035, hz * k, hx * 2, 0.03, 0.08, tone(color, 0.05), 0, Math.atan2(rise, hz));
    g.box(0, y + rise * (1 - k) + 0.035, -hz * k, hx * 2, 0.03, 0.08, tone(color, 0.03), 0, -Math.atan2(rise, hz));
  }
  // 山墙
  const gy = y - t;
  const gr = (rise * wallHz) / hz;
  for (const s of [-1, 1])
    g.poly(
      [
        [s * wallHx, gy, wallHz],
        [s * wallHx, gy + gr, 0],
        [s * wallHx, gy, -wallHz],
      ],
      wall,
      true,
    );
}

function hip(g: Geo, hx: number, hz: number, y: number, rise: number, color: string): void {
  const r = Math.max(0, hx - hz);
  const dark = tone(color, -0.07);
  const A: [number, number, number] = [-hx, y, hz];
  const B: [number, number, number] = [hx, y, hz];
  const C: [number, number, number] = [hx, y, -hz];
  const D: [number, number, number] = [-hx, y, -hz];
  const R1: [number, number, number] = [-r, y + rise, 0];
  const R2: [number, number, number] = [r, y + rise, 0];
  g.poly([A, B, R2, R1], color);
  g.poly([C, D, R1, R2], tone(color, -0.025));
  g.poly([B, C, R2], tone(color, -0.05));
  g.poly([D, A, R1], tone(color, 0.02));
  g.poly([D, C, B, A], dark);
  g.box(0, y + rise + 0.02, 0, r * 2 + 0.3, 0.12, 0.26, dark);
}

function flat(g: Geo, c: Ctx, cx: number, cz: number, hx: number, hz: number, ph: number): void {
  const y = c.top;
  const cap = tone(c.wall, 0.07);
  g.box(cx, y + 0.06, cz, hx * 2 - 0.1, 0.12, hz * 2 - 0.1, '#CFC4B2');
  g.box(cx, y + 0.125, cz, hx * 2 - 1.3, 0.02, hz * 2 - 1.3, '#D9CFBE');
  for (const s of [-1, 1]) {
    g.box(cx, y + ph / 2, cz + s * (hz - THICK / 2), hx * 2, ph, THICK, c.wall);
    g.box(cx + s * (hx - THICK / 2), y + ph / 2, cz, THICK, ph, hz * 2, c.wall);
    g.box(cx, y + ph + 0.04, cz + s * (hz - THICK / 2), hx * 2 + 0.1, 0.08, THICK + 0.12, cap);
    g.box(cx + s * (hx - THICK / 2), y + ph + 0.04, cz, THICK + 0.12, 0.08, hz * 2 + 0.1, cap);
  }
}

/** 屋顶以及屋顶上的东西 */
function roof(g: Geo, c: Ctx): void {
  const k = c.place.kind;
  const cx = c.ox + c.Wm / 2;
  const cz = c.oz + c.Hm / 2;
  const hx = c.Wm / 2 - INSET;
  const hz = c.Hm / 2 - INSET;
  const ns = c.place.facing === 'n' || c.place.facing === 's';
  const id = c.place.id;

  if (FLAT.includes(k)) {
    const ph = k === 'apartment' ? 0.5 : 0.62 + (c.v % 2) * 0.2;
    flat(g, c, cx, cz, hx, hz, ph);
    if (k === 'apartment') {
      g.block(cx, c.top, cz, 3.0, 2.3, 3.2, tone(c.wall, -0.03));
      g.box(cx, c.top + 2.36, cz, 3.4, 0.12, 3.6, tone(c.roof, -0.02));
      const s = hash01(id, 'tank') < 0.5 ? -1 : 1;
      const tx = cx + (ns ? s * hx * 0.55 : 0);
      const tz = cz + (ns ? 0 : s * hz * 0.55);
      g.block(tx, c.top + 0.1, tz, 1.5, 0.5, 1.5, METAL);
      g.cyl(tx, c.top + 0.6, tz, 0.8, 1.3, '#DDE4E6', 14);
      g.cyl(tx, c.top + 1.9, tz, 0.84, 0.08, '#C7D0D3', 14);
      // 太阳能热水器
      for (let i = 0; i < 3; i++) {
        const u = -s * (0.25 + i * 0.22);
        const px = cx + (ns ? u * hx : hx * 0.35);
        const pz = cz + (ns ? hz * 0.35 : u * hz);
        g.box(px, c.top + 0.7, pz, 1.3, 0.06, 1.7, '#3F5666', 0, 0.55);
        g.cyl(px, c.top + 1.1, pz - 0.75, 0.2, 0.01, WHITE, 8);
        g.rod(px - 0.6, c.top + 1.18, pz - 0.75, px + 0.6, c.top + 1.18, pz - 0.75, 0.2, '#E9EEF0', 8);
      }
    } else if (k === 'office') {
      g.cyl(cx, c.top, cz, 0.06, 4.2, WHITE, 8);
      g.box(cx + 0.7, c.top + 3.75, cz, 1.3, 0.8, 0.03, '#D2473A');
      g.block(cx - hx * 0.5, c.top, cz - hz * 0.3, 2.2, 1.2, 1.8, tone(c.wall, -0.04));
      g.box(cx - hx * 0.5, c.top + 1.26, cz - hz * 0.3, 2.5, 0.1, 2.1, tone(c.roof, -0.03));
      for (let i = 0; i < 3; i++) g.block(cx + hx * (0.2 + i * 0.25), c.top + 0.12, cz + hz * 0.5, 0.9, 0.6, 0.5, '#E3E6E4');
      g.block(cx + hx * 0.45, c.top + 0.12, cz - hz * 0.45, 2.4, 0.3, 1.6, '#B9CCD3');
    }
    return;
  }

  // 坡屋顶
  let alongDoorWall = true;
  let over = 0.45;
  let rise = 0;
  let color = c.roof;
  let hipped = false;
  let base = c.top;
  if (BAND_KINDS.includes(k)) {
    // 门头墙
    for (const s of [-1, 1]) {
      g.box(cx, c.top + BAND / 2, cz + s * (hz - THICK / 2), hx * 2, BAND, THICK, c.wall);
      g.box(cx + s * (hx - THICK / 2), c.top + BAND / 2, cz, THICK, BAND, hz * 2, c.wall);
    }
    g.box(cx, c.top + 0.02, cz, hx * 2 + 0.08, 0.1, hz * 2 + 0.08, tone(c.wall, 0.07));
    base = c.top + BAND;
    over = 0.22;
    hipped = c.v % 2 === 0;
    alongDoorWall = true;
  }
  if (k === 'house') {
    alongDoorWall = c.v !== 1;
    hipped = c.v === 3;
  } else if (k === 'school') {
    hipped = true;
    over = 0.55;
  } else if (k === 'teahouse' || k === 'center') over = 0.65;
  else if (k === 'market') {
    over = 0.8;
    color = '#C4775B';
  } else if (k === 'workshop') {
    over = 0.35;
    color = '#8FA3AB';
  }
  const axisX = ns === alongDoorWall;
  const rhx = (axisX ? hx : hz) + over;
  const rhz = (axisX ? hz : hx) + over;
  rise = k === 'house' ? rhz * 0.5 + 0.3 : k === 'workshop' ? 1.5 : k === 'market' ? 2.3 : k === 'school' ? 2.6 : BAND_KINDS.includes(k) ? 1.25 : rhz * 0.42 + 0.3;
  g.push(cx, 0, cz, axisX ? 0 : Math.PI / 2);
  if (hipped) hip(g, rhx, rhz, base, rise, color);
  else gable(g, rhx, rhz, base + 0.12, rise, color, c.wall, axisX ? hz : hx, axisX ? hx : hz);
  if (k === 'eatery') {
    g.cyl(-rhx * 0.5, base + rise * 0.3, -rhz * 0.45, 0.2, 1.3, METAL, 10);
    g.cyl(-rhx * 0.5, base + rise * 0.3 + 1.3, -rhz * 0.45, 0.27, 0.1, DARK, 10);
  }
  if (k === 'house' && c.v % 2 === 0) {
    g.block(rhx * 0.45, c.top + rise * 0.3, -rhz * 0.4, 0.55, rise * 0.75 + 0.5, 0.55, '#B98A72');
    g.block(rhx * 0.45, c.top + rise * 1.05 + 0.5, -rhz * 0.4, 0.7, 0.1, 0.7, '#8E6A5A');
  }
  if (k === 'workshop') for (let i = -1; i <= 1; i++) g.block(i * rhx * 0.5, c.top + rise, 0, 1.6, 0.5, 0.9, '#7B8F97');
  if (k === 'market') {
    // 气楼：屋脊上抬起的一条天窗
    g.block(0, c.top + rise - 0.25, 0, rhx * 1.5, 0.8, 2.2, '#EFE6D6');
    g.box(0, c.top + rise + 0.62, 0, rhx * 1.56, 0.12, 2.9, tone(color, -0.05));
  }
  g.pop();
  if (k === 'workshop') {
    g.cyl(c.ox + c.Wm - 1.6, 0, c.oz + 1.4, 0.38, c.top + 4.2, '#B98A72', 12, 0.8);
    g.cyl(c.ox + c.Wm - 1.6, c.top + 4.2, c.oz + 1.4, 0.34, 0.2, '#8E6A5A', 12);
  }
}

/** 门面上的装饰：雨棚、灯笼、阳台、空调、花盆。返回招牌的位置 */
function decorate(g: Geo, c: Ctx): SignDef | null {
  const k = c.place.kind;
  const id = c.place.id;
  const fr = frameOf(c, c.place.facing);
  const du = doorU(c);
  let sign: SignDef | null = null;
  const signAt = (u: number, y: number, out: number, w: number, h: number, bg: string, fg: string): SignDef => ({
    x: fr.ox + fr.tx * u + fr.nx * out,
    y,
    z: fr.oz + fr.tz * u + fr.nz * out,
    w,
    h,
    rot: fr.rot,
    text: c.place.name,
    bg,
    fg,
  });
  const textW = (h: number) => Math.min(fr.L - 0.5, c.place.name.length * h * 0.95 + h * 1.2);

  g.push(fr.ox, 0, fr.oz, fr.rot);
  if (k === 'house') {
    // 门廊小檐 + 花盆
    g.box(du, 2.42, 0.42, 1.9, 0.09, 1.0, c.roof, 0, 0.24);
    g.box(du - 0.85, 1.2, 0.8, 0.09, 2.4, 0.09, WOOD_D);
    g.box(du + 0.85, 1.2, 0.8, 0.09, 2.4, 0.09, WOOD_D);
    for (const s of [-1, 1])
      if (hash01(id, 'pot', s) < 0.7) {
        g.cyl(du + s * 1.25, 0, 0.45, 0.2, 0.36, '#B5654A', 10, 1.2);
        g.blob(du + s * 1.25, 0.72, 0.45, 0.34, 0.44, 0.34, pickOf(['#7FA56A', '#8FB27A', '#6E985F'], id, s));
      }
    if (c.place.floors === 2 && c.v === 2) {
      g.box(fr.L / 2, FH + 0.02, 0.55, fr.L * 0.6, 0.12, 1.1, tone(c.wall, 0.05));
      g.box(fr.L / 2, FH + 0.55, 1.07, fr.L * 0.6, 0.1, 0.06, WOOD_D);
      for (let i = 0; i <= 6; i++) g.box(fr.L * 0.2 + (fr.L * 0.6 * i) / 6, FH + 0.3, 1.07, 0.05, 0.5, 0.05, WOOD_D);
    }
  } else if (k === 'apartment') {
    g.box(du, 2.55, 0.75, 2.8, 0.14, 1.5, CREAM);
    g.box(du - 1.2, 1.25, 1.35, 0.14, 2.5, 0.14, tone(c.wall, -0.1));
    g.box(du + 1.2, 1.25, 1.35, 0.14, 2.5, 0.14, tone(c.wall, -0.1));
    // 楼梯间的竖条窗
    for (let f = 1; f < c.place.floors; f++) g.box(du, f * FH + 1.5, 0.05, 1.0, 1.6, 0.06, '#8FA9B5');
  } else if (SHOPS.includes(k)) {
    const banded = BAND_KINDS.includes(k);
    if (banded) {
      // 条纹雨棚
      const n = Math.max(4, Math.round((fr.L - 0.6) / 0.55));
      const seg = (fr.L - 0.6) / n;
      for (let i = 0; i < n; i++) g.box(0.3 + seg * (i + 0.5), 2.48, 0.56, seg, 0.07, 1.2, i % 2 ? CREAM : c.trim, 0, 0.3);
      g.box(fr.L / 2, 2.14, 1.1, fr.L - 0.6, 0.16, 0.04, CREAM);
      const h = 0.66;
      sign = signAt(fr.L / 2, c.top + 0.34, 0.1, textW(h), h, tone(c.trim, -0.04), '#FBF6EA');
    } else {
      const h = 0.62;
      sign = signAt(fr.L / 2, c.top + 0.52, 0.72, textW(h), h, '#5A3F33', '#F5D9A0');
      g.box(fr.L / 2, c.top + 0.16, 0.7, textW(h) + 0.2, 0.1, 0.14, WOOD_D);
    }
    if (k === 'eatery' || k === 'teahouse')
      for (const s of [-1, 1]) {
        g.rod(du + s * 0.95, 2.6, 0.34, du + s * 0.95, 2.25, 0.34, 0.015, DARK);
        g.cyl(du + s * 0.95, 1.9, 0.34, 0.17, 0.36, '#D2473A', 10);
        g.cyl(du + s * 0.95, 1.86, 0.34, 0.06, 0.04, '#E3A13A', 8);
        g.cyl(du + s * 0.95, 2.26, 0.34, 0.06, 0.04, '#E3A13A', 8);
      }
    if (k === 'grocery') {
      // 门口的货筐
      for (let i = 0; i < 3; i++) g.block(du + 1.5 + i * 0.75, 0, 0.5, 0.62, 0.42, 0.5, pickOf(['#D9776A', '#5C9E6E', '#E3A13A', '#4B7EAD'], id, i));
    }
  } else if (k === 'market') {
    const n = Math.round(fr.L / 0.7);
    const seg = fr.L / n;
    for (let i = 0; i < n; i++) g.box(seg * (i + 0.5), 2.86, 0.7, seg, 0.07, 1.5, i % 2 ? CREAM : '#C4775B', 0, 0.2);
    const h = 0.8;
    sign = signAt(fr.L / 2, c.top + 0.72, 0.86, textW(h), h, '#1F5F63', '#FBF6EA');
    g.box(fr.L / 2, c.top + 0.26, 0.84, textW(h) + 0.3, 0.12, 0.16, WOOD_D);
    for (let i = 0; i < 4; i++) g.block(1.0 + i * 0.8, 0, 0.6, 0.66, 0.4, 0.5, pickOf(['#B98F62', '#8FAE7C', '#D9A75A'], id, i));
  } else if (k === 'school' || k === 'office') {
    g.box(du, 2.7, 0.9, 4.2, 0.18, 1.8, CREAM);
    for (const s of [-1, 1]) g.cyl(du + s * 1.8, 0, 1.6, 0.14, 2.7, CREAM, 10);
    g.box(fr.L / 2, c.top - 0.5, 0.03, fr.L, 0.22, 0.05, c.trim);
    const h = 0.72;
    if (k === 'school') {
      sign = signAt(du, 3.25, 1.82, textW(h), h, '#FBF6EA', '#1F5F63');
      g.cyl(du + 4.2, 0, 2.2, 0.07, 7.5, WHITE, 8);
      g.box(du + 4.95, 6.95, 2.2, 1.4, 0.9, 0.03, '#D2473A');
      g.block(du + 4.2, 0, 2.2, 0.9, 0.3, 0.9, STONE);
    } else sign = signAt(fr.L / 2, c.top + 0.32, 0.1, textW(h), h, '#FBF6EA', '#B5382E');
  } else if (k === 'workshop') {
    const h = 0.7;
    sign = signAt(fr.L / 2, c.top + 0.62, 0.42, textW(h), h, '#4E6470', '#FBF6EA');
    g.box(fr.L / 2, c.top + 0.2, 0.4, textW(h) + 0.3, 0.12, 0.14, '#5E6F77');
    for (let i = 0; i < 3; i++) g.block(1.2 + i * 1.1, 0, 0.8, 0.9, 0.7 + (i % 2) * 0.5, 0.9, pickOf([WOOD, WOOD_L, '#8FA3AB'], id, i), hash01(id, i) * 0.4);
  }
  g.pop();

  if (k === 'apartment') {
    // 背面的阳台与晾衣；侧墙的空调外机
    const back: Side = c.place.facing === 'n' ? 's' : c.place.facing === 's' ? 'n' : c.place.facing === 'e' ? 'w' : 'e';
    const fb = frameOf(c, back);
    g.push(fb.ox, 0, fb.oz, fb.rot);
    for (let f = 1; f < c.place.floors; f++)
      for (const q of [0.25, 0.75]) {
        const u = fb.L * q;
        const y = f * FH;
        g.box(u, y + 0.02, 0.5, 2.8, 0.12, 1.0, tone(c.wall, 0.04));
        g.box(u, y + 0.5, 0.98, 2.8, 0.9, 0.06, tone(c.wall, 0.07));
        g.box(u - 1.38, y + 0.5, 0.5, 0.06, 0.9, 1.0, tone(c.wall, 0.07));
        g.box(u + 1.38, y + 0.5, 0.5, 0.06, 0.9, 1.0, tone(c.wall, 0.07));
        if (hash01(id, 'dry', f, q) < 0.65) {
          g.rod(u - 1.3, y + 2.25, 1.15, u + 1.3, y + 2.25, 1.15, 0.02, METAL);
          const n = 2 + Math.floor(hash01(id, 'dn', f, q) * 3);
          for (let i = 0; i < n; i++) g.box(u - 1.0 + i * 0.6, y + 1.9, 1.15, 0.42, 0.62, 0.03, pickOf(FABRIC, id, f, q, i));
        }
        if (hash01(id, 'bp', f, q) < 0.5) g.blob(u + 0.9, y + 1.1, 0.75, 0.3, 0.3, 0.26, '#7FA56A');
      }
    g.pop();
    for (const s of ['e', 'w', 'n', 's'] as Side[]) {
      if (s === back) continue;
      const fs = frameOf(c, s);
      g.push(fs.ox, 0, fs.oz, fs.rot);
      for (let f = 0; f < c.place.floors; f++) for (const q of [0.3, 0.8]) if (hash01(id, 'ac', s, f, q) < 0.4) g.box(fs.L * q, f * FH + 0.55, 0.2, 0.8, 0.5, 0.34, '#E6E9E7');
      g.pop();
    }
  }
  return sign;
}

/** 整栋楼的外观（合并成一个几何体） */
export function buildExterior(place: PlaceDef): { geometry: THREE.BufferGeometry; glass: GlassDef[]; sign: SignDef | null; height: number } {
  const c = ctxOf(place);
  const g = new Geo();
  const glass: GlassDef[] = [];
  for (let f = 0; f < place.floors; f++) for (const s of SIDES) wallSide(g, c, s, f, false, glass);
  roof(g, c);
  const sign = decorate(g, c);
  return { geometry: g.build(), glass, sign, height: c.top + 2 };
}

export interface CutPart {
  mesh: THREE.Mesh;
  kind: 'wall' | 'slab' | 'inner' | 'roof';
  floor: number;
  side?: Side;
  /** 当前与目标不透明度 */
  alpha: number;
  target: number;
}

/** 剖面用的零件：每层四面墙、楼板、家具，外加屋顶 */
export function buildCutParts(place: PlaceDef, material: THREE.Material): CutPart[] {
  const c = ctxOf(place);
  const parts: CutPart[] = [];
  const add = (g: Geo, kind: CutPart['kind'], floor: number, side?: Side) => {
    if (g.empty) return;
    const mesh = new THREE.Mesh(g.build(), material.clone());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parts.push({ mesh, kind, floor, side, alpha: 1, target: 1 });
  };
  const floorColor = FLOOR_COLOR[place.kind] ?? '#D8CDB8';
  for (let f = 0; f < place.floors; f++) {
    for (const s of SIDES) {
      const g = new Geo();
      wallSide(g, c, s, f, true);
      add(g, 'wall', f, s);
    }
    const slab = new Geo();
    const y = f * FH;
    slab.box(c.ox + c.Wm / 2, y - 0.04, c.oz + c.Hm / 2, c.Wm - 2 * INSET - 0.02, 0.12, c.Hm - 2 * INSET - 0.02, floorColor);
    // 地板拼缝：几道深一点的细线
    const n = Math.round((c.Wm - 1) / 1.2);
    for (let i = 1; i < n; i++) slab.box(c.ox + INSET + ((c.Wm - 2 * INSET) * i) / n, y + 0.022, c.oz + c.Hm / 2, 0.02, 0.004, c.Hm - 2 * INSET - 2 * THICK, tone(floorColor, -0.05));
    add(slab, 'slab', f);

    const inner = new Geo();
    for (const w of c.interior.walls) {
      if (w.floor !== f) continue;
      const dx = w.x2 - w.x1;
      const dz = w.y2 - w.y1;
      const len = Math.hypot(dx, dz);
      inner.box(c.ox + (w.x1 + w.x2) / 2, y + 0.7, c.oz + (w.y1 + w.y2) / 2, len, 1.4, 0.1, INNER, Math.atan2(-dz, dx));
      inner.box(c.ox + (w.x1 + w.x2) / 2, y + 1.42, c.oz + (w.y1 + w.y2) / 2, len + 0.02, 0.05, 0.14, tone(c.wall, -0.06), Math.atan2(-dz, dx));
    }
    c.interior.furniture.forEach((fu, i) => {
      if (fu.floor !== f) return;
      drawFurniture(inner, { ...fu, x: c.ox + fu.x, y: c.oz + fu.y }, y + 0.02, `${place.id}:${i}`);
      // 住家：沙发前铺一块地毯，餐桌下垫一块席子（只是陈设，不占站位）
      if (fu.unit >= 0 && fu.kind === 'sofa') {
        const rug = pickOf(['#C9A27A', '#9DB5A6', '#C99A8A', '#B7A9C4', '#D8C08A'], place.id, i, 'rug');
        inner.push(c.ox + fu.x, y + 0.025, c.oz + fu.y, fu.rot);
        inner.box(0, 0.006, 1.25, 2.3, 0.012, 1.5, rug);
        inner.box(0, 0.008, 1.25, 1.9, 0.012, 1.1, tone(rug, 0.07));
        inner.pop();
      } else if (fu.unit >= 0 && fu.kind === 'table') {
        inner.push(c.ox + fu.x, y + 0.025, c.oz + fu.y, fu.rot);
        inner.box(0, 0.005, 0, fu.w + 1.5, 0.01, fu.d + 1.5, '#E3D2B4');
        inner.pop();
      } else if (fu.unit >= 0 && fu.kind === 'wardrobe') {
        inner.push(c.ox + fu.x, y + 0.025, c.oz + fu.y, fu.rot);
        inner.cyl(0.95, 0, 0.1, 0.17, 0.3, '#B5654A', 10, 1.2);
        inner.blob(0.95, 0.62, 0.1, 0.3, 0.4, 0.3, '#7FA56A');
        inner.pop();
      }
    });
    add(inner, 'inner', f);
  }
  const r = new Geo();
  roof(r, c);
  decorate(r, c);
  add(r, 'roof', place.floors);
  return parts;
}

/** 开放空间里的家具（长椅、树、亭子、篮筐……） */
export function drawOpenPlace(g: Geo, place: PlaceDef): void {
  const it = interiorOf(place);
  const ox = place.x * CELL;
  const oz = place.y * CELL;
  const pavilions = it.furniture.filter((f) => f.kind === 'pavilion');
  it.furniture.forEach((fu, i) => {
    // 树不长到亭子里去（只是不画，站位不受影响）
    if (fu.kind === 'tree' && pavilions.some((p) => Math.hypot(p.x - fu.x, p.y - fu.y) < p.w / 2 + fu.w / 2 + 0.6)) return;
    drawFurniture(g, { ...fu, x: ox + fu.x, y: oz + fu.y }, 0.02, `${place.id}:${i}`);
  });
}

/** 招牌：把店名画到画布上做贴图（程序生成，不用外部资产） */
export function makeSign(def: SignDef): THREE.Mesh {
  const px = 96;
  const cv = document.createElement('canvas');
  cv.height = px;
  cv.width = Math.max(64, Math.round((def.w / def.h) * px));
  const g = cv.getContext('2d')!;
  g.fillStyle = def.bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = def.fg;
  g.globalAlpha = 0.55;
  g.lineWidth = 3;
  g.strokeRect(5, 5, cv.width - 10, cv.height - 10);
  g.globalAlpha = 1;
  g.fillStyle = def.fg;
  g.font = `700 ${Math.round(px * 0.56)}px 'Songti SC', 'Noto Serif SC', 'STSong', 'PingFang SC', 'Microsoft YaHei', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const m = g.measureText(def.text);
  const sx = Math.min(1, (cv.width - 26) / m.width);
  g.save();
  g.translate(cv.width / 2, cv.height / 2 + 3);
  g.scale(sx, 1);
  g.fillText(def.text, 0, 0);
  g.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.w, def.h), mat);
  mesh.position.set(def.x, def.y, def.z);
  mesh.rotation.y = def.rot;
  return mesh;
}
