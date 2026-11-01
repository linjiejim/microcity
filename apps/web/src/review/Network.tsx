import { useEffect, useMemo, useRef, useState } from 'react';
import { type DomainEvent, type TownMap, type WorldState } from '@microcity/sim';
import { useApp } from '../store.ts';
import { canvasFont } from '../theme/palette.ts';

const FONT = canvasFont(12);
const WIN_HEX: Record<string, string> = { exact: '#3e8e63', coarse: '#e3a13a', all_day: '#c2553a', unknown: '#8f897e' };

interface Node {
  id: string;
  name: string;
  x: number;
  y: number;
  r: number;
  fill: string;
  ring?: string;
  relays: number;
}

/** 谁告诉了谁：环形布局（北区在上、南区在下，同户相邻），边的颜色是传出去的版本精度 */
export function Network({ s, map, family, t, height = 360 }: { s: WorldState; map: TownMap; family: string; t: number; height?: number }) {
  const timeline = useApp((st) => st.timeline);
  const set = useApp((st) => st.set);
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const [W, setW] = useState(0);
  const [hover, setHover] = useState<Node | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tx = useMemo(() => timeline.filter((e): e is Extract<DomainEvent, { type: 'transmission' }> => e.type === 'transmission' && e.tr.familyId === family && e.t <= t), [timeline, family, t]);
  const nodes = useMemo(() => {
    if (!W) return [] as Node[];
    const agents = Object.values(s.agents).sort((a, b) => {
      const da = map.places[a.home]?.district === 'north' ? 0 : 1;
      const db = map.places[b.home]?.district === 'north' ? 0 : 1;
      return da - db || a.householdId.localeCompare(b.householdId) || a.id.localeCompare(b.id);
    });
    const relays = new Map<string, number>();
    for (const e of tx) relays.set(e.tr.from, (relays.get(e.tr.from) ?? 0) + 1);
    const cx = W / 2;
    const cy = height / 2;
    const rx = W / 2 - 70;
    const ry = height / 2 - 34;
    const north = agents.filter((a) => map.places[a.home]?.district === 'north');
    const south = agents.filter((a) => map.places[a.home]?.district !== 'north');
    return agents.map((a): Node => {
      // 北区排在上半圈（从左到右），南区排在下半圈（从右到左）
      const inN = north.indexOf(a);
      const ang = inN >= 0 ? Math.PI + ((inN + 0.5) / north.length) * Math.PI : ((south.indexOf(a) + 0.5) / Math.max(1, south.length)) * Math.PI;
      const b = a.beliefs[family];
      const k = !b ? 'none' : !b.slots.window ? 'unknown' : b.slots.window.kind === 'exact' ? 'exact' : b.slots.window.kind === 'coarse' ? 'coarse' : 'all_day';
      const d = a.trustGov - a.traits.trustOfficial;
      return {
        id: a.id,
        name: a.name,
        x: Math.round(cx + Math.cos(ang) * rx),
        y: Math.round(cy + Math.sin(ang) * ry),
        r: 4 + Math.min(6, (relays.get(a.id) ?? 0) * 1.2),
        fill: k === 'none' ? '#cfc7ba' : b!.status === 'believe' ? WIN_HEX[k]! : '#9d968a',
        ...(Math.abs(d) >= 0.005 ? { ring: d > 0 ? '#3e8e63' : '#c2553a' } : {}),
        relays: relays.get(a.id) ?? 0,
      };
    });
  }, [s, map, family, tx, W, height]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !W) return;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    c.width = W * dpr;
    c.height = height * dpr;
    c.style.width = `${W}px`;
    c.style.height = `${height}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.font = FONT;
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, height);
    g.fillStyle = '#9d968a';
    g.fillText('北区', 10, 14);
    g.fillText('南区', 10, height - 14);
    const at = new Map(nodes.map((n) => [n.id, n]));
    const latest = tx.length ? tx[tx.length - 1]!.t : t;
    for (const e of tx) {
      const a = at.get(e.tr.from);
      const b = at.get(e.tr.to);
      if (!a || !b) continue;
      const v = s.versions[e.tr.versionId];
      const k = !v?.slots.window ? 'unknown' : v.slots.window.kind === 'exact' ? 'exact' : v.slots.window.kind === 'coarse' ? 'coarse' : 'all_day';
      const fresh = latest - e.t < 3600;
      g.fillStyle = WIN_HEX[k]!;
      g.globalAlpha = fresh ? 0.95 : 0.45;
      const n = Math.max(2, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      for (let i = 1; i < n; i++) {
        const f = i / n;
        const sz = f > 0.8 ? 2 : 1;
        g.fillRect(Math.round(a.x + (b.x - a.x) * f), Math.round(a.y + (b.y - a.y) * f), sz, sz);
      }
    }
    g.globalAlpha = 1;
    for (const n of nodes) {
      const r = Math.round(n.r);
      if (n.ring) {
        g.fillStyle = n.ring;
        g.fillRect(n.x - r - 2, n.y - r - 2, r * 2 + 4, r * 2 + 4);
      }
      g.fillStyle = '#ffffff';
      g.fillRect(n.x - r - 1, n.y - r - 1, r * 2 + 2, r * 2 + 2);
      g.fillStyle = n.fill;
      g.fillRect(n.x - r, n.y - r, r * 2, r * 2);
      if (n.relays >= 3 || hover?.id === n.id) {
        g.fillStyle = '#26241f';
        const left = n.x < W / 2;
        g.textAlign = left ? 'right' : 'left';
        g.fillText(n.name, n.x + (left ? -r - 5 : r + 5), n.y);
        g.textAlign = 'left';
      }
    }
  }, [nodes, tx, s, W, height, hover, t]);
  const pick = (e: React.MouseEvent): Node | undefined => {
    const r = wrap.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return nodes.find((n) => Math.abs(n.x - x) <= n.r + 3 && Math.abs(n.y - y) <= n.r + 3);
  };
  return (
    <div ref={wrap} className="network" style={{ height }} onMouseMove={(e) => setHover(pick(e) ?? null)} onMouseLeave={() => setHover(null)} onClick={(e) => {
      const n = pick(e);
      if (n) set({ trajectory: n.id });
    }} data-testid="network">
      <canvas ref={ref} />
      {hover && (
        <div className="chart-tip surface" style={{ left: Math.min(W - 200, hover.x + 12), top: Math.max(0, hover.y - 30) }}>
          {hover.name} · 转告 {hover.relays} 次
        </div>
      )}
    </div>
  );
}
