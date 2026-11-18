import { useEffect } from 'react';
import { dayOf, OLDTOWN, parseTime } from '@microcity/society';
import './theme/tokens.css';
import './ui/ui.css';
import './app.css';
import { PeoplePanel } from './hud/PeoplePanel.tsx';
import { PersonCard } from './hud/PersonCard.tsx';
import { PlaceCard } from './hud/PlaceCard.tsx';
import { TimeBar } from './hud/TimeBar.tsx';
import { TopBar } from './hud/TopBar.tsx';
import { runtime } from './runtime.ts';
import { SettingsModal } from './settings/SettingsModal.tsx';
import { set, SPEEDS, useApp } from './store.ts';
import { WorldCanvas } from './world/WorldCanvas.tsx';

/** 链接里可以带：seed（运行种子）、t（例如 D03 18:30）、who（居民 id）——同一个链接看到同一刻（D85）；带 t 时停在那一刻 */
function readLink(): { seed: number; t?: number; who?: string } {
  const q = new URLSearchParams(location.search);
  const seed = Number(q.get('seed') ?? 1);
  let t: number | undefined;
  try {
    const raw = q.get('t');
    if (raw) t = parseTime(raw);
  } catch {
    t = undefined;
  }
  return { seed: Number.isFinite(seed) ? seed : 1, ...(t !== undefined ? { t } : {}), ...(q.get('who') ? { who: q.get('who')! } : {}) };
}

export function App() {
  const phase = useApp((s) => s.phase);
  const computed = useApp((s) => s.computed);
  const error = useApp((s) => s.error);
  const follow = useApp((s) => s.follow);

  useEffect(() => {
    const link = readLink();
    if (link.t !== undefined) {
      runtime.t = link.t;
      set({ playing: false });
    }
    runtime.boot(OLDTOWN, link.seed);
    let pendingWho = link.who;
    const off = useApp.subscribe((s) => {
      if (pendingWho && s.phase === 'ready' && runtime.people[pendingWho]) {
        const who = pendingWho;
        pendingWho = undefined;
        runtime.follow(who);
      }
    });
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const s = useApp.getState();
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
      off();
      window.removeEventListener('keydown', key);
      runtime.dispose();
    };
  }, []);

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
    <div className={`app${follow ? ' following' : ''}`} data-testid="app" data-phase={phase}>
      <WorldCanvas />
      {booted && (
        <>
          <TopBar />
          <PeoplePanel />
          <PersonCard />
          <PlaceCard />
          <TimeBar />
        </>
      )}
      {!booted && (
        <div className="splash" data-testid="splash">
          <div className="serif splash-title">微缩城</div>
          <div className="dim">正在让街坊们过上日子…{computed > 0 ? `已经算完第 ${computed} 天` : ''}</div>
        </div>
      )}
      <SettingsModal />
    </div>
  );
}
