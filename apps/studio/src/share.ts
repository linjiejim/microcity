import { normalizeSpec, OLDTOWN, parseTime, PRESETS, RUMORS, validateExperiment, type CommunitySpec, type Experiment, type Intervention } from '@microcity/society';
import type { WorldConfig } from './sim/protocol.ts';

/**
 * 分享链接（D85、D96）：
 *   #w=…  一个世界（社区规格、种子、干预）
 *   #x=…  一份实验清单
 *   ?t=D03 18:30&who=p001  停在哪一刻、跟着谁
 * 链接里的东西一律当作不可信的输入：规格过规范化，干预逐条检查形状。密钥永远不进链接。
 */

const enc = (x: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(x));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const dec = (s: string): unknown => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const day = (v: unknown): v is number => num(v, 1, 60) && Number.isInteger(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 40;

/** 一条干预的形状对不对；不对返回 undefined */
export function cleanIntervention(raw: unknown): Intervention | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const to = r.to === undefined ? {} : day(r.to) ? { to: r.to } : undefined;
  if (!to) return undefined;
  switch (r.kind) {
    case 'close':
      return str(r.place) && day(r.from) ? { kind: 'close', place: r.place, from: r.from, ...to } : undefined;
    case 'price':
      return str(r.place) && str(r.item) && num(r.factor, 0.1, 5) && day(r.from) ? { kind: 'price', place: r.place, item: r.item, factor: r.factor, from: r.from, ...to } : undefined;
    case 'grant':
      return num(r.amount, 1, 20000) && day(r.day) ? { kind: 'grant', amount: r.amount, day: r.day, ...(Array.isArray(r.households) ? { households: r.households.filter(str) as never } : {}) } : undefined;
    case 'layoff':
      return str(r.place) && num(r.fraction, 0, 1) && day(r.day) ? { kind: 'layoff', place: r.place, fraction: r.fraction, day: r.day } : undefined;
    case 'rent':
      return num(r.factor, 0.1, 5) && day(r.from) ? { kind: 'rent', factor: r.factor, from: r.from, ...to } : undefined;
    case 'canteen':
      return str(r.place) && num(r.price, 1, 100) && day(r.from) ? { kind: 'canteen', place: r.place, price: r.price, from: r.from, ...to } : undefined;
    case 'weather':
      return (r.weather === 'sun' || r.weather === 'cloud' || r.weather === 'rain') && day(r.from) && day(r.to) ? { kind: 'weather', weather: r.weather, from: r.from, to: r.to } : undefined;
    case 'rumor':
      return str(r.topic) && r.topic in RUMORS && num(r.seeds, 1, 50) && day(r.day) ? { kind: 'rumor', topic: r.topic, seeds: Math.round(r.seeds), day: r.day } : undefined;
    default:
      return undefined;
  }
}

export function cleanInterventions(raw: unknown): Intervention[] {
  return Array.isArray(raw) ? raw.slice(0, 12).map(cleanIntervention).filter((x): x is Intervention => !!x) : [];
}

export function cleanSpec(raw: unknown): CommunitySpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CommunitySpec>;
  const preset = PRESETS[r.template as CommunitySpec['template']] ?? OLDTOWN;
  return normalizeSpec({ ...preset, ...r, households: { ...preset.households, ...(r.households && typeof r.households === 'object' ? r.households : {}) } }).spec;
}

export function cleanConfig(raw: unknown): WorldConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { spec: cleanSpec(r.spec), seed: num(r.seed, 0, 1e9) ? Math.round(r.seed) : 1, interventions: cleanInterventions(r.interventions) };
}

export function cleanExperiment(raw: unknown): Experiment | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const x: Experiment = {
    name: String(r.name ?? '').slice(0, 40),
    question: String(r.question ?? '').slice(0, 120),
    spec: cleanSpec(r.spec),
    seeds: Array.isArray(r.seeds) ? r.seeds.filter((s): s is number => num(s, 0, 1e9)).map(Math.round) : [],
    days: num(r.days, 1, 60) ? Math.round(r.days) : 0,
    interventions: cleanInterventions(r.interventions),
    ...(day(r.from) ? { from: r.from } : {}),
    ...(r.resample === true ? { resample: true } : {}),
    predictions: Array.isArray(r.predictions)
      ? r.predictions
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .slice(0, 8)
          .map((p, i) => ({ id: `P${i + 1}`, text: String(p.text ?? '').slice(0, 80), metric: String(p.metric ?? ''), expect: p.expect === 'lower' ? ('lower' as const) : ('higher' as const) }))
      : [],
  };
  return validateExperiment(x).length === 0 ? x : undefined;
}

export interface Link {
  config: WorldConfig;
  experiment?: Experiment;
  t?: number;
  who?: string;
  view?: string;
}

export function readLink(search: string, hash: string): Link {
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  let config: WorldConfig = { spec: PRESETS[q.get('c') as CommunitySpec['template']] ?? OLDTOWN, seed: 1, interventions: [] };
  let experiment: Experiment | undefined;
  try {
    if (h.get('w')) config = cleanConfig(dec(h.get('w')!));
    if (h.get('x')) experiment = cleanExperiment(dec(h.get('x')!));
  } catch {
    // 坏链接：按默认的世界打开
  }
  const seed = Number(q.get('seed'));
  if (q.has('seed') && Number.isFinite(seed)) config = { ...config, seed: Math.round(seed) };
  let t: number | undefined;
  try {
    if (q.get('t')) t = parseTime(q.get('t')!);
  } catch {
    t = undefined;
  }
  return { config, ...(experiment ? { experiment } : {}), ...(t !== undefined ? { t } : {}), ...(q.get('who') ? { who: q.get('who')! } : {}), ...(q.get('v') ? { view: q.get('v')! } : {}) };
}

const isDefault = (c: WorldConfig): boolean => c.interventions.length === 0 && JSON.stringify(c.spec) === JSON.stringify(PRESETS[c.spec.template]);

/** 指向一个世界（可带时刻与人）的链接 */
export function worldLink(base: string, config: WorldConfig, at?: { t: string; who?: string | null }): string {
  const q = new URLSearchParams();
  if (isDefault(config)) {
    if (config.spec.template !== 'oldtown') q.set('c', config.spec.template);
    if (config.seed !== 1) q.set('seed', String(config.seed));
  }
  if (at) {
    q.set('t', at.t);
    if (at.who) q.set('who', at.who);
  }
  const qs = q.toString();
  return `${base}${qs ? `?${qs}` : ''}${isDefault(config) ? '' : `#w=${enc(config)}`}`;
}

export function experimentLink(base: string, x: Experiment): string {
  return `${base}?v=lab#x=${enc(x)}`;
}
