import { randomUUID } from 'node:crypto';
import {
  FACILITY_LABEL,
  describeEventInput,
  normalizeSpec,
  presets,
  ROLE_IDS,
  ROLE_LABEL,
  scenarioFromSpec,
  specHash,
  townStats,
  type Look,
  type PlaceDef,
  type Prop,
  type TileKind,
  type TownSpec,
  type TownStats,
} from '@microcity/sim';
import { hasModelAccess } from './config.ts';
import type { Store } from './db.ts';
import type { ChatClient, ChatMessage } from './providers/chat.ts';

/** 建镇模板版本：改系统提示或补丁规则必须升版本（缓存键随之变化） */
export const BUILDER_TEMPLATE_VERSION = 'builder_tpl_v2';

export interface BuilderMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string;
  source?: 'model' | 'offline' | 'form' | 'preset' | 'error';
  changes?: string[];
  warnings?: string[];
  suggestions?: string[];
}

export interface TownPreview {
  hash: string;
  name: string;
  stats: TownStats;
  map: { w: number; h: number; tiles: TileKind[]; places: PlaceDef[]; props: Prop[] };
  people: Array<{ id: string; name: string; age: number; gender: 'f' | 'm'; role: string; district: string; household: string; look: Look; bio: string }>;
  events: string[];
}

