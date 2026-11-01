/**
 * 计数器式随机数：值只由 (seed, key...) 决定，与调用顺序无关。
 * 分支里多出一次抽样不会让其他抽样错位（见 spec D7）。
 */

/** cyrb53：53 位字符串哈希，纯整数运算，跨平台确定。 */
export function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export type RngKey = ReadonlyArray<string | number>;

export const rngKeyString = (key: RngKey): string => key.join('|');

/** [0, 1) 均匀分布 */
export function rand(seed: number, ...key: RngKey): number {
  return hash53(rngKeyString(key), seed) / 9007199254740992;
}

/** [lo, hi] 整数 */
export function randInt(seed: number, lo: number, hi: number, ...key: RngKey): number {
  return lo + Math.floor(rand(seed, ...key) * (hi - lo + 1));
}

/** 标准正态（Box-Muller） */
export function randNormal(seed: number, ...key: RngKey): number {
  const u1 = Math.max(1e-12, rand(seed, ...key, 'n1'));
  const u2 = rand(seed, ...key, 'n2');
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** 以抖动（分钟）偏移，结果取整到分钟 */
export function jitterMin(seed: number, spreadMin: number, ...key: RngKey): number {
  return Math.round(randNormal(seed, ...key) * spreadMin) * 60;
}

export function pick<T>(arr: readonly T[], seed: number, ...key: RngKey): T {
  if (arr.length === 0) throw new Error('pick from empty array');
  return arr[Math.floor(rand(seed, ...key) * arr.length)]!;
}

/** 按权重抽样，返回下标与所用随机数 */
export function weightedIndex(weights: readonly number[], u: number): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(0, weights[i]!) / total;
    if (u < acc) return i;
  }
  return weights.length - 1;
}

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
/** 数值保留 3 位，便于审计记录稳定 */
export const r3 = (x: number): number => Math.round(x * 1000) / 1000;
