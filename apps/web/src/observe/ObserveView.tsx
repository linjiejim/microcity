import { Suspense, lazy, useState } from 'react';
import { useApp, viewState } from '../store.ts';
import { Tabs } from '../ui/kit.tsx';
import { Inspector } from '../panels/Inspector.tsx';
import { Timeline } from '../panels/Timeline.tsx';
import { Feed } from './Feed.tsx';
import { NewsList, PeopleList } from './Lists.tsx';
import { PersonPanel } from './PersonPanel.tsx';
import { Scrubber } from './Scrubber.tsx';

/** 城市（three.js）按需分包：第一次进入观察才下载（v4 D60） */
const CityView = lazy(() => import('../city/CityView.tsx').then((m) => ({ default: m.CityView })));

/** 观察：城市占满中央；右侧“现场 · 居民 · 新闻”；选中居民时是精简人物卡；底部章节条 */
export function ObserveView({ active }: { active: boolean }) {
  const selected = useApp((s) => s.selectedAgent);
  const profile = useApp((s) => s.profile);
  const [detail, setDetail] = useState(false);
  return (
    <div className={`observe ${detail ? 'detail' : ''}`} data-testid="observe" hidden={!active}>
      <Suspense
        fallback={
          <div className="city surface" data-testid="city-pending">
            <div className="city-loading">
              <span className="blink">载入小镇…</span>
            </div>
          </div>
        }
      >
        <CityView active={active} />
      </Suspense>
      <aside className="side surface" data-testid="side">
        {selected ? <PersonPanel id={selected} /> : <SideTabs />}
      </aside>
      {detail ? <Timeline onClose={() => setDetail(false)} /> : <Scrubber onDetail={() => setDetail(true)} />}
      {profile && <ProfileDrawer id={profile} />}
    </div>
  );
}

function SideTabs() {
  const tab = useApp((s) => s.sideTab);
  const set = useApp((s) => s.set);
  const s = useApp((st) => viewState(st));
  return (
    <div className="side-tabs">
      <Tabs
        value={tab}
        onChange={(v) => set({ sideTab: v })}
        tabs={[
          { id: 'feed', label: '现场', icon: 'talk' },
          { id: 'people', label: '居民', icon: 'person', count: s ? Object.keys(s.agents).length : 0 },
          { id: 'news', label: '新闻', icon: 'news', count: s ? Object.keys(s.news).length : 0 },
        ]}
      />
      {tab === 'feed' && <Feed />}
      {tab === 'people' && <PeopleList />}
      {tab === 'news' && <NewsList />}
    </div>
  );
}

function ProfileDrawer({ id }: { id: string }) {
  const set = useApp((s) => s.set);
  return (
    <div className="drawer-back" onMouseDown={(e) => e.target === e.currentTarget && set({ profile: undefined })} data-testid="profile-drawer">
      <aside className="drawer surface">
        <Inspector id={id} onClose={() => set({ profile: undefined })} />
      </aside>
    </div>
  );
}
