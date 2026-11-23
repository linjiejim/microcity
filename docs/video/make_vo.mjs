// 旁白：content.js 的每一句用 macOS 自带的 say（婷婷）念成一段，量出时长与句中停顿，
// 排成时间线，写出 timing.js（comp.html 读它排画面和字幕）与 .work/vo.wav。
//   node docs/video/make_vo.mjs            # 只重念改过的句子（按文字缓存）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = resolve(HERE, '.work/vo');
mkdirSync(WORK, { recursive: true });
const ctx = {};
vm.runInNewContext(readFileSync(resolve(HERE, 'content.js'), 'utf8'), ctx);
const { LINES, DEFAULT_GAP, LEAD, TAIL } = ctx.MC;
const VOICE = process.env.VOICE ?? 'Tingting';
const RATE = Number(process.env.RATE ?? 212);
const SR = 48000;

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const dur = (f) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim());
/** 句中的停顿 [起, 止]（秒） */
function pauses(f) {
  const r = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${f}" -af silencedetect=n=-42dB:d=0.11 -f null - 2>&1 | grep silence_ || true`], { encoding: 'utf8' });
  const ps = [];
  let s0 = null;
  for (const line of r.split('\n')) {
    const a = line.match(/silence_start: ([\d.]+)/), b = line.match(/silence_end: ([\d.]+)/);
    if (a) s0 = Number(a[1]);
    if (b && s0 !== null) { ps.push([s0, Number(b[1])]); s0 = null; }
  }
  return ps;
}

const timeline = [];
let t = LEAD;
LINES.forEach((L, i) => {
  const say = L.read ?? L.text;
  const key = createHash('sha1').update(`${VOICE}|${RATE}|${say}`).digest('hex').slice(0, 10);
  const raw = `${WORK}/${L.id}-${key}.aiff`, wav = `${WORK}/${L.id}-${key}.wav`;
  if (!existsSync(wav)) {
    run('say', ['-v', VOICE, '-r', String(RATE), '-o', raw, say]);
    // 去掉首尾的静音，统一成 48 kHz 单声道
    run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse', '-ar', String(SR), '-ac', '1', wav]);
  }
  const d = dur(wav);
  const ps = pauses(wav).filter(([a, b]) => a > 0.15 && b < d - 0.1);
  if (i > 0 || L.gap) t += i === 0 ? 0 : L.gap ?? DEFAULT_GAP;
  timeline.push({ id: L.id, beat: L.beat, text: L.text, t0: +t.toFixed(3), t1: +(t + d).toFixed(3), wav, pauses: ps.map(([a, b]) => [+(t + a).toFixed(3), +(t + b).toFixed(3)]) });
  t += d;
});
const total = +(t + TAIL).toFixed(3);

// 字幕：按标点切成不超过 MAX 个字的小段，句中停顿对上标点就用停顿的时刻，否则按字数分
const MAX = 21;
const len = (s) => [...s].length;
for (const L of timeline) {
  const parts = L.text.match(/[^，；：。？、]+[，；：。？、]?/g) ?? [L.text];
  const groups = [];
  for (const p of parts) {
    const last = groups[groups.length - 1];
    if (last && len(last + p) <= MAX && !/[。？；]$/.test(last)) groups[groups.length - 1] = last + p;
    else groups.push(p);
  }
  // 每组末尾的标点位置 → 对应的停顿
  const ends = [];
  let acc = 0;
  const totalLen = len(L.text);
  for (const g of groups) { acc += len(g); ends.push(acc); }
  const subs = [];
  let s0 = L.t0;
  groups.forEach((g, k) => {
    let s1 = L.t1;
    if (k < groups.length - 1) {
      const guess = L.t0 + (L.t1 - L.t0) * (ends[k] / totalLen);
      const near = L.pauses.map(([a, b]) => (a + b) / 2).sort((x, y) => Math.abs(x - guess) - Math.abs(y - guess))[0];
      s1 = near !== undefined && Math.abs(near - guess) < 0.9 ? near : guess;
    }
    subs.push({ text: g.replace(/[，；：、]$/, ''), t0: +s0.toFixed(3), t1: +s1.toFixed(3) });
    s0 = s1;
  });
  L.subs = subs;
}

// 混一条旁白轨
const inputs = [], filters = [];
timeline.forEach((L, i) => {
  inputs.push('-i', L.wav);
  filters.push(`[${i}]adelay=${Math.round(L.t0 * 1000)}|${Math.round(L.t0 * 1000)}[d${i}]`);
});
const mix = `${filters.join(';')};${timeline.map((_, i) => `[d${i}]`).join('')}amix=inputs=${timeline.length}:normalize=0,apad=whole_dur=${total}[out]`;
run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', mix, '-map', '[out]', '-ar', String(SR), '-ac', '1', '-t', String(total), resolve(HERE, '.work/vo.wav')]);

const slim = timeline.map(({ wav, ...rest }) => rest);
writeFileSync(resolve(HERE, 'timing.js'), `// 由 make_vo.mjs 生成，别手改\nwindow.MC_TIMING = ${JSON.stringify({ voice: VOICE, rate: RATE, total, lines: slim })};\n`);
for (const L of timeline) console.log(L.id.padEnd(4), L.t0.toFixed(2).padStart(6), (L.t1 - L.t0).toFixed(2).padStart(5), L.subs.map((s) => s.text).join(' / '));
console.log('total', total, 's');
