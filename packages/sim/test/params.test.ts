import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  Engine,
  PARAM_KNOBS,
  PARAM_PRESETS,
  TRUST_RULES,
  applyTownPatch,
  branchParams,
  classicSpec,
  contentHash,
  describeBranch,
  generatedDefaults,
  normalizeSpec,
  paramAt,
  parseTime,
  patchAt,
  resolveParams,
  scenarioFromSpec,
  town30,
  trustSummary,
} from '../src/index.ts';

const runTo = (opts: { seed: number; params?: Parameters<typeof resolveParams>[0] }, until: string) => {
  const e = Engine.create(town30(), { seed: opts.seed, decisionMode: 'rule', ...(opts.params ? { params: opts.params } : {}) });
  e.advance(parseTime(until));
  return e;
};

describe('规则参数（params_v2）', () => {
  it('空覆盖与不传完全等价；v1 预设只换回校准过的几组', () => {
    expect(resolveParams()).toBe(DEFAULT_PARAMS);
    expect(resolveParams({})).toBe(DEFAULT_PARAMS);
    expect(TRUST_RULES.surprisedUninformed).toBe(DEFAULT_PARAMS.trust.surprisedUninformed);
    const v1 = resolveParams(PARAM_PRESETS.v1);
    expect(v1.trust.surprisedUninformed).toBe(-0.12);
    expect(v1.semantics.moveBase).toBe(0.3);
    expect(v1.memory.concern.surprised_uninformed).toBe(0);
    expect(v1.mention).toEqual(DEFAULT_PARAMS.mention);
    const a = runTo({ seed: 11 }, 'D04 18:00');
    const b = runTo({ seed: 11, params: {} }, 'D04 18:00');
    expect(contentHash(b.state)).toBe(contentHash(a.state));
    expect(b.snapshot().params).toBeUndefined();
  });

  it('未知键、非数值都拒绝；按路径读写', () => {
    expect(() => resolveParams({ mention: { nope: 1 } } as never)).toThrow('mention.nope');
    expect(() => resolveParams({ trust: { scale: Number.NaN } })).toThrow('trust.scale');
    const p = patchAt('attention.salience.push', 0.9);
    expect(paramAt(resolveParams(p), 'attention.salience.push')).toBe(0.9);
    expect(paramAt(resolveParams(p), 'attention.salience.website')).toBe(0.5);
    for (const k of PARAM_KNOBS) {
      const d = paramAt(DEFAULT_PARAMS, k.path);
      expect(k.lo).toBeLessThan(d);
      expect(k.hi).toBeGreaterThan(d);
    }
  });

  it('覆盖会改变结果，并随快照保存、恢复后继续生效', () => {
    const quiet = runTo({ seed: 11, params: { mention: { intercept: -6 } } }, 'D04 12:00');
    const base = runTo({ seed: 11 }, 'D04 12:00');
    const relays = (e: Engine) => Object.values(e.state.versions).filter((v) => v.origin.kind === 'relay').length;
    expect(relays(quiet)).toBeLessThan(relays(base));
    const snap = quiet.snapshot();
    expect(snap.params).toEqual({ mention: { intercept: -6 } });
    const r = Engine.restore(snap, town30());
    expect(r.P.mention.intercept).toBe(-6);
  });

  it('信任幅度 × scale：幅度放大，每个人信任的变化随之放大', () => {
    const moved = (e: Engine) => Object.values(e.state.agents).reduce((n, a) => n + Math.abs(a.trustGov - a.traits.trustOfficial), 0);
    const e1 = runTo({ seed: 5 }, 'D04 20:00');
    const e3 = runTo({ seed: 5, params: { trust: { scale: 3 } } }, 'D04 20:00');
    expect(moved(e1)).toBeGreaterThan(0);
    expect(moved(e3)).toBeGreaterThan(moved(e1) * 2);
    expect(trustSummary(e3.state).govUp + trustSummary(e3.state).govDown).toBeGreaterThan(0);
  });
});

describe('实验分支：参数与换镇', () => {
  it('实验级覆盖与分支覆盖合并，分支优先；描述写出改了什么', () => {
    const m = { params: { trust: { scale: 2 }, mention: { intercept: -3 } } };
    const p = branchParams(m, { label: 'x', params: { trust: { scale: 3 } } })!;
    expect(p).toEqual({ trust: { scale: 3 }, mention: { intercept: -3 } });
    expect(branchParams({}, { label: 'x' })).toBeUndefined();
    expect(describeBranch({ label: 'x', params: { trust: { scale: 3 } }, town: { culture: { trustGov: 0.3 } } })).toEqual(['对官方的信任 0.3', 'trust.scale = 3']);
  });

  it('换镇补丁：经典底座只接受修饰；生成底座可以改关系网；剧本不变', () => {
    const classic = normalizeSpec(classicSpec()).spec;
    const low = applyTownPatch(classic, { culture: { trustGov: 0.3 } });
    expect(low.base).toBe('classic');
    const sc = scenarioFromSpec(normalizeSpec(low).spec);
    expect(sc.people.every((p, i) => p.traits.trustOfficial <= town30().people[i]!.traits.trustOfficial)).toBe(true);
    expect(sc.outages.map((o) => o.id)).toEqual(town30().outages.map((o) => o.id));
    expect(() => applyTownPatch(classic, { network: { crossDistrict: 0.6 } })).toThrow('经典小镇');
    const gen = generatedDefaults();
    const wide = scenarioFromSpec(normalizeSpec(applyTownPatch(gen, { network: { crossDistrict: 0.6 } })).spec);
    const narrow = scenarioFromSpec(normalizeSpec(applyTownPatch(gen, { network: { crossDistrict: 0.05 } })).spec);
    const home = (sc: typeof wide) => new Map(sc.people.map((p) => [p.id, sc.households.find((h) => h.id === p.household)!.place]));
    const cross = (sc: typeof wide) => {
      const h = home(sc);
      const d = new Map(sc.map.places.map((p) => [p.id, p.district]));
      return sc.relations.filter((r) => r.kind === 'friend' && d.get(h.get(r.a)!) !== d.get(h.get(r.b)!)).length;
    };
    expect(cross(wide)).toBeGreaterThan(cross(narrow));
  });
});
