import { useEffect, useRef, useState } from 'react';
import { DAY, dayOf, dayStart, formatTime, weekday, type SeriesPoint } from '@microcity/sim';
import { PAL, canvasFont } from '../theme/palette.ts';

const FONT = canvasFont(12);

export interface Layer {
  key: string;
  label: string;
  color: string;
  get: (p: SeriesPoint) => number;
}

function useWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

interface Frame {
  g: CanvasRenderingContext2D;
  W: number;
  H: number;
  X: (t: number) => number;
  t0: number;
  t1: number;
  L: number;
  top: number;
  bottom: number;
}

function frame(c: HTMLCanvasElement, W: number, H: number, t0: number, t1: number): Frame {
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  c.width = W * dpr;
  c.height = H * dpr;
  c.style.width = `${W}px`;
  c.style.height = `${H}px`;
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.font = FONT;
  g.textBaseline = 'top';
  const L = 34;
  const R = 8;
  const top = 8;
  const bottom = H - 20;
  const X = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  g.clearRect(0, 0, W, H);
  for (let d = dayOf(t0); d <= dayOf(t1); d++) {
    const x = X(Math.max(t0, dayStart(d)));
    g.fillStyle = PAL.line;
    g.fillRect(Math.round(x), top, 1, bottom - top);
    g.fillStyle = PAL.ink3;
    if (t1 - t0 < 9 * DAY) g.fillText(`D${String(d).padStart(2, '0')} ${weekday(d)}`, x + 4, bottom + 5);
  }
  return { g, W, H, X, t0, t1, L, top, bottom };
}

function cursor(f: Frame, t: number, base: number | null): void {
  const { g, X, top, bottom } = f;
  if (base !== null && base >= f.t0) {
    const bx = X(base);
    g.strokeStyle = PAL.ink3;
    g.lineWidth = 1.2;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(bx, top);
    g.lineTo(bx, bottom);
    g.stroke();
    g.setLineDash([]);
  }
  const x = X(t);
  g.fillStyle = PAL.teal;
  g.fillRect(x - 1, top, 2, bottom - top);
}

function pickTime(e: React.MouseEvent, el: HTMLElement, pts: SeriesPoint[], W: number): number | undefined {
  if (!pts.length) return undefined;
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left;
  const t0 = pts[0]!.t;
  const t1 = pts[pts.length - 1]!.t;
  const L = 34;
  return Math.round(t0 + ((x - L) / Math.max(1, W - L - 8)) * (t1 - t0));
}

