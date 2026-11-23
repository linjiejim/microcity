import type { Bucket, NeedKey } from '@microcity/society';

/**
 * canvas 与三维场景用的颜色：与 tokens.css 同一套值（canvas / three 读不到 CSS 变量）。
 */
export const PAL = {
  paper: '#faf7f2',
  surface: '#ffffff',
  surface2: '#f3eee6',
  line: '#e7e0d5',
  line2: '#d8cfc1',
  ink: '#26241f',
  ink2: '#5e5a52',
  ink3: '#8f897e',
  teal: '#1f5f63',
  teal2: '#2e7c80',
  amber: '#e3a13a',
  ok: '#3e8e63',
  bad: '#c2553a',
  info: '#4b7ead',
  plum: '#8a6a9a',
} as const;

/** 时间利用分桶的颜色：时间轴、作息、图例统一 */
export const BUCKET_HEX: Record<Bucket, string> = {
  sleep: '#5b6b8c',
  rest: '#9aa6bd',
  work: '#1f5f63',
  study: '#4b7ead',
  meal: '#e3a13a',
  chores: '#9c6b4e',
  leisure: '#5c9e6e',
  travel: '#bdb6aa',
  other: '#d8cfc1',
};

export const NEED_HEX: Record<NeedKey, string> = { hunger: '#e3a13a', energy: '#5b6b8c', social: '#d9776a', fun: '#5c9e6e' };

export const FONT_UI = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
