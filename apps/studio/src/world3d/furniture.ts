import type { Furniture } from '@microcity/society';
import { Geo, hash01, pickOf, tone } from './geo.ts';

/**
 * 家具套件：每件家具由几个盒子、圆柱、球团拼成。
 * 局部坐标：+z 是家具的正面，x 是宽；尺寸来自室内模板（内核与画面共用，D68）。
 */

export const WOOD = '#B98F62';
export const WOOD_D = '#8E6A48';
export const WOOD_L = '#D9BC94';
export const CREAM = '#F4EDE0';
export const WHITE = '#FBF8F2';
export const STONE = '#CFC8BC';
export const METAL = '#9AA1A5';
export const DARK = '#3B3A3C';
const FABRIC = ['#C97B63', '#6F9C9A', '#D9A75A', '#8A9CB8', '#B58DAA', '#8FAE7C', '#D38A7A'];
const GOODS = ['#D9776A', '#E3A13A', '#5C9E6E', '#4B7EAD', '#F2D06B', '#B58DAA', '#F4EDE0', '#C2553A'];
const PRODUCE = ['#6FA65A', '#D9523F', '#E8943A', '#8DBB5E', '#F0CF5A', '#A85A8A', '#E9E2C8'];
const BOOKS = ['#B5654A', '#1F5F63', '#E3A13A', '#4B7EAD', '#8A6A9A', '#5C9E6E', '#EFE3D0'];
export const LEAVES = ['#7FA56A', '#8FB27A', '#6E985F', '#9DB87F', '#86AC72', '#A5BC7B'];
const LEAVES_WARM = ['#D7B24E', '#D99A4E'];
export const TRUNK = '#8A6A4F';

function legs(g: Geo, w: number, d: number, h: number, t: number, color: string): void {
  const x = w / 2 - t;
  const z = d / 2 - t;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.block(sx * x, 0, sz * z, t, h, t, color);
}

/** 一棵树：树干 + 三团树冠。size 是树冠直径 */
export function tree(g: Geo, x: number, y: number, z: number, size: number, key: string): void {
  const r = size / 2;
  const h = 1.6 + r * 1.3;
  const warm = hash01(key, 'warm') < 0.08;
  const c = warm ? pickOf(LEAVES_WARM, key, 'c') : pickOf(LEAVES, key, 'c');
  g.cyl(x, y, z, 0.16 + r * 0.06, h * 0.75, TRUNK, 7, 0.7);
  g.blob(x, y + h, z, r, r * 0.86, r, c, hash01(key, 'r') * 6);
  g.blob(x + r * 0.5, y + h - r * 0.25, z + r * 0.2, r * 0.66, r * 0.58, r * 0.66, tone(c, -0.03), 1);
  g.blob(x - r * 0.45, y + h + r * 0.15, z - r * 0.3, r * 0.6, r * 0.55, r * 0.6, tone(c, 0.04), 2);
}

export function bush(g: Geo, x: number, y: number, z: number, s: number, key: string): void {
  const c = pickOf(LEAVES, key, 'b');
  g.blob(x, y + 0.4 * s, z, 0.75 * s, 0.5 * s, 0.75 * s, c, hash01(key) * 6);
  g.blob(x + 0.5 * s, y + 0.3 * s, z + 0.2 * s, 0.5 * s, 0.36 * s, 0.5 * s, tone(c, 0.04), 1);
}

