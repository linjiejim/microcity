import { useEffect, useState } from 'react';
import { api, type GalleryCard } from '../lib/api.ts';
import { openRun, useApp } from '../store.ts';
import { Badge, Button, Empty } from '../ui/kit.tsx';
import { Figure } from './Figure.tsx';

const VERDICT_COLOR: Record<string, string> = { 支持: 'var(--ok)', 部分支持: 'var(--warn)', 不支持: 'var(--bad)' };

/**
 * 实验广场（v4）：每张卡片是一个经典的社会学说法。先猜（按钮是中性的，示意图只画骨架），
 * 猜完才揭晓小镇的答案、两种心智的判定，以及“在这里重跑”“复制并修改”。
 */
export function GalleryView() {
  const [cards, setCards] = useState<GalleryCard[]>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    api.gallery().then(setCards, (e: Error) => setErr(e.message));
  }, []);
  return (
    <div className="gallery" data-testid="gallery">
      <header className="gallery-head">
        <h1 className="serif">实验广场</h1>
        <p>先猜，再看小镇的答案。每张卡片是一个经典的社会学说法，放进一座 60 人的小镇里检验；同一个实验用“规则”和“Jev”两种心智各跑一遍，两边都成立的才算结论。</p>
      </header>
      {err && <Empty icon="warn">读不到实验广场：{err}</Empty>}
      {!cards && !err && <Empty icon="clock">载入实验广场…</Empty>}
      {cards && cards.length === 0 && <Empty icon="dice">还没有精选实验。</Empty>}
      <div className="gallery-grid">
        {cards?.map((c) => (
          <Card key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}

function Card({ c }: { c: GalleryCard }) {
  const key = `microcity.guess.${c.id}@${c.version}`;
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [guess, setGuess] = useState<number | null>(() => {
    const v = localStorage.getItem(key);
    return v === null ? null : Number(v);
  });
  const [exp, setExp] = useState(c.experiment);
  const [busy, setBusy] = useState(false);

  // 在跑的时候轮询
  useEffect(() => {
    if (!exp || exp.status !== 'running') return;
    const t = setInterval(() => {
      api.experiment(exp.id).then(
        (x) => x.status !== 'running' && setExp({ id: x.id, status: x.status }),
        () => {},
      );
    }, 1500);
    return () => clearInterval(t);
  }, [exp?.id, exp?.status]);

  const pick = (i: number) => {
    setGuess(i);
    localStorage.setItem(key, String(i));
  };
  const run = async () => {
    setBusy(true);
    try {
      setExp(await api.runGallery(c.id));
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const open = async () => {
    const x = await api.experiment(exp!.id);
    const first = x.result && Object.values(x.result.branches)[0];
    if (first?.runId) await openRun(first.runId);
    set({ workspace: 'review', reviewTab: 'compare', experimentId: x.id });
  };
  const copy = () =>
    set({
      modal: {
        kind: 'manifest',
        scenario: c.scenario,
        title: `复制并修改：${c.title}`,
        manifest: { name: `${c.title.slice(0, 30)}（我的版本）`, question: c.question, seeds: c.seeds.slice(0, 5), provider: 'rule', branches: c.branches, ...(c.predictions ? { predictions: c.predictions } : {}) },
      },
    });
  const revealed = guess !== null;
  const right = guess === c.guess.answer;

  return (
    <article className={`g-card surface ${revealed ? 'revealed' : ''}`} data-testid={`gallery-${c.id}`}>
      {c.figure && <Figure f={c.figure} revealed={revealed} />}
      <div className="g-body">
        <h2 className="g-title serif">{c.title}</h2>
        <div className="g-classic">{c.classic}</div>
        <p className="g-q">{c.question}</p>
        <div className="g-guess">
          <div className="g-prompt">{c.guess.prompt}</div>
          <div className="g-pills">
            {c.guess.options.map((o, i) => {
              const cls = !revealed ? '' : i === c.guess.answer ? 'right' : i === guess ? 'wrong' : 'dim';
              return (
                <button key={o} className={`g-pill ${cls} ${guess === i ? 'chosen' : ''}`} onClick={() => !revealed && pick(i)} disabled={revealed && guess !== i && i !== c.guess.answer} data-testid={`guess-${c.id}-${i}`}>
                  {o}
                </button>
              );
            })}
          </div>
          {!revealed && (
            <button className="linkbtn g-skip" onClick={() => pick(-1)} data-testid={`reveal-${c.id}`}>
              不猜，直接看
            </button>
          )}
        </div>
        {revealed && (
          <div className={`g-answer ${guess >= 0 ? (right ? 'ok' : 'miss') : ''}`} data-testid={`answer-${c.id}`}>
            {guess >= 0 && <b>{right ? '猜对了。' : '没猜中。'}</b>}
            小镇的答案是「{c.guess.options[c.guess.answer]}」。{c.guess.explain}
          </div>
        )}
        {revealed && (
          <ul className="g-findings">
            {c.findings.map((f) => (
              <li key={f.text}>
                <span>{f.text}</span>
                <span className="g-chips">
                  {f.rule && (
                    <Badge color={VERDICT_COLOR[f.rule] ?? 'var(--ink-2)'} title="规则心智下的判定（3 座镇 × 20 seed）">
                      规则 {f.rule}
                    </Badge>
                  )}
                  {f.jev && (
                    <Badge color={VERDICT_COLOR[f.jev] ?? 'var(--ink-2)'} title="Jev 心智下的判定（10 seed）">
                      Jev {f.jev}
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="g-foot">
        <span className="muted">
          {c.town.population} 人 · {Object.keys(c.branches).length} 个分支 · {c.seeds.length} 个 seed
        </span>
        <span className="grow" />
        {revealed &&
          (exp?.status === 'done' ? (
            <Button size="sm" variant="primary" icon="eye" onClick={open} testId={`gallery-open-${c.id}`}>
              看重跑的结果
            </Button>
          ) : exp?.status === 'running' ? (
            <Button size="sm" icon="clock" disabled testId={`gallery-running-${c.id}`}>
              正在跑…
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon="play" onClick={run} disabled={busy} testId={`gallery-run-${c.id}`}>
              在这里重跑
            </Button>
          ))}
        {revealed && (
          <Button size="sm" icon="fork" onClick={copy} testId={`gallery-copy-${c.id}`}>
            复制并修改
          </Button>
        )}
      </footer>
    </article>
  );
}
