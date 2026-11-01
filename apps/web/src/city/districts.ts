import type { District, TownMap } from '@microcity/sim';

/** 哪些区此刻停着电（按该区住宅的供电判断） */
export function darkDistricts(map: TownMap, s?: { places: Record<string, { powered: boolean }> }): District[] {
  if (!s) return [];
  const out: District[] = [];
  for (const d of ['north', 'south'] as District[]) {
    const homes = map.placesOfKind('residence').filter((p) => p.district === d);
    if (homes.length && homes.every((p) => s.places[p.id]?.powered === false)) out.push(d);
  }
  return out;
}
