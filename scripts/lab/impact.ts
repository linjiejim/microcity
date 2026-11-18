/**
 * v5 的影响案例（docs/experiments/20261119-v5-impact-cases.md）：
 *   node --import tsx scripts/lab/impact.ts            # 全部案例
 *   node --import tsx scripts/lab/impact.ts rumor rain # 只跑某几个
 * 只在内存里跑；汇总写到 docs/experiments/results/v5-impact.json。
 */
import { writeFileSync } from 'node:fs';
import { compare, generateCommunity, INDICATORS, runLine } from '@microcity/society';
import { CASES } from '../../apps/studio/src/lab/presets.ts';

const only = process.argv.slice(2);
/**
 * 安慰剂（事后加的探索性分析，不在预注册里）：第 4 天给每户发 1 元。
 * 任何一点扰动都会让两条世界线此后的随机走向分开，所以“干预线与基线不同”本身不说明什么；
 * 安慰剂量出的是这种分叉自己能造成多大的差，当作噪声的底。
 */
const placeboCache = new Map<string, Array<ReturnType<typeof runLine>>>();
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
const out: Record<string, unknown> = {};

for (const c of CASES) {
  if (only.length && !only.includes(c.id)) continue;
  const x = c.experiment;
  const t0 = performance.now();
  const def = generateCommunity(x.spec);
  const base = x.seeds.map((s) => runLine(def, s, [], x.days));
  const treat = x.seeds.map((s) => runLine(def, s, x.interventions, x.days));
  const r = compare(def, x, base, treat);
  const pkey = `${def.id}:${x.days}`;
  if (!placeboCache.has(pkey)) placeboCache.set(pkey, x.seeds.map((s) => runLine(def, s, [{ kind: 'grant', amount: 1, day: 4 }], x.days)));
  const placebo = compare(def, { ...x, from: r.from }, base, placeboCache.get(pkey)!);
  const noise = (key: string) => {
    const m = placebo.metrics.find((k) => k.key === key)!;
    return median(m.treat.map((b, i) => Math.abs(b - m.base[i]!)));
  };
  console.log(`\n## ${c.title}（${def.name}，${x.seeds.length} 个种子 × ${x.days} 天，指标自第 ${r.from} 天起；${Math.round(performance.now() - t0)} ms）\n`);
  console.log('| 假设 | 指标 | 基线（中位数） | 干预（中位数） | 配对差的中位数 | 安慰剂的差 | 同向的种子 | 判定 |\n| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const p of r.predictions) {
    const m = r.metrics.find((k) => k.key === p.metric)!;
    const ind = INDICATORS[p.metric]!;
    const diff = median(m.treat.map((b, i) => b - m.base[i]!));
    const nz = noise(p.metric);
    const d = Math.max(ind.digits, 1);
    console.log(`| ${p.text} | \`${p.metric}\` | ${median(m.base).toFixed(ind.digits)} ${ind.unit} | ${median(m.treat).toFixed(ind.digits)} ${ind.unit} | ${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(d)} | ±${nz.toFixed(d)}${Math.abs(diff) > 2 * nz ? '' : '（没超过两倍）'} | ${Math.round(p.share * x.seeds.length)} / ${x.seeds.length} | ${p.verdict} |`);
  }
  // 预测之外变化最大的几项：按“配对差的中位数 ÷ 基线的中位数”排
  const others = r.metrics
    .filter((m) => !x.predictions.some((p) => p.metric === m.key))
    .map((m) => {
      const diffs = m.treat.map((b, i) => b - m.base[i]!);
      const same = Math.max(diffs.filter((d) => d > 0).length, diffs.filter((d) => d < 0).length);
      return { m, rel: Math.abs(median(diffs)) / Math.max(1e-9, Math.abs(median(m.base))), same };
    })
    .filter((o) => o.same >= Math.ceil(x.seeds.length * 0.8) && o.rel > 0.03 && Math.abs(median(o.m.treat.map((b, i) => b - o.m.base[i]!))) > 2 * noise(o.m.key))
    .sort((a, b) => b.rel - a.rel)
    .slice(0, 5);
  if (others.length) console.log(`\n预测之外、方向一致的变化：${others.map((o) => `${INDICATORS[o.m.key]!.label} ${median(o.m.base).toFixed(INDICATORS[o.m.key]!.digits)} → ${median(o.m.treat).toFixed(INDICATORS[o.m.key]!.digits)}`).join('；')}`);
  console.log(`受影响最大的人：${r.affected.slice(0, 5).map((a) => `${def.people[a.index]!.name}（${def.people[a.index]!.job ? '上班' : def.people[a.index]!.stage === 'retired' ? '退休' : def.people[a.index]!.stage}，第 ${a.day} 天）`).join('、')}`);
  out[c.id] = { community: def.name, seeds: x.seeds, days: x.days, from: r.from, predictions: r.predictions, metrics: r.metrics, placebo: placebo.metrics };
}
if (!only.length) writeFileSync(new URL('../../docs/experiments/results/v5-impact.json', import.meta.url), JSON.stringify(out, null, 1));
