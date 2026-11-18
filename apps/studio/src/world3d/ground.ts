import * as THREE from 'three';
import { CELL, G_GREEN, G_LOT, G_PLAZA, G_STREET, type MapDef } from '@microcity/society';
import { withWetness } from './detail.ts';
import { Geo, hash01, pickOf, tone } from './geo.ts';
import { DARK, LEAVES, WOOD_D, bush, tree } from './furniture.ts';

/**
 * 地面与陈设。
 * 地面是一张程序画出来的贴图（石板路、草地、广场铺地、球场线），贴在一个平面上；
 * 树、路灯、灌木、自行车、垃圾桶、菜地合并成一个静态网格。
 */

const PX = 32;
/** 贴图的放大倍数：一格 4 米画成 PX × SCALE 个像素，近看路沿与石缝才清楚 */
const SCALE = 2;
const GRASS = '#B4CB8C';
const GRASS_2 = '#A9C283';
const STREET = '#D6CDBE';
const STREET_MAIN = '#CBC2B4';
const CURB = '#E9E2D4';
const PLAZA = '#E6D3B4';
const APRON = '#DDD0B6';
const PARK = '#A6C283';
const PATH = '#E3D5B6';
const COURT = '#C9805F';
const COURT_IN = '#6F9F8B';

/** 画布上的伪随机：只影响纹理的斑点 */
function speckle(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colors: string[], n: number, key: string, size = 2.2): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length]!;
    g.globalAlpha = 0.25 + hash01(key, i, 'a') * 0.3;
    const s = size * (0.6 + hash01(key, i, 's'));
    g.beginPath();
    g.arc(x + hash01(key, i, 'x') * w, y + hash01(key, i, 'y') * h, s, 0, 6.3);
    g.fill();
  }
  g.globalAlpha = 1;
}

