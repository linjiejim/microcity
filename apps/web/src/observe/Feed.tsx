import { useMemo, useState } from 'react';
import { clock, dayOf, formatTime, weekday, type Beat } from '@microcity/sim';
import { focusFamily, useApp, viewState } from '../store.ts';
import { Avatar, BigNumber, Empty, Icon, Segmented } from '../ui/kit.tsx';
import { BEAT_ICON, TONE_COLOR, beatMatches, type BeatFilter } from '../lib/beats.ts';
import { KNOW_LABEL, knowCounts } from '../lib/know.ts';
import { STATE_HEX } from '../theme/palette.ts';

/** 现场（v4）：一个大数字 + 三色进度；下一件剧本里的事；默认只列关键节拍，展开才看全部 */
export function Feed() {
  const beats = useApp((s) => s.beats);
  const history = useApp((s) => s.history);
  const scenario = useApp((s) => s.scenario);
  const fam = useApp((s) => focusFamily(s));
  const [scope, setScope] = useState<'key' | 'all'>('key');
  const [filter, setFilter] = useState<BeatFilter>('all');
  const cutoff = history?.t ?? Infinity;
  const list = useMemo(
    () =>
      beats
        .filter((b) => b.t <= cutoff && (scope === 'key' ? b.level === 'key' : beatMatches(b, filter)) && (!b.family || b.family === fam || scope === 'all'))
        .slice(-300)
        .reverse(),
    [beats, cutoff, filter, fam, scope],
  );
  const now = useApp((s) => s.clock.t);
  const next = (scenario?.script ?? []).find((x) => x.at > (history?.t ?? now) && (x.kind === 'publish' || x.kind === 'power'));

  return (
    <div className="feed" data-testid="feed">
      <NowSummary />
      {next && (
        <div className="upcoming" data-testid="upcoming">
          <span className="muted">接下来</span>
          <Icon name={next.kind === 'publish' ? 'news' : next.on ? 'bolt' : 'boltOff'} size={14} color="var(--ink-3)" />
          <span className="num dim">{formatTime(next.at)}</span>
          <span className="dim ellipsis">{next.kind === 'publish' ? `发布《${next.headline}》` : next.note}</span>
        </div>
      )}
      <div className="feed-bar">
        <Segmented
          testId="feed-scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'key', label: '关键' },
            { value: 'all', label: `全部 ${beats.filter((b) => b.t <= cutoff).length}` },
          ]}
        />
        {scope === 'all' && (
          <Segmented
            testId="feed-filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'spread', label: '传播' },
              { value: 'decide', label: '决定' },
              { value: 'impact', label: '后果' },
            ]}
          />
        )}
      </div>
      <div className="feed-list">
        {list.length === 0 && <Empty icon="talk">还没有值得说的事。播放或快进看看。</Empty>}
        {list.map((b, i) => (
          <FeedRow key={b.id} b={b} dayHead={i === 0 || dayOf(list[i - 1]!.t) !== dayOf(b.t)} />
        ))}
      </div>
    </div>
  );
}

/** 此刻：知道的人数 / 总人数 + 三色进度 */
function NowSummary() {
  const s = useApp((st) => viewState(st));
  const fam = useApp((st) => focusFamily(st));
  const rev = useApp((st) => st.rev);
  const counts = useMemo(() => (s ? knowCounts(s, fam) : null), [s, fam, rev]);
  if (!s || !counts) return null;
  const total = counts.unaware + counts.heard + counts.believe;
  return (
    <div className="now-summary" data-testid="now-summary">
      <BigNumber value={counts.heard + counts.believe} of={total} caption="人已经知道" />
      <div className="know-bar" title="知情三态">
        {(['believe', 'heard', 'unaware'] as const).map((k) => (
          <i key={k} style={{ flex: counts[k], background: STATE_HEX[k] }} />
        ))}
      </div>
      <div className="know-legend">
        {(['unaware', 'heard', 'believe'] as const).map((k) => (
          <span key={k}>
            <i style={{ background: STATE_HEX[k] }} />
            {KNOW_LABEL[k]} <b className="num">{counts[k]}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function FeedRow({ b, dayHead }: { b: Beat; dayHead: boolean }) {
  const set = useApp((s) => s.set);
  const s = useApp((st) => viewState(st));
  const open = () => {
    if (b.ref?.decision) set({ modal: { kind: 'decision', id: b.ref.decision } });
    else if (b.agents[0]) set({ selectedAgent: b.agents[0] });
  };
  const who = b.agents[0] ? s?.agents[b.agents[0]] : undefined;
  return (
    <>
      {dayHead && (
        <div className="feed-day">
          D{String(dayOf(b.t)).padStart(2, '0')} {weekday(dayOf(b.t))}
        </div>
      )}
      <div className={`feed-row ${b.level === 'key' ? 'key' : ''}`} data-testid={`beat-${b.kind}`}>
        <span className="num feed-t">{clock(b.t)}</span>
        <span className="feed-ic" style={{ color: TONE_COLOR[b.tone] }}>
          <Icon name={BEAT_ICON[b.kind]} size={14} />
        </span>
        <button className="feed-main" onClick={open} title={b.ref?.decision ? '点开看这次决定' : b.agents[0] ? '看这个人' : undefined}>
          <div className="feed-title">{b.title}</div>
          {b.detail && <div className="muted feed-detail">{b.detail}</div>}
        </button>
        {who && (
          <button className="face" onClick={() => set({ selectedAgent: who.id })} title={who.name}>
            <Avatar look={who.look} size={26} />
          </button>
        )}
      </div>
    </>
  );
}
