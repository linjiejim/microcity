/**
 * 新内核的体检（v5，M0 的性能探针 + M1 的典型事实）：
 *   pnpm probe            # 默认 30 天、种子 1
 *   pnpm probe 14 3       # 14 天、种子 3
 * 只在内存里跑，不写任何文件。
 */
import { BUCKETS, BUCKET_LABEL, checkInvariants, contentHash, DAY, DEFAULT_PARAMS, Engine, generateCommunity, initialState, OLDTOWN, rand, reduce, totalMoney, type DomainEvent } from '@microcity/society';

const DAYS = Number(process.argv[2] ?? 30);
const SEED = Number(process.argv[3] ?? 1);
const t0 = performance.now();
const def = generateCommunity(OLDTOWN);
const t1 = performance.now();
const events: DomainEvent[] = [];
const e = Engine.create(def, { seed: SEED, onEvent: (ev) => events.push(ev) });
const total0 = totalMoney(e.state);
const bad: string[] = [];
for (let d = 1; d <= DAYS; d++) {
  e.advance(d * DAY - 1);
  for (const b of checkInvariants(def, e.state, total0)) if (bad.length < 10) bad.push(`第 ${d} 天：${b}`);
}
const t2 = performance.now();
const st = initialState(def, DEFAULT_PARAMS, SEED, rand);
for (const ev of events) reduce(st, ev, { params: DEFAULT_PARAMS });

console.log(`${def.name}：${def.people.length} 人，${def.households.length} 户，${def.firms.length} 家单位，${def.ties.length} 条关系`);
console.log(`生成 ${Math.round(t1 - t0)} ms；${DAYS} 天用了 ${Math.round(t2 - t1)} ms，${events.length} 个事件（每天 ${Math.round(events.length / DAYS)}）`);
console.log(`不变量：${bad.length ? bad.join('；') : '通过'}；重放一致：${contentHash(st) === e.stateHash() ? '是' : '否'}`);

const P = Object.fromEntries(def.people.map((p) => [p.id, p]));
const rows = events.filter((x): x is Extract<DomainEvent, { type: 'day_summary' }> => x.type === 'day_summary' && x.day > 1);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
console.log(`\n时间利用（小时/天，含周末）\n${'人群'.padEnd(6)}${BUCKETS.map((b) => BUCKET_LABEL[b].padStart(7)).join('')}   聊天  心情`);
for (const [stage, label] of [['child', '小学生'], ['student', '中学生'], ['worker', '在职'], ['homemaker', '持家'], ['retired', '退休']] as const) {
  const r = rows.filter((x) => P[x.agent]!.stage === stage);
  if (r.length) console.log(`${label.padEnd(6)}${BUCKETS.map((b) => (avg(r.map((x) => x.use[b])) / 3600).toFixed(1).padStart(9)).join('')}  ${avg(r.map((x) => x.chats)).toFixed(1).padStart(5)}  ${avg(r.map((x) => x.mood)).toFixed(2)}`);
}
const count = (type: DomainEvent['type']) => events.filter((x) => x.type === type).length;
const neg = def.households.filter((h) => (e.state.accounts[`hh:${h.id}`] ?? 0) < 0).length;
console.log(`\n错过的固定安排 ${count('commit_missed')}，到了做不成 ${count('plan_failed')}，聊天 ${count('chat')}，新认识 ${count('tie_formed')}，成为朋友 ${count('tie_changed')}`);
console.log(`入不敷出的家庭 ${neg} / ${def.households.length}；各单位账上：${def.firms.map((f) => `${f.name} ${Math.round(e.state.accounts[f.id] ?? 0)}`).join('，')}`);
if (bad.length) process.exitCode = 1;
