import { useEffect, useRef, useState } from 'react';
import { HOUR, DAY, clock, dayOf, dayStart, timeOfDay, weekday, type DomainEvent } from '@microcity/sim';
import { api } from '../lib/api.ts';
import { displayTime, focusFamily, useApp, viewState } from '../store.ts';
import { Button, Icon, Segmented } from '../ui/kit.tsx';
import { CH_HEX, describeEvent } from '../lib/format.ts';
import { canvasFont } from '../theme/palette.ts';

type Range = 'all' | 'day' | 'six';
const FONT = canvasFont(12);
const LANES = [
  { id: 'world', label: '世界', h: 18 },
  { id: 'spread', label: '传播', h: 30 },
  { id: 'decide', label: '决策', h: 16 },
  { id: 'impact', label: '后果', h: 14 },
  { id: 'agent', label: '选中', h: 16 },
] as const;
const AXIS = 18;
const GUTTER = 44;

const KIND_COLOR: Record<string, string> = {
  sleep: '#e2dbcf', work: '#2f5f8a', wfh: '#2f5f8a', class: '#8a6a9a', study: '#8a6a9a', jobsearch: '#8a6a9a', shop: '#e3a13a', leisure: '#3e8e63', walk: '#3e8e63', breakfast: '#e7d6bd', lunch: '#e7d6bd', dinner: '#e7d6bd', tv: '#9d968a', home: '#cfc7ba', nap: '#e2dbcf', care: '#cfc7ba', read_board: '#3e8e63', wait: '#c2553a',
};

interface Hit {
  x: number;
  y: number;
  e: DomainEvent;
}

