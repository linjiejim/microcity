// 声音：全部本地合成，不用任何外部素材。
//   node docs/video/sound.mjs   → .work/music.wav（铺底）、.work/sfx.wav（点击与衔接），再混成 .work/mix.wav
// 铺底是 F 大调的四个和弦循环（Fmaj7 → Dm9 → B♭maj7 → C6/9），柔和的长音加一点木琴似的拨音；
// 效果音只放在点击和几次大的衔接上，和铺底共用一个混响。人声出现时铺底自动压低（sidechaincompress）。
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, '../../package.json'));
const { chromium } = require('@playwright/test');
const SR = 48000;

// 时间与事件从片子里读
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('file://' + resolve(HERE, 'comp.html'));
const { dur, events, beats } = await page.evaluate(async () => {
  await window.__ready;
  const L = window.MC_TIMING.lines, at = (id) => L.find((l) => l.id === id).t0;
  return { dur: window.__meta.dur, events: window.__events(), beats: { b2: at('c1'), b3: at('v1'), b4: at('r1'), outro: at('r6'), end: at('r7') } };
});
await browser.close();

const N = Math.ceil(dur * SR);
const music = [new Float32Array(N), new Float32Array(N)], sfx = [new Float32Array(N), new Float32Array(N)];
const send = [new Float32Array(N), new Float32Array(N)]; // 进混响的部分
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

function add(buf, t0, sig, gain, pan = 0, rev = 0) {
  const i0 = Math.round(t0 * SR), gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < sig.length; i++) {
    const j = i0 + i; if (j < 0 || j >= N) continue;
    buf[0][j] += sig[i] * gl; buf[1][j] += sig[i] * gr;
    if (rev) { send[0][j] += sig[i] * gl * rev; send[1][j] += sig[i] * gr * rev; }
  }
}
// 音色
function padNote(f, len, att = 1.4, rel = 1.6) {
  const n = Math.round((len + rel) * SR), out = new Float32Array(n);
  const d = 1.0016, ph = rnd() * 6.28;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = smooth(t / att) * (t > len ? Math.exp(-(t - len) / (rel / 3)) : 1);
    const s = Math.sin(6.2832 * f * t + ph) + 0.5 * Math.sin(6.2832 * f * d * t) + 0.18 * Math.sin(6.2832 * 2 * f * t + 1.3) + 0.06 * Math.sin(6.2832 * 3 * f * t);
    lp += (s - lp) * 0.18; // 柔一点
    out[i] = lp * env * (1 + 0.04 * Math.sin(6.2832 * 0.23 * t));
  }
  return out;
}
function pluck(f, decay = 0.7) {
  const n = Math.round(decay * 5 * SR), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, a = Math.min(1, t / 0.004);
    out[i] = a * (Math.sin(6.2832 * f * t) * Math.exp(-t / decay) + 0.35 * Math.sin(6.2832 * 2 * f * t) * Math.exp(-t / (decay * 0.45)) + 0.12 * Math.sin(6.2832 * 3.98 * f * t) * Math.exp(-t / (decay * 0.2)));
  }
  return out;
}
function bell(f, decay = 1.6) {
  const n = Math.round(decay * 5 * SR), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR, a = Math.min(1, t / 0.003); out[i] = a * (Math.sin(6.2832 * f * t) * Math.exp(-t / decay) + 0.3 * Math.sin(6.2832 * 2.76 * f * t) * Math.exp(-t / (decay * 0.3)) + 0.12 * Math.sin(6.2832 * 5.4 * f * t) * Math.exp(-t / (decay * 0.12))); }
  return out;
}
function noise(len, { lp0 = 3000, lp1 = 3000, hp = 200, shape = (u) => 1 } = {}) {
  const n = Math.round(len * SR), out = new Float32Array(n);
  let l = 0, h = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, fc = lp0 * Math.pow(lp1 / lp0, u), a = 1 - Math.exp(-6.2832 * fc / SR);
    const x = rnd() * 2 - 1; l += (x - l) * a;
    const ah = Math.exp(-6.2832 * hp / SR); h = ah * (h + l - prev); prev = l;
    out[i] = h * shape(u);
  }
  return out;
}
const env = (attack, peak = 0.5) => (u) => (u < peak ? Math.pow(u / peak, 2) : Math.pow(1 - (u - peak) / (1 - peak), 2.2)) * (attack ? 1 : 1);
function tone(f, len, decay) { const n = Math.round(len * SR), o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; o[i] = Math.sin(6.2832 * f * t) * Math.exp(-t / decay) * Math.min(1, t / 0.002); } return o; }
function mixInto(a, b, g = 1) { for (let i = 0; i < Math.min(a.length, b.length); i++) a[i] += b[i] * g; return a; }

