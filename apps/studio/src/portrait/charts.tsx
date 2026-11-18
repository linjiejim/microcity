import type { ReactNode } from 'react';

/** 画像用的几种小图：不用图表库，SVG 与 DOM 自己画；颜色都来自 tokens */

export function StackBar({ parts, unit = '' }: { parts: Array<{ label: string; value: number; color: string }>; unit?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="stackbar" role="img" aria-label={parts.map((p) => `${p.label} ${p.value.toFixed(1)}${unit}`).join('，')}>
      {parts.map((p) => (
        <i key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label} ${p.value.toFixed(1)}${unit}`}>
          {p.value / total > 0.07 ? p.value.toFixed(1) : ''}
        </i>
      ))}
    </div>
  );
}

export function Bars({ rows, color = 'var(--teal)', format = (v: number) => String(Math.round(v)) }: { rows: Array<{ label: ReactNode; value: number; color?: string; note?: string }>; color?: string; format?: (v: number) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div className="bars-row" key={i}>
          <span className="bars-label">{r.label}</span>
          <span className="bars-track">
            <i style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: r.color ?? color }} />
          </span>
          <span className="bars-value num">
            {format(r.value)}
            {r.note ? <em className="dim"> {r.note}</em> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 一条或几条折线；横轴是第几天 */
export function Lines({ series, height = 120, format = (v: number) => String(Math.round(v)), zero = false }: { series: Array<{ label: string; values: number[]; color: string }>; height?: number; format?: (v: number) => string; zero?: boolean }) {
  const W = 520;
  const H = height;
  const pad = { l: 8, r: 44, t: 8, b: 18 };
  const all = series.flatMap((s) => s.values);
  if (all.length === 0) return <div className="dim">还没有数据。</div>;
  const lo = zero ? Math.min(0, ...all) : Math.min(...all);
  const hi = Math.max(...all, lo + 1e-9);
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  return (
    <svg className="lines" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join('、')}>
      <line x1={pad.l} x2={W - pad.r} y1={y(lo)} y2={y(lo)} stroke="var(--line-2)" />
      <line x1={pad.l} x2={W - pad.r} y1={y(hi)} y2={y(hi)} stroke="var(--line)" strokeDasharray="3 4" />
      <text x={W - pad.r + 6} y={y(hi) + 4} className="axis">
        {format(hi)}
      </text>
      <text x={W - pad.r + 6} y={y(lo) + 4} className="axis">
        {format(lo)}
      </text>
      <text x={pad.l} y={H - 4} className="axis">
        第 1 天
      </text>
      <text x={W - pad.r} y={H - 4} className="axis" textAnchor="end">
        第 {n} 天
      </text>
      {series.map((s) => (
        <g key={s.label}>
          <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
          {s.values.length === 1 && <circle cx={x(0)} cy={y(s.values[0]!)} r="3" fill={s.color} />}
        </g>
      ))}
    </svg>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="legend left">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function Pyramid({ bands }: { bands: Array<{ label: string; m: number; f: number }> }) {
  const max = Math.max(1, ...bands.flatMap((b) => [b.m, b.f]));
  return (
    <div className="pyramid" role="img" aria-label="人口金字塔">
      {[...bands].reverse().map((b) => (
        <div className="pyr-row" key={b.label}>
          <span className="pyr-side left">
            <span className="num dim">{b.m || ''}</span>
            <i style={{ width: `${(b.m / max) * 100}%`, background: 'var(--info)' }} />
          </span>
          <span className="pyr-label num">{b.label}</span>
          <span className="pyr-side">
            <i style={{ width: `${(b.f / max) * 100}%`, background: 'var(--c-pink)' }} />
            <span className="num dim">{b.f || ''}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function HeatGrid({ rows, max }: { rows: Array<{ label: string; byHour: number[] }>; max: number }) {
  return (
    <div className="heat" role="img" aria-label="一天里各处的人数">
      <div className="heat-row head">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="num">
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
      </div>
      {rows.map((r, k) => {
        const rowMax = k === 0 ? Math.max(1, ...r.byHour) : max;
        return (
          <div className="heat-row" key={r.label}>
            <span className="heat-label">{r.label}</span>
            {r.byHour.map((v, h) => (
              <i key={h} title={`${h}:00 ${r.label} ${v.toFixed(1)} 人`} style={{ background: `color-mix(in srgb, ${k === 0 ? 'var(--ink-3)' : 'var(--teal)'} ${Math.round(Math.min(1, v / rowMax) * 100)}%, var(--surface-2))` }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** 24 小时的作息环：零点在正上方，顺时针 */
export function Ring({ segments, size = 180, children }: { segments: Array<{ from: number; to: number; color: string; label: string }>; size?: number; children?: ReactNode }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" role="img" aria-label="一天的作息">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="11" />
        {segments.map((s, i) => {
          const len = Math.max(0, ((s.to - s.from) / 86400) * c);
          return (
            <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="11" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-(s.from / 86400) * c} transform="rotate(-90 50 50)">
              <title>{s.label}</title>
            </circle>
          );
        })}
        {[0, 6, 12, 18].map((h) => {
          const a = (h / 24) * 2 * Math.PI - Math.PI / 2;
          return (
            <text key={h} x={50 + Math.cos(a) * 30} y={50 + Math.sin(a) * 30 + 2.5} textAnchor="middle" className="ring-tick">
              {h}
            </text>
          );
        })}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