export function drawFurniture(g: Geo, f: Furniture, y0: number, key: string): void {
  const { w, d } = f;
  g.push(f.x, y0, f.y, f.rot);
  switch (f.kind) {
    case 'bed':
    case 'cot': {
      const blanket = pickOf(FABRIC, key, 'bl');
      g.block(0, 0.12, 0, w, 0.22, d, WOOD);
      g.block(0, 0.34, 0, w - 0.06, 0.14, d - 0.06, WHITE);
      g.block(0, 0.12, -d / 2 + 0.04, w, 0.75, 0.08, WOOD_D);
      g.block(0, 0.47, -d / 2 + 0.36, w * 0.62, 0.09, 0.34, CREAM);
      g.block(0, 0.46, d * 0.16, w - 0.02, 0.07, d * 0.6, blanket);
      break;
    }
    case 'table': {
      g.block(0, 0.7, 0, w, 0.06, d, WOOD_L);
      legs(g, w - 0.08, d - 0.08, 0.7, 0.07, WOOD);
      if (hash01(key, 'cup') < 0.6) g.cyl(w * 0.18, 0.76, -d * 0.1, 0.05, 0.09, WHITE, 8);
      if (hash01(key, 'dish') < 0.5) g.cyl(-w * 0.2, 0.76, d * 0.12, 0.11, 0.03, CREAM, 10);
      break;
    }
    case 'stonetable': {
      g.cyl(0, 0, 0, 0.22, 0.68, STONE, 10);
      g.cyl(0, 0.68, 0, w / 2 + 0.05, 0.1, tone(STONE, 0.04), 14);
      break;
    }
    case 'chair': {
      g.block(0, 0.4, 0, w, 0.05, d, WOOD);
      legs(g, w, d, 0.4, 0.045, WOOD_D);
      g.block(0, 0.45, -d / 2 + 0.025, w, 0.42, 0.05, WOOD);
      break;
    }
    case 'sofa': {
      const c = pickOf(FABRIC, key, 'sofa');
      g.block(0, 0.08, 0.04, w, 0.34, d - 0.08, c);
      g.block(0, 0.08, -d / 2 + 0.1, w, 0.74, 0.2, tone(c, -0.04));
      g.block(-w / 2 + 0.09, 0.08, 0.02, 0.18, 0.54, d - 0.04, tone(c, -0.04));
      g.block(w / 2 - 0.09, 0.08, 0.02, 0.18, 0.54, d - 0.04, tone(c, -0.04));
      g.block(-w * 0.2, 0.42, -d / 2 + 0.26, 0.4, 0.3, 0.12, tone(c, 0.12));
      break;
    }
    case 'tv': {
      g.block(0, 0, 0, w, 0.42, d, WOOD);
      g.block(0, 0.5, 0, w * 0.88, 0.56, 0.05, DARK);
      g.block(0, 0.42, 0, 0.3, 0.08, 0.14, DARK);
      break;
    }
    case 'stove': {
      g.block(0, 0, 0, w, 0.82, d, CREAM);
      g.block(0, 0.82, 0, w + 0.02, 0.05, d + 0.02, STONE);
      g.cyl(-w * 0.22, 0.87, 0, 0.15, 0.02, DARK, 10);
      g.cyl(w * 0.22, 0.87, 0, 0.15, 0.02, DARK, 10);
      g.cyl(-w * 0.22, 0.89, 0, 0.13, 0.12, METAL, 10);
      g.block(0, 1.75, -d / 2 + 0.16, w * 0.7, 0.2, 0.32, METAL);
      break;
    }
    case 'fridge': {
      g.block(0, 0, 0, w, 1.7, d, WHITE);
      g.block(0, 1.02, d / 2, w - 0.06, 0.012, 0.012, METAL);
      g.block(w / 2 - 0.08, 1.2, d / 2 + 0.01, 0.03, 0.3, 0.03, METAL);
      break;
    }
    case 'desk': {
      g.block(0, 0.7, 0, w, 0.05, d, WOOD_L);
      g.block(-w / 2 + 0.03, 0, 0, 0.05, 0.7, d - 0.04, WOOD);
      g.block(w / 2 - 0.03, 0, 0, 0.05, 0.7, d - 0.04, WOOD);
      if (hash01(key, 'mon') < 0.55) {
        g.block(0, 0.84, -d * 0.2, 0.5, 0.32, 0.04, DARK);
        g.block(0, 0.75, -d * 0.2, 0.1, 0.1, 0.08, DARK);
      } else {
        g.block(-w * 0.2, 0.75, 0, 0.26, 0.05, 0.2, pickOf(BOOKS, key, 'bk'));
        g.block(-w * 0.2, 0.8, 0, 0.24, 0.04, 0.18, pickOf(BOOKS, key, 'bk2'));
      }
      break;
    }
    case 'wardrobe': {
      g.block(0, 0, 0, w, 1.9, d, WOOD);
      g.block(0, 0.1, d / 2, 0.012, 1.7, 0.012, WOOD_D);
      break;
    }
    case 'stairs': {
      const n = 8;
      for (let i = 0; i < n; i++) g.block(0, 0, -d / 2 + (d / n) * (i + 0.5), w * 0.9, (3 / n) * (i + 1), d / n, STONE);
      break;
    }
    case 'counter': {
      g.block(0, 0, 0, w, 0.92, d, WOOD);
      g.block(0, 0.92, 0, w + 0.06, 0.05, d + 0.06, WOOD_L);
      g.block(w * 0.28, 0.97, 0, 0.32, 0.24, 0.26, DARK);
      break;
    }
    case 'shelf': {
      g.block(0, 0, 0, w, 0.12, d, WOOD_D);
      for (let lv = 0; lv < 3; lv++) {
        const y = 0.12 + lv * 0.5;
        g.block(0, y + 0.44, 0, w, 0.04, d, WOOD);
        const n = Math.max(2, Math.floor(w / 0.42));
        for (let i = 0; i < n; i++) g.block(-w / 2 + (w / n) * (i + 0.5), y, 0, (w / n) * 0.8, 0.26 + hash01(key, lv, i) * 0.14, d * 0.82, pickOf(GOODS, key, lv, i));
      }
      g.block(-w / 2 + 0.02, 0, 0, 0.04, 1.62, d, WOOD);
      g.block(w / 2 - 0.02, 0, 0, 0.04, 1.62, d, WOOD);
      break;
    }
    case 'stall': {
      g.block(0, 0, 0, w, 0.78, d, WOOD);
      g.block(0, 0.78, 0, w + 0.04, 0.04, d + 0.04, WOOD_L);
      const n = 4;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w / n) * (i + 0.5);
        const c = pickOf(PRODUCE, key, i);
        g.block(x, 0.82, 0, (w / n) * 0.86, 0.1, d * 0.8, WOOD_D);
        for (let k = 0; k < 3; k++) g.blob(x + (k - 1) * 0.14, 0.96, (hash01(key, i, k) - 0.5) * d * 0.4, 0.14, 0.1, 0.14, tone(c, (k - 1) * 0.04), k);
      }
      break;
    }
    case 'bookshelf': {
      g.block(0, 0, 0, w, 1.9, d, WOOD);
      for (let lv = 0; lv < 4; lv++) {
        const n = Math.max(3, Math.floor(w / 0.3));
        for (let i = 0; i < n; i++) g.block(-w / 2 + (w / n) * (i + 0.5), 0.14 + lv * 0.44, d / 2 - 0.02, (w / n) * 0.82, 0.3 + hash01(key, lv, i) * 0.06, 0.06, pickOf(BOOKS, key, lv, i));
      }
      break;
    }
    case 'blackboard': {
      g.block(0, 0.95, 0, w + 0.14, 1.24, d, WOOD_L);
      g.block(0, 1.02, d / 2, w, 1.1, 0.03, '#3F6457');
      break;
    }
    case 'machine': {
      g.block(0, 0, 0, w, 0.9, d, '#8FA3AB');
      g.block(-w * 0.2, 0.9, 0, w * 0.5, 0.5, d * 0.7, '#7B9099');
      g.block(w * 0.28, 0.9, 0, 0.2, 0.26, 0.2, '#E3A13A');
      g.cyl(w * 0.28, 1.16, 0, 0.07, 0.1, '#C2553A', 8);
      break;
    }
    case 'bench': {
      g.block(0, 0.4, 0, w, 0.06, d, WOOD_L);
      g.block(0, 0.5, -d / 2 + 0.03, w, 0.36, 0.05, WOOD_L);
      g.block(-w / 2 + 0.12, 0, 0, 0.07, 0.4, d, DARK);
      g.block(w / 2 - 0.12, 0, 0, 0.07, 0.4, d, DARK);
      break;
    }
    case 'tree':
      tree(g, 0, 0, 0, w, key);
      break;
    case 'pavilion': {
      const r = w / 2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.cyl(sx * (r - 0.3), 0, sz * (d / 2 - 0.3), 0.12, 2.5, '#A65B45', 8);
      g.block(0, 0, 0, w, 0.14, d, STONE);
      const top: [number, number, number] = [0, 3.9, 0];
      const e = 0.5;
      const c: Array<[number, number, number]> = [
        [-r - e, 2.5, -d / 2 - e],
        [r + e, 2.5, -d / 2 - e],
        [r + e, 2.5, d / 2 + e],
        [-r - e, 2.5, d / 2 + e],
      ];
      for (let i = 0; i < 4; i++) g.poly([c[i]!, top, c[(i + 1) % 4]!], i % 2 ? '#7E6A5C' : '#8A7566', true);
      g.ball(0, 3.95, 0, 0.16, '#E3A13A');
      break;
    }
    case 'hoop': {
      g.cyl(0, 0, -d / 2 + 0.2, 0.07, 3.0, METAL, 8);
      g.block(0, 2.95, -d / 2 + 0.55, 0.08, 0.08, 0.7, METAL);
      g.block(0, 2.7, -d / 2 + 0.9, w * 0.72, 0.85, 0.05, WHITE);
      g.block(0, 2.86, -d / 2 + 0.93, 0.5, 0.36, 0.02, '#D9523F');
      g.cyl(0, 2.72, -d / 2 + 1.15, 0.23, 0.04, '#E8743A', 12);
      break;
    }
    case 'shelter': {
      for (const sx of [-1, 1]) g.cyl(sx * (w / 2 - 0.2), 0, -d / 2 + 0.2, 0.06, 2.5, METAL, 8);
      g.block(0, 2.5, 0.05, w, 0.1, d, '#5E8A8D');
      g.block(0, 0.5, -d / 2 + 0.2, w - 0.4, 1.6, 0.04, '#DCEBEA');
      g.block(0, 0.42, -d / 2 + 0.5, w * 0.7, 0.06, 0.4, WOOD_L);
      g.block(-w * 0.3, 0, -d / 2 + 0.5, 0.06, 0.42, 0.36, DARK);
      g.block(w * 0.3, 0, -d / 2 + 0.5, 0.06, 0.42, 0.36, DARK);
      break;
    }
    case 'sign': {
      g.cyl(0, 0, 0, 0.05, 2.6, METAL, 8);
      g.block(0, 2.5, 0, 0.7, 0.7, 0.06, '#1F5F63');
      g.block(0, 2.2, 0.04, 0.5, 0.22, 0.02, WHITE);
      break;
    }
    case 'planter': {
      g.block(0, 0, 0, w, 0.45, d, STONE);
      g.block(0, 0.4, 0, w - 0.2, 0.08, d - 0.2, '#8D7B62');
      tree(g, 0, 0.4, 0, w * 1.5, key);
      bush(g, w * 0.25, 0.42, d * 0.22, 0.5, key);
      break;
    }
    case 'flagpole': {
      g.block(0, 0, 0, 1.0, 0.3, 1.0, STONE);
      g.cyl(0, 0.3, 0, 0.05, 8, WHITE, 8);
      g.block(0.62, 7.6, 0, 1.2, 0.75, 0.03, '#D2473A');
      break;
    }
    case 'plant': {
      g.cyl(0, 0, 0, 0.18, 0.34, '#B5654A', 10, 1.25);
      g.blob(0, 0.72, 0, 0.32, 0.42, 0.32, pickOf(LEAVES, key, 'pl'));
      break;
    }
  }
  g.pop();
}
