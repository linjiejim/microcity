// 旁白：content.js 的每一句用 MiniMax 念成一段，量出时长与句中停顿，排成时间线，
// 写出 timing.js（comp.html 读它排画面和字幕）与 .work/vo.wav。
//   node docs/video/make_vo.mjs              # 中文（只重念改过的句子，按嗓音与文字缓存）
//   node docs/video/make_vo.mjs --lang en    # 英文 → timing.en.js 与 .work/vo.en.wav
// 念好的每一句存在 vo/<lang>/ 并进仓库：改了哪句才需要密钥（MINIMAX_API_KEY，只从环境变量读）。
// ENGINE=say 退回 macOS 自带的 say（不需要密钥，只用来对时间）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MODEL, TONES, synth } from './minimax.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LANG = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : 'zh';
const EN = LANG === 'en';
const ctx = {};
vm.runInNewContext(readFileSync(resolve(HERE, 'content.js'), 'utf8'), ctx);
const { DEFAULT_GAP, LEAD, TAIL } = ctx.MC;
const LINES = EN ? ctx.MC.LINES_EN : ctx.MC.LINES;
const ENGINE = process.env.ENGINE ?? 'minimax';

// 嗓音：试音后选定（README.md 记着为什么）
const VOICES = {
  zh: { voice: 'Chinese (Mandarin)_Gentleman', speed: 1.15 },
  en: { voice: 'English_expressive_narrator', speed: 1.1 },
};
// 临时换嗓音：VOICE_ZH / SPEED_ZH、VOICE_EN / SPEED_EN（分语言，免得做英文版时把中文也换了）
const ENV = (k) => process.env[`${k}_${LANG.toUpperCase()}`];
const V = { ...VOICES[LANG], ...(ENV('VOICE') ? { voice: ENV('VOICE') } : {}), ...(ENV('SPEED') ? { speed: Number(ENV('SPEED')) } : {}) };
const SR = 48000;
const KEEP = resolve(HERE, 'vo', LANG); // 念好的 mp3（进仓库）
const WORK = resolve(HERE, '.work/vo', LANG); // 转好的 wav（不进仓库）
mkdirSync(KEEP, { recursive: true });
mkdirSync(WORK, { recursive: true });

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
// 去掉首尾的静音，统一成 48 kHz 单声道
const TRIM = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06,areverse';

const timeline = [];
const used = new Set();
let t = LEAD;
for (const [i, L] of LINES.entries()) {
  const say = L.read ?? L.text;
  const sig = ENGINE === 'say' ? `say|Tingting|232|${say}` : `${MODEL}|${V.voice}|${V.speed}|${(TONES[LANG] ?? []).join(',')}|${say}`;
  const key = createHash('sha1').update(sig).digest('hex').slice(0, 10);
  const src = ENGINE === 'say' ? `${WORK}/${L.id}-${key}.aiff` : `${KEEP}/${L.id}-${key}.mp3`;
  const wav = `${WORK}/${L.id}-${key}.wav`;
  used.add(`${L.id}-${key}.mp3`);
  if (!existsSync(src)) {
    if (ENGINE === 'say') run('say', ['-v', 'Tingting', '-r', '232', '-o', src, say]);
    else { const d = await synth({ text: say, voice: V.voice, speed: V.speed, out: src, lang: LANG }); console.log(`念了 ${L.id}（${d.toFixed(2)} s）`); }
  }
  if (!existsSync(wav)) run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', TRIM + (ENGINE === 'say' ? ',atempo=1.07' : ''), '-ar', String(SR), '-ac', '1', wav]);
  const d = dur(wav);
  const ps = pauses(wav).filter(([a, b]) => a > 0.15 && b < d - 0.1);
  if (i > 0) t += L.gap ?? DEFAULT_GAP;
  timeline.push({ id: L.id, beat: L.beat, text: L.text, t0: +t.toFixed(3), t1: +(t + d).toFixed(3), wav, pauses: ps.map(([a, b]) => [+(t + a).toFixed(3), +(t + b).toFixed(3)]) });
  t += d;
}
// 改过的句子留下的旧录音删掉，免得仓库里越积越多
if (ENGINE !== 'say') for (const f of readdirSync(KEEP)) if (f.endsWith('.mp3') && !used.has(f)) rmSync(`${KEEP}/${f}`);
const total = +(t + TAIL).toFixed(3);

// 字幕：按标点切成小段（中文不超过 20 个字，英文不超过 56 个字符），
// 句中停顿对上标点就用停顿的时刻，否则按字数分
const MAX = EN ? 56 : 20;
const MIN = EN ? 18 : 0; // 英文太短的一段（“Later,”）并进下一段，只要合起来不超过 MAX2
const MAX2 = 70;
const len = (s) => [...s].length;
const PARTS = EN ? /.+?(?:[,;:.?!](?=\s|$)|$)\s*/g : /[^，；：。？]+[，；：。？]?/g; // 英文只在后面跟空格的标点处切（5.5 不切）
const HARD = EN ? /[.?;!]\s*$/ : /[。？；]$/;
for (const L of timeline) {
  const parts = L.text.match(PARTS) ?? [L.text];
  let groups = [];
  for (const p of parts) {
    const last = groups[groups.length - 1];
    if (last && len(last + p) <= MAX && !HARD.test(last)) groups[groups.length - 1] = last + p;
    else groups.push(p);
  }
  if (MIN) {
    const merged = [];
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k], n = groups[k + 1];
      if (n !== undefined && len(g.trim()) < MIN && len(g + n) <= MAX2) { groups[k + 1] = g + n; continue; }
      merged.push(g);
    }
    groups = merged;
  }
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
    const clean = EN ? g.trim().replace(/[,;:.]$/, '') : g.replace(/[，；、：。]$/, '');
    subs.push({ text: clean, t0: +s0.toFixed(3), t1: +s1.toFixed(3) });
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
run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', mix, '-map', '[out]', '-ar', String(SR), '-ac', '1', '-t', String(total), resolve(HERE, EN ? '.work/vo.en.wav' : '.work/vo.wav')]);

const slim = timeline.map(({ wav, ...rest }) => rest);
const who = ENGINE === 'say' ? { engine: 'say', voice: 'Tingting' } : { engine: 'minimax', model: MODEL, voice: V.voice, speed: V.speed };
writeFileSync(resolve(HERE, EN ? 'timing.en.js' : 'timing.js'), `// 由 make_vo.mjs 生成，别手改\nwindow.${EN ? 'MC_TIMING_EN' : 'MC_TIMING'} = ${JSON.stringify({ ...who, lang: LANG, total, lines: slim })};\n`);
for (const L of timeline) console.log(L.id.padEnd(4), L.t0.toFixed(2).padStart(6), (L.t1 - L.t0).toFixed(2).padStart(5), L.subs.map((s) => s.text).join(' / '));
console.log('total', total, 's', JSON.stringify(who));
