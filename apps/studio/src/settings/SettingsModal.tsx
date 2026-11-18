import { useEffect, useState } from 'react';
import { browserDeps, keyInfo, listModels, type KeyInfo } from '../llm/openrouter.ts';
import { clearLedger, DEFAULT_PREFS, loadLedger, loadPrefs, looksLikeKey, maskKey, MODEL_PRESETS, savePrefs, type Ledger, type LlmPrefs } from '../llm/prefs.ts';
import { set, useApp } from '../store.ts';
import { Badge, Button, Modal, SecTitle } from '../ui/kit.tsx';

const usd = (x: number): string => `$${x.toFixed(x < 0.01 && x > 0 ? 5 : 3)}`;

/** 设置：自己的 OpenRouter 密钥、两个模型、本机与账户的用量（D71–D73） */
export function SettingsModal() {
  const open = useApp((s) => s.settingsOpen);
  const [prefs, setPrefs] = useState<LlmPrefs>(DEFAULT_PREFS);
  const [ledger, setLedger] = useState<Ledger>(() => loadLedger(window.localStorage));
  const [info, setInfo] = useState<{ ok: true; info: KeyInfo } | { ok: false; detail: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!open) return;
    const p = loadPrefs(window.localStorage);
    setPrefs(p);
    setLedger(loadLedger(window.localStorage));
    setEditing(!p.key);
    setInfo(null);
  }, [open]);

  if (!open) return null;
  const update = (patch: Partial<LlmPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(window.localStorage, next);
  };
  const check = async () => {
    setChecking(true);
    setInfo(await keyInfo(browserDeps(), prefs.key));
    setChecking(false);
  };
  const keyOk = looksLikeKey(prefs.key);
  const over = ledger.costUsd >= prefs.budgetUsd;

  return (
    <Modal title="模型与用量" icon="sliders" onClose={() => set({ settingsOpen: false })} width={640} testId="settings">
      <div className="settings">
        <p className="dim">不填密钥，一切照常：居民按规则过日子，回放与人物卡都不需要模型。填了密钥，才可以让语言模型替居民说一句心里话。</p>

        <SecTitle icon="link">OpenRouter 密钥</SecTitle>
        {editing ? (
          <div className="row">
            <input className="input grow" type="password" autoComplete="off" spellCheck={false} placeholder="sk-or-…" value={prefs.key} onChange={(e) => update({ key: e.target.value.trim() })} data-testid="key-input" />
            <Button onClick={() => setEditing(false)} disabled={!keyOk} testId="key-save">
              好了
            </Button>
          </div>
        ) : (
          <div className="row">
            <code className="grow" data-testid="key-mask">
              {maskKey(prefs.key)}
            </code>
            <Button size="sm" onClick={() => setEditing(true)} testId="key-edit">
              更换
            </Button>
            <Button size="sm" variant="danger" onClick={() => (update({ key: '' }), setEditing(true), setInfo(null))} testId="key-clear">
              清除
            </Button>
          </div>
        )}
        <p className="dim small">密钥只保存在这台电脑的浏览器里，只会发给 openrouter.ai。任何能打开这个浏览器的人都能用它，建议在 OpenRouter 那边给这把密钥设一个额度上限。</p>
        {prefs.key && !keyOk && <p className="note">这不像 OpenRouter 的密钥（应以 sk-or- 开头）。</p>}

        <SecTitle icon="cube">模型</SecTitle>
        <div className="grid2">
          <label>
            <span>语言模型</span>
            <input className="input" list="or-models" value={prefs.languageModel} onChange={(e) => update({ languageModel: e.target.value.trim() })} data-testid="model-language" />
            <span className="dim small">只负责表达：把事实改写成居民的心里话。</span>
          </label>
          <label>
            <span>决策模型</span>
            <input className="input" list="or-models" value={prefs.decisionModel} onChange={(e) => update({ decisionModel: e.target.value.trim() })} data-testid="model-decision" />
            <span className="dim small">只回答语义判断，不生成文字。先在这里选好，接进居民的选择要等实验台（M4）。</span>
          </label>
        </div>
        <datalist id="or-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <div className="row">
          <Button size="sm" onClick={() => update({ languageModel: MODEL_PRESETS.language, decisionModel: MODEL_PRESETS.decision })} testId="model-reset">
            恢复预设
          </Button>
          <Button size="sm" onClick={() => void listModels(browserDeps()).then(setModels)} testId="model-list">
            {models.length ? `已载入 ${models.length} 个模型` : '从 OpenRouter 载入模型列表'}
          </Button>
        </div>

        <SecTitle icon="coin">用量</SecTitle>
        <div className="grid2">
          <div className="well stat" data-testid="usage-local">
            <span className="dim">本机累计</span>
            <b className="num">{usd(ledger.costUsd)}</b>
            <span className="dim small">
              调用 {ledger.calls} 次，读缓存 {ledger.cacheHits} 次，{(ledger.promptTokens + ledger.completionTokens).toLocaleString('zh-CN')} token
            </span>
            {over && <Badge color="var(--bad)">已到预算，不再调用</Badge>}
          </div>
          <div className="well stat" data-testid="usage-account">
            <span className="dim">账户侧（这把密钥）</span>
            {info?.ok ? (
              <>
                <b className="num">{usd(info.info.usage)}</b>
                <span className="dim small">{info.info.limit === null ? '没有设额度上限' : `额度 ${usd(info.info.limit)}，还剩 ${usd(info.info.remaining ?? 0)}`}</span>
              </>
            ) : (
              <span className="dim small">{info ? info.detail : '点“查询”向 OpenRouter 问这把密钥的用量与额度。'}</span>
            )}
            <Button size="sm" disabled={!keyOk || checking} onClick={() => void check()} testId="usage-check">
              {checking ? '在查…' : '查询'}
            </Button>
          </div>
        </div>
        <div className="row">
          <label className="row">
            <span>本机预算（美元）</span>
            <input className="input num" style={{ width: 90 }} type="number" min={0} step={0.1} value={prefs.budgetUsd} onChange={(e) => update({ budgetUsd: Math.max(0, Number(e.target.value) || 0) })} data-testid="budget" />
          </label>
          <span className="dim small grow">本机累计花费到了这个数，就不再调用模型。</span>
          <Button size="sm" variant="ghost" onClick={() => (clearLedger(window.localStorage), setLedger(loadLedger(window.localStorage)))} testId="usage-reset">
            清零本机记录
          </Button>
        </div>
        {ledger.recent.length > 0 && (
          <table className="calls">
            <tbody>
              {ledger.recent.slice(0, 6).map((c, i) => (
                <tr key={i}>
                  <td className="dim num">{c.at.slice(5, 16).replace('T', ' ')}</td>
                  <td>{c.purpose}</td>
                  <td className="dim">{c.model}</td>
                  <td className="num">{c.cached ? '缓存' : usd(c.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
