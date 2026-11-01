import { useMemo, useState } from 'react';
import { clock, describeSlots, type Agent, type WorldState } from '@microcity/sim';
import { focusFamily, useApp, viewState } from '../store.ts';
import { Avatar, Badge, Button, Empty, Icon } from '../ui/kit.tsx';
import { CH_COLOR, CHANNEL_LABEL, placeName, windowTone } from '../lib/format.ts';
import type { IconName } from '../ui/icons.ts';

type Filter = 'all' | 'unaware' | 'aware' | 'rumor' | 'acted' | 'hit' | 'trust';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '全部居民' },
  { id: 'unaware', label: '还没接触到消息' },
  { id: 'aware', label: '已知情（相信/怀疑）' },
  { id: 'rumor', label: '相信“全天”的' },
  { id: 'acted', label: '因消息改了安排' },
  { id: 'hit', label: '被停电影响' },
  { id: 'trust', label: '信任变了的' },
];

const ACT_ICON: Partial<Record<string, IconName>> = {
  sleep: 'zzz', work: 'org', wfh: 'org', class: 'book', study: 'book', shop: 'coin', lunch: 'home', dinner: 'home', breakfast: 'home', leisure: 'talk', walk: 'person', tv: 'eye', read_board: 'board', wait: 'boltOff', care: 'home', jobsearch: 'search', home: 'home', nap: 'zzz',
};

export function beliefDot(a: Agent, fam: string) {
  const b = a.beliefs[fam];
  if (!b) return <span className="chip-dot" style={{ boxShadow: 'inset 0 0 0 2px var(--fg-3)' }} title="未接触" />;
  const tone = windowTone(b.slots);
  return <span className="chip-dot" style={{ background: b.status === 'believe' ? tone.hex : 'transparent', boxShadow: `inset 0 0 0 2px ${tone.hex}` }} title={`${b.status === 'believe' ? '相信' : b.status === 'doubt' ? '将信将疑' : '不信'}：${describeSlots(b.slots)}`} />;
}

function matches(a: Agent, f: Filter, fam: string): boolean {
  const b = a.beliefs[fam];
  switch (f) {
    case 'all':
      return true;
    case 'unaware':
      return !b;
    case 'aware':
      return !!b;
    case 'rumor':
      return b?.slots.window?.kind === 'all_day';
    case 'acted':
      return !!a.funnel[fam]?.intended;
    case 'hit':
      return a.stats.inconvenience > 0;
    case 'trust':
      return Math.abs(a.trustGov - a.traits.trustOfficial) >= 0.005 || Object.keys(a.trustIn).length > 0;
  }
}

export function PeopleList() {
  const s = useApp((st) => viewState(st));
  const rev = useApp((st) => st.rev);
  const sel = useApp((st) => st.selectedAgent);
  const fam = useApp((st) => focusFamily(st));
  const set = useApp((st) => st.set);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const agents = s ? Object.values(s.agents) : [];
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, agents.filter((a) => matches(a, f.id, fam)).length])), [agents, fam, rev, s?.meta.seq]);
  const list = agents.filter((a) => matches(a, filter, fam) && (!q || a.name.includes(q) || a.roleLabel.includes(q)));
  return (
    <div className="people" data-testid="people">
      <div className="people-bar">
        <select className="field-input" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} data-testid="people-filter">
          {FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}（{counts[f.id]}）
            </option>
          ))}
        </select>
        <input className="field-input" placeholder="搜索姓名 / 身份" value={q} onChange={(e) => setQ(e.target.value)} data-testid="people-search" />
      </div>
      <div className="list" data-testid="people-list">
        {list.length === 0 && <Empty>没有符合条件的居民</Empty>}
        {list.map((a) => {
          const place = a.loc.k === 'walk' ? `→ ${placeName(s, a.loc.walk.toPlace)}` : a.loc.k === 'in' ? placeName(s, a.loc.place) : '街上';
          return (
            <button key={a.id} className={`row-btn ${sel === a.id ? 'on' : ''}`} onClick={() => set({ selectedAgent: sel === a.id ? undefined : a.id })} data-testid={`agent-row-${a.id}`}>
              <Avatar look={a.look} dim={a.act?.kind === 'sleep'} />
              <div className="row-main">
                <div className="row-title">
                  {a.name}
                  <span className="muted"> {a.age} · {a.roleLabel}</span>
                </div>
                <div className="row-sub muted">
                  <Icon name={a.loc.k === 'walk' ? 'person' : (ACT_ICON[a.act?.kind ?? ''] ?? 'home')} /> {a.act?.label ?? (a.loc.k === 'walk' ? '走路' : '空闲')} · {place}
                </div>
              </div>
              <div className="row-tail">
                {a.stats.inconvenience > 0 && <Icon name="boltOff" color="var(--bad)" title="被停电影响" />}
                {a.funnel[fam]?.intended && <Icon name="list" color="var(--info)" title="改了安排" />}
                {beliefDot(a, fam)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function NewsList() {
  const s = useApp((st) => viewState(st));
  const set = useApp((st) => st.set);
  const fam = useApp((st) => focusFamily(st));
  const news = s ? Object.values(s.news).sort((a, b) => b.publishedAt - a.publishedAt) : [];
  if (news.length === 0) return <NoNews s={s} />;
  return (
    <div className="list" data-testid="news-list">
      {news.map((n) => {
        const on = fam === n.familyId;
        const aware = s ? Object.values(s.agents).filter((a) => a.beliefs[n.familyId]).length : 0;
        return (
          <div key={n.id} className={`news-card ${on ? 'on' : ''}`} data-testid={`news-${n.id}`}>
            <button className="news-head" onClick={() => set({ selectedFamily: n.familyId, selectedAgent: undefined })}>
              <div className="row-title">{n.headline.text}</div>
              <div className="muted">
                {n.publisher.name} · D{String(Math.floor(n.publishedAt / 86400) + 1).padStart(2, '0')} {clock(n.publishedAt)}
                {n.correctionOf ? ' · 更正' : ''}
              </div>
            </button>
            <div className="news-meta">
              {n.channels.map((c) => (
                <Badge key={c} color={CH_COLOR[c]}>
                  {CHANNEL_LABEL[c]}
                </Badge>
              ))}
              {n.intervention && (
                <Badge color="var(--rumor)" icon="flag">
                  干预
                </Badge>
              )}
              <span className="muted num" style={{ marginLeft: 'auto' }}>
                知情 {aware}
              </span>
            </div>
            <div className="news-actions">
              <Button size="sm" icon="layers" on={on} onClick={() => set({ selectedFamily: n.familyId, overlay: 'spread', selectedAgent: undefined })}>
                看传播
              </Button>
              <Button size="sm" icon="rumor" onClick={() => set({ modal: { kind: 'lineage', family: n.familyId } })} testId={`lineage-${n.id}`}>
                版本血缘
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NoNews({ s }: { s?: WorldState }) {
  const set = useApp((st) => st.set);
  const scenario = useApp((st) => st.scenario);
  void s;
  const next = scenario?.script.find((x) => x.kind === 'publish');
  return (
    <div className="left-body">
      <Empty icon="news">
        还没有新闻。
        {next && (
          <>
            <br />
            剧本：{next.note}（{next.headline}）
          </>
        )}
        <br />
        你也可以用“发布新闻”做一次记录在案的干预。
      </Empty>
      <div style={{ padding: 10 }}>
        <Button icon="news" variant="primary" onClick={() => set({ modal: { kind: 'news' } })} style={{ width: '100%' }}>
          发布新闻
        </Button>
      </div>
    </div>
  );
}
