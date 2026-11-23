import { useEffect, useState } from 'react';
import { BUCKET_LABEL, DAY, dayStart, formatTime, weekday, type Affected, type DayAgg, type Experiment } from '@microcity/society';
import { fmtMoney, roleOf } from '../hud/format.ts';
import { Avatar } from '../hud/Avatar.tsx';
import { runtime } from '../runtime.ts';
import { set } from '../store.ts';
import { BUCKET_HEX } from '../theme/palette.ts';
import { dayStory, type Segment } from '../timeline/segments.ts';
import { Button } from '../ui/kit.tsx';
import type { CommunityDef } from '@microcity/society';
import { lab } from './client.ts';

function Strip({ label, segs, d0 }: { label: string; segs: Segment[]; d0: number }) {
  return (
    <div className="micro-line">
      <span className="micro-label">{label}</span>
      <div className="strip static">
        {segs.map((s) => (
          <i key={s.t0} className={`seg-block${s.away ? ' away' : ''}`} title={`${formatTime(s.t0).slice(4)}–${formatTime(s.t1 - 1).slice(4)} ${s.label}`} style={{ left: `${((s.t0 - d0) / DAY) * 100}%`, width: `${((s.t1 - s.t0) / DAY) * 100}%`, background: BUCKET_HEX[s.bucket] }} />
        ))}
      </div>
    </div>
  );
}

/** 两条线上这一天不一样的地方：只在其中一条线上出现过的事 */
function diffs(a: Segment[], b: Segment[]): { onlyBase: string[]; onlyTreat: string[] } {
  const key = (s: Segment) => s.label;
  const A = new Set(a.map(key));
  const B = new Set(b.map(key));
  return { onlyBase: [...A].filter((k) => !B.has(k)).slice(0, 5), onlyTreat: [...B].filter((k) => !A.has(k)).slice(0, 5) };
}

/**
 * 微观镜头（D91）：同一个人、同一天，在基线与干预两条世界线里各是怎么过的。
 */
export function Micro({ def, x, who, base, treat, onClose }: { def: CommunityDef; x: Experiment; who: Affected; base: DayAgg[]; treat: DayAgg[]; onClose: () => void }) {
  const p = def.people[who.index]!;
  const [day, setDay] = useState(who.day);
  const [lines, setLines] = useState<{ day: number; a: Segment[]; b: Segment[] } | null>(null);
  const seed = x.seeds[0]!;
  useEffect(() => {
    let alive = true;
    setLines(null);
    const name = (id: string) => def.people.find((q) => q.id === id)?.name ?? id;
    const place = (id: string) => def.map.places.find((q) => q.id === id)?.name ?? id;
    void Promise.all([lab.pack({ spec: x.spec, seed, interventions: [] }, day), lab.pack({ spec: x.spec, seed, interventions: x.interventions }, day)]).then(([pa, pb]) => {
      if (alive) setLines({ day, a: dayStory(pa, p.id, name, place).segments, b: dayStory(pb, p.id, name, place).segments });
    });
    return () => {
      alive = false;
    };
  }, [day, p.id, seed, x, def]);
  const sa = base[day - 1]?.people[who.index];
  const sb = treat[day - 1]?.people[who.index];
  const d0 = dayStart(day);
  const d = lines ? diffs(lines.a, lines.b) : undefined;
  const used = lines ? [...new Set([...lines.a, ...lines.b].map((s) => s.bucket))] : [];
  return (
    <section className="pcard surface wide micro" data-testid="micro">
      <div className="micro-head">
        <Avatar look={p.look} size={44} />
        <div className="grow">
          <h3 className="serif">{p.name}的第 {day} 天</h3>
          <div className="dim">
            {p.age} 岁 · {roleOf(p)} · {weekday(day)} · 种子 {seed}
          </div>
        </div>
        <Button size="sm" variant="ghost" icon="history" disabled={day <= 1} onClick={() => setDay(day - 1)} testId="micro-prev">
          前一天
        </Button>
        <Button size="sm" variant="ghost" icon="right" disabled={day >= x.days} onClick={() => setDay(day + 1)} testId="micro-next">
          后一天
        </Button>
        <Button size="sm" variant="ghost" icon="cross" onClick={onClose} testId="micro-close" title="关闭" />
      </div>
      {!lines ? (
        <div className="dim blink">正在重算这一天…</div>
      ) : (
        <>
          <Strip label="没有这件事" segs={lines.a} d0={d0} />
          <Strip label="有这件事" segs={lines.b} d0={d0} />
          <div className="strip-ticks num">
            {[0, 6, 12, 18].map((h) => (
              <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          <div className="legend left">
            {used.map((b) => (
              <span key={b}>
                <i style={{ background: BUCKET_HEX[b] }} />
                {BUCKET_LABEL[b]}
              </span>
            ))}
          </div>
          <div className="micro-diff">
            <div>
              <b>只在“没有这件事”时做了</b>
              <p>{d!.onlyBase.length ? d!.onlyBase.join('；') : '没有'}</p>
            </div>
            <div>
              <b>只在“有这件事”时做了</b>
              <p>{d!.onlyTreat.length ? d!.onlyTreat.join('；') : '没有'}</p>
            </div>
          </div>
        </>
      )}
      {sa && sb && (
        <table className="micro-nums" data-testid="micro-nums">
          <thead>
            <tr>
              <th />
              <th>花了</th>
              <th>收到</th>
              <th>聊天</th>
              <th>心情</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['没有这件事', sa],
              ['有这件事', sb],
            ].map(([label, s]) => {
              const v = s as typeof sa;
              return (
                <tr key={label as string}>
                  <td>{label as string}</td>
                  <td className="num">{fmtMoney(v.spent)}</td>
                  <td className="num">{fmtMoney(v.earned)}</td>
                  <td className="num">{v.chats} 次</td>
                  <td className="num">{Math.round(v.mood * 100)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="row">
        <Button
          icon="eye"
          variant="primary"
          testId="micro-open"
          onClick={() => {
            runtime.boot({ spec: x.spec, seed, interventions: x.interventions }, dayStart(day) + 7 * 3600, p.id);
            set({ view: 'world', playing: false });
          }}
        >
          在“有这件事”的世界里看这一天
        </Button>
        <span className="dim small">会离开实验台，打开那条世界线，停在这一天早上七点并跟着{p.name}。</span>
      </div>
    </section>
  );
}
