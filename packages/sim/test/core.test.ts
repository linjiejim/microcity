import { describe, expect, it } from 'vitest';
import { at, canonical, contentHash, formatTime, parseTime, rand, town30, buildMap, makeVersion, transmitSlots, mergeBelief, comprehend, describeSlots, versionIdFor, type Slots, type Traits } from '@microcity/sim';

const traits = (over: Partial<Traits> = {}): Traits => ({ anxiety: 0.3, riskAversion: 0.5, sociability: 0.5, order: 0.5, curiosity: 0.5, altruism: 0.5, commitment: 0.5, trustOfficial: 0.6, detail: 0.6, ...over });

describe('时间与随机数', () => {
  it('解析与格式化互逆', () => {
    expect(formatTime(parseTime('D03 08:05'))).toBe('D03 08:05');
    expect(parseTime('D01 00:00')).toBe(0);
    expect(at(4, 14)).toBe(3 * 86400 + 14 * 3600);
  });
  it('计数器式随机数：同键同值，与调用顺序无关', () => {
    const a = rand(42, 'x', 1);
    rand(42, 'noise');
    expect(rand(42, 'x', 1)).toBe(a);
    expect(rand(43, 'x', 1)).not.toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
  it('规范化 JSON 与键顺序无关', () => {
    expect(canonical({ b: 1, a: { d: 2, c: undefined } })).toBe(canonical({ a: { d: 2 }, b: 1 }));
    expect(contentHash({ a: 1 })).toBe(contentHash({ a: 1 }));
  });
});

describe('地图', () => {
  const map = buildMap(town30());
  it('任意两个地点门到门都走得通', () => {
    const ids = Object.keys(map.places);
    for (const a of ids) for (const b of ids) expect(map.path(map.places[a]!.door, map.places[b]!.door), `${a}→${b}`).not.toBeNull();
  });
  it('公告栏与喷泉不可穿行，开放空间有站位', () => {
    expect(map.cost(16, 18)).toBe(Infinity);
    expect(map.cost(19, 20)).toBe(Infinity);
    expect(map.slots('P01').length).toBeGreaterThan(10);
  });
  it('河把北区与南区分开，只能过桥', () => {
    const p = map.path(map.places.R01!.door, map.places.W06!.door)!;
    expect(p.some((t) => map.kind(t.x, t.y) === 'bridge')).toBe(true);
  });
});

describe('主张：转述变形与理解', () => {
  const body: Slots = { event: 'power_outage', area: 'north', day: 4, window: { kind: 'exact', from: 14 * 3600, to: 16 * 3600 }, source: 'gov', certainty: 'confirmed' };
  it('版本 id 由内容决定（同内容去重）', () => {
    expect(versionIdFor('F', body)).toBe(versionIdFor('F', { ...body }));
    const v = makeVersion({ familyId: 'F', slots: body, origin: { kind: 'publish', by: 'gov', channel: 'website' }, root: 'N1', mutations: [], t: 0 });
    expect(v.id).toBe(versionIdFor('F', body));
  });
  it('转述是确定性的，且每处变形都有记录', () => {
    const p = { seed: 1, speaker: 'a', listener: 'b', familyId: 'F', n: 3, slots: body, traits: traits({ detail: 0.1 }), medium: 'speech' as const };
    const x = transmitSlots(p);
    expect(transmitSlots(p)).toEqual(x);
    for (const m of x.mutations) expect(['drop', 'coarsen', 'fill_worst_case', 'weaken', 'strengthen']).toContain(m.op);
  });
  it('“全天”只会在时段缺失且说话人焦虑时被补出来', () => {
    const noWindow: Slots = { event: 'power_outage', area: 'north', day: 4, certainty: 'likely' };
    let calm = 0;
    let anxious = 0;
    for (let n = 0; n < 400; n++) {
      if (transmitSlots({ seed: 5, speaker: 'a', listener: 'b', familyId: 'F', n, slots: noWindow, traits: traits({ anxiety: 0.2 }), medium: 'speech' }).slots.window?.kind === 'all_day') calm++;
      const r = transmitSlots({ seed: 5, speaker: 'a', listener: 'b', familyId: 'F', n, slots: noWindow, traits: traits({ anxiety: 0.9 }), medium: 'speech' });
      if (r.slots.window?.kind === 'all_day') {
        anxious++;
        expect(r.mutations.some((m) => m.op === 'fill_worst_case' && m.slot === 'window')).toBe(true);
      }
    }
    expect(calm).toBe(0);
    expect(anxious).toBeGreaterThan(100);
    // 有精确时段时不会凭空变成全天
    for (let n = 0; n < 200; n++) expect(transmitSlots({ seed: 5, speaker: 'a', listener: 'b', familyId: 'F', n, slots: body, traits: traits({ anxiety: 0.95, detail: 1 }), medium: 'text' }).slots.window?.kind).not.toBe('all_day');
  });
  it('看标题的人拿不到正文才有的细节', () => {
    const headline: Slots = { event: 'power_outage', area: 'north', day: 4, window: { kind: 'coarse', label: 'afternoon' } };
    for (let i = 0; i < 50; i++) {
      const c = comprehend({ seed: 9, agent: 'a', exposureId: `x${i}`, slots: headline, fragment: 'headline', opened: false, habits: { website: [], push: true, phone: 'mid', readDepth: 1, drain: 5, lunch: 'home', leisure: [] }, traits: traits(), fatigue: 0 });
      expect(c.slots.window?.kind).not.toBe('exact');
      expect(c.slots.advice).toBeUndefined();
    }
  });
  it('信念合并：官方精确时段压过亲友转述的“全天”；同一根源重复不叠加置信度', () => {
    const rumor = mergeBelief(undefined, { familyId: 'F', slots: { ...body, window: { kind: 'all_day' }, source: 'person' }, versionId: 'v_r', t: 0, source: { versionId: 'v_r', channel: 'talk', t: 0, root: 'N1', credibility: 0.6 } });
    const same = mergeBelief(rumor.belief, { familyId: 'F', slots: { ...body, window: { kind: 'all_day' }, source: 'person' }, versionId: 'v_r', t: 1, source: { versionId: 'v_r', channel: 'talk', t: 1, root: 'N1', credibility: 0.6 } });
    expect(same.belief.confidence).toBe(rumor.belief.confidence);
    const official = mergeBelief(same.belief, { familyId: 'F', slots: body, versionId: 'v_o', t: 2, source: { versionId: 'v_o', channel: 'website', t: 2, root: 'N2', credibility: 0.8 } });
    expect(official.belief.slots.window).toEqual(body.window);
    expect(official.belief.confidence).toBeGreaterThan(same.belief.confidence);
    expect(describeSlots(official.belief.slots)).toContain('14:00–16:00');
  });
});