// 铺底
const BAR = 3.2; // 75 BPM 的 4/4
const CHORDS = [
  { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7
  { root: 38, notes: [50, 53, 57, 60, 64] }, // Dm9
  { root: 46, notes: [50, 53, 57, 58] }, // B♭maj7
  { root: 48, notes: [52, 55, 57, 62] }, // C6/9
];
const ARP = [[72, 69, 65, 69], [69, 65, 62, 64], [70, 65, 62, 65], [67, 64, 62, 67]];
const start = 0.2;
const level = (t) => {
  // 段落：开头只有长音，第二、三段加拨音，第四段稀一点，结尾只剩长音
  const fadeIn = smooth((t - start) / 2.5), fadeOut = 1 - smooth((t - (dur - 2.2)) / 2.0);
  return fadeIn * fadeOut;
};
for (let b = 0; start + b * BAR < dur; b++) {
  const t = start + b * BAR, ch = CHORDS[b % 4];
  const last = t > beats.end + 1.2; // 结尾：落在 F 上，不再换
  const c = last ? CHORDS[0] : ch;
  const len = BAR + 0.25;
  const g = 0.05 * level(t + 1);
  for (const m of c.notes) add(music, t, padNote(hz(m), len), g * (m > 60 ? 0.7 : 1), (m - 57) / 14, 0.35);
  add(music, t, padNote(hz(c.root), len, 0.4, 1.2), g * 1.15, 0, 0.1);
  // 拨音：第二段起每拍一个，第三段每半拍加一个轻的，第四段每两拍一个
  const inB2 = t >= beats.b2 - 0.2, inB3 = t >= beats.b3 - 0.2, inB4 = t >= beats.b4 - 0.4, outro = t >= beats.outro - 0.6;
  if (!inB2 || outro) continue;
  const arp = ARP[b % 4];
  for (let q = 0; q < 8; q++) {
    const tq = t + q * (BAR / 8);
    if (q % 2 === 1 && !(inB3 && !inB4)) continue;
    if (inB4 && q % 4 !== 0) continue;
    const m = arp[(q >> 1) % 4] + (q % 2 ? 12 : 0);
    const v = (q % 2 ? 0.45 : 0.85) * (0.8 + 0.4 * rnd());
    add(music, tq, pluck(hz(m), q % 2 ? 0.35 : 0.6), 0.032 * v * level(tq), (rnd() - 0.5) * 0.7, 0.55);
  }
}
// 结尾：名字落下时一声钟
const land = events.find((e) => e.kind === 'land');
if (land) { add(music, land.t, bell(hz(77), 2.4), 0.05, 0.1, 0.6); add(music, land.t + 0.09, bell(hz(81), 2.0), 0.03, -0.2, 0.6); }

// 效果音
for (const e of events) {
  const p = (rnd() - 0.5) * 0.4;
  if (e.kind === 'click') {
    const s = mixInto(noise(0.018, { lp0: 6000, lp1: 2500, hp: 1800, shape: (u) => Math.pow(1 - u, 3) }), tone(2600, 0.02, 0.004), 0.25);
    add(sfx, e.t - 0.005, s, 0.32, p, 0.12);
    add(sfx, e.t + 0.075, s, 0.16, p, 0.1);
  } else if (e.kind === 'whoosh' || e.kind === 'whoosh-soft') {
    const len = e.kind === 'whoosh' ? 0.8 : 0.55;
    add(sfx, e.t - len * 0.35, noise(len, { lp0: 300, lp1: 2400, hp: 120, shape: env(0, 0.55) }), e.kind === 'whoosh' ? 0.22 : 0.13, -0.3, 0.4);
  } else if (e.kind === 'tick' || e.kind === 'tick-soft') {
    const f = e.kind === 'tick' ? 820 : 640;
    const s = mixInto(mixInto(tone(f, 0.12, 0.03), tone(f * 2.02, 0.08, 0.012), 0.4), noise(0.01, { lp0: 4000, lp1: 2000, hp: 800, shape: (u) => 1 - u }), 0.3);
    add(sfx, e.t, s, e.kind === 'tick' ? 0.2 : 0.12, p, 0.3);
  } else if (e.kind === 'cast') {
    add(sfx, e.t, bell(hz(84), 1.1), 0.05, 0, 0.5);
    add(sfx, e.t + 0.2, bell(hz(84), 1.1), 0.025, 0.3, 0.5);
  } else if (e.kind === 'swell') {
    [79, 84, 88].forEach((m, i) => add(sfx, e.t + i * 0.07, bell(hz(m), 0.7), 0.022, (i - 1) * 0.4, 0.6));
  } else if (e.kind === 'flip') {
    const s = noise(0.05, { lp0: 1600, lp1: 900, hp: 300, shape: (u) => Math.sin(Math.PI * u) });
    add(sfx, e.t - 0.12, s, 0.2, -0.2, 0.2); add(sfx, e.t + 0.02, s, 0.16, 0.2, 0.2);
  } else if (e.kind === 'land') {
    const n = Math.round(0.4 * SR), th = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / SR; th[i] = Math.sin(6.2832 * (55 + 40 * Math.exp(-t / 0.05)) * t) * Math.exp(-t / 0.12) * Math.min(1, t / 0.004); }
    add(sfx, e.t, th, 0.35, 0, 0.1);
  }
}

