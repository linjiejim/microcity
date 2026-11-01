import * as THREE from 'three';
import type { PlaceDef } from '@microcity/sim';
import { drawIcon, type IconName } from '../ui/icons.ts';
import { canvasFont, mix, soft, tone } from '../theme/palette.ts';

/** 确定性伪随机（纹理用，不影响模拟） */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** 每个格子在墙面纹理上的像素数 */
const U = 40;

/** 墙面：楼层 × 圆角窗；南面带门。lit = 夜间窗户发光贴图（黑底、亮窗） */
export function wallTexture(p: PlaceDef, face: 'south' | 'north' | 'east' | 'west', lit: boolean): THREE.Texture {
  return cached(`wall:${p.id}:${face}:${lit ? 1 : 0}`, () => {
    const floors = Math.max(1, p.style.floors);
    const widthTiles = face === 'south' || face === 'north' ? p.rect.w : p.rect.h;
    const W = widthTiles * U;
    const H = floors * U + 12;
    const [c, g] = canvas(W, H);
    const r = prng(p.id.charCodeAt(1) * 97 + face.length * 13);
    const wall = tone(soft(p.style.wall), 0.18);
    const trim = soft(p.style.trim);
    g.fillStyle = lit ? '#000' : wall;
    g.fillRect(0, 0, W, H);
    if (!lit) {
      // 勒脚与檐口
      g.fillStyle = tone(wall, -0.12);
      g.fillRect(0, H - 7, W, 7);
      g.fillStyle = mix(trim, wall, 0.35);
      g.fillRect(0, 0, W, 5);
    }
    for (let f = 0; f < floors; f++) {
      const y = H - 7 - (f + 1) * U + 11;
      for (let x = 7; x + 20 <= W - 6; x += 26) {
        const isDoor = face === 'south' && f === 0 && Math.abs(x + 10 - (doorX(p) * U + U / 2)) < 18;
        if (isDoor) continue;
        const on = r() < 0.7;
        if (lit) {
          if (!on) continue;
          g.fillStyle = '#ffd68a';
          roundRect(g, x, y, 20, 22, 4);
          g.fill();
        } else {
          g.fillStyle = tone(trim, 0.35);
          roundRect(g, x - 2, y - 2, 24, 26, 5);
          g.fill();
          const glass = g.createLinearGradient(x, y, x + 20, y + 22);
          glass.addColorStop(0, '#a9c0cf');
          glass.addColorStop(1, '#7f9aad');
          g.fillStyle = glass;
          roundRect(g, x, y, 20, 22, 4);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.45)';
          roundRect(g, x + 3, y + 3, 5, 7, 2);
          g.fill();
        }
      }
    }
    if (face === 'south') {
      const dx = doorX(p) * U + U / 2 - 11;
      if (lit) {
        g.fillStyle = '#ffc56b';
        roundRect(g, dx + 2, H - 36, 18, 29, 6);
        g.fill();
      } else {
        g.fillStyle = tone(trim, -0.05);
        roundRect(g, dx, H - 38, 22, 31, 7);
        g.fill();
        g.fillStyle = tone(trim, -0.25);
        roundRect(g, dx + 3, H - 35, 16, 28, 5);
        g.fill();
        g.fillStyle = '#f1d9a8';
        g.beginPath();
        g.arc(dx + 15, H - 20, 1.6, 0, Math.PI * 2);
        g.fill();
      }
    }
    return tex(c);
  });
}

export const doorX = (p: PlaceDef): number => Math.max(0, Math.min(p.rect.w - 1, p.door.x - p.rect.x));

/** 招牌：圆角牌子上写一个字 */
export function signTexture(text: string, bg: string, fg: string): THREE.Texture {
  return cached(`sign:${text}:${bg}:${fg}`, () => {
    const [c, g] = canvas(64, 64);
    g.fillStyle = bg;
    roundRect(g, 2, 2, 60, 60, 14);
    g.fill();
    g.fillStyle = fg;
    g.font = canvasFont(36, 700);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 32, 34);
    return tex(c);
  });
}

/** 头顶图标：白色圆角气泡 + 线性图标 */
export function iconSprite(name: IconName, color: string, bubble = true): THREE.Texture {
  return cached(`icon:${name}:${color}:${bubble}`, () => {
    const [c, g] = canvas(64, 72);
    if (bubble) {
      g.fillStyle = 'rgba(38,36,31,0.18)';
      roundRect(g, 5, 7, 56, 52, 18);
      g.fill();
      g.fillStyle = '#ffffff';
      roundRect(g, 4, 4, 56, 52, 18);
      g.fill();
      g.beginPath();
      g.moveTo(26, 55);
      g.lineTo(32, 66);
      g.lineTo(38, 55);
      g.closePath();
      g.fill();
      drawIcon(g, name, 16, 14, color, 32, 2.2);
    } else drawIcon(g, name, 12, 16, color, 40, 2.2);
    return tex(c);
  });
}

/** 公告栏上的告示：张数 = 贴了几张 */
export function posterTexture(n: number): THREE.Texture {
  return cached(`poster:${n}`, () => {
    const [c, g] = canvas(64, 48);
    g.fillStyle = '#d9c3a4';
    g.fillRect(0, 0, 64, 48);
    for (let i = 0; i < Math.min(3, n); i++) {
      const x = 5 + i * 19;
      g.fillStyle = '#fbf8f3';
      roundRect(g, x, 5, 16, 38, 2);
      g.fill();
      g.fillStyle = '#d6716a';
      g.fillRect(x, 5, 16, 6);
      g.fillStyle = '#a3adbb';
      g.fillRect(x + 3, 16, 10, 2);
      g.fillRect(x + 3, 22, 10, 2);
      g.fillRect(x + 3, 28, 7, 2);
    }
    return tex(c);
  });
}

/** 雨棚条纹 */
export function awningTexture(color: string): THREE.Texture {
  return cached(`awning:${color}`, () => {
    const [c, g] = canvas(64, 16);
    for (let x = 0; x < 64; x += 16) {
      g.fillStyle = color;
      g.fillRect(x, 0, 8, 16);
      g.fillStyle = '#fbf8f3';
      g.fillRect(x + 8, 0, 8, 16);
    }
    const t = tex(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}

/** 调亮 / 调暗（兼容旧名） */
export function shade(hex: string, amt: number): string {
  return tone(hex, amt);
}
