import { beforeAll, describe, expect, it } from 'vitest';
import { contentHash, DAY, DayRunner, dayStart, DEFAULT_PARAMS, generateCommunity, hm, OLDTOWN, type CommunityDef } from '@microcity/society';
import { chat, keyInfo, type Deps } from '../src/llm/openrouter.ts';
import { monologue, templateThought, validateMonologue, type MonologueFacts } from '../src/llm/monologue.ts';
import { loadLedger, loadPrefs, looksLikeKey, maskKey, savePrefs, DEFAULT_PREFS, type KV } from '../src/llm/prefs.ts';
import type { DayPack } from '../src/sim/protocol.ts';
import { Cursor } from '../src/timeline/cursor.ts';
import { computePoses, makeStage } from '../src/timeline/poses.ts';
import { dayStory } from '../src/timeline/segments.ts';
import type { ActorPose } from '../src/world3d/types.ts';

let def: CommunityDef;
let packs: DayPack[];
beforeAll(() => {
  def = generateCommunity(OLDTOWN);
  const runner = new DayRunner(def, { seed: 1 }, true);
  packs = [1, 2, 3].map(() => {
    const r = runner.next();
    return { day: r.day, snapshot: r.snapshot!, events: r.events! };
  });
});

describe('按天取数据与游标', () => {
  it('一天的快照加上当天的事件，正好得到下一天的快照', () => {
    for (const d of [0, 1]) {
      const c = new Cursor(packs[d]!, DEFAULT_PARAMS);
      c.seek(dayStart(packs[d]!.day + 1) - 1);
      const next = structuredClone(packs[d + 1]!.snapshot);
      // 快照取在午夜之前，时刻字段以游标为准
      expect(contentHash({ ...c.state, t: 0 })).toBe(contentHash({ ...next, t: 0 }));
    }
  });

  it('往回拖与从头走到同一时刻，状态相同', () => {
    const pack = packs[1]!;
    const a = new Cursor(pack, DEFAULT_PARAMS);
    a.seek(dayStart(2) + hm(20));
    a.seek(dayStart(2) + hm(9, 30));
    const b = new Cursor(pack, DEFAULT_PARAMS);
    b.seek(dayStart(2) + hm(9, 30));
    expect(contentHash(a.state)).toBe(contentHash(b.state));
    expect([...a.lastSpot.keys()].sort()).toEqual([...b.lastSpot.keys()].sort());
  });

  it('seek 返回这次新应用的事件；往回拖时为空', () => {
    const c = new Cursor(packs[0]!, DEFAULT_PARAMS);
    const first = c.seek(hm(8));
    expect(first.length).toBeGreaterThan(100);
    expect(c.seek(hm(8)).length).toBe(0);
    expect(c.seek(hm(7)).length).toBe(0);
  });
});

describe('一个人的一天', () => {
  it('时间轴上的段首尾相接，铺满整天', () => {
    const name = (id: string) => def.people.find((p) => p.id === id)?.name ?? id;
    const place = (id: string) => def.map.places.find((p) => p.id === id)?.name ?? id;
    for (const p of def.people.filter((_, i) => i % 9 === 0)) {
      const story = dayStory(packs[1]!, p.id, name, place);
      const segs = story.segments;
      expect(segs.length).toBeGreaterThan(3);
      expect(segs[0]!.t0).toBe(dayStart(2));
      let covered = 0;
      for (let i = 0; i < segs.length; i++) {
        if (i > 0) expect(segs[i]!.t0).toBeGreaterThanOrEqual(segs[i - 1]!.t1 - 1);
        covered += segs[i]!.t1 - segs[i]!.t0;
      }
      // 两件事之间可能有几秒的空隙，其余时间都有着落
      expect(covered).toBeGreaterThan(DAY - 600);
      expect(covered).toBeLessThanOrEqual(DAY);
      for (const d of story.decisions) expect(d.options.some((o) => o.id === d.chosen)).toBe(true);
    }
  });
});

