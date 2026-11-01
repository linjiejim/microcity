import { hash53 } from './rng.ts';

/** 规范化 JSON：对象键排序、丢弃 undefined，保证同内容同字符串。 */
export function canonical(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortDeep(x);
    }
    return out;
  }
  return v;
}

/** 106 位内容哈希（两次 cyrb53），十六进制。纯 JS，前后端一致。 */
export function contentHash(value: unknown): string {
  const s = typeof value === 'string' ? value : canonical(value);
  const a = hash53(s, 0x9e3779b1).toString(16).padStart(14, '0');
  const b = hash53(s, 0x85ebca6b).toString(16).padStart(14, '0');
  return a + b;
}

export const shortHash = (value: unknown): string => contentHash(value).slice(0, 10);