export function Timeline({ onClose }: { onClose?: () => void }) {
  const [range, setRange] = useState<Range>('day');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hits = useRef<Hit[]>([]);
  const view = useRef<{ t0: number; t1: number; w: number }>({ t0: 0, t1: 1, w: 1 });
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub?: string; color: string } | null>(null);
  const runId = useApp((s) => s.runId);
  const history = useApp((s) => s.history);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      if (ts - last < 120) return;
      last = ts;
      const c = canvasRef.current;
      const wrap = wrapRef.current;
      const st = useApp.getState();
      const s = viewState(st);
      if (!c || !wrap || !s) return;
      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) {
        c.width = W * dpr;
        c.height = H * dpr;
        c.style.width = `${W}px`;
        c.style.height = `${H}px`;
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.font = FONT;
      g.textBaseline = 'top';
      const now = displayTime(st.clock);
      const start = 6 * HOUR;
      let t0: number;
      let t1: number;
      if (range === 'all') {
        t0 = start;
        t1 = Math.max(now + 2 * HOUR, start + DAY);
      } else if (range === 'day') {
        t0 = dayStart(dayOf(now));
        t1 = t0 + DAY;
      } else {
        t0 = now - 4 * HOUR;
        t1 = now + 2 * HOUR;
      }
      const w = W - GUTTER - 8;
      view.current = { t0, t1, w };
      const X = (t: number) => Math.round(GUTTER + ((t - t0) / (t1 - t0)) * w);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
      // 夜晚底纹
      for (let d = dayOf(t0); d <= dayOf(t1); d++) {
        const n0 = dayStart(d) - 3 * HOUR;
        const n1 = dayStart(d) + 6 * HOUR;
        g.fillStyle = '#f3eee6';
        g.fillRect(X(Math.max(t0, n0)), AXIS, Math.max(0, X(Math.min(t1, n1)) - X(Math.max(t0, n0))), H - AXIS);
      }
      // 坐标轴
      g.fillStyle = '#e2dbcf';
      g.fillRect(0, 0, W, AXIS);
      const span = t1 - t0;
      const step = span > 3 * DAY ? 6 * HOUR : span > DAY ? 3 * HOUR : span > 8 * HOUR ? HOUR : 30 * 60;
      for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
        const x = X(t);
        const isDay = timeOfDay(t) === 0;
        g.fillStyle = isDay ? '#8f897e' : '#cfc7ba';
        g.fillRect(x, AXIS - (isDay ? 18 : 5), isDay ? 2 : 1, isDay ? H : 5);
        g.fillStyle = isDay ? '#26241f' : '#8f897e';
        const label = isDay ? `D${String(dayOf(t)).padStart(2, '0')} ${weekday(dayOf(t))}` : clock(t);
        if (isDay || step <= 3 * HOUR) g.fillText(label, x + 3, 3);
      }
      // 车道
      let y = AXIS;
      const laneY: Record<string, number> = {};
      for (const l of LANES) {
        laneY[l.id] = y;
        g.fillStyle = '#e2dbcf';
        g.fillRect(0, y + l.h - 1, W, 1);
        g.fillStyle = '#8f897e';
        g.fillText(l.label, 6, y + Math.floor((l.h - 12) / 2));
        y += l.h;
      }
      g.fillStyle = '#cfc7ba';
      g.fillRect(GUTTER - 2, AXIS, 2, H - AXIS);
      const hs: Hit[] = [];
      const fam = focusFamily(st);
      const ids = Object.keys(s.agents);
      for (const e of st.timeline) {
        if (e.t < t0 || e.t > t1) continue;
        const x = X(e.t);
        switch (e.type) {
          case 'news_published': {
            const yy = laneY.world! + 2;
            g.fillStyle = e.news.intervention ? '#a45a8a' : '#e3a13a';
            g.fillRect(x, yy, 2, 14);
            g.fillRect(x + 2, yy, 6, 6);
            hs.push({ x, y: yy + 7, e });
            break;
          }
          case 'power': {
            const yy = laneY.world! + 3;
            g.fillStyle = e.on ? '#3e8e63' : '#c2553a';
            g.fillRect(x - 1, yy, 3, 12);
            hs.push({ x, y: yy + 6, e });
            break;
          }
          case 'place_mode':
          case 'org_notice':
          case 'intervention': {
            if (e.type === 'intervention' && e.by !== 'admin') break;
            const yy = laneY.world! + 6;
            g.fillStyle = e.type === 'intervention' ? '#a45a8a' : '#d98a2b';
            g.fillRect(x - 2, yy, 4, 4);
            hs.push({ x, y: yy + 2, e });
            break;
          }
          case 'exposure': {
            if (e.family !== fam) break;
            const i = ids.indexOf(e.agent);
            const yy = laneY.spread! + 2 + ((i * 7) % 24);
            g.fillStyle = CH_HEX[e.channel];
            g.fillRect(x - 1, yy, e.attention.opened ? 3 : 2, e.attention.opened ? 3 : 2);
            hs.push({ x, y: yy + 1, e });
            break;
          }
          case 'transmission': {
            if (e.tr.familyId !== fam) break;
            const yy = laneY.spread! + 1;
            g.fillStyle = CH_HEX[e.tr.channel];
            g.fillRect(x, yy + 26, 1, 3);
            break;
          }
          case 'decision': {
            const yy = laneY.decide! + 4;
            const d = e as Extract<DomainEvent, { type: 'decision' }>;
            g.fillStyle = d.provider === 'jev' ? '#2f8a91' : '#a8a298';
            g.fillRect(x - 2, yy, 4, 8);
            hs.push({ x, y: yy + 4, e });
            break;
          }
          case 'inconvenience': {
            const yy = laneY.impact! + 3;
            g.fillStyle = e.expected ? '#d98a2b' : '#c2553a';
            g.fillRect(x - 1, yy, 3, 8);
            hs.push({ x, y: yy + 4, e });
            break;
          }
        }
      }
      // 选中居民的安排
      const sel = st.selectedAgent ? s.agents[st.selectedAgent] : undefined;
      if (sel) {
        const yy = laneY.agent! + 3;
        for (const items of Object.values(sel.plans))
          for (const it of items) {
            if (it.end < t0 || it.start > t1 || it.status === 'cancelled') continue;
            const x0 = Math.max(GUTTER, X(it.start));
            const x1 = Math.min(W - 8, X(it.end));
            if (x1 <= x0) continue;
            g.fillStyle = KIND_COLOR[it.kind] ?? '#cfc7ba';
            g.fillRect(x0, yy, Math.max(1, x1 - x0 - 1), 10);
            if (it.status === 'failed' || it.status === 'interrupted') {
              g.fillStyle = '#c2553a';
              g.fillRect(x0, yy + 8, Math.max(1, x1 - x0 - 1), 2);
            }
            if (it.origin?.family) {
              g.fillStyle = '#e3a13a';
              g.fillRect(x0, yy, 2, 10);
            }
          }
        g.fillStyle = '#26241f';
        g.fillText(sel.name, 6, laneY.agent! + 2);
      }
      // 当前时刻 / 历史时刻
      const nx = X(now);
      if (nx >= GUTTER && nx <= W) {
        g.fillStyle = '#e3a13a';
        g.fillRect(nx, AXIS, 2, H - AXIS);
        g.fillRect(nx - 3, AXIS, 8, 3);
      }
      if (st.history) {
        const hx = X(st.history.t);
        g.fillStyle = '#26241f';
        g.fillRect(hx, AXIS, 2, H - AXIS);
        g.fillRect(hx - 3, H - 3, 8, 3);
      }
      hits.current = hs;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [range]);

  const onMove = (e: React.MouseEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best: Hit | undefined;
    let bd = 7;
    for (const h of hits.current) {
      const d = Math.abs(h.x - x) + Math.abs(h.y - y) * 0.6;
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    if (!best) {
      setTip(null);
      return;
    }
    const st = useApp.getState();
    const line = describeEvent(best.e, viewState(st));
    if (!line) return setTip(null);
    setTip({ x: Math.min(r.width - 290, x + 12), y: Math.max(0, y - 46), text: `${clock(best.e.t)} ${line.text}`, sub: line.sub, color: line.color });
  };

  const onClick = async (e: React.MouseEvent) => {
    if (!runId) return;
    const r = wrapRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const { t0, t1, w } = view.current;
    if (x < GUTTER) return;
    const t = Math.round(t0 + ((x - GUTTER) / w) * (t1 - t0));
    const st = useApp.getState();
    if (t >= displayTime(st.clock) - 60) {
      set({ history: undefined });
      return;
    }
    try {
      const h = await api.stateAt(runId, t);
      set({ history: { seq: h.seq, t, state: h.state } });
    } catch (err) {
      toast(`无法回到该时刻：${(err as Error).message}`, 'bad');
    }
  };

  return (
    <section className="timeline surface" data-testid="timeline">
      <header className="panel-head">
        <Icon name="list" color="var(--accent)" />
        <span>明细时间轴</span>
        <span className="muted">五条车道；点击任意位置回到当时（只读）</span>
        <span className="grow" />
        {history && (
          <button className="linkbtn" onClick={() => set({ history: undefined })} data-testid="tl-back-live">
            返回实时
          </button>
        )}
        {onClose && (
          <Button size="sm" icon="history" onClick={onClose} title="回到章节条" testId="tl-chapters">
            章节
          </Button>
        )}
        <Segmented
          testId="tl-range"
          value={range}
          onChange={setRange}
          options={[
            { value: 'all', label: '全程' },
            { value: 'day', label: '当天' },
            { value: 'six', label: '6 小时' },
          ]}
        />
      </header>
      <div ref={wrapRef} className="tl-canvas" onMouseMove={onMove} onMouseLeave={() => setTip(null)} onClick={onClick} data-testid="timeline-canvas">
        <canvas ref={canvasRef} />
        {tip && (
          <div className="tip surface" style={{ left: tip.x, top: tip.y, position: 'absolute' }}>
            <div style={{ color: tip.color }}>{tip.text}</div>
            {tip.sub && <div className="muted">{tip.sub}</div>}
          </div>
        )}
      </div>
    </section>
  );
}
