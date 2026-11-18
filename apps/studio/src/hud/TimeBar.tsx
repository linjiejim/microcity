import { useMemo, useRef, useState } from 'react';
import { BUCKET_LABEL, DAY, dayOf, dayStart, type Bucket } from '@microcity/society';
import { runtime } from '../runtime.ts';
import { set, SPEEDS, useApp, type Speed } from '../store.ts';
import { BUCKET_HEX } from '../theme/palette.ts';
import { Button, Segmented, Switch } from '../ui/kit.tsx';
import { fmtClock, fmtDay } from './format.ts';

const SPEED_LABEL: Record<Speed, string> = { 1: '实时', 10: '10 倍', 60: '1 分/秒', 300: '5 分/秒', 1200: '20 分/秒' };
const MARK_COLOR = { chat: 'var(--c-pink)', pay: 'var(--amber)', earn: 'var(--ok)', tie: 'var(--teal)', fail: 'var(--bad)' } as const;

/** 底部时间轴：播放、倍速、换天；一条 24 小时的带子，跟随某人时按其活动着色 */
export function TimeBar() {
  const now = useApp((s) => s.now);
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const director = useApp((s) => s.director);
  const computed = useApp((s) => s.computed);
  const follow = useApp((s) => s.follow);
  const waiting = useApp((s) => s.waiting);
  const rev = useApp((s) => s.storyRev);
  const strip = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const day = dayOf(now);
  const d0 = dayStart(day);
  const story = runtime.story;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const segments = useMemo(() => (follow && story ? story.segments : []), [rev, follow]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const marks = useMemo(() => (follow && story ? story.marks : []), [rev, follow]);
  const used = useMemo(() => [...new Set(segments.map((s) => s.bucket))] as Bucket[], [segments]);

  const timeAt = (clientX: number): number => {
    const r = strip.current!.getBoundingClientRect();
    return d0 + Math.max(0, Math.min(0.9999, (clientX - r.left) / r.width)) * DAY;
  };
  const drag = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    runtime.seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => runtime.seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const hoverSeg = hover ? segments.find((s) => hover.t >= s.t0 && hover.t < s.t1) : undefined;

  return (
    <footer className="timebar hud" data-testid="timebar">
      <div className="tb-row">
        <Button icon={playing ? 'pause' : 'play'} variant="primary" onClick={() => set({ playing: !playing })} testId="play" title={playing ? '暂停（空格）' : '播放（空格）'} />
        <Segmented<Speed> testId="speed" value={speed} onChange={(v) => set({ speed: v, director: false })} options={SPEEDS.map((v) => ({ value: v, label: SPEED_LABEL[v] }))} />
        <Switch checked={director} onChange={(v) => set({ director: v, playing: true })} testId="director" title="睡觉、上班时快进，在路上、聊天、花钱时放慢">
          一分钟看完一天
        </Switch>
        <div className="grow" />
        {waiting && <span className="dim blink">这一天还在算…</span>}
        <Button icon="history" size="sm" variant="ghost" disabled={day <= 1} onClick={() => runtime.seekDay(day - 1)} testId="day-prev" title="前一天（[）">
          前一天
        </Button>
        <span className="tb-day num" data-testid="day-label">
          {fmtDay(now)}
        </span>
        <Button icon="right" size="sm" variant="ghost" disabled={day >= computed} onClick={() => runtime.seekDay(day + 1)} testId="day-next" title="后一天（]）">
          后一天
        </Button>
      </div>
      <div
        className="strip"
        ref={strip}
        data-testid="strip"
        onPointerDown={drag}
        onPointerMove={(e) => {
          const r = strip.current!.getBoundingClientRect();
          setHover({ x: e.clientX - r.left, t: timeAt(e.clientX) });
        }}
        onPointerLeave={() => setHover(null)}
      >
        <div className="strip-sky" />
        {segments.map((s) => (
          <i key={`${s.t0}`} className={`seg-block${s.away ? ' away' : ''}`} style={{ left: `${((s.t0 - d0) / DAY) * 100}%`, width: `${((s.t1 - s.t0) / DAY) * 100}%`, background: BUCKET_HEX[s.bucket] }} />
        ))}
        {marks.map((m, i) => (
          <i key={i} className="seg-mark" style={{ left: `${((m.t - d0) / DAY) * 100}%`, background: MARK_COLOR[m.kind] }} />
        ))}
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} className="tick num" style={{ left: `${(h / 24) * 100}%` }}>
            {h < 24 ? `${String(h).padStart(2, '0')}:00` : ''}
          </span>
        ))}
        <b className="cursor" style={{ left: `${((now - d0) / DAY) * 100}%` }} />
        {hover && (
          <div className="strip-tip" style={{ left: hover.x }}>
            <span className="num">{fmtClock(hover.t)}</span>
            {hoverSeg && <span>{hoverSeg.label}</span>}
          </div>
        )}
      </div>
      {follow ? (
        <div className="legend">
          {used.map((b) => (
            <span key={b}>
              <i style={{ background: BUCKET_HEX[b] }} />
              {BUCKET_LABEL[b]}
            </span>
          ))}
        </div>
      ) : (
        <div className="legend dim">点一个人，时间轴会显示这个人这一天是怎么过的</div>
      )}
    </footer>
  );
}