/** 堆叠面积：每一层是一类人的数量，纵轴是总人数 */
export function StackChart({ points, layers, total, t, base, height = 160, onPick, testId }: { points: SeriesPoint[]; layers: Layer[]; total: number; t: number; base: number | null; height?: number; onPick?: (t: number) => void; testId?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const W = useWidth(wrap);
  const [hover, setHover] = useState<{ x: number; p: SeriesPoint } | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !W || points.length < 2) return;
    const f = frame(c, W, height, points[0]!.t, points[points.length - 1]!.t);
    const { g, X, top, bottom } = f;
    const Y = (v: number) => bottom - (v / Math.max(1, total)) * (bottom - top);
    // 每一层画成一块面积：上沿是累计到本层，下沿是累计到上一层
    const acc = points.map(() => 0);
    for (const l of layers) {
      const lo = acc.slice();
      points.forEach((p, i) => (acc[i]! += Math.max(0, l.get(p))));
      g.beginPath();
      points.forEach((p, i) => (i === 0 ? g.moveTo(X(p.t), Y(acc[i]!)) : g.lineTo(X(p.t), Y(acc[i]!))));
      for (let i = points.length - 1; i >= 0; i--) g.lineTo(X(points[i]!.t), Y(lo[i]!));
      g.closePath();
      g.fillStyle = l.color;
      g.globalAlpha = 0.85;
      g.fill();
      g.globalAlpha = 1;
    }
    g.fillStyle = PAL.ink3;
    g.fillText(String(total), 4, top);
    g.fillText('0', 4, bottom - 12);
    cursor(f, t, base);
  }, [points, layers, total, t, base, W, height]);
  return (
    <div
      ref={wrap}
      className="chart"
      style={{ height }}
      data-testid={testId}
      onMouseMove={(e) => {
        const tt = pickTime(e, wrap.current!, points, W);
        if (tt === undefined) return;
        const p = [...points].reverse().find((x) => x.t <= tt) ?? points[0]!;
        setHover({ x: e.clientX - wrap.current!.getBoundingClientRect().left, p });
      }}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => {
        const tt = pickTime(e, wrap.current!, points, W);
        if (tt !== undefined) onPick?.(tt);
      }}
    >
      <canvas ref={ref} />
      {hover && (
        <div className="chart-tip surface" style={{ left: Math.min(W - 180, hover.x + 10) }}>
          <div className="num">{formatTime(hover.p.t)}</div>
          {layers.map((l) => (
            <div key={l.key}>
              <i style={{ background: l.color }} /> {l.label} <span className="num">{l.get(hover.p)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface Line {
  key: string;
  label: string;
  color: string;
  get: (p: SeriesPoint) => number;
}

/** 折线：纵轴 [lo, hi] */
export function LineChart({ points, lines, lo, hi, t, base, height = 120, onPick, fmt = (v) => String(v), testId }: { points: SeriesPoint[]; lines: Line[]; lo: number; hi: number; t: number; base: number | null; height?: number; onPick?: (t: number) => void; fmt?: (v: number) => string; testId?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const W = useWidth(wrap);
  const [hover, setHover] = useState<{ x: number; p: SeriesPoint } | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !W || points.length < 2) return;
    const f = frame(c, W, height, points[0]!.t, points[points.length - 1]!.t);
    const { g, X, top, bottom } = f;
    const Y = (v: number) => bottom - ((v - lo) / Math.max(1e-9, hi - lo)) * (bottom - top);
    g.fillStyle = PAL.line;
    g.fillRect(f.L, Math.round(Y((lo + hi) / 2)), W - f.L - 8, 1);
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const l of lines) {
      g.strokeStyle = l.color;
      g.beginPath();
      points.forEach((p, i) => (i === 0 ? g.moveTo(X(p.t), Y(l.get(p))) : g.lineTo(X(p.t), Y(l.get(p)))));
      g.stroke();
    }
    g.fillStyle = PAL.ink3;
    g.fillText(fmt(hi), 2, top);
    g.fillText(fmt(lo), 2, bottom - 12);
    cursor(f, t, base);
  }, [points, lines, lo, hi, t, base, W, height, fmt]);
  return (
    <div
      ref={wrap}
      className="chart"
      style={{ height }}
      data-testid={testId}
      onMouseMove={(e) => {
        const tt = pickTime(e, wrap.current!, points, W);
        if (tt === undefined) return;
        const p = [...points].reverse().find((x) => x.t <= tt) ?? points[0]!;
        setHover({ x: e.clientX - wrap.current!.getBoundingClientRect().left, p });
      }}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => {
        const tt = pickTime(e, wrap.current!, points, W);
        if (tt !== undefined) onPick?.(tt);
      }}
    >
      <canvas ref={ref} />
      {hover && (
        <div className="chart-tip surface" style={{ left: Math.min(W - 180, hover.x + 10) }}>
          <div className="num">{formatTime(hover.p.t)}</div>
          {lines.map((l) => (
            <div key={l.key}>
              <i style={{ background: l.color }} /> {l.label} <span className="num">{fmt(l.get(hover.p))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="legend-row">
      {items.map((x) => (
        <span key={x.label}>
          <i style={{ background: x.color }} />
          {x.label}
        </span>
      ))}
    </div>
  );
}
