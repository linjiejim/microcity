import { describe, expect, it } from 'vitest';
import { checkInvariants, contentHash, DAY, Engine, generateCommunity, normalizeSpec, PRESETS, totalMoney, WorldMap, type CommunitySpec } from '../src/index.ts';

const TEMPLATES = Object.keys(PRESETS) as CommunitySpec['template'][];

describe('四个社区配方（D93）', () => {
  it.each(TEMPLATES)('%s：确定性生成，门都走得到，一周里不变量都成立', (template) => {
    const spec = PRESETS[template];
    const def = generateCommunity(spec);
    expect(contentHash(generateCommunity(spec))).toBe(contentHash(def));
    expect(def.people.length).toBeGreaterThanOrEqual(spec.population);
    const map = new WorldMap(def.map);
    const bus = def.map.places.find((p) => p.kind === 'busstop')!;
    for (const p of def.map.places) expect(Number.isFinite(map.meters(p.id, bus.id)), p.id).toBe(true);
    // 地点互不重叠
    const taken = new Set<number>();
    for (const p of def.map.places)
      for (let y = p.y; y < p.y + p.h; y++)
        for (let x = p.x; x < p.x + p.w; x++) {
          expect(taken.has(y * 1000 + x), `${p.name} 与别的地点重叠`).toBe(false);
          taken.add(y * 1000 + x);
        }
    for (const h of def.households) expect(h.members.length).toBeLessThanOrEqual(5);
    for (const f of def.firms) expect(f.staff.length, f.name).toBeGreaterThan(0);

    const e = Engine.create(def, { seed: 2 });
    const total0 = totalMoney(e.state);
    for (let d = 1; d <= 7; d++) {
      e.advance(d * DAY - 1);
      expect(checkInvariants(def, e.state, total0), `D${d}`).toEqual([]);
    }
    const neg = def.households.filter((h) => (e.state.accounts[`hh:${h.id}`] ?? 0) < 0).length;
    expect(neg / def.households.length).toBeLessThan(0.1);
  });

  it('各有各的样子：新小区多数人去城里，工厂镇多数人在车间，城中村多数人租房', () => {
    const share = (template: CommunitySpec['template'], f: (def: ReturnType<typeof generateCommunity>) => number) => f(generateCommunity(PRESETS[template]));
    const city = (def: ReturnType<typeof generateCommunity>) => def.people.filter((p) => p.job?.firm === 'city').length / def.people.filter((p) => p.job).length;
    expect(share('newtown', city)).toBeGreaterThan(0.55);
    expect(share('factory', city)).toBeLessThan(0.15);
    expect(share('oldtown', city)).toBeLessThan(0.4);
    const plant = (def: ReturnType<typeof generateCommunity>) => def.people.filter((p) => p.job && def.map.places.find((x) => x.id === p.job!.place)?.kind === 'workshop').length;
    expect(share('factory', plant)).toBeGreaterThan(40);
    const renters = (def: ReturnType<typeof generateCommunity>) => def.households.filter((h) => h.rentWeekly > 0).length / def.households.length;
    expect(share('village', renters)).toBeGreaterThan(0.6);
    expect(share('factory', renters)).toBeLessThan(0.3);
    const elders = (def: ReturnType<typeof generateCommunity>) => def.people.filter((p) => p.age >= 60).length / def.people.length;
    expect(share('oldtown', elders)).toBeGreaterThan(share('newtown', elders) * 1.8);
    // 新小区没有菜市场和茶馆
    const kinds = new Set(generateCommunity(PRESETS.newtown).map.places.map((p) => p.kind));
    expect(kinds.has('market')).toBe(false);
    expect(kinds.has('teahouse')).toBe(false);
  });

  it('规范化：不认识的模板退回老城街坊；越界的值拉回范围', () => {
    const { spec, adjustments } = normalizeSpec({ ...PRESETS.village, template: 'mars' as CommunitySpec['template'], cityShare: 2, name: '  ' });
    expect(spec.template).toBe('oldtown');
    expect(spec.cityShare).toBe(0.85);
    expect(spec.name).toBe('和平里');
    expect(adjustments.map((a) => a.field)).toContain('cityShare');
  });
});
