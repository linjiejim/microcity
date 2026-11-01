import { classicSpec, normalizeSpec, scenarioFromSpec, specHash, town30, type ScenarioDef, type TownSpec } from '@microcity/sim';
import type { Store } from './db.ts';

/**
 * 场景登记（spec v1 §2.8）：'town30' 是内置的经典小镇；其余场景由规格按内容哈希登记（sc_<hash>），
 * 需要时由确定性生成器重建，所以运行只存场景 id。
 */
export class ScenarioRegistry {
  private cache = new Map<string, ScenarioDef>();
  constructor(private store: Store) {}

  get(id: string): ScenarioDef | undefined {
    const hit = this.cache.get(id);
    if (hit) return hit;
    let sc: ScenarioDef | undefined;
    if (id === 'town30') sc = town30();
    else {
      const row = this.store.scenario(id);
      if (row) sc = scenarioFromSpec(normalizeSpec(row.spec).spec, id);
    }
    if (sc) this.cache.set(id, sc);
    return sc;
  }

  require(id: string): ScenarioDef {
    const sc = this.get(id);
    if (!sc) throw new Error(`未知场景 ${id}`);
    return sc;
  }

  /** 规格 → 场景 id（与默认经典规格等价时就是 town30） */
  register(spec: TownSpec, source: 'builder' | 'preset' | 'api'): { id: string; scenario: ScenarioDef } {
    const n = normalizeSpec(spec).spec;
    const def = scenarioFromSpec(n);
    if (def.id === 'town30') return { id: 'town30', scenario: this.require('town30') };
    const h = specHash(n);
    const id = `sc_${h}`;
    this.store.putScenario({ id, name: def.name, spec: n, hash: h, source });
    return { id, scenario: this.require(id) };
  }

  specOf(id: string): TownSpec | undefined {
    if (id === 'town30') return normalizeSpec(classicSpec()).spec;
    const row = this.store.scenario(id);
    return row ? normalizeSpec(row.spec).spec : undefined;
  }
}
