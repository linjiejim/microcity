import { useEffect, useRef, useState } from 'react';
import { DAY, HOUR, clock, dayOf, dayStart, formatTime, weekday, type Beat } from '@microcity/sim';
import { api } from '../lib/api.ts';
import { displayTime, useApp } from '../store.ts';
import { Button } from '../ui/kit.tsx';
import { drawIcon } from '../ui/icons.ts';
import { BEAT_ICON, TONE_HEX } from '../lib/beats.ts';
import { PAL, canvasFont } from '../theme/palette.ts';

const FONT = canvasFont(11);
const PAD = 18;
/** 右边留给“明细”按钮 */
const RIGHT = 70;
/** 画成带图标徽章、并在下面标字的关键时刻 */
const BADGE: Partial<Record<string, string>> = { publish: '通知', clarify: '澄清', outage: '停电', restore: '来电', false_alarm: '虚惊', intervention: '干预' };

interface Mark {
  x: number;
  t: number;
  title: string;
  sub?: string;
  color: string;
  future?: boolean;
}

/** 观察工作区底部的“章节条”：关键时刻 + 剧本里将要发生的事 + 当前时刻；点过去回看，点将来的标记快进 */
export function Scrubber({ onDetail }: { onDetail: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const marks = useRef<Mark[]>([]);
  const view = useRef({ t0: 0, t1: 1, w: 1 });
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
      const sc = st.scenario;
      if (!c || !wrap || !sc) return;
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
      const lastEnd = Math.max(...sc.outages.map((o) => dayStart(o.day) + o.to), sc.start + 2 * DAY);
      const t0 = sc.start;
      const t1 = Math.max(lastEnd + 8 * HOUR, now + 3 * HOUR);
      const w = W - PAD * 2 - RIGHT;
      view.current = { t0, t1, w };
      const X = (t: number) => PAD + ((t - t0) / (t1 - t0)) * w;
      const TY = Math.round(H * 0.46);
      g.clearRect(0, 0, W, H);
      // 夜晚底纹与日刻度
      for (let d = dayOf(t0); d <= dayOf(t1); d++) {
        const n0 = Math.max(t0, dayStart(d) - 3 * HOUR);
        const n1 = Math.min(t1, dayStart(d) + 6 * HOUR);
        if (n1 > n0) {
          g.fillStyle = PAL.surface2;
          g.fillRect(X(n0), 8, X(n1) - X(n0), H - 16);
        }
        const x = X(dayStart(d));
        if (dayStart(d) >= t0) {
          g.fillStyle = PAL.line;
          g.fillRect(Math.round(x), 8, 1, H - 16);
        }
        g.fillStyle = PAL.ink3;
        g.fillText(`D${String(d).padStart(2, '0')} ${weekday(d)}`, Math.max(PAD, x) + 5, 9);
      }
      // 轨道：已经过去的部分用深青
      const nx = X(now);
      g.lineCap = 'round';
      g.lineWidth = 3;
      g.strokeStyle = PAL.line2;
      g.beginPath();
      g.moveTo(PAD, TY);
      g.lineTo(PAD + w, TY);
      g.stroke();
      g.strokeStyle = PAL.teal;
      g.beginPath();
      g.moveTo(PAD, TY);
      g.lineTo(Math.max(PAD, nx), TY);
      g.stroke();
      const ms: Mark[] = [];
      let lastLabel = -999;
      const label = (x: number, text: string, color: string) => {
        if (x - lastLabel < 58) return;
        lastLabel = x;
        g.fillStyle = color;
        g.textAlign = 'center';
        g.fillText(text, x, TY + 16);
        g.textAlign = 'left';
      };
      // 剧本里将要发生的事：空心圆环
      for (const x of sc.script) {
        if (x.kind !== 'publish' && x.kind !== 'power') continue;
        if (x.at <= now) continue;
        const xx = X(x.at);
        const color = x.kind === 'publish' ? PAL.amber : x.on ? PAL.ok : PAL.bad;
        g.fillStyle = PAL.surface;
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(xx, TY, 7, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        label(xx, x.kind === 'publish' ? '将发通知' : x.on ? '将来电' : '将停电', PAL.ink3);
        ms.push({ x: xx, t: x.at, title: `${formatTime(x.at)} 将要${x.kind === 'publish' ? `发布《${x.headline}》` : x.note}`, sub: '点击快进到这里', color, future: true });
      }
      // 已经发生的关键时刻：小圆点；重要的几类画成带图标的徽章并标字
      const beats: Beat[] = st.beats.filter((b) => b.level === 'key');
      for (const b of beats) {
        const xx = X(b.t);
        const color = TONE_HEX[b.tone];
        const tag = BADGE[b.kind] ?? (b.kind === 'milestone' && /50%/.test(b.title) ? '半数相信' : undefined);
        if (tag) {
          g.fillStyle = PAL.surface;
          g.strokeStyle = color;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(xx, TY, 10, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          drawIcon(g, BEAT_ICON[b.kind], xx - 6, TY - 6, color, 12, 2.2);
          label(xx, tag, PAL.ink2);
        } else {
          g.fillStyle = color;
          g.beginPath();
          g.arc(xx, TY, 3, 0, Math.PI * 2);
          g.fill();
        }
        ms.push({ x: xx, t: b.t, title: `${clock(b.t)} ${b.title}`, ...(b.detail ? { sub: b.detail } : {}), color });
      }
      // 当前时刻 / 回看时刻
      g.fillStyle = PAL.teal;
      g.beginPath();
      g.roundRect(nx - 2, TY - 14, 4, 28, 2);
      g.fill();
      if (st.history) {
        const hx = X(st.history.t);
        g.fillStyle = PAL.ink;
        g.beginPath();
        g.roundRect(hx - 2, TY - 14, 4, 28, 2);
        g.fill();
      }
      marks.current = ms;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const nearest = (x: number): Mark | undefined => {
    let best: Mark | undefined;
    let bd = 7;
    for (const m of marks.current) {
      const d = Math.abs(m.x - x);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  };

  const onMove = (e: React.MouseEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const m = nearest(e.clientX - r.left);
    if (!m) return setTip(null);
    setTip({ x: r.left + Math.min(r.width - 290, Math.max(0, m.x - 20)), y: r.top - 8, text: m.title, ...(m.sub ? { sub: m.sub } : {}), color: m.color });
  };

  const onClick = async (e: React.MouseEvent) => {
    if (!runId) return;
    const r = wrapRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const m = nearest(x);
    const st = useApp.getState();
    const now = displayTime(st.clock);
    const { t0, t1, w } = view.current;
    const t = m ? m.t : Math.round(t0 + ((x - PAD) / w) * (t1 - t0));
    if (m?.future) {
      try {
        const res = await api.control(runId, { op: 'jump', to: formatTime(m.t - 60) });
        set({ run: res, history: undefined, clock: { t: res.t, at: performance.now(), speed: res.speed, paused: res.paused, blocked: res.blocked } });
      } catch (err) {
        toast((err as Error).message, 'bad');
      }
      return;
    }
    if (t >= now - 60) {
      if (t > now + 60) toast('那一刻还没发生：点剧本里的空心标记可以快进过去');
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
    <section className="scrubber surface" data-testid="scrubber">
      <div ref={wrapRef} className="tl-canvas" onMouseMove={onMove} onMouseLeave={() => setTip(null)} onClick={onClick} data-testid="timeline-canvas" title="点过去回看（只读）；点空心圆环快进">
        <canvas ref={canvasRef} />
        {tip && (
          <div className="tip surface" style={{ left: tip.x, top: tip.y, transform: 'translateY(-100%)' }}>
            <div style={{ color: tip.color, fontWeight: 600 }}>{tip.text}</div>
            {tip.sub && <div className="muted">{tip.sub}</div>}
          </div>
        )}
      </div>
      <div className="scrub-tools">
        {history && (
          <button className="linkbtn" onClick={() => set({ history: undefined })} data-testid="tl-back-live">
            返回实时
          </button>
        )}
        <Button size="sm" icon="list" onClick={onDetail} title="五条车道的明细时间轴" testId="tl-detail">
          明细
        </Button>
      </div>
    </section>
  );
}