describe('姿态', () => {
  it('任一时刻：坐标都是有限数；去城里的人不可见；占着站位的人互不重叠', () => {
    const stage = makeStage(def);
    const pack = packs[1]!;
    const c = new Cursor(pack, DEFAULT_PARAMS);
    const poses: ActorPose[] = [];
    for (const h of [3, 7.6, 10, 12.2, 16.5, 19.4, 22.5]) {
      const t = dayStart(2) + Math.round(h * 3600);
      c.seek(t);
      computePoses(stage, c.state, t, c.lastChat, c.lastSpot, poses);
      expect(poses.length).toBe(def.people.length);
      const seen = new Set<string>();
      def.people.forEach((p, i) => {
        const o = poses[i]!;
        const ps = c.state.people[p.id]!;
        expect(o.visible).toBe(!ps.act?.away);
        if (!o.visible) return;
        for (const v of [o.x, o.y, o.h, o.face]) expect(Number.isFinite(v)).toBe(true);
        expect(o.x).toBeGreaterThanOrEqual(0);
        expect(o.x).toBeLessThanOrEqual(def.map.w * 4);
        if (ps.loc.k === 'move') expect(o.place).toBeNull();
        else if (ps.act && ps.act.anchor >= 0 && t - ps.act.t0 > 30 && ps.act.hobby !== 'walk') {
          const key = `${o.x.toFixed(2)},${o.y.toFixed(2)},${o.h}`;
          expect(seen.has(key), `${p.name} ${ps.act.label}`).toBe(false);
          seen.add(key);
        }
      });
    }
    // 凌晨大家都躺着；白天有人在走
    c.seek(dayStart(2) + hm(3));
    computePoses(stage, c.state, dayStart(2) + hm(3), c.lastChat, c.lastSpot, poses);
    expect(poses.filter((o) => o.anim === 'lie').length).toBeGreaterThan(def.people.length * 0.9);
  });
});

// ───────────────────────── 模型：全部用假的存储与假的网络

