/**
 * canvas 与三维场景用的颜色：与 tokens.css 同一套值（canvas / three 读不到 CSS 变量）。
 * 另有一张映射表：内核给的场景颜色（建筑、人物，沿用 Endesga 32）→ 暖色低饱和版。
 * 内核的颜色是渲染提示，前端映射而不是改内核（v4 D56）：生成场景与黄金哈希不受影响。
 */
export const PAL = {
  paper: '#faf7f2',
  surface: '#ffffff',
  surface2: '#f3eee6',
  surface3: '#e9e2d7',
  line: '#e7e0d5',
  line2: '#d8cfc1',
  ink: '#26241f',
  ink2: '#5e5a52',
  ink3: '#8f897e',
  teal: '#1f5f63',
  teal2: '#2e7c80',
  tealSoft: '#e3efee',
  amber: '#e3a13a',
  amberSoft: '#fbefd8',
  ok: '#3e8e63',
  warn: '#d98a2b',
  bad: '#c2553a',
  info: '#4b7ead',
  rumor: '#a45a8a',
  plum: '#8a6a9a',
} as const;

/** 知情三态 */
export const STATE_HEX = { unaware: '#bdb6aa', heard: '#e3a13a', believe: '#1f5f63' } as const;
export type KnowState = keyof typeof STATE_HEX;

/** 渠道色 */
export const CH_HEX = { website: '#4b7ead', push: '#e3a13a', board: '#5c9e6e', talk: '#d9776a', dm: '#a45a8a', org: '#3f9aa0' } as const;

/** 时段精度色 */
export const WIN_HEX = { exact: '#3e8e63', coarse: '#e3a13a', all_day: '#c2553a', unknown: '#a8a298' } as const;

export const FONT_UI = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
export const canvasFont = (px: number, weight = 400) => `${weight} ${px}px ${FONT_UI}`;

/** Endesga 32 → 暖色低饱和 */
const SOFT: Record<string, string> = {
  '#be4a2f': '#c8775b',
  '#d77643': '#d99a6c',
  '#ead4aa': '#efe3cc',
  '#e4a672': '#e6be94',
  '#b86f50': '#b98d72',
  '#733e39': '#8a6356',
  '#3e2731': '#5b4a4f',
  '#a22633': '#b9605c',
  '#e43b44': '#d6716a',
  '#f77622': '#e59a5a',
  '#feae34': '#e8b460',
  '#fee761': '#efd98a',
  '#63c74d': '#9cc48a',
  '#3e8948': '#6f9f76',
  '#265c42': '#4f7a64',
  '#193c3e': '#3f5f60',
  '#124e89': '#557a9e',
  '#0099db': '#79a9cc',
  '#2ce8f5': '#8fcfd2',
  '#ffffff': '#fbf8f3',
  '#c0cbdc': '#cfd5dc',
  '#8b9bb4': '#a3adbb',
  '#5a6988': '#7d879b',
  '#3a4466': '#5d6478',
  '#262b44': '#474b5c',
  '#181425': '#3a3740',
  '#ff0044': '#d9667a',
  '#68386c': '#8d6a8f',
  '#b55088': '#bf7fa3',
  '#f6757a': '#e9a09d',
  '#e8b796': '#eccbb3',
  '#c28569': '#c99e86',
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;

/** 两色按比例混合（t = 0 取 a，1 取 b） */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** 内核颜色 → 暖色版；表里没有的颜色：降饱和并向纸色靠一点 */
export function soft(hex: string): string {
  const k = hex.toLowerCase();
  const hit = SOFT[k];
  if (hit) return hit;
  if (!/^#[0-9a-f]{6}$/.test(k)) return hex;
  const [r, g, b] = hexToRgb(k);
  const grey = (r + g + b) / 3;
  const desat = toHex(r + (grey - r) * 0.35, g + (grey - g) * 0.35, b + (grey - b) * 0.35);
  return mix(desat, '#f3eee6', 0.2);
}

/** 调亮 / 调暗（amt > 0 向白，< 0 向黑） */
export function tone(hex: string, amt: number): string {
  return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#1e1c19', -amt);
}
