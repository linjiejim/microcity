import { useEffect, useRef, useState } from 'react';
import type { TownSpec } from '@microcity/sim';
import { api, type BuilderView, type Preset } from '../lib/api.ts';
import { openRun, refreshRuns, useApp } from '../store.ts';
import { Avatar, Badge, Button, Empty, Icon, SecTitle, Segmented } from '../ui/kit.tsx';
import { MiniMap } from './MiniMap.tsx';
import { EventsEditor, SpecForm } from './SpecForm.tsx';

/** 设计：对话建镇 + 模板 + 参数；右侧是生成结果的预览；最后开始观察或做对照实验 */
export function DesignView() {
  const sessionId = useApp((s) => s.sessionId);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [view, setView] = useState<BuilderView>();
  const [presets, setPresets] = useState<Preset[]>([]);
  useEffect(() => {
    api
      .presets()
      .then(setPresets)
      .catch(() => {});
  }, []);
  useEffect(() => {
    let alive = true;
    const saved = sessionId ?? localStorage.getItem('microcity.session') ?? undefined;
    (async () => {
      try {
        const v = saved ? await api.session(saved).catch(() => api.newSession('classic')) : await api.newSession('classic');
        if (!alive) return;
        localStorage.setItem('microcity.session', v.id);
        set({ sessionId: v.id });
        setView(v);
      } catch (e) {
        toast(`建镇会话打不开：${(e as Error).message}`, 'bad');
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);
  if (!view) return <Empty>打开建镇会话…</Empty>;
  return (
    <div className="design" data-testid="design">
      <Chat view={view} onView={setView} />
      <Preview view={view} onView={setView} presets={presets} />
    </div>
  );
}

function Chat({ view, onView }: { view: BuilderView; onView: (v: BuilderView) => void }) {
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [view.messages.length, busy]);
  const send = async (t?: string) => {
    const msg = (t ?? text).trim();
    if (!msg || busy) return;
    setBusy(true);
    setText('');
    onView({ ...view, messages: [...view.messages, { role: 'user', text: msg, at: new Date().toISOString() }] });
    try {
      onView(await api.say(view.id, msg));
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const last = [...view.messages].reverse().find((m) => m.role === 'assistant');
  const chips = last?.suggestions?.length ? last.suggestions : ['老人多一些，很少有人订推送', '邻里常串门', '再加一轮周六南区停电'];
  return (
    <section className="chat surface" data-testid="builder-chat">
      <div className="chat-hero">
        <h1 className="serif">造一座小镇</h1>
        <p className="dim">描述你想要的小镇和想做的实验，右边会同步预览。</p>
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            className="field-input"
            rows={4}
            value={text}
            disabled={!view.modelAccess || busy}
            placeholder={view.modelAccess ? '比如：40 人的老城区，老人多，很少有人订推送，通知只贴公告栏' : '离线模式：请用右边的模板与参数'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            data-testid="chat-input"
          />
          <div className="chat-send-row">
            <Badge color={view.modelAccess ? 'var(--c-jev)' : 'var(--ink-3)'}>{view.modelAccess ? 'DeepSeek Flash' : '离线：用模板与参数'}</Badge>
            <span className="grow" />
            <Button type="submit" variant="primary" icon="sparkle" disabled={!view.modelAccess || busy || !text.trim()} testId="chat-send">
              改小镇
            </Button>
          </div>
        </form>
        <div className="chips">
          {chips.map((s, i) => (
            <button key={i} className="chip" onClick={() => void send(s)} disabled={busy || !view.modelAccess}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="chat-list" ref={list}>
        {view.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`} data-testid={`msg-${m.role}`}>
            <div className="msg-text">{m.text}</div>
            {m.changes && m.changes.length > 0 && (
              <ul className="msg-changes">
                {m.changes.map((c, j) => (
                  <li key={j}>
                    <Icon name="check" size={14} color="var(--ok)" /> {c}
                  </li>
                ))}
              </ul>
            )}
            {m.warnings && m.warnings.length > 0 && (
              <ul className="msg-warn">
                {m.warnings.map((c, j) => (
                  <li key={j}>
                    <Icon name="warn" size={14} color="var(--warn)" /> {c}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant blink">按模板规则改规格…</div>}
      </div>
    </section>
  );
}

function Preview({ view, onView, presets }: { view: BuilderView; onView: (v: BuilderView) => void; presets: Preset[] }) {
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const health = useApp((s) => s.health);
  const [draft, setDraft] = useState<TownSpec>(view.spec);
  const [seed, setSeed] = useState(42);
  const [provider, setProvider] = useState<'rule' | 'jev'>('rule');
  const [script, setScript] = useState<'outage' | 'quiet'>('outage');
  const [busy, setBusy] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setDraft(view.spec), [view.spec]);
  const apply = (s: TownSpec, source: 'form' | 'preset' = 'form') => {
    setDraft(s);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      async () => {
        try {
          const v = await api.setSpec(view.id, s, source);
          onView(v);
        } catch (e) {
          toast((e as Error).message, 'bad');
        }
      },
      source === 'preset' ? 0 : 450,
    );
  };
  const st = view.preview.stats;
  const launch = async () => {
    setBusy('run');
    try {
      const r = await api.launch(view.id, { seed, provider, script });
      await refreshRuns();
      await openRun(r.id);
      set({ workspace: 'observe' });
      toast(`已开始：${r.name}`, 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(undefined);
    }
  };
  const experiment = async () => {
    setBusy('exp');
    try {
      const r = await api.launch(view.id, { seed, provider: 'rule', script });
      const x = await api.startExperiment({ builderSession: view.id, seed, seedCount: 10, provider });
      await refreshRuns();
      await openRun(r.id);
      set({ workspace: 'review', reviewTab: 'compare', experimentId: x.id });
      toast('对照实验已开始：10 个随机种子 × 4 个分支', 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <section className="preview" data-testid="builder-preview">
      <div className="pv-main surface">
        <header className="preview-head">
          <input className="town-name serif" value={draft.name} maxLength={16} onChange={(e) => apply({ ...draft, name: e.target.value })} data-testid="town-name" aria-label="小镇名字" />
          <Badge color={draft.base === 'classic' ? 'var(--teal)' : 'var(--c-jev)'}>{draft.base === 'classic' ? '经典手工小镇' : `模板生成 · 种子 ${draft.seed}`}</Badge>
          {draft.base === 'generated' && (
            <Button size="sm" icon="refresh" onClick={() => apply({ ...draft, seed: draft.seed + 1 })} title="同样的参数，换一座镇" testId="reroll">
              换一座
            </Button>
          )}
          <span className="grow" />
          <select className="field-input preset" value="" onChange={(e) => e.target.value && apply(presets.find((p) => p.id === e.target.value)!.spec, 'preset')} data-testid="preset-select">
            <option value="">换模板…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </header>
        <div className="pv-map">
          <MiniMap preview={view.preview} />
        </div>
        <div className="town-stats" data-testid="town-stats">
          <div className="stat">
            <b className="num">{st.population}</b>
            <span>人 · {st.households} 户</span>
          </div>
          <div className="stat">
            <b className="num">{st.ages.senior}</b>
            <span>位 60 岁以上</span>
          </div>
          <div className="stat">
            <b className="num">{Math.round(st.push * 100)}%</b>
            <span>订推送</span>
          </div>
          <div className="stat">
            <b className="num">{st.trustGov}</b>
            <span>对官方的信任</span>
          </div>
        </div>
        <details className="spec-details">
          <summary>更多设置：人口、人群、媒介、关系、居民名单</summary>
          <dl className="kv town-facts">
            <dt>年龄</dt>
            <dd className="num">
              30 岁以下 {st.ages.youth} · 30 到 59 岁 {st.ages.adult} · 60 岁以上 {st.ages.senior}
            </dd>
            <dt>分区</dt>
            <dd className="num">
              北区 {st.districts.north} · 南区 {st.districts.south}
            </dd>
            <dt>媒介</dt>
            <dd className="num">
              订推送 {Math.round(st.push * 100)}% · 常看网站 {Math.round(st.website * 100)}% · 公告栏 {st.boards} 块
            </dd>
            <dt>关系</dt>
            <dd className="num">
              人均朋友 {st.friends} · 跨区 {st.crossDistrictFriends} 对 · 跨户亲属 {st.kinPairs} 对 · 焦虑 {st.anxiety}
            </dd>
            <dt>设施</dt>
            <dd>
              {Object.entries(st.places)
                .filter(([k]) => k !== 'residence')
                .map(([k, n]) => `${PLACE_KIND[k] ?? k}${n! > 1 ? `×${n}` : ''}`)
                .join('、')}
            </dd>
          </dl>
          <SpecForm spec={draft} onChange={apply} />
          <SecTitle extra={<span className="muted">{view.preview.people.length} 人</span>}>居民</SecTitle>
          <div className="people-strip" data-testid="people-strip">
            {view.preview.people.map((p) => (
              <div key={p.id} className="pp" title={`${p.name}，${p.age} 岁，${p.role}；${p.bio}`}>
                <Avatar look={p.look} size={26} />
                <span>{p.name}</span>
                <span className="muted ellipsis">{p.role}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
      <div className="pv-side surface">
        <div className="pv-side-head">
          <h2 className="serif">剧本</h2>
          <span className="muted">实验里会发生什么</span>
        </div>
        <div className="pv-side-body">
          <EventsEditor events={draft.events} onChange={(events) => apply({ ...draft, events })} />
        </div>
        <footer className="launch" data-testid="launch-bar">
          <details className="launch-more">
            <summary>运行设置：随机种子 {seed} · {provider === 'jev' ? 'Jev' : '规则'}决策</summary>
            <div className="launch-opts">
              <div className="field inline">
                <label>随机种子</label>
                <input className="field-input num" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} style={{ width: 90 }} data-testid="launch-seed" />
              </div>
              <Segmented
                value={provider}
                onChange={setProvider}
                testId="launch-provider"
                options={[
                  { value: 'rule', label: '规则决策' },
                  { value: 'jev', label: health?.models.access ? 'Jev 决策' : 'Jev（未配置）' },
                ]}
              />
              <Segmented
                value={script}
                onChange={setScript}
                options={[
                  { value: 'outage', label: '按剧本发通知' },
                  { value: 'quiet', label: '只停电不通知' },
                ]}
              />
            </div>
          </details>
          <div className="launch-row">
            <Button icon="fork" onClick={experiment} disabled={!!busy} title="10 个随机种子 × A/B/C/D 四种发布方式" testId="launch-experiment">
              {busy === 'exp' ? '启动中…' : '对照实验'}
            </Button>
            <Button variant="primary" icon="play" onClick={launch} disabled={!!busy || (provider === 'jev' && !health?.models.access)} testId="launch-run" style={{ flex: 1 }}>
              {busy === 'run' ? '建镇中…' : '开始观察'}
            </Button>
          </div>
        </footer>
      </div>
    </section>
  );
}

const PLACE_KIND: Record<string, string> = { gov: '政务中心', clinic: '诊所', library: '图书馆', utility: '维护站', newsroom: '报社', supermarket: '超市', cafe: '咖啡馆', restaurant: '餐馆', convenience: '便利店', studio: '工作室', plaza: '广场', park: '公园' };