export function buildGroundTexture(map: MapDef): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = map.w * PX * SCALE;
  cv.height = map.h * PX * SCALE;
  const g = cv.getContext('2d')!;
  g.scale(SCALE, SCALE);
  const LW = map.w * PX;
  const LH = map.h * PX;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= map.w || y >= map.h ? G_LOT : map.ground[y * map.w + x]!);
  const main = (y: number) => y === 17 || y === 18;

  g.fillStyle = GRASS;
  g.fillRect(0, 0, LW, LH);
  speckle(g, 0, 0, LW, LH, [GRASS_2, '#C0D49A', '#A3BD7E'], 5200, 'grass', 5);
  speckle(g, 0, 0, LW, LH, ['#9DB877', '#C6D9A2'], 9000, 'grass2', 1.4);

  // 建筑脚下的铺地
  for (const p of map.places) {
    if (p.open) continue;
    g.fillStyle = APRON;
    g.beginPath();
    g.roundRect(p.x * PX - 5, p.y * PX - 5, p.w * PX + 10, p.h * PX + 10, 9);
    g.fill();
  }

  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const k = at(x, y);
      const px = x * PX;
      const py = y * PX;
      if (k === G_STREET) {
        g.fillStyle = main(y) ? STREET_MAIN : STREET;
        g.fillRect(px, py, PX, PX);
      } else if (k === G_PLAZA) {
        g.fillStyle = PLAZA;
        g.fillRect(px, py, PX, PX);
      } else if (k === G_GREEN) {
        g.fillStyle = PARK;
        g.fillRect(px, py, PX, PX);
      }
    }

  // 石板缝与铺地格
  g.lineWidth = 1;
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const k = at(x, y);
      const px = x * PX;
      const py = y * PX;
      if (k === G_STREET) {
        g.strokeStyle = 'rgba(120,105,85,0.10)';
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.moveTo(px, py + i * 8 + 0.5);
          g.lineTo(px + PX, py + i * 8 + 0.5);
          g.stroke();
          const off = i % 2 ? 8 : 0;
          for (let j = off; j < PX; j += 16) {
            g.beginPath();
            g.moveTo(px + j + 0.5, py + i * 8);
            g.lineTo(px + j + 0.5, py + i * 8 + 8);
            g.stroke();
          }
        }
        speckle(g, px, py, PX, PX, ['#C9BFAE', '#DED6C8'], 3, `st${x}_${y}`, 2.5);
      } else if (k === G_PLAZA) {
        g.strokeStyle = 'rgba(150,120,80,0.16)';
        for (let i = 0; i <= 2; i++) {
          g.beginPath();
          g.moveTo(px, py + i * 16 + 0.5);
          g.lineTo(px + PX, py + i * 16 + 0.5);
          g.moveTo(px + i * 16 + 0.5, py);
          g.lineTo(px + i * 16 + 0.5, py + PX);
          g.stroke();
        }
        if ((x + y) % 2 === 0) {
          g.fillStyle = 'rgba(255,255,255,0.10)';
          g.fillRect(px, py, PX, PX);
        }
      } else if (k === G_GREEN) speckle(g, px, py, PX, PX, ['#9DBA7A', '#B2CC8E'], 4, `gr${x}_${y}`, 3.5);
    }

  // 路缘：街道与地块相接处的一条浅色石边
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      if (at(x, y) !== G_STREET) continue;
      const px = x * PX;
      const py = y * PX;
      const edge = (dx: number, dy: number) => {
        const k = at(x + dx, y + dy);
        return k !== G_STREET && k !== G_PLAZA;
      };
      g.fillStyle = CURB;
      const e = 4;
      if (edge(0, -1)) g.fillRect(px, py, PX, e);
      if (edge(0, 1)) g.fillRect(px, py + PX - e, PX, e);
      if (edge(-1, 0)) g.fillRect(px, py, e, PX);
      if (edge(1, 0)) g.fillRect(px + PX - e, py, e, PX);
      g.fillStyle = 'rgba(110,95,75,0.22)';
      if (edge(0, -1)) g.fillRect(px, py + e, PX, 1);
      if (edge(0, 1)) g.fillRect(px, py + PX - e - 1, PX, 1);
      if (edge(-1, 0)) g.fillRect(px + e, py, 1, PX);
      if (edge(1, 0)) g.fillRect(px + PX - e - 1, py, 1, PX);
    }

  // 主街：中线与斑马线
  g.fillStyle = 'rgba(255,252,244,0.75)';
  for (let x = 0; x < map.w; x++) {
    if (at(x, 17) !== G_STREET) continue;
    const cross = at(x, 16) === G_STREET || at(x, 19) === G_STREET;
    if (!cross) g.fillRect(x * PX + 6, 18 * PX - 1, PX - 14, 2);
  }
  for (let x = 1; x < map.w - 1; x++) {
    const vertical = at(x, 16) === G_STREET && at(x, 15) === G_STREET;
    if (!vertical) continue;
    for (const [sx, ok] of [
      [x - 1, at(x - 1, 16) !== G_STREET],
      [x + 1, at(x + 1, 16) !== G_STREET],
    ] as const) {
      if (!ok) continue;
      const px = sx === x - 1 ? x * PX - 14 : (x + 1) * PX + 4;
      for (let i = 0; i < 8; i++) g.fillRect(px, 17 * PX + 4 + i * 7.5, 10, 4);
    }
  }

  // 公园的环形小路、球场的线
  for (const p of map.places) {
    const px = p.x * PX;
    const py = p.y * PX;
    const w = p.w * PX;
    const h = p.h * PX;
    if (p.kind === 'park') {
      const ns = p.facing === 'n' || p.facing === 's';
      const W = ns ? w : h;
      const D = ns ? h : w;
      g.strokeStyle = PATH;
      g.lineWidth = 13;
      g.beginPath();
      g.ellipse(px + w / 2, py + h / 2, (ns ? 0.4 * W : 0.38 * D), (ns ? 0.38 * D : 0.4 * W), 0, 0, 6.3);
      g.stroke();
      g.beginPath();
      g.moveTo((p.door.x + 0.5) * PX, (p.door.y + 0.5) * PX);
      g.lineTo(px + w / 2, (p.door.y + 0.5) * PX);
      g.moveTo(px + w / 2, py + h * 0.12);
      g.lineTo(px + w / 2, py + h * 0.88);
      g.stroke();
      g.strokeStyle = 'rgba(150,125,85,0.25)';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(px + w / 2, py + h / 2, (ns ? 0.4 * W : 0.38 * D) + 7, (ns ? 0.38 * D : 0.4 * W) + 7, 0, 0, 6.3);
      g.stroke();
    } else if (p.kind === 'court') {
      g.fillStyle = COURT;
      g.beginPath();
      g.roundRect(px + 6, py + 6, w - 12, h - 12, 6);
      g.fill();
      g.fillStyle = COURT_IN;
      g.fillRect(px + 16, py + 22, w - 32, h - 36);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 2;
      g.strokeRect(px + 16, py + 22, w - 32, h - 36);
      g.beginPath();
      g.moveTo(px + w / 2, py + 22);
      g.lineTo(px + w / 2, py + h - 14);
      g.stroke();
      g.beginPath();
      g.arc(px + w / 2, py + h / 2 + 4, 12, 0, 6.3);
      g.stroke();
      for (const s of [0, 1]) {
        g.beginPath();
        g.arc(s ? px + w - 16 : px + 16, py + h / 2 + 4, 22, s ? Math.PI / 2 : -Math.PI / 2, s ? (3 * Math.PI) / 2 : Math.PI / 2);
        g.stroke();
      }
    } else if (p.kind === 'square') {
      g.strokeStyle = 'rgba(160,120,70,0.35)';
      g.lineWidth = 3;
      g.strokeRect(px + 10, py + 10, w - 20, h - 20);
      g.fillStyle = 'rgba(190,120,80,0.16)';
      g.beginPath();
      g.arc(px + w / 2, py + h * 0.45, w * 0.26, 0, 6.3);
      g.fill();
      g.strokeStyle = 'rgba(160,120,70,0.3)';
      g.lineWidth = 2;
      g.stroke();
    } else if (p.kind === 'busstop') {
      g.fillStyle = 'rgba(240,200,90,0.5)';
      g.fillRect(px, py + h - 5, w, 3);
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function buildGround(map: MapDef): THREE.Group {
  const group = new THREE.Group();
  const W = map.w * CELL;
  const H = map.h * CELL;
  const tex = buildGroundTexture(map);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), withWetness(new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 })));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(W / 2, 0, H / 2);
  plane.receiveShadow = true;
  group.add(plane);
  // 地图外的一大片草地，被雾慢慢吃掉
  const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: GRASS, roughness: 1 }));
  far.rotation.x = -Math.PI / 2;
  far.position.set(W / 2, -0.05, H / 2);
  far.receiveShadow = true;
  group.add(far);
  // 主街通往城里的两段路
  const roadMat = withWetness(new THREE.MeshStandardMaterial({ color: STREET_MAIN, roughness: 1 }));
  for (const s of [-1, 1]) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(600, 2 * CELL), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(s < 0 ? -300 : W + 300, -0.02, 18 * CELL);
    road.receiveShadow = true;
    group.add(road);
  }
  return group;
}

