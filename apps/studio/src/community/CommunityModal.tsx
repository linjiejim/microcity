import { useEffect, useMemo, useState } from 'react';
import { generateCommunity, normalizeSpec, PRESETS, SPEC_LIMITS, TEMPLATE_LABEL, type CommunitySpec, type HouseholdType } from '@microcity/society';
import { buildFromText } from '../llm/builder.ts';
import { browserDeps } from '../llm/openrouter.ts';
import { headline, HOUSEHOLD_LABEL } from '../portrait/data.ts';
import { runtime } from '../runtime.ts';
import { worldLink } from '../share.ts';
import { set, useApp } from '../store.ts';
import { Button, Modal, SecTitle } from '../ui/kit.tsx';

const TEMPLATES = Object.keys(PRESETS) as CommunitySpec['template'][];
const HOUSEHOLDS = Object.keys(HOUSEHOLD_LABEL) as HouseholdType[];
const pct = (a: number, b: number): string => `${Math.round((100 * a) / Math.max(1, b))}%`;

function Slider({ label, value, min, max, step, show, onChange, testId }: { label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void; testId?: string }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testId} />
      <span className="num dim">{show}</span>
    </label>
  );
}

/**
 * 社区（M5）：四个配方任选；也可以拖参数自己配，旁边是“配方画像”；
 * 或者用一句话让语言模型给出补丁（只认白名单字段，D94）。
 */