// 一个共用的混响（Freeverb 式：四个梳状 + 两个全通）
function reverb(x, offset) {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d: Math.round((d + offset) * SR / 44100), buf: null, i: 0, lp: 0 }));
  const aps = [556, 441].map((d) => ({ d: Math.round((d + offset) * SR / 44100), buf: null, i: 0 }));
  combs.forEach((c) => (c.buf = new Float32Array(c.d))); aps.forEach((a) => (a.buf = new Float32Array(a.d)));
  const y = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let s = 0;
    for (const c of combs) { const o = c.buf[c.i]; c.lp = o * 0.75 + c.lp * 0.25; c.buf[c.i] = x[n] * 0.5 + c.lp * 0.86; c.i = (c.i + 1) % c.d; s += o; }
    for (const a of aps) { const bo = a.buf[a.i]; const out = -s + bo; a.buf[a.i] = s + bo * 0.5; a.i = (a.i + 1) % a.d; s = out; }
    y[n] = s * 0.25;
  }
  return y;
}
const wetL = reverb(send[0], 0), wetR = reverb(send[1], 23);

// 效果音的混响混进 sfx，铺底的混进 music（简单起见按各自送出的比例分）
for (let i = 0; i < N; i++) { music[0][i] += wetL[i] * 0.9; music[1][i] += wetR[i] * 0.9; }

function writeWav(path, ch) {
  const n = ch[0].length, data = Buffer.alloc(n * 4);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ch[0][i]), Math.abs(ch[1][i]));
  const g = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < n; i++) { data.writeInt16LE(Math.round(clamp(ch[0][i] * g, -1, 1) * 32767), i * 4); data.writeInt16LE(Math.round(clamp(ch[1][i] * g, -1, 1) * 32767), i * 4 + 2); }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
  return peak;
}
const W = (p) => resolve(HERE, '.work', p);
console.log('music peak', writeWav(W('music.wav'), music).toFixed(3), 'sfx peak', writeWav(W('sfx.wav'), sfx).toFixed(3));

// 混音：人声为主；铺底在人声下面压低；最后整体到 -16 LUFS
const MUSIC_DB = Number(process.env.MUSIC_DB ?? -13), SFX_DB = Number(process.env.SFX_DB ?? -6);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', W('vo.wav'), '-i', W('music.wav'), '-i', W('sfx.wav'), '-filter_complex', [
  `[0]highpass=f=80,acompressor=threshold=-22dB:ratio=2.5:attack=5:release=90:makeup=2,aformat=channel_layouts=stereo,asplit=2[vo][key]`,
  `[1]volume=${MUSIC_DB}dB[m]`,
  `[m][key]sidechaincompress=threshold=0.015:ratio=5:attack=25:release=380:makeup=1[md]`,
  `[2]volume=${SFX_DB}dB[s]`,
  `[vo][md][s]amix=inputs=3:normalize=0,loudnorm=I=-16:TP=-2:LRA=9[out]`,
].join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', W('mix.wav')]);
console.log('mix →', W('mix.wav'));
