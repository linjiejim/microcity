import { useEffect, useMemo, useState } from 'react';
import { api, type ReportView } from '../lib/api.ts';
import { useApp, viewState } from '../store.ts';
import { Avatar, Badge, Button, Empty, Icon, SecTitle, Segmented } from '../ui/kit.tsx';

/** 实验报告：服务端先算事实表，再由 DeepSeek 只复述事实写成报告（校验不过就用模板） */
export function ReportPanel() {
  const runId = useApp((s) => s.runId);
  const expId = useApp((s) => s.experimentId);
  const health = useApp((s) => s.health);
  const toast = useApp((s) => s.toast);
  const [subject, setSubject] = useState<'run' | 'exp'>(expId ? 'exp' : 'run');
  const [rep, setRep] = useState<ReportView | null>();
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const target = subject === 'exp' && expId ? expId : runId;
  useEffect(() => {
    if (!target) return;
    let alive = true;
    setRep(undefined);
    (subject === 'exp' ? api.expReport(target) : api.report(target))
      .then((r) => alive && setRep(r ?? null))
      .catch(() => alive && setRep(null));
    return () => {
      alive = false;
    };
  }, [target, subject]);
  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const h = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(h);
  }, [busy]);
  const make = async (force: boolean) => {
    if (!target) return;
    setBusy(true);
    setElapsed(0);
    try {
      const r = subject === 'exp' ? await api.makeExpReport(target, force) : await api.makeReport(target, force);
      setRep(r);
      toast(r.source === 'model' ? `报告已生成（${r.model}，$${r.cost.toFixed(4)}）` : '已生成模板报告', 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="report-wrap" data-testid="report">
      <div className="report-bar">
        <Segmented
          value={subject}
          onChange={setSubject}
          testId="report-subject"
          options={[
            { value: 'run', label: '这次运行' },
            { value: 'exp', label: expId ? '当前对照实验' : '对照实验（先在“对照”里选一个）' },
          ]}
        />
        <span className="grow" />
        {rep && (
          <>
            <Button icon="refresh" onClick={() => make(true)} disabled={busy} testId="report-regen">
              重新生成
            </Button>
            <Button icon="list" onClick={() => copyMarkdown(rep, toast)} testId="report-copy">
              复制 Markdown
            </Button>
          </>
        )}
      </div>
      {busy && (
        <div className="writing" data-testid="report-busy">
          <Icon name="book" color="var(--accent)" size={24} />
          <div>
            <div className="blink">{health?.models.access ? `DeepSeek 正在按事实表写报告… ${elapsed}s` : `整理事实表… ${elapsed}s`}</div>
            <div className="muted">先从事件日志算出事实表（每条带编号），模型只能复述其中的数字、时刻和人名，校验不过就重写一次，再不过用模板。</div>
          </div>
        </div>
      )}
      {!busy && rep === undefined && <Empty>载入中…</Empty>}
      {!busy && rep === null && (
        <div className="report-empty">
          <Empty icon="book">
            {subject === 'exp' && !expId ? '先在“对照”里选一个实验。' : '还没有报告。'}
            <br />
            报告会回答：消息怎么传开的、每个人怎么反应、信任与关系怎么变、不同条件下有什么差别。
          </Empty>
          {(subject === 'run' || expId) && (
            <Button variant="primary" icon="book" onClick={() => make(false)} testId="report-make">
              生成{subject === 'exp' ? '实验' : '运行'}报告
            </Button>
          )}
          <div className="muted" style={{ textAlign: 'center' }}>
            {health?.models.access ? '由 DeepSeek Flash 撰写（约 20–30 秒，约 $0.0005）' : '未配置模型：会生成模板报告（直接复述事实表）'}
          </div>
        </div>
      )}
      {!busy && rep && <ReportBody r={rep} />}
    </div>
  );
}

function ReportBody({ r }: { r: ReportView }) {
  const s = useApp((st) => viewState(st));
  const set = useApp((st) => st.set);
  const [open, setOpen] = useState<string>();
  const facts = useMemo(() => new Map(r.facts.groups.flatMap((g) => g.facts.map((f) => [f.id, f.text] as const))), [r]);
  const cite = (ids: string[]) => (
    <span className="cites">
      {ids.map((c) => (
        <button key={c} className={`cite ${open === c ? 'on' : ''}`} title={facts.get(c)} onClick={() => setOpen(open === c ? undefined : c)}>
          {c}
        </button>
      ))}
    </span>
  );
  const byName = (name: string) => (s ? Object.values(s.agents).find((a) => a.name === name) : undefined);
  return (
    <article className="report" data-testid="report-body">
      <header className="report-head">
        <div className="t-2x" style={{ color: 'var(--fg-0)' }}>
          {r.report.title}
        </div>
        <div className="wrap-row">
          <Badge color={r.source === 'model' ? 'var(--e-cyan)' : 'var(--fg-2)'} icon={r.source === 'model' ? 'bulb' : 'list'}>
            {r.source === 'model' ? `模型撰写 · ${r.model}` : '模板报告（复述事实表）'}
          </Badge>
          {r.validation && (
            <Badge color={r.validation.ok ? 'var(--ok)' : 'var(--warn)'} icon={r.validation.ok ? 'check' : 'warn'}>
              {r.validation.ok ? `通过校验（第 ${r.validation.attempts} 次）：数字、时刻、人名都出自事实表` : `模型输出没通过校验，已用模板`}
            </Badge>
          )}
          <span className="muted">
            {r.facts.subject.name} · 截至 {r.facts.subject.at} · {new Date(r.createdAt).toLocaleString('zh-CN')}
            {r.cost > 0 ? ` · $${r.cost.toFixed(4)}` : ''}
          </span>
        </div>
        {r.validation && !r.validation.ok && r.validation.problems.length > 0 && <div className="muted">未通过的原因：{r.validation.problems.slice(0, 4).join('；')}</div>}
      </header>
      <p className="report-summary">{r.report.summary}</p>
      {open && (
        <div className="fact-pop well" data-testid="fact-pop">
          <b>{open}</b> {facts.get(open)}
        </div>
      )}
      <SecTitle icon="bulb">发现</SecTitle>
      <ol className="findings">
        {r.report.findings.map((f, i) => (
          <li key={i}>
            {f.text} {cite(f.cites)}
          </li>
        ))}
      </ol>
      {r.report.stories.length > 0 && (
        <>
          <SecTitle icon="person">个体故事</SecTitle>
          <div className="stories">
            {r.report.stories.map((x, i) => {
              const a = byName(x.person);
              return (
                <div key={i} className="story">
                  {a && <Avatar look={a.look} size={36} />}
                  <div>
                    <div className="row-title">
                      {x.person}
                      {a && (
                        <button className="linkbtn" style={{ marginLeft: 8 }} onClick={() => set({ trajectory: a.id })}>
                          看轨迹
                        </button>
                      )}
                    </div>
                    <div>
                      {x.text} {cite(x.cites)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <SecTitle icon="link">社会形态的变化</SecTitle>
      <p>
        {r.report.socialChange.text} {cite(r.report.socialChange.cites)}
      </p>
      <SecTitle icon="warn">边界</SecTitle>
      <ul className="plain muted">
        {r.report.caveats.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      <details className="facts">
        <summary>事实表（{facts.size} 条，报告只能引用这些）</summary>
        {r.facts.groups.map((g) => (
          <div key={g.key + g.title}>
            <div className="sec-title">{g.title}</div>
            <ul className="plain">
              {g.facts.map((f) => (
                <li key={f.id} className={open === f.id ? 'hl' : ''}>
                  <b className="num">{f.id}</b> {f.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </article>
  );
}

function copyMarkdown(r: ReportView, toast: (t: string, tone?: 'info' | 'ok' | 'bad') => void) {
  const lines = [
    `# ${r.report.title}`,
    '',
    r.report.summary,
    '',
    '## 发现',
    ...r.report.findings.map((f) => `- ${f.text}（${f.cites.join('、')}）`),
    '',
    ...(r.report.stories.length ? ['## 个体故事', ...r.report.stories.map((x) => `- **${x.person}**：${x.text}（${x.cites.join('、')}）`), ''] : []),
    '## 社会形态的变化',
    r.report.socialChange.text,
    '',
    '## 边界',
    ...r.report.caveats.map((c) => `- ${c}`),
    '',
    '## 事实表',
    ...r.facts.groups.flatMap((g) => [`### ${g.title}`, ...g.facts.map((f) => `- ${f.id} ${f.text}`)]),
  ];
  void navigator.clipboard?.writeText(lines.join('\n')).then(
    () => toast('已复制 Markdown', 'ok'),
    () => toast('复制失败（浏览器不允许）', 'bad'),
  );
}
