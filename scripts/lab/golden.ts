// 记录重构前的终态哈希：默认规则参数必须逐字节复现
import { Engine, contentHash, normalizeSpec, parseTime, presets, scenarioFromSpec, town30 } from '@microcity/sim';
const cases: Array<[string, () => ReturnType<typeof town30>, number, string]> = [
  ['classic', () => town30(), 42, 'D04 20:00'],
  ['classic', () => town30(), 7, 'D05 12:00'],
  ['bigtwo', () => scenarioFromSpec(normalizeSpec(presets().find((p) => p.id === 'bigtwo')!.spec).spec), 7, 'D07 12:00'],
  ['newtown', () => scenarioFromSpec(normalizeSpec(presets().find((p) => p.id === 'newtown')!.spec).spec), 3, 'D05 08:00'],
];
for (const [name, mk, seed, until] of cases) {
  const e = Engine.create(mk(), { seed, decisionMode: 'rule' });
  e.advance(parseTime(until));
  console.log(JSON.stringify({ name, seed, until, hash: contentHash(e.state), seq: e.state.meta.seq }));
}
