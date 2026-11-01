import { useEffect, useRef, useState } from 'react';
import type { PlaceDef, TileKind } from '@microcity/sim';
import type { TownPreview } from '../lib/api.ts';
import { mix, soft, tone } from '../theme/palette.ts';

const TILE: Record<TileKind, string> = {
  grass: '#e7ecd9',
  park: '#dbe7cb',
  road: '#e4ddd1',
  path: '#eee8dc',
  plaza: '#f0e6d4',
  water: '#cfe3ec',
  bridge: '#dccab1',
  lot: '#ebe6dd',
  tree: '#c6d8b0',
  flower: '#e3ead3',
};

const KIND_LABEL: Record<string, string> = {
  residence: '住宅',
  gov: '政务',
  clinic: '诊所',
  library: '图书馆',
  utility: '维护站',
  newsroom: '报社',
  supermarket: '超市',
  cafe: '咖啡馆',
  restaurant: '餐馆',
  convenience: '便利店',
  studio: '工作室',
  plaza: '广场',
  park: '公园',
};

/** 设计工作区的小镇预览：俯视，地块 + 圆角建筑；悬停看地点 */
export function MiniMap({ preview }: { preview: TownPreview }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const [W, setW] = useState(0);
  const [hover, setHover] = useState<{ p: PlaceDef; x: number; y: number } | null>(null);
  const m = preview.map;
  const scale = W ? Math.max(4, Math.min(16, Math.floor(W / m.w))) : 8;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c || !W) return;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    c.width = m.w * scale * dpr;
    c.height = m.h * scale * dpr;
    c.style.width = `${m.w * scale}px`;
    c.style.height = `${m.h * scale}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const k = m.tiles[y * m.w + x]!;
        g.fillStyle = TILE[k];
        g.fillRect(x * scale, y * scale, scale, scale);
        if (k === 'tree') {
          g.fillStyle = '#9dbf86';
          g.beginPath();
          g.arc(x * scale + scale / 2, y * scale + scale / 2, scale * 0.42, 0, Math.PI * 2);
          g.fill();
        } else if (k === 'flower') {
          g.fillStyle = '#efd98a';
          g.fillRect(x * scale + 1, y * scale + 1, 2, 2);
          g.fillStyle = '#c2553a';
          g.fillRect(x * scale + scale - 3, y * scale + scale - 3, 2, 2);
        }
      }
    }
    for (const p of m.places) {
      const r = p.rect;
      if (p.open) {
        g.strokeStyle = p.kind === 'park' ? '#6f9f76' : '#b9a58a';
        g.lineWidth = 2;
        g.strokeRect(r.x * scale + 1, r.y * scale + 1, r.w * scale - 2, r.h * scale - 2);
        continue;
      }
      const c = mix(soft(p.style.roof), '#ffffff', 0.3);
      g.fillStyle = c;
      g.strokeStyle = tone(c, -0.15);
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(r.x * scale + 1, r.y * scale + 1, r.w * scale - 2, r.h * scale - 2, Math.max(2, scale * 0.5));
      g.fill();
      g.stroke();
      g.fillStyle = '#e3a13a';
      g.beginPath();
      g.arc(p.door.x * scale + scale / 2, (r.y + r.h) * scale - 1.5, 1.8, 0, Math.PI * 2);
      g.fill();
    }
    for (const pr of m.props) {
      if (pr.kind === 'board') {
        g.fillStyle = '#e3a13a';
        g.fillRect(pr.x * scale, pr.y * scale, scale, scale);
        g.fillStyle = '#ffffff';
        g.fillRect(pr.x * scale + 1, pr.y * scale + 1, scale - 2, 1);
      } else if (pr.kind === 'fountain') {
        g.fillStyle = '#2f8a91';
        g.fillRect(pr.x * scale + 1, pr.y * scale + 1, scale - 2, scale - 2);
      }
    }
  }, [m, W, scale]);
  return (
    <div
      ref={wrap}
      className="minimap"
      data-testid="minimap"
      onMouseMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        const tx = Math.floor((e.clientX - r.left) / scale);
        const ty = Math.floor((e.clientY - r.top) / scale);
        const p = m.places.find((q) => tx >= q.rect.x && tx < q.rect.x + q.rect.w && ty >= q.rect.y && ty < q.rect.y + q.rect.h);
        setHover(p ? { p, x: e.clientX - wrap.current!.getBoundingClientRect().left, y: e.clientY - wrap.current!.getBoundingClientRect().top } : null);
      }}
      onMouseLeave={() => setHover(null)}
    >
      <canvas ref={ref} />
      {hover && (
        <div className="chart-tip surface" style={{ left: Math.min(W - 180, hover.x + 12), top: hover.y + 12 }}>
          {hover.p.name} · {KIND_LABEL[hover.p.kind] ?? hover.p.kind} · {hover.p.district === 'north' ? '北区' : '南区'}
          {hover.p.board ? ' · 公告栏' : ''}
        </div>
      )}
    </div>
  );
}
