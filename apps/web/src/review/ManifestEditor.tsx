import { useRef, useState } from 'react';
import type { ExperimentManifest } from '@microcity/sim';
import { api } from '../lib/api.ts';
import { useApp } from '../store.ts';
import { Button, Modal } from '../ui/kit.tsx';

/** 分享用的实验清单只留人写的部分：分叉点、终点由服务端按剧本算 */
export function shareable(m: Partial<ExperimentManifest>): Partial<ExperimentManifest> {
  const { id: _id, forkAt: _f, until: _u, ...rest } = m;
  return rest;
}

/**
 * 实验清单（JSON）：一个文件就是一个实验——问题、分支（改通知 / 换参数 / 换镇）、随机种子、事先写下的预测。
 * 可以复制别人的实验改一改、导入文件、导出文件；“校验并开始”交给服务端逐项校验。
 */
export function ManifestEditor({ scenario, manifest, title }: { scenario: string; manifest: Partial<ExperimentManifest>; title?: string }) {
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const health = useApp((s) => s.health);
  const [text, setText] = useState(() => JSON.stringify(shareable(manifest), null, 2));
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const close = () => set({ modal: null });

  const parse = (): Partial<ExperimentManifest> | undefined => {
    try {
      return JSON.parse(text) as Partial<ExperimentManifest>;
    } catch (e) {
      setErr(`JSON 格式不对：${(e as Error).message}`);
      return undefined;
    }
  };
  const start = async () => {
    const m = parse();
    if (!m) return;
    setBusy(true);
    setErr(undefined);
    try {
      const r = await api.startExperiment({ scenario: m.scenario ?? scenario, manifest: m });
      toast('实验开始了：跑完后在“对照”里看结果与预测的判定', 'ok');
      set({ modal: null, experimentId: r.id, workspace: 'review', reviewTab: 'compare' });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    const m = parse();
    if (!m) return;
    const blob = new Blob([JSON.stringify({ ...m, scenario: m.scenario ?? scenario }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(m.name ?? 'experiment').replace(/[\\/:*?"<>|\s]+/g, '-')}.microcity.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const load = async (f: File) => {
    try {
      const m = JSON.parse(await f.text()) as Partial<ExperimentManifest>;
      setText(JSON.stringify(shareable(m), null, 2));
      setErr(undefined);
    } catch (e) {
      setErr(`读不了这个文件：${(e as Error).message}`);
    }
  };

  return (
    <Modal
      title={title ?? '实验清单'}
      icon="list"
      onClose={close}
      width={820}
      testId="manifest-editor"
      footer={
        <>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
          <Button icon="plus" onClick={() => file.current?.click()} testId="manifest-import">
            导入文件
          </Button>
          <Button icon="down" onClick={download} testId="manifest-export">
            导出文件
          </Button>
          <span className="grow" />
          <Button onClick={close}>取消</Button>
          <Button variant="primary" icon="fork" onClick={start} disabled={busy} testId="manifest-start">
            {busy ? '校验中…' : '校验并开始'}
          </Button>
        </>
      }
    >
      <p className="dim" style={{ marginTop: 0 }}>
        一个实验就是一个文件：问题、分支、随机种子、先写下的预测。改好后点“校验并开始”，服务端会逐项校验并告诉你哪里不对。
        {health?.public && ` 演示站只开放规则模式，每个实验最多 ${health.public.limits.maxSeeds} 个随机种子。`}
      </p>
      <textarea className="field-input manifest-json" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} data-testid="manifest-json" />
      {err && (
        <div className="err" data-testid="manifest-error">
          {err}
        </div>
      )}
      <details className="manifest-help">
        <summary>字段说明</summary>
        <ul>
          <li>
            <b>branches</b>：每个分支一个大写字母。<code>patches</code> 改某一轮事件：<code>channels</code>（website / push / board）、<code>headline</code>（exact / coarse / none）、<code>silent</code>（不发通知）、<code>clarify</code>
            （澄清时间与渠道）、<code>mode</code>（false_alarm 虚惊 / absent 不存在）；<code>town</code> 换一座镇（culture / media / network / population 的部分字段）；<code>params</code> 换心智参数。
          </li>
          <li>
            <b>predictions</b>：先猜再跑。<code>metric</code> 是指标键，如 <code>E1.t50</code>（半数相信用时）、<code>E1.surprisedPeople</code>、<code>E1.overreactMin</code>、<code>E1.gapT50</code>（老人比青年晚多久过半）、
            <code>trustAt.E3.govMean</code>；<code>a</code>、<code>b</code> 是两个分支，<code>expect</code> 是 higher / lower / same。跑完后逐 seed 配对判定：方向在 ≥ 70% 的配对里成立为“支持”。
          </li>
          <li>
            <b>seeds</b>：随机种子。结论要看分布，建议至少 5 个。
          </li>
        </ul>
      </details>
    </Modal>
  );
}