function memory(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
const TEST_KEY = `sk-or-${'t'.repeat(24)}`;

function deps(reply: { status?: number; body: unknown }, calls: { n: number; last?: RequestInit; url?: string }): Deps {
  return {
    kv: memory(),
    now: () => new Date('2026-11-18T08:00:00Z'),
    fetch: (async (url: string, init?: RequestInit) => {
      calls.n++;
      calls.last = init;
      calls.url = url;
      return { ok: (reply.status ?? 200) < 400, status: reply.status ?? 200, json: async () => reply.body };
    }) as unknown as typeof fetch,
  };
}

const facts: MonologueFacts = { name: '程汉章', age: 64, bio: '64 岁，退休', when: '周三 15:26，晴', doing: '在巷口面馆吃东西', why: ['此刻需要'], feelings: ['有点饿'], today: ['和尹庆丰聊了聊（下棋）'], names: ['尹庆丰'] };
const everyone = ['程汉章', '尹庆丰', '余汉章', '冯淑敏'];

describe('模型：密钥、预算、缓存、记账', () => {
  it('密钥的样子', () => {
    expect(looksLikeKey(TEST_KEY)).toBe(true);
    expect(looksLikeKey('sk-abc')).toBe(false);
    expect(maskKey(TEST_KEY)).not.toContain('tttttttttt');
  });

  it('没有密钥就不发请求', async () => {
    const calls = { n: 0 };
    const d = deps({ body: {} }, calls);
    const r = await chat(d, { model: 'm', messages: [{ role: 'user', content: 'x' }], purpose: 't', template: 'v1' });
    expect(r).toMatchObject({ ok: false, reason: 'no_key' });
    expect(calls.n).toBe(0);
  });

  it('调用成功：只发往 openrouter.ai，花费记进本机账本；同样的问题第二次读缓存', async () => {
    const calls: { n: number; last?: RequestInit; url?: string } = { n: 0 };
    const d = deps({ body: { choices: [{ message: { content: ' 好的 ' } }], usage: { prompt_tokens: 120, completion_tokens: 12, cost: 0.00021 } } }, calls);
    savePrefs(d.kv, { ...DEFAULT_PREFS, key: TEST_KEY });
    const req = { model: loadPrefs(d.kv).languageModel, messages: [{ role: 'user' as const, content: 'x' }], purpose: '测试', template: 'v1' };
    const a = await chat(d, req);
    expect(a).toMatchObject({ ok: true, text: '好的', cached: false });
    expect(calls.url!.startsWith('https://openrouter.ai/api/v1/')).toBe(true);
    expect((calls.last!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_KEY}`);
    const b = await chat(d, req);
    expect(b).toMatchObject({ ok: true, cached: true });
    expect(calls.n).toBe(1);
    const ledger = loadLedger(d.kv);
    expect(ledger).toMatchObject({ calls: 1, cacheHits: 1, promptTokens: 120, completionTokens: 12, costUsd: 0.00021 });
    expect(ledger.recent.length).toBe(2);
  });

  it('预算闸：本机累计到了预算就不再调用', async () => {
    const calls = { n: 0 };
    const d = deps({ body: { choices: [{ message: { content: 'a' } }], usage: { cost: 0.3 } } }, calls);
    savePrefs(d.kv, { ...DEFAULT_PREFS, key: TEST_KEY, budgetUsd: 0.5 });
    const ask = (i: number) => chat(d, { model: 'm', messages: [{ role: 'user', content: `q${i}` }], purpose: 't', template: 'v1' });
    expect((await ask(1)).ok).toBe(true);
    expect((await ask(2)).ok).toBe(true);
    expect(await ask(3)).toMatchObject({ ok: false, reason: 'budget' });
    expect(calls.n).toBe(2);
  });

  it('没通过校验的答案不进缓存', async () => {
    const calls = { n: 0 };
    const d = deps({ body: { choices: [{ message: { content: '坏答案' } }], usage: { cost: 0 } } }, calls);
    savePrefs(d.kv, { ...DEFAULT_PREFS, key: TEST_KEY });
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'x' }], purpose: 't', template: 'v1', accept: () => false };
    expect(await chat(d, req)).toMatchObject({ ok: false, reason: 'rejected' });
    await chat(d, req);
    expect(calls.n).toBe(2);
  });

  it('账户侧用量：查询成功与密钥无效', async () => {
    const ok = await keyInfo(deps({ body: { data: { label: 'k', usage: 1.81, limit: 5, limit_remaining: 3.19 } } }, { n: 0 }), TEST_KEY);
    expect(ok).toEqual({ ok: true, info: { label: 'k', usage: 1.81, limit: 5, remaining: 3.19 } });
    const bad = await keyInfo(deps({ status: 401, body: { error: { message: 'No auth' } } }, { n: 0 }), TEST_KEY);
    expect(bad.ok).toBe(false);
  });
});

describe('内心独白只能复述事实表', () => {
  it('多出的数字、时刻、人名都算问题', () => {
    expect(validateMonologue('有点饿，来碗面。', facts, everyone)).toEqual([]);
    expect(validateMonologue('15:26 了，饿。', facts, everyone)).toEqual([]);
    expect(validateMonologue('都 16:00 了才吃上。', facts, everyone).length).toBe(1);
    expect(validateMonologue('花了 14 块。', facts, everyone).length).toBe(1);
    expect(validateMonologue('等会儿找冯淑敏下棋。', facts, everyone).length).toBe(1);
    expect(validateMonologue('刚和尹庆丰杀了两盘。', facts, everyone)).toEqual([]);
  });

  it('没有密钥时用模板想法，并说明原因；模型乱说时退回模板', async () => {
    const none = await monologue(deps({ body: {} }, { n: 0 }), facts, everyone);
    expect(none).toMatchObject({ source: 'template', text: templateThought(facts) });
    expect(none.note).toContain('密钥');
    const d = deps({ body: { choices: [{ message: { content: '我要去找冯淑敏，都 17:00 了。' } }], usage: { cost: 0.0001 } } }, { n: 0 });
    savePrefs(d.kv, { ...DEFAULT_PREFS, key: TEST_KEY });
    const bad = await monologue(d, facts, everyone);
    expect(bad.source).toBe('template');
    expect(bad.note).toContain('没通过事实校验');
    const good = deps({ body: { choices: [{ message: { content: '饿了，来碗面垫垫。' } }], usage: { cost: 0.0001 } } }, { n: 0 });
    savePrefs(good.kv, { ...DEFAULT_PREFS, key: TEST_KEY });
    expect(await monologue(good, facts, everyone)).toMatchObject({ source: 'model', text: '饿了，来碗面垫垫。' });
  });
});

// ───────────────────────── 画像、分享、对话建镇、第二意见

import { cleanConfig, cleanExperiment, cleanIntervention, experimentLink, readLink, worldLink } from '../src/share.ts';
import { applyPatch, buildFromText, parsePatch } from '../src/llm/builder.ts';
import { normalizeProbs, secondOpinion } from '../src/llm/second.ts';
import { calibration, flows, groups, groupStats, heat, money, paper, personSeries, social } from '../src/portrait/data.ts';
import { CASES } from '../src/lab/presets.ts';
import { INDICATORS, PRESETS, validateExperiment, type DayAgg } from '@microcity/society';

describe('画像的数据', () => {
  let aggs: DayAgg[];
  beforeAll(() => {
    const runner = new DayRunner(def, { seed: 1 }, false);
    aggs = [1, 2, 3, 4, 5, 6, 7, 8].map(() => runner.next().agg);
  });

  it('人群的时间利用：每组一天正好 24 小时；所有人这一组等于全体', () => {
    for (const g of groups(def)) expect(groupStats(aggs, g.idx).hours.reduce((a, b) => a + b, 0)).toBeCloseTo(24, 5);
    expect(groups(def)[0]!.idx.length).toBe(def.people.length);
  });

  it('钱的流向：有工资、养老金、买东西，名字都是中文', () => {
    const f = flows(aggs, 40);
    expect(f.length).toBeGreaterThan(8);
    for (const x of f) {
      expect(x.perDay).toBeGreaterThan(0);
      expect(`${x.from}${x.to}${x.kind}`).not.toMatch(/firm|person|household|ext|undefined/);
    }
    expect(f.some((x) => x.kind === '工资')).toBe(true);
    expect(f.some((x) => x.to === '菜市场' && x.kind === '买东西')).toBe(true);
  });

  it('场所热度、钱、关系、个人序列都算得出来', () => {
    const h = heat(aggs);
    expect(h.rows[0]!.label).toBe('在家');
    expect(h.rows[0]!.byHour[3]!).toBeGreaterThan(def.people.length * 0.9);
    expect(h.rows.some((r) => r.label === '学校')).toBe(true);
    const m = money(def, aggs);
    expect(m.trend.length).toBe(aggs.length);
    expect(m.hist.reduce((a, b) => a + b.n, 0)).toBe(def.people.filter((p) => p.age >= 18).length);
    expect(m.gini).toBeGreaterThan(0);
    expect(social(aggs).ties.reduce((a, b) => a + b.n, 0)).toBeGreaterThan(def.ties.length - 1);
    const s = personSeries(aggs, 0);
    expect(s.mood.length).toBe(aggs.length);
    expect(s.hours.reduce((a, b) => a + b, 0)).toBeCloseTo(24, 5);
  });

  it('校准：六大类加起来是 24 小时，参照也是', () => {
    const rows = calibration(def, aggs);
    expect(rows.reduce((a, r) => a + r.model, 0)).toBeCloseTo(1440, 3);
    expect(rows.reduce((a, r) => a + r.reference, 0)).toBe(1440);
  });

  it('日报：每一句里出现的人名都是这个社区的人，数字来自当天的统计', () => {
    const agg = aggs[2]!;
    const items = paper(def, agg);
    expect(items.length).toBeGreaterThan(4);
    const text = items.map((i) => i.text).join('');
    expect(text).toContain(`${agg.chats} 次天`);
    expect(text).not.toMatch(/undefined|NaN/);
  });
});

describe('分享链接（D96）', () => {
  it('世界与实验都能编码再读回；默认的世界用短链接', () => {
    expect(worldLink('http://x/', { spec: PRESETS.oldtown, seed: 1, interventions: [] })).toBe('http://x/');
    expect(worldLink('http://x/', { spec: PRESETS.village, seed: 3, interventions: [] }, { t: 'D03 18:30', who: 'p001' })).toBe('http://x/?c=village&seed=3&t=D03+18%3A30&who=p001');
    const config = { spec: { ...PRESETS.newtown, population: 150 }, seed: 7, interventions: [{ kind: 'grant' as const, amount: 500, day: 4 }] };
    const url = new URL(worldLink('http://x/', config, { t: 'D02 08:00' }));
    const back = readLink(url.search, url.hash);
    expect(back.config).toEqual(config);
    expect(back.t).toBe(86400 + 8 * 3600);
    const x = CASES[0]!.experiment;
    const u2 = new URL(experimentLink('http://x/', x));
    const b2 = readLink(u2.search, u2.hash);
    expect(b2.view).toBe('lab');
    expect(b2.experiment).toEqual({ ...x, predictions: x.predictions.map((p, i) => ({ ...p, id: `P${i + 1}` })) });
  });

  it('坏链接与越界的值：退回默认，或者拉回范围，绝不抛错', () => {
    expect(readLink('?seed=abc&t=nonsense', '#w=%%%').config).toEqual({ spec: PRESETS.oldtown, seed: 1, interventions: [] });
    expect(cleanConfig({ spec: { template: 'mars', population: 99999 }, seed: -5, interventions: [{ kind: 'boom' }, { kind: 'grant', amount: 1e9, day: 4 }, { kind: 'close', place: 'market', from: 4 }] })).toMatchObject({ seed: 1, spec: { template: 'oldtown', population: 220 }, interventions: [{ kind: 'close', place: 'market', from: 4 }] });
    expect(cleanIntervention({ kind: 'rumor', topic: 'not-a-topic', seeds: 3, day: 2 })).toBeUndefined();
    expect(cleanIntervention({ kind: 'weather', weather: 'rain', from: 2 })).toBeUndefined();
    expect(cleanExperiment({ name: 'x', seeds: [1], days: 5, interventions: [] })).toBeUndefined();
  });

  it('案例预设都是合法的实验清单，指标都存在', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(5);
    for (const c of CASES) {
      expect(validateExperiment(c.experiment), c.id).toEqual([]);
      for (const p of c.experiment.predictions) expect(INDICATORS[p.metric], p.metric).toBeTruthy();
    }
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });
});

describe('对话建镇（D94）', () => {
  it('只认白名单字段；类型不对的丢掉并记下', () => {
    const r = parsePatch('```json\n{"template":"village","population":160,"renters":"很多","evil":1,"households":{"single":0.4,"aliens":9}}\n```')!;
    expect(r.patch).toEqual({ template: 'village', population: 160, households: { single: 0.4 } });
    expect(r.ignored.sort()).toEqual(['evil', 'households.aliens', 'renters']);
    expect(parsePatch('不是 JSON')).toBeUndefined();
    expect(parsePatch('[1,2]')).toBeUndefined();
  });

  it('补丁过规范化：越界的拉回范围并说明；换模板时以那个模板为底', () => {
    const a = applyPatch(PRESETS.oldtown, { population: 5000, cityShare: 0.5 });
    expect(a.spec.population).toBe(220);
    expect(a.spec.cityShare).toBe(0.5);
    expect(a.adjustments.map((x) => x.field)).toEqual(['population']);
    const b = applyPatch(PRESETS.oldtown, { template: 'factory', name: '钢城' });
    expect(b.spec.template).toBe('factory');
    expect(b.spec.cityShare).toBe(PRESETS.factory.cityShare);
    expect(b.spec.name).toBe('钢城');
  });

  it('没有密钥时不发请求；有密钥时采用补丁并说明；乱答时不采用', async () => {
    const none = await buildFromText(deps({ body: {} }, { n: 0 }), PRESETS.oldtown, '年轻人多的新小区');
    expect(none.ok).toBe(false);
    const d = deps({ body: { choices: [{ message: { content: '{"template":"newtown","population":900,"hack":true}' } }], usage: { cost: 0.0002 } } }, { n: 0 });
    savePrefs(d.kv, { ...DEFAULT_PREFS, key: TEST_KEY });
    const ok = await buildFromText(d, PRESETS.oldtown, '年轻人多的新小区');
    expect(ok).toMatchObject({ ok: true, spec: { template: 'newtown', population: 220 } });
    if (ok.ok) {
      expect(ok.notes.join('；')).toContain('超出范围');
      expect(ok.notes.join('；')).toContain('没有采用的字段：hack');
    }
    const bad = deps({ body: { choices: [{ message: { content: '好的，我来帮你。' } }], usage: { cost: 0.0002 } } }, { n: 0 });
    savePrefs(bad.kv, { ...DEFAULT_PREFS, key: TEST_KEY });
    expect(await buildFromText(bad, PRESETS.oldtown, '年轻人多的新小区')).toMatchObject({ ok: false });
  });
});

describe('第二意见（D92）', () => {
  const options = [
    { id: 'a', label: '看电视', u: 1, p: 0.6, f: {} },
    { id: 'b', label: '去公园散步', u: 0.5, p: 0.4, f: {} },
  ];
  const who = { person: '64 岁，退休', now: '周三 19:10，晴', location: '9 号院', feelings: ['有点闷'] };

  it('归一化：缺的选项用极小值兜底，加起来是 1', () => {
    const p = normalizeProbs(['a', 'b', 'c'], { o1: 0.7, o2: 0.3 });
    expect(p.a! + p.b! + p.c!).toBeCloseTo(1, 2);
    expect(p.c!).toBeGreaterThan(0);
    expect(p.a!).toBeGreaterThan(p.b!);
  });

  it('没有密钥时不发请求；有密钥时发到决策模型的接口，结果记账并缓存', async () => {
    const calls: { n: number; last?: RequestInit; url?: string } = { n: 0 };
    const none = await secondOpinion(deps({ body: {} }, calls), who, options);
    expect(none.ok).toBe(false);
    expect(calls.n).toBe(0);
    const d = deps({ body: { answers: { fit: { choice: 'o2', probabilities: { o1: 0.2, o2: 0.8 } } }, usage: { input_tokens: 300, output_tokens: 0, cost: 0.00002 } } }, calls);
    savePrefs(d.kv, { ...DEFAULT_PREFS, key: TEST_KEY });
    const r = await secondOpinion(d, who, options);
    expect(r).toMatchObject({ ok: true, top: 'b', cached: false });
    expect(calls.url).toBe('https://openrouter.ai/api/v1/systemone');
    const sent = JSON.parse(String(calls.last!.body)) as { model: string; questions: { fit: { criteria: Record<string, string> } } };
    expect(sent.model).toBe('typesafe/jev-1.13');
    expect(sent.questions.fit.criteria).toEqual({ o1: '看电视', o2: '去公园散步' });
    expect(await secondOpinion(d, who, options)).toMatchObject({ ok: true, cached: true });
    expect(calls.n).toBe(1);
    expect(loadLedger(d.kv)).toMatchObject({ calls: 1, cacheHits: 1, costUsd: 0.00002 });
  });
});