export function CommunityModal() {
  const open = useApp((s) => s.communityOpen);
  const [spec, setSpec] = useState<CommunitySpec>(runtime.config.spec);
  const [seed, setSeed] = useState(runtime.config.seed);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSpec(runtime.config.spec);
    setSeed(runtime.config.seed);
    setNotes([]);
    setCopied(false);
  }, [open]);

  // 配方画像：按当前的参数真的生成一遍（十几毫秒），看到的就是会得到的
  const preview = useMemo(() => {
    try {
      const def = generateCommunity(spec);
      return { h: headline(def), firms: def.firms.length, ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [spec]);

  if (!open) return null;
  const change = (patch: Partial<CommunitySpec>) => {
    const { spec: next, adjustments } = normalizeSpec({ ...spec, ...patch });
    setSpec(next);
    setNotes(adjustments.map((a) => `${a.field}：${a.reason}，已改为 ${a.to}`));
  };
  const total = HOUSEHOLDS.reduce((a, k) => a + spec.households[k], 0) || 1;
  const same = JSON.stringify(spec) === JSON.stringify(runtime.config.spec) && seed === runtime.config.seed && runtime.config.interventions.length === 0;
  const enter = () => {
    runtime.boot({ spec, seed, interventions: [] });
    set({ communityOpen: false, view: 'world', playing: true });
  };
  const build = async () => {
    setBusy(true);
    const r = await buildFromText(browserDeps(), spec, ask);
    setBusy(false);
    if (!r.ok) return setNotes([r.reason]);
    setSpec(r.spec);
    setNotes(r.notes);
  };

  return (
    <Modal title="换一个社区" icon="home" onClose={() => set({ communityOpen: false })} width={860} testId="community">
      <div className="community">
        <div className="packs" data-testid="packs">
          {TEMPLATES.map((t) => (
            <button type="button" key={t} className={`pack${spec.template === t ? ' on' : ''}`} onClick={() => (setSpec(PRESETS[t]), setNotes([]))} data-testid={`pack-${t}`}>
              <b className="serif">{PRESETS[t].name}</b>
              <span className="dim small">{TEMPLATE_LABEL[t]}</span>
              <span className="pack-blurb">{PRESETS[t].blurb}</span>
            </button>
          ))}
        </div>

        <div className="composer">
          <div className="composer-left">
            <SecTitle icon="sliders">自己配</SecTitle>
            <Slider label="人口" value={spec.population} min={SPEC_LIMITS.population[0]} max={SPEC_LIMITS.population[1]} step={5} show={`${spec.population} 人`} onChange={(v) => change({ population: v })} testId="spec-population" />
            <Slider label="住楼房" value={spec.apartments} min={0} max={0.9} step={0.05} show={`${Math.round(spec.apartments * 100)}%`} onChange={(v) => change({ apartments: v })} testId="spec-apartments" />
            <Slider label="租房" value={spec.renters} min={0} max={0.9} step={0.05} show={`${Math.round(spec.renters * 100)}%`} onChange={(v) => change({ renters: v })} />
            <Slider label="去城里上班" value={spec.cityShare} min={0} max={0.85} step={0.05} show={`${Math.round(spec.cityShare * 100)}%`} onChange={(v) => change({ cityShare: v })} testId="spec-city" />
            <Slider label="收入水平" value={spec.wealth} min={SPEC_LIMITS.wealth[0]} max={SPEC_LIMITS.wealth[1]} step={0.05} show={`× ${spec.wealth.toFixed(2)}`} onChange={(v) => change({ wealth: v })} />
            <details>
              <summary>家庭构成</summary>
              {HOUSEHOLDS.map((k) => (
                <Slider key={k} label={HOUSEHOLD_LABEL[k]} value={spec.households[k]} min={0} max={0.5} step={0.01} show={pct(spec.households[k], total)} onChange={(v) => change({ households: { ...spec.households, [k]: v } })} />
              ))}
            </details>
            <label className="slider">
              <span>种子</span>
              <input className="input num" type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, Math.round(Number(e.target.value) || 1)))} data-testid="spec-seed" />
              <span className="dim small">同样的社区，换一种过法</span>
            </label>
          </div>

          <div className="composer-right">
            <SecTitle icon="person">配出来是这样</SecTitle>
            {preview.ok ? (
              <div className="recipe" data-testid="recipe">
                <div>
                  <b className="num serif">{preview.h.people}</b> 人，<b className="num serif">{preview.h.households}</b> 户
                </div>
                <div>平均 {preview.h.avgAge.toFixed(0)} 岁；60 岁以上占 {pct(preview.h.elders, preview.h.people)}，孩子占 {pct(preview.h.children, preview.h.people)}</div>
                <div>
                  {preview.h.localJobs} 人在本地上班，{preview.h.cityJobs} 人去城里
                </div>
                <div>
                  {pct(preview.h.renters, preview.h.households)} 的家庭租房；{preview.firms} 家店与单位
                </div>
              </div>
            ) : (
              <div className="note">这组参数配不出来：{preview.error}</div>
            )}

            <SecTitle icon="sparkle">或者说一句话</SecTitle>
            <textarea className="input area" rows={2} placeholder="例如：一个年轻人很多、大多租房、白天都去城里上班的新小区" value={ask} onChange={(e) => setAsk(e.target.value)} data-testid="builder-input" />
            <div className="row">
              <Button size="sm" icon="sparkle" disabled={busy || ask.trim().length < 4} onClick={() => void build()} testId="builder-run">
                {busy ? '在想…' : '让语言模型来配'}
              </Button>
              <span className="dim small">需要在“模型与用量”里填密钥。模型只能改上面这些参数。</span>
            </div>
            {notes.length > 0 && (
              <ul className="notes" data-testid="builder-notes">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="row">
          <Button variant="primary" icon="play" disabled={!preview.ok || same} onClick={enter} testId="community-enter">
            {same ? '现在看的就是它' : `进入${spec.name}`}
          </Button>
          <span className="grow" />
          <Button
            size="sm"
            variant="ghost"
            icon="link"
            testId="community-share"
            onClick={() => {
              void navigator.clipboard?.writeText(worldLink(location.origin + location.pathname, { spec, seed, interventions: [] }));
              setCopied(true);
            }}
          >
            {copied ? '链接已复制' : '复制这个社区的链接'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
