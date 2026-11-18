import { useEffect, useMemo } from 'react';
import { dayOf } from '@microcity/society';
import './theme/tokens.css';
import './ui/ui.css';
import './app.css';
import './pages.css';
import { CommunityModal } from './community/CommunityModal.tsx';
import { PeoplePanel } from './hud/PeoplePanel.tsx';
import { PersonCard } from './hud/PersonCard.tsx';
import { PlaceCard } from './hud/PlaceCard.tsx';
import { TimeBar } from './hud/TimeBar.tsx';
import { TopBar } from './hud/TopBar.tsx';
import { LabView } from './lab/LabView.tsx';
import { PortraitView } from './portrait/PortraitView.tsx';
import { runtime } from './runtime.ts';
import { SettingsModal } from './settings/SettingsModal.tsx';
import { readLink } from './share.ts';
import { set, SPEEDS, useApp, type View } from './store.ts';
import { WorldCanvas } from './world/WorldCanvas.tsx';

export function App() {
  const phase = useApp((s) => s.phase);
  const computed = useApp((s) => s.computed);
  const error = useApp((s) => s.error);
  const follow = useApp((s) => s.follow);
  const view = useApp((s) => s.view);
  // 链接只在打开时读一次（D85、D96）
  const link = useMemo(() => readLink(location.search, location.hash), []);

  useEffect(() => {
    const view: View = link.experiment || link.view === 'lab' ? 'lab' : link.view === 'portrait' ? 'portrait' : 'world';
    runtime.visible = view === 'world';
    // 带 t 的链接打开就停在那一刻
    set({ view, playing: link.t === undefined });
    runtime.boot(link.config, link.t, link.who);
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const s = useApp.getState();
      if (s.view !== 'world' || s.communityOpen || s.settingsOpen) return;
      if (e.key === ' ') {
        e.preventDefault();
        set({ playing: !s.playing });
      } else if (e.key === 'Escape') {
        if (s.follow) runtime.follow(null);
        else set({ place: null, peopleOpen: false });
      } else if (e.key === '[') runtime.seekDay(Math.max(1, dayOf(runtime.t) - 1));
      else if (e.key === ']') runtime.seekDay(Math.min(s.computed, dayOf(runtime.t) + 1));
      else if (e.key >= '1' && e.key <= '5') set({ speed: SPEEDS[Number(e.key) - 1]!, director: false });
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      runtime.dispose();
    };
  }, [link]);

  if (phase === 'error') {
    return (
      <div className="splash" data-testid="error">
        <div className="serif splash-title">出了点问题</div>
        <div className="dim">{error}</div>
      </div>
    );
  }
  const booted = phase === 'ready';
  return (
    <div className={`app${follow ? ' following' : ''} view-${view}`} data-testid="app" data-phase={phase} data-view={view}>
      <WorldCanvas />
      {booted && (
        <>
          <TopBar />
          {view === 'world' && (
            <>
              <PeoplePanel />
              <PersonCard />
              <PlaceCard />
              <TimeBar />
            </>
          )}
          {view === 'portrait' && <PortraitView />}
          {view === 'lab' && <LabView {...(link.experiment ? { initial: link.experiment } : {})} />}
        </>
      )}
      {!booted && (
        <div className="splash" data-testid="splash">
          <div className="serif splash-title">微缩城</div>
          <div className="dim">正在让街坊们过上日子…{computed > 0 ? `已经算完第 ${computed} 天` : ''}</div>
        </div>
      )}
      <CommunityModal />
      <SettingsModal />
    </div>
  );
}
