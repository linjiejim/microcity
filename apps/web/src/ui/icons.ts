/**
 * 线性图标（24×24，描边 1.75，圆角端点）。每个图标是若干段 SVG 路径；以 "F:" 开头的路径用填充而不是描边。
 * UI（<Icon>）与 canvas（drawIcon：城市头顶图标、章节条）共用这一套路径，保证风格统一。
 */
const CIRCLE = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const DOT = (x: number, y: number) => `M${x} ${y}h.01`;

export const ICONS = {
  play: ['F:M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z'],
  pause: ['F:M7 5h3.2v14H7z', 'F:M13.8 5H17v14h-3.2z'],
  step: ['F:M6 5.6v12.8a.7.7 0 0 0 1.1.6l9-6.4a.7.7 0 0 0 0-1.2l-9-6.4a.7.7 0 0 0-1.1.6z', 'M19 5v14'],
  ff: ['F:M3.5 6.5v11l8-5.5z', 'F:M12.5 6.5v11l8-5.5z'],
  news: ['M5 4h11a1 1 0 0 1 1 1v14H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z', 'M17 8h2a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2', 'M8 8h6', 'M8 12h6', 'M8 16h3'],
  push: ['M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M11 18h2', `F:${CIRCLE(17.5, 5.5, 2.6)}`],
  web: [CIRCLE(12, 12, 9), 'M3 12h18', 'M12 3c2.4 2.7 3.5 5.7 3.5 9s-1.1 6.3-3.5 9c-2.4-2.7-3.5-5.7-3.5-9S9.6 5.7 12 3z'],
  board: ['M4 4h16v11H4z', 'M8 8h8', 'M8 11h5', 'M8 15v5', 'M16 15v5'],
  talk: ['M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
  dm: ['M4 6h16v12H4z', 'm4.5 7 7.5 6 7.5-6'],
  org: ['M4 20V9l8-5 8 5v11', 'M3 20h18', 'M10 20v-5h4v5', DOT(9, 11), DOT(15, 11)],
  bolt: ['M13 3 5 13.5h6L10 21l8-10.5h-6z'],
  boltOff: ['M13 3l-3 3.8', 'M16.2 10.5H18l-3.8 5', 'M10 21l1-6.5H5l2.5-3.2', 'M3 3l18 18'],
  search: [CIRCLE(11, 11, 7), 'm20 20-4-4'],
  fork: [CIRCLE(6, 5, 2), CIRCLE(18, 5, 2), CIRCLE(12, 19, 2), 'M6 7v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7', 'M12 11.5V17'],
  compare: ['M4 20h16', 'M7 16v-4', 'M12 16V6', 'M17 16V9'],
  person: [CIRCLE(12, 8, 4), 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
  place: ['M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z', CIRCLE(12, 10, 2.3)],
  clock: [CIRCLE(12, 12, 9), 'M12 7v5l3.2 2'],
  sun: [CIRCLE(12, 12, 4), 'M12 2.5v2', 'M12 19.5v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2.5 12h2', 'M19.5 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  moon: ['M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z'],
  warn: ['M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z', 'M12 9.5v4', DOT(12, 17)],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  cross: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', CIRCLE(12, 12, 3)],
  bulb: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z'],
  book: ['M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z', 'M5 18.5A1.5 1.5 0 0 0 6.5 20H19v-3'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  dice: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', DOT(4.5, 6), DOT(4.5, 12), DOT(4.5, 18)],
  roof: ['M3 11.5 12 4l9 7.5', 'M5.5 10v10h13V10'],
  home: ['M3 11.5 12 4l9 7.5', 'M5.5 10v10h13V10', 'M10 20v-5.5h4V20'],
  tag: ['M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0z', DOT(8, 8)],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  filter: ['M4 5h16l-6 7.5V19l-4-2v-4.5z'],
  coin: [CIRCLE(12, 12, 9), 'M12 6.5v11', 'M15 9.4c-.4-.9-1.5-1.4-3-1.4-1.7 0-3 .8-3 2s1.3 1.6 3 1.9 3 .8 3 2-1.3 2.1-3 2.1c-1.5 0-2.6-.5-3-1.5'],
  zzz: ['M4 9h5l-5 6h5', 'M13 5h4l-4 5h4', 'M15 15h5l-5 5h5'],
  question: [CIRCLE(12, 12, 9), 'M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.5', DOT(12, 17)],
  exclaim: [CIRCLE(12, 12, 9), 'M12 7.5v5.5', DOT(12, 16.5)],
  rumor: ['M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', DOT(8.5, 10.5), DOT(12, 10.5), DOT(15.5, 10.5)],
  down: ['m6 9 6 6 6-6'],
  right: ['m9 6 6 6-6 6'],
  refresh: ['M20 12a8 8 0 1 1-2.3-5.6L20 8.5', 'M20 4v4.5h-4.5'],
  flag: ['M5 21V4', 'M5 4.5h11.5l-2 4 2 4H5'],
  history: ['M3.5 12a8.5 8.5 0 1 0 2.8-6.3L3.5 8.5', 'M3.5 3.5v5h5', 'M12 7.5V12l3 2'],
  layers: ['m12 3 9 5-9 5-9-5z', 'm3 12.5 9 5 9-5', 'm3 16.5 9 5 9-5'],
  more: [DOT(6, 12), DOT(12, 12), DOT(18, 12)],
  map: ['M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z', 'M9 4v14', 'M15 6v14'],
  cube: ['m12 3 8 4.5v9L12 21l-8-4.5v-9z', 'm4 7.5 8 4.5 8-4.5', 'M12 12v9'],
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  sliders: ['M4 7h10', 'M18 7h2', CIRCLE(16, 7, 2), 'M4 17h4', 'M12 17h8', CIRCLE(10, 17, 2)],
  sparkle: ['M12 3.5l1.9 5.2 5.1 1.8-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.8z', 'M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

/** 路径拆成 { d, fill } */
export function iconPaths(name: IconName): Array<{ d: string; fill: boolean }> {
  return ICONS[name].map((p) => (p.startsWith('F:') ? { d: p.slice(2), fill: true } : { d: p, fill: false }));
}

const path2d = new Map<string, Path2D>();
/** 画到 canvas：以 (x, y) 为左上角，边长 size 像素 */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, color: string, size = 14, lineWidth = 1.9): void {
  const s = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of iconPaths(name)) {
    let pp = path2d.get(p.d);
    if (!pp) {
      pp = new Path2D(p.d);
      path2d.set(p.d, pp);
    }
    if (p.fill) ctx.fill(pp);
    else ctx.stroke(pp);
  }
  ctx.restore();
}
