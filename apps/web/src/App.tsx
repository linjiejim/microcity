import { useEffect } from 'react';
import { api } from './lib/api.ts';
import { openRun, refreshRuns, useApp } from './store.ts';
import { TopBar, SPEEDS } from './shell/TopBar.tsx';
import { Diagnostics } from './shell/Diagnostics.tsx';
import { ObserveView } from './observe/ObserveView.tsx';
import { ReviewView } from './review/ReviewView.tsx';
import { DesignView } from './design/DesignView.tsx';
import { GalleryView } from './gallery/GalleryView.tsx';
import { ManifestEditor } from './review/ManifestEditor.tsx';
import { NewsEditor } from './panels/NewsEditor.tsx';
import { DecisionModal } from './panels/DecisionModal.tsx';
import { HelpModal, LineageModal, RunsModal } from './panels/SmallModals.tsx';
import { Icon } from './ui/kit.tsx';

export function App() {
  const ws = useApp((s) => s.workspace);
  const modal = useApp((s) => s.modal);
  const toasts = useApp((s) => s.toasts);
  const runId = useApp((s) => s.runId);
  const cityMounted = useApp((s) => s.cityMounted);

  // 启动：连服务端、选运行（优先上次打开的；没有就新建一座经典小镇）。第一次来先进“设计”
  useEffect(() => {
    (async () => {
      const st = useApp.getState();
      const firstVisit = !localStorage.getItem('microcity.ws');
      // 分享链接可以直接指定工作区：?ws=gallery / design / observe / review
      const wsParam = new URLSearchParams(location.search).get('ws');
      const linked = wsParam === 'gallery' || wsParam === 'design' || wsParam === 'observe' || wsParam === 'review' ? wsParam : null;
      if (linked) st.set({ workspace: linked });
      else if (firstVisit) st.set({ workspace: 'design' });
      try {
        const health = await api.health();
        st.set({ health });
        // 演示站：第一次来先看实验广场
        if (firstVisit && !linked && health.public) st.set({ workspace: 'gallery' });
        const runs = await refreshRuns();
        const last = localStorage.getItem('microcity.run');
        const pick = runs.find((r) => r.id === last) ?? runs.find((r) => !r.experiment_id);
        if (pick) await openRun(pick.id);
        else {
          const r = await api.createRun({ seed: 42, provider: 'rule' });
          await refreshRuns();
          await openRun(r.id);
        }
      } catch (e) {
        st.toast(`连不上服务端：${(e as Error).message}`, 'bad');
      }
    })();
  }, []);

  // 快捷键
  useEffect(() => {
    const h = async (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.closest('input,textarea,select,[role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useApp.getState();
      if (e.key === 'g' || e.key === 'G') return st.set({ workspace: 'gallery' });
      if (e.key === 'd' || e.key === 'D') return st.set({ workspace: 'design' });
      if (e.key === 'o' || e.key === 'O') return st.set({ workspace: 'observe' });
      if (e.key === 'r' || e.key === 'R') return st.set({ workspace: 'review' });
      if (e.key === '?') return st.set({ modal: { kind: 'help' } });
      if (e.key === 'Escape') {
        if (st.profile) return st.set({ profile: undefined });
        if (st.trajectory) return st.set({ trajectory: undefined });
        return st.set({ selectedAgent: undefined, selectedPlace: undefined });
      }
      if (!st.runId || st.workspace !== 'observe') return;
      const ctl = async (body: Parameters<typeof api.control>[1]) => {
        const r = await api.control(st.runId!, body);
        st.set({ run: r, clock: { t: r.t, at: performance.now(), speed: r.speed, paused: r.paused, blocked: r.blocked } });
      };
      if (e.key === ' ') {
        e.preventDefault();
        await ctl({ op: st.run?.paused ? 'play' : 'pause' });
      } else if (/^[1-5]$/.test(e.key)) await ctl({ op: 'speed', speed: SPEEDS[Number(e.key) - 1] });
      else if (e.key === 'n' || e.key === 'N') st.set({ modal: { kind: 'news' } });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="ws-main">
        {/* 城市第一次进入观察才加载；之后常驻（切走时暂停渲染），回来不必重建三维场景 */}
        {runId && cityMounted && <ObserveView active={ws === 'observe'} />}
        {ws === 'review' && runId && <ReviewView />}
        {ws === 'design' && <DesignView />}
        {ws === 'gallery' && <GalleryView />}
      </main>
      {modal?.kind === 'news' && <NewsEditor />}
      {modal?.kind === 'decision' && <DecisionModal id={modal.id} />}
      {modal?.kind === 'runs' && <RunsModal />}
      {modal?.kind === 'lineage' && <LineageModal family={modal.family} />}
      {modal?.kind === 'help' && <HelpModal />}
      {modal?.kind === 'diagnostics' && <Diagnostics />}
      {modal?.kind === 'manifest' && <ManifestEditor scenario={modal.scenario} manifest={modal.manifest} {...(modal.title ? { title: modal.title } : {})} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast surface ${t.tone}`} data-testid="toast">
            <Icon name={t.tone === 'bad' ? 'warn' : t.tone === 'ok' ? 'check' : 'bulb'} color={t.tone === 'bad' ? 'var(--bad)' : t.tone === 'ok' ? 'var(--ok)' : 'var(--accent)'} />
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
