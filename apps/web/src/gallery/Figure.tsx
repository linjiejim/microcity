import type { GalleryFigure } from '../lib/api.ts';
import { PAL, STATE_HEX } from '../theme/palette.ts';

const GRAY = '#e2dbcf';
const FONT = { fontSize: 11, fill: PAL.ink2 } as const;

/** 确定性打散：点图里被填上的点散落在镇上，而不是排成一条 */
function order(n: number, seed: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  let s = seed;
  for (let i = n - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx;
}

/** 广场卡片的示意图：猜之前只画中性的骨架（不泄露答案），猜完填上数字 */
export function Figure({ f, revealed }: { f: GalleryFigure; revealed: boolean }) {
  return (
    <figure className="g-fig" data-testid="g-figure">
      <svg viewBox="0 0 320 132" role="img" aria-label={revealed ? f.note : '示意图（猜完再揭晓）'}>
        {f.kind === 'dots' && <Dots f={f} revealed={revealed} />}
        {f.kind === 'race' && <Race f={f} revealed={revealed} />}
        {f.kind === 'chain' && <Chain f={f} revealed={revealed} />}
        {f.kind === 'robust' && <Robust f={f} revealed={revealed} />}
        {f.kind === 'diverge' && <Diverge f={f} revealed={revealed} />}
      </svg>
      <figcaption className={revealed ? '' : 'muted'}>{revealed ? f.note : '先猜，再看小镇的答案'}</figcaption>
    </figure>
  );
}

function Dots({ f, revealed }: { f: Extract<GalleryFigure, { kind: 'dots' }>; revealed: boolean }) {
  const cols = 10;
  const rows = Math.ceil(f.total / cols);
  const panel = (x0: number, label: string, value: number, seed: number) => {
    const filled = new Set(order(f.total, seed).slice(0, Math.round(value)));
    return (
      <g transform={`translate(${x0} 8)`}>
        {Array.from({ length: f.total }, (_, i) => (
          <circle key={i} cx={8 + (i % cols) * 13 + (Math.floor(i / cols) % 2) * 3} cy={8 + Math.floor(i / cols) * 13} r={4.6} fill={revealed && filled.has(i) ? STATE_HEX.believe : GRAY} style={{ transition: `fill 0.4s ${(i % 17) * 0.02}s` }} />
        ))}
        <text x={66} y={rows * 13 + 18} textAnchor="middle" {...FONT}>
          {label}
          {revealed ? ` · ${value}` : ''}
        </text>
      </g>
    );
  };
  return (
    <>
      {panel(10, f.a.label, f.a.value, 7)}
      {panel(170, f.b.label, f.b.value, 7)}
    </>
  );
}

function Race({ f, revealed }: { f: Extract<GalleryFigure, { kind: 'race' }>; revealed: boolean }) {
  const max = Math.max(...f.rows.flatMap((r) => [r.a, r.b]));
  const X0 = 118;
  const W = 140;
  return (
    <>
      <text x={8} y={14} {...FONT} fill={PAL.ink3}>
        {f.unit}
      </text>
      {f.rows.map((r, i) => {
        const y = 32 + i * 48;
        const bar = (dy: number, v: number, text: string, color: string, cond: string) => (
          <g transform={`translate(0 ${y + dy})`}>
            <text x={48} y={9} fontSize={10} fill={PAL.ink3}>
              {cond}
            </text>
            <rect x={X0} y={1} width={W} height={10} rx={5} fill="#f1ece3" />
            {revealed && <rect x={X0} y={1} width={Math.max(6, (v / max) * W)} height={10} rx={5} fill={color} style={{ transition: 'width 0.5s' }} />}
            {revealed && (
              <text x={X0 + W + 6} y={10} fontSize={11} fill={PAL.ink}>
                {text}
              </text>
            )}
          </g>
        );
        return (
          <g key={r.label}>
            <text x={8} y={y + 18} fontSize={12} fontWeight={600} fill={PAL.ink}>
              {r.label}
            </text>
            {bar(0, r.a, r.aText, '#a3adbb', f.aLabel)}
            {bar(18, r.b, r.bText, STATE_HEX.believe, f.bLabel)}
          </g>
        );
      })}
    </>
  );
}

function Chain({ f, revealed }: { f: Extract<GalleryFigure, { kind: 'chain' }>; revealed: boolean }) {
  return (
    <>
      {f.hops.map((h, j) => (
        <text key={h} x={120 + j * 80} y={14} textAnchor="middle" fontSize={10} fill={PAL.ink3}>
          {h}
        </text>
      ))}
      {f.rows.map((r, i) => {
        const y = 44 + i * 50;
        return (
          <g key={r.label}>
            <text x={8} y={y + 4} fontSize={11} fill={PAL.ink}>
              {r.label}
            </text>
            <line x1={120} x2={120 + (r.values.length - 1) * 80} y1={y} y2={y} stroke={GRAY} strokeWidth={2} />
            {r.values.map((v, j) => (
              <g key={j}>
                <circle cx={120 + j * 80} cy={y} r={14} fill="#fff" stroke={GRAY} strokeWidth={1.5} />
                {revealed && <circle cx={120 + j * 80} cy={y} r={Math.max(2, 14 * Math.sqrt(v / 100))} fill={STATE_HEX.believe} style={{ transition: 'r 0.5s' }} />}
                {revealed && (
                  <text x={120 + j * 80} y={y + 28} textAnchor="middle" fontSize={11} fill={PAL.ink}>
                    {v}%
                  </text>
                )}
              </g>
            ))}
          </g>
        );
      })}
    </>
  );
}

function Robust({ f, revealed }: { f: Extract<GalleryFigure, { kind: 'robust' }>; revealed: boolean }) {
  const X0 = 110;
  const W = 170;
  return (
    <>
      <text x={X0} y={14} fontSize={10} fill={PAL.ink3}>
        0%
      </text>
      <text x={X0 + W / 2} y={14} fontSize={10} fill={PAL.ink3} textAnchor="middle">
        50%
      </text>
      <text x={X0 + W} y={14} fontSize={10} fill={PAL.ink3} textAnchor="end">
        100%
      </text>
      <line x1={X0 + W / 2} x2={X0 + W / 2} y1={20} y2={124} stroke={PAL.line2} strokeDasharray="3 3" />
      {f.rows.map((r, i) => {
        const y = 32 + i * 50;
        return (
          <g key={r.label}>
            <foreignObject x={4} y={y - 2} width={100} height={40}>
              <div className="g-fig-label">{r.label}</div>
            </foreignObject>
            {(['rule', 'jev'] as const).map((k, j) => (
              <g key={k} transform={`translate(0 ${y + j * 16})`}>
                <rect x={X0} y={0} width={W} height={10} rx={5} fill="#f1ece3" />
                {revealed && <rect x={X0} y={0} width={(r[k] / 100) * W} height={10} rx={5} fill={r[k] >= 70 ? STATE_HEX.believe : STATE_HEX.heard} style={{ transition: 'width 0.5s' }} />}
                <text x={X0 + W + 6} y={9} fontSize={10} fill={PAL.ink3}>
                  {k === 'rule' ? '规则' : 'Jev'}
                  {revealed ? ` ${r[k]}%` : ''}
                </text>
              </g>
            ))}
          </g>
        );
      })}
    </>
  );
}

function Diverge({ f, revealed }: { f: Extract<GalleryFigure, { kind: 'diverge' }>; revealed: boolean }) {
  const C = 190;
  const S = 14;
  return (
    <>
      <text x={8} y={14} fontSize={11} fill={PAL.ink3}>
        {f.unit}
      </text>
      <line x1={C} x2={C} y1={24} y2={124} stroke={PAL.line2} />
      <text x={C - 6} y={122} fontSize={10} fill={PAL.ink3} textAnchor="end">
        更少
      </text>
      <text x={C + 6} y={122} fontSize={10} fill={PAL.ink3}>
        更多
      </text>
      {f.rows.map((r, i) => {
        const y = 38 + i * 36;
        const w = Math.abs(r.value) * S;
        return (
          <g key={r.label}>
            <text x={8} y={y + 10} fontSize={12} fontWeight={600} fill={PAL.ink}>
              {r.label}
            </text>
            <rect x={C - 110} y={y} width={220} height={14} rx={7} fill="#f6f2eb" />
            {revealed && <rect x={r.value >= 0 ? C : C - w} y={y} width={w} height={14} rx={7} fill={r.value >= 0 ? STATE_HEX.believe : STATE_HEX.heard} style={{ transition: 'width 0.5s' }} />}
            {revealed && (
              <text x={r.value >= 0 ? C + w + 6 : C - w - 6} y={y + 11} fontSize={11} fill={PAL.ink} textAnchor={r.value >= 0 ? 'start' : 'end'}>
                {r.text}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}