export interface BuilderView {
  id: string;
  spec: TownSpec;
  messages: BuilderMessage[];
  preview: TownPreview;
  modelAccess: boolean;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** 两份规格的差异（给人看的“改了什么”） */
export function specChanges(a: TownSpec, b: TownSpec): string[] {
  const out: string[] = [];
  const cmp = (label: string, x: unknown, y: unknown, fmt: (v: never) => string = (v) => String(v)) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${label}：${fmt(x as never)} → ${fmt(y as never)}`);
  };
  cmp('名字', a.name, b.name);
  cmp('底座', a.base, b.base, (v: string) => (v === 'classic' ? '经典手工小镇' : '模板生成'));
  cmp('生成种子', a.seed, b.seed);
  if (b.base === 'generated') {
    cmp('人口', a.population.size, b.population.size);
    cmp('老人比例', a.population.seniors, b.population.seniors, pct);
    cmp('年轻人比例', a.population.youth, b.population.youth, pct);
    cmp('住北区比例', a.population.northShare, b.population.northShare, pct);
    for (const k of Object.keys(b.facilities) as Array<keyof TownSpec['facilities']>) cmp(FACILITY_LABEL[k], a.facilities[k], b.facilities[k]);
  }
  cmp('对官方的信任', a.culture.trustGov, b.culture.trustGov);
  cmp('焦虑', a.culture.anxiety, b.culture.anxiety);
  cmp('爱社交', a.culture.sociability, b.culture.sociability);
  cmp('记细节', a.culture.detail, b.culture.detail);
  cmp('订阅推送', a.media.push, b.media.push, pct);
  cmp('常看网站', a.media.website, b.media.website, pct);
  cmp('公告栏', a.media.boards, b.media.boards);
  cmp('人均朋友', a.network.friends, b.network.friends);
  cmp('跨区交友', a.network.crossDistrict, b.network.crossDistrict);
  cmp('跨户亲属', a.network.kin, b.network.kin);
  if (JSON.stringify(a.characters) !== JSON.stringify(b.characters)) out.push(`具名人物：${b.characters.map((c) => c.name).join('、') || '无'}`);
  if (JSON.stringify(a.events) !== JSON.stringify(b.events)) out.push(`剧本：${b.events.map(describeEventInput).join('；')}`);
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const TOP_KEYS = new Set(['name', 'base', 'seed', 'population', 'facilities', 'culture', 'media', 'network', 'characters', 'events']);

/**
 * 白名单补丁：对象逐层合并，数组整体替换，未知字段丢弃。
 * 经典小镇的人口与设施是固定的：补丁要改它们时自动切到模板生成，并提示用户。
 */
export function applyPatch(spec: TownSpec, patch: unknown): { merged: Record<string, unknown>; dropped: string[]; notes: string[] } {
  const merged: Record<string, unknown> = structuredClone(spec) as unknown as Record<string, unknown>;
  const dropped: string[] = [];
  const notes: string[] = [];
  if (!isObj(patch)) return { merged, dropped, notes };
  for (const [k, v] of Object.entries(patch)) {
    if (!TOP_KEYS.has(k)) {
      dropped.push(k);
      continue;
    }
    const cur = merged[k];
    merged[k] = isObj(v) && isObj(cur) ? { ...cur, ...v } : v;
  }
  if (merged.base === 'classic' && ('population' in patch || 'facilities' in patch)) {
    merged.base = 'generated';
    notes.push('经典小镇的人口和设施是固定的，已切换为“按模板生成”');
  }
  return { merged, dropped, notes };
}

const SYSTEM = `你是“微缩城”的建镇助手。用户用自然语言描述想要的小镇和想做的实验，你把它翻译成对 TownSpec 规格的修改（patch）。
所有模板规则都在服务端代码里：你只提出修改，服务端会把越界的值夹回合理范围并告诉用户。不要编造规格之外的字段。

TownSpec 可改字段：
- name：小镇名（≤8 字）
- base："classic"=v0 手工小镇（30 人固定；只能改 culture/media/network.friends/具名人物特质/events）；"generated"=按模板生成。用户要改人口、年龄结构、设施时，必须同时给出 "base":"generated"
- seed：生成种子（换一个 = 同样参数的另一座镇）
- population（仅 generated）：size 人口 12–60；seniors 60 岁以上比例 0–0.6；youth 18–29 岁比例 0–0.6；northShare 住北区比例 0.2–0.8
- facilities（仅 generated）：cafe/restaurant/convenience 0–3，supermarket/studio/clinic/library 0–2，newsroom 0–1，parks 1–3；政务中心、维护站固定各一
- culture：trustGov 对官方通知的平均信任、anxiety 焦虑、sociability 爱社交、detail 记细节，均为 0.05–0.95
- media：push 订阅政务推送的人口比例 0–1；website 常看镇网站的比例 0–1；boards 公告栏个数 0–3
- network：friends 人均朋友数 0–6；crossDistrict 跨区交友倾向 0–1；kin 独居老人有住在别处的子女的比例 0–1
- characters：具名人物（≤12 个）[{name, age?, gender?:'f'|'m', role?, district?:'north'|'south', bio?, traits?:{anxiety,riskAversion,sociability,order,curiosity,altruism,commitment,trustOfficial,detail}, habits?:{push?,website?,phone?:'low'|'mid'|'high'}, kin?:{name, relation:'父女'|'父子'|'母女'|'母子'|'夫妻'|'兄妹'|'姐弟'|'朋友'}}]；role 取值：${ROLE_IDS.map((r) => `${r}(${ROLE_LABEL[r]})`).join('、')}
- events：停电剧本（1–3 轮），每轮 {area:'north'|'south', day:2–7（D01 是周一）, from:'HH:MM', to:'HH:MM', notice:null 或 {at:'D03 08:05', channels:['website'|'push'|'board'], headline:'exact'|'coarse'|'none', advice:['charge_devices'|'plan_elsewhere'|'store_food']}, clarify:null 或 {at:'D03 16:00', channels:[...]}}。通知必须早于停电；headline 为 coarse 时标题只写“上午/下午”，是谣言与过度调整的主要来源；notice 为 null 表示不发通知。

输出严格 JSON：{"reply":"给用户的中文回复（≤150 字，只描述 patch 里真的改了的东西，并说明为什么这样改）","patch":{只放要改的字段；嵌套对象可只给要改的子字段；characters/events 要改时给完整数组},"suggestions":["下一步可以试的 1–3 条短建议"]}
与建镇无关的问题：patch 给 {}，reply 简短回答并把话题引回实验设计。`;

export class Builder {
  private previews = new Map<string, TownPreview>();
  constructor(
    private store: Store,
    private chat: ChatClient,
  ) {}

  presets(): Array<{ id: string; name: string; blurb: string; spec: TownSpec; preview: TownPreview }> {
    return presets().map((p) => ({ ...p, spec: normalizeSpec(p.spec).spec, preview: this.preview(normalizeSpec(p.spec).spec) }));
  }

  preview(spec: TownSpec): TownPreview {
    const h = specHash(spec);
    const hit = this.previews.get(h);
    if (hit) return hit;
    const sc = scenarioFromSpec(spec);
    const placeOf = new Map(sc.map.places.map((p) => [p.id, p]));
    const hh = new Map(sc.households.map((x) => [x.id, x]));
    const p: TownPreview = {
      hash: h,
      name: sc.name,
      stats: townStats(sc),
      map: sc.map,
      people: sc.people.map((x) => ({ id: x.id, name: x.name, age: x.age, gender: x.gender, role: x.roleLabel, district: placeOf.get(hh.get(x.household)?.place ?? '')?.district ?? 'north', household: hh.get(x.household)?.label ?? '', look: x.look, bio: x.bio })),
      events: sc.events.map((e, i) => describeEventInput(spec.events[i]!) || String(e.id)),
    };
    this.previews.set(h, p);
    if (this.previews.size > 50) this.previews.delete(this.previews.keys().next().value!);
    return p;
  }

  private view(id: string, spec: TownSpec, messages: BuilderMessage[]): BuilderView {
    return { id, spec, messages, preview: this.preview(spec), modelAccess: hasModelAccess() };
  }

  create(presetId?: string): BuilderView {
    const p = presets().find((x) => x.id === presetId) ?? presets()[0]!;
    const spec = normalizeSpec(p.spec).spec;
    const id = `bs_${randomUUID().slice(0, 8)}`;
    const hello: BuilderMessage = {
      role: 'assistant',
      at: new Date().toISOString(),
      source: 'preset',
      text: hasModelAccess()
        ? `从「${p.name}」开始。说说你想观察一个什么样的小镇、想做什么实验，比如“40 人的老城区，老人多、大家很少看手机，通知只贴公告栏”，我来改规格，右边会同步预览。`
        : `从「${p.name}」开始。当前没有配置模型密钥（OpenRouter），对话建镇不可用；可以直接换模板、调右边的参数。`,
      suggestions: ['老人多一些，少有人订推送', '再加一轮周六南区停电', '让标题写清楚精确时间'],
    };
    this.store.saveSession(id, spec, [hello]);
    return this.view(id, spec, [hello]);
  }

  get(id: string): BuilderView | undefined {
    const r = this.store.session(id);
    if (!r) return undefined;
    return this.view(id, normalizeSpec(r.spec).spec, r.messages as BuilderMessage[]);
  }

  /** 表单直改或换模板 */
  setSpec(id: string, input: unknown, source: 'form' | 'preset'): BuilderView & { warnings: string[] } {
    const cur = this.get(id);
    if (!cur) throw new Error('session not found');
    const { spec, warnings } = normalizeSpec(input, cur.spec);
    const changes = specChanges(cur.spec, spec);
    const messages = [...cur.messages];
    if (changes.length || warnings.length) messages.push({ role: 'assistant', at: new Date().toISOString(), source, text: source === 'preset' ? `换成模板「${spec.name}」。` : '已按表单修改。', changes, warnings });
    this.store.saveSession(id, spec, messages);
    return { ...this.view(id, spec, messages), warnings };
  }

  async message(id: string, text: string): Promise<BuilderView & { reply: BuilderMessage }> {
    const cur = this.get(id);
    if (!cur) throw new Error('session not found');
    const userMsg: BuilderMessage = { role: 'user', text: text.slice(0, 500), at: new Date().toISOString() };
    let reply: BuilderMessage;
    let spec = cur.spec;
    if (!hasModelAccess()) {
      reply = { role: 'assistant', at: new Date().toISOString(), source: 'offline', text: '没有配置模型密钥（OpenRouter），对话建镇暂时不可用。可以直接在右边换模板、调参数。' };
    } else {
      const history: ChatMessage[] = cur.messages.slice(-8).map((m) => ({ role: m.role, content: m.role === 'assistant' ? JSON.stringify({ reply: m.text }) : m.text }));
      const stats = this.preview(spec).stats;
      const res = await this.chat.json<{ reply?: unknown; patch?: unknown; suggestions?: unknown }>({
        runId: null,
        purpose: 'builder',
        tpl: BUILDER_TEMPLATE_VERSION,
        temperature: 0.3,
        maxTokens: 1400,
        accept: (d) => !!d && typeof d === 'object' && typeof d.reply === 'string',
        messages: [
          { role: 'system', content: SYSTEM },
          ...history,
          { role: 'user', content: JSON.stringify({ 当前规格: spec, 当前画像: { 人口: stats.population, 户: stats.households, 北区: stats.districts.north, 南区: stats.districts.south, 老人: stats.ages.senior, 年轻人: stats.ages.youth, 订阅推送: stats.push, 常看网站: stats.website, 平均信任官方: stats.trustGov, 人均朋友: stats.friends, 剧本: stats.events }, 用户说: userMsg.text }) },
        ],
      });
      if (!res.ok) {
        reply = { role: 'assistant', at: new Date().toISOString(), source: 'error', text: `这次没能拿到可用的修改（${res.error.slice(0, 60)}），规格没有变。换个说法再试试？` };
      } else {
        const { merged, dropped, notes } = applyPatch(spec, res.data.patch);
        const n = normalizeSpec(merged, spec);
        const changes = specChanges(spec, n.spec);
        spec = n.spec;
        const warnings = [...notes, ...n.warnings, ...dropped.map((k) => `忽略了规格里没有的字段 ${k}`)];
        const suggestions = Array.isArray(res.data.suggestions) ? res.data.suggestions.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 40)).slice(0, 3) : [];
        reply = { role: 'assistant', at: new Date().toISOString(), source: 'model', text: typeof res.data.reply === 'string' && res.data.reply.trim() ? res.data.reply.trim().slice(0, 300) : changes.length ? '已按你的描述调整。' : '规格没有变。', changes, warnings, suggestions };
      }
    }
    const messages = [...cur.messages, userMsg, reply];
    this.store.saveSession(id, spec, messages);
    return { ...this.view(id, spec, messages), reply };
  }
}