export interface LampDef {
  x: number;
  y: number;
  z: number;
}

/** 树、路灯、灌木、自行车、垃圾桶、菜地 */
export function buildProps(g: Geo, map: MapDef): LampDef[] {
  const lamps: LampDef[] = [];
  map.props.forEach((p, i) => {
    const key = `prop${i}`;
    switch (p.kind) {
      case 'tree':
        tree(g, p.x, 0, p.y, 2.6 * p.s + 0.6, key);
        break;
      case 'bush':
        bush(g, p.x, 0, p.y, p.s, key);
        break;
      case 'lamp': {
        g.cyl(p.x, 0, p.y, 0.09, 0.3, DARK, 8, 0.7);
        g.cyl(p.x, 0.3, p.y, 0.045, 3.3, DARK, 6);
        g.box(p.x, 3.62, p.y, 0.34, 0.06, 0.34, DARK);
        g.box(p.x, 3.98, p.y, 0.4, 0.06, 0.4, DARK);
        lamps.push({ x: p.x, y: 3.8, z: p.y });
        break;
      }
      case 'bike': {
        g.push(p.x, 0, p.y, p.r);
        const c = pickOf(['#4B7EAD', '#C2553A', '#5C9E6E', '#E3A13A', '#6B6B6B'], key);
        for (const z of [-0.5, 0.5]) {
          g.push(0, 0.32, z, 0);
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            const b = ((k + 1) / 8) * Math.PI * 2;
            g.rod(0, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0, Math.cos(b) * 0.3, Math.sin(b) * 0.3, 0.025, DARK, 4);
          }
          g.pop();
        }
        g.rod(0, 0.32, -0.5, 0, 0.7, -0.1, 0.03, c);
        g.rod(0, 0.7, -0.1, 0, 0.75, 0.38, 0.03, c);
        g.rod(0, 0.32, 0.5, 0, 0.95, 0.36, 0.03, c);
        g.box(0, 0.95, 0.36, 0.5, 0.04, 0.04, DARK);
        g.box(0, 0.78, -0.16, 0.14, 0.05, 0.26, DARK);
        g.pop();
        break;
      }
      case 'bin': {
        g.cyl(p.x, 0, p.y, 0.26, 0.75, '#6F8F7E', 10, 1.12);
        g.cyl(p.x, 0.75, p.y, 0.3, 0.06, tone('#6F8F7E', -0.08), 10);
        break;
      }
      case 'plot': {
        // 一小块菜地：垄 + 几团菜
        g.box(p.x, 0.05, p.y, 3.2, 0.1, 3.2, '#A98C68');
        for (let r = 0; r < 3; r++) {
          g.box(p.x, 0.13, p.y - 1.0 + r * 1.0, 2.9, 0.1, 0.5, '#8F7352');
          for (let k = 0; k < 4; k++) if (hash01(key, r, k) < 0.85) g.blob(p.x - 1.1 + k * 0.75, 0.3, p.y - 1.0 + r * 1.0, 0.24, 0.2, 0.24, pickOf(LEAVES, key, r, k), k);
        }
        g.cyl(p.x + 1.5, 0, p.y + 1.5, 0.04, 0.8, WOOD_D, 5);
        g.cyl(p.x - 1.5, 0, p.y + 1.5, 0.04, 0.8, WOOD_D, 5);
        break;
      }
    }
  });
  // 电线杆与电线：沿两条次街各立一排，杆间的线微微下垂
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= map.w || y >= map.h ? G_LOT : map.ground[y * map.w + x]!);
  for (const row of [10, 26]) {
    if (row >= map.h) continue;
    const xs: number[] = [];
    for (let x = 3; x < map.w - 2; x += 3) if (at(x, row) === G_STREET && at(x, row - 1) !== G_STREET) xs.push(x);
    const z = row * CELL + 0.28;
    xs.forEach((x, i) => {
      const px = (x + 0.5) * CELL;
      g.cyl(px, 0, z, 0.09, 6.4, '#8A7460', 6, 0.75);
      g.box(px, 6.0, z, 0.08, 0.08, 1.5, '#7A6654');
      g.box(px, 5.55, z, 0.07, 0.07, 1.0, '#7A6654');
      if (hash01('pole', row, i) < 0.4) g.block(px, 4.3, z + 0.16, 0.4, 0.55, 0.3, '#9AA1A5');
      const next = xs[i + 1];
      if (next === undefined || next - x > 6) return;
      const nx = (next + 0.5) * CELL;
      for (const [dz, y0] of [
        [-0.65, 6.02],
        [0.65, 6.02],
        [0, 5.57],
      ] as const) {
        const seg = 5;
        for (let k = 0; k < seg; k++) {
          const a = k / seg;
          const b = (k + 1) / seg;
          const sag = (u: number) => -0.55 * 4 * u * (1 - u);
          g.rod(px + (nx - px) * a, y0 + sag(a), z + dz, px + (nx - px) * b, y0 + sag(b), z + dz, 0.012, '#3B3A3C', 3);
        }
      }
    });
  }

  // 地图外围再撒一圈远树，给画面收边
  const W = map.w * CELL;
  const H = map.h * CELL;
  for (let i = 0; i < 150; i++) {
    const a = hash01('far', i, 'a') * Math.PI * 2;
    const r = 1.02 + hash01('far', i, 'r') * 0.55;
    const x = W / 2 + Math.cos(a) * W * 0.62 * r;
    const z = H / 2 + Math.sin(a) * H * 0.72 * r;
    if (x > -4 && x < W + 4 && z > -4 && z < H + 4) continue;
    if (Math.abs(z - 18 * CELL) < 8) continue;
    tree(g, x, 0, z, 3.2 + hash01('far', i, 's') * 3, `far${i}`);
  }
  return lamps;
}
