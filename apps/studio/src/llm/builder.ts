import { normalizeSpec, PRESETS, SPEC_LIMITS, TEMPLATE_LABEL, type Adjustment, type CommunitySpec, type HouseholdType } from '@microcity/society';
import { chat, type Deps } from './openrouter.ts';
import { loadPrefs } from './prefs.ts';

export const BUILDER_TEMPLATE_VERSION = 'studio_builder_v1';

const HOUSEHOLD_KEYS: HouseholdType[] = ['elder_couple', 'elder_single', 'three_gen', 'nuclear', 'couple', 'single', 'single_parent', 'sharers'];

/**
 * 对话建镇（D94）：语言模型只能给出对规格的补丁，而且只认白名单里的字段；
 * 补丁再过规范化，越界的拉回范围，并把改了什么告诉用户。
 */
export interface Patch {
  template?: CommunitySpec['template'];
  name?: string;
  population?: number;
  apartments?: number;
  renters?: number;
  wealth?: number;
  cityShare?: number;
  households?: Partial<Record<HouseholdType, number>>;
}

/** 从模型的回答里取出补丁：只留白名单字段、类型对的值 */
export function parsePatch(text: string): { patch: Patch; ignored: string[] } | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim());
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const patch: Patch = {};
  const ignored: string[] = [];
  for (const key of Object.keys(r)) {
    const v = r[key];
    if (key === 'template' && typeof v === 'string' && v in PRESETS) patch.template = v as CommunitySpec['template'];
    else if (key === 'name' && typeof v === 'string' && v.trim()) patch.name = v.trim().slice(0, 12);
    else if ((key === 'population' || key === 'apartments' || key === 'renters' || key === 'wealth' || key === 'cityShare') && typeof v === 'number' && Number.isFinite(v)) patch[key] = v;
    else if (key === 'households' && v && typeof v === 'object') {
      const h: Partial<Record<HouseholdType, number>> = {};
      for (const k of HOUSEHOLD_KEYS) {
        const w = (v as Record<string, unknown>)[k];
        if (typeof w === 'number' && Number.isFinite(w) && w >= 0) h[k] = w;
      }
      for (const k of Object.keys(v)) if (!HOUSEHOLD_KEYS.includes(k as HouseholdType)) ignored.push(`households.${k}`);
      if (Object.keys(h).length) patch.households = h;
    } else ignored.push(key);
  }
  return { patch, ignored };
}

/** 把补丁用在规格上并规范化 */
export function applyPatch(base: CommunitySpec, patch: Patch): { spec: CommunitySpec; adjustments: Adjustment[] } {
  const start = patch.template && patch.template !== base.template ? { ...PRESETS[patch.template] } : base;
  const merged: CommunitySpec = { ...start, ...patch, households: { ...start.households, ...patch.households }, blurb: start.blurb };
  return normalizeSpec(merged);
}

const FIELD_LABEL: Record<string, string> = { population: '人口', apartments: '住楼房的比例', renters: '租房的比例', wealth: '收入水平', cityShare: '去城里上班的比例' };

export type BuildResult = { ok: true; spec: CommunitySpec; notes: string[]; cached: boolean } | { ok: false; reason: string };

export async function buildFromText(deps: Deps, base: CommunitySpec, request: string): Promise<BuildResult> {
  const prefs = loadPrefs(deps.kv);
  const system = [
    '你把一句话的描述变成对“社区规格”的补丁。只输出一个 JSON 对象，不要解释，不要代码块。',
    `可以出现的字段（都可省略）：template（${Object.entries(TEMPLATE_LABEL).map(([k, v]) => `${k}=${v}`).join('，')}）、name（社区名，不超过 6 个字）、population（${SPEC_LIMITS.population.join('–')}）、apartments（住楼房的家庭占比 0–0.9）、renters（租房家庭占比 0–0.9）、wealth（收入水平系数 ${SPEC_LIMITS.wealth.join('–')}，1 是平常）、cityShare（上班的人里去城里的比例 0–0.85）、households（各类家庭的相对权重，键只能是 ${HOUSEHOLD_KEYS.join('、')}，分别是老两口、独居老人、三代同堂、一家三四口、小两口、一个人住、单亲、合租）。`,
    '没有提到的字段不要写。不要编造别的字段。',
  ].join('\n');
  const res = await chat(deps, {
    model: prefs.languageModel,
    purpose: '对话建镇',
    template: BUILDER_TEMPLATE_VERSION,
    maxTokens: 300,
    temperature: 0.2,
    accept: (text) => !!parsePatch(text) && Object.keys(parsePatch(text)!.patch).length > 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `现在的规格：${JSON.stringify({ template: base.template, name: base.name, population: base.population, apartments: base.apartments, renters: base.renters, wealth: base.wealth, cityShare: base.cityShare, households: base.households })}\n\n我想要：${request.slice(0, 300)}` },
    ],
  });
  if (!res.ok) return { ok: false, reason: res.reason === 'rejected' ? '模型的回答不是一份可用的补丁，没有采用。' : res.detail };
  const parsed = parsePatch(res.text)!;
  const { spec, adjustments } = applyPatch(base, parsed.patch);
  const notes = [
    ...Object.keys(parsed.patch).map((k) => (k === 'households' ? '调整了家庭构成' : k === 'template' ? `换成了${TEMPLATE_LABEL[spec.template]}的底子` : k === 'name' ? `改名为${spec.name}` : `${FIELD_LABEL[k] ?? k}改为 ${spec[k as 'population']}`)),
    ...adjustments.map((a) => `${FIELD_LABEL[a.field] ?? a.field}：${a.from} 超出范围，已改为 ${a.to}`),
    ...(parsed.ignored.length ? [`没有采用的字段：${parsed.ignored.join('、')}`] : []),
  ];
  return { ok: true, spec, notes, cached: res.cached };
}
