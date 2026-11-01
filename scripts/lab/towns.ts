// 实验标准镇：60 人、河分南北、一轮北区停电（第二轮按实验另加）
import { generatedDefaults, normalizeSpec, scenarioFromSpec, townStats, type TownSpec } from '@microcity/sim';

export function labTown(seed = 42, extra: Partial<TownSpec> = {}): TownSpec {
  const s = generatedDefaults();
  Object.assign(s, {
    name: `实验镇 ${seed}`,
    seed,
    population: { size: 60, seniors: 0.25, youth: 0.25, northShare: 0.5 },
    facilities: { cafe: 2, restaurant: 2, convenience: 2, supermarket: 1, studio: 1, clinic: 1, library: 1, newsroom: 1, parks: 2 },
    culture: { trustGov: 0.6, anxiety: 0.45, sociability: 0.6, detail: 0.58 },
    media: { push: 0.3, website: 0.25, boards: 2 },
    network: { friends: 2.5, crossDistrict: 0.3, kin: 0.4 },
    ...extra,
  } satisfies Partial<TownSpec>);
  return normalizeSpec(s).spec;
}

/** 第二轮：同一个北区，D06 14:00–16:00，D05 08:05 发精确标题的通知 */
export const SECOND_WAVE = { id: 'E2', area: 'north' as const, day: 6, from: '14:00', to: '16:00', notice: { at: 'D05 08:05', channels: ['website' as const, 'push' as const, 'board' as const], headline: 'exact' as const, advice: ['charge_devices' as const, 'plan_elsewhere' as const] }, clarify: null, workOrder: true };

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const seed of [42, 7, 99]) {
    const spec = labTown(seed);
    const sc = scenarioFromSpec(spec);
    const st = townStats(sc);
    console.log(seed, JSON.stringify({ pop: st.population, districts: st.districts, push: st.push, website: st.website, boards: st.boards, trust: st.trustGov, events: spec.events.map((e) => `${e.id} ${e.area} D${e.day} ${e.from}-${e.to} ${e.notice?.headline} ${e.notice?.channels}`) }));
  }
}
