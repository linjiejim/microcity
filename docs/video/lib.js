// 介绍片用的几个纯函数：缓动、弹簧、画布小工具。所有值都是时间的函数（同一个 t 永远画出同一帧）。
(function (root) {
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const seg = (t, t0, t1) => (t1 <= t0 ? (t >= t1 ? 1 : 0) : clamp((t - t0) / (t1 - t0)));
  const pow = (n) => (u) => 1 - Math.pow(1 - u, n);
  const powIO = (n) => (u) => (u < 0.5 ? Math.pow(2, n - 1) * Math.pow(u, n) : 1 - Math.pow(-2 * u + 2, n) / 2);
  const E = 1 - Math.pow(2, -10);
  const ease = {
    linear: (u) => u,
    smooth: (u) => u * u * (3 - 2 * u),
    sineIO: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
    cubicIO: powIO(3),
    quintIO: powIO(5),
    quadOut: pow(2),
    cubicOut: pow(3),
    quartOut: pow(4),
    quintOut: pow(5),
    expoOut: (u) => (u <= 0 ? 0 : u >= 1 ? 1 : (1 - Math.pow(2, -10 * u)) / E),
    expoIn: (u) => (u <= 0 ? 0 : u >= 1 ? 1 : (Math.pow(2, 10 * u) - 1) / 1023),
    expoIO: (u) => (u < 0.5 ? ease.expoIn(2 * u) / 2 : 1 - ease.expoIn(2 - 2 * u) / 2),
    backOut: (u) => 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2),
  };
  const tw = (t, t0, t1, curve = ease.cubicIO) => curve(seg(t, t0, t1));

  /** 欠阻尼弹簧的闭式解：tau 秒后走完的比例（会略冲过 1 再回来） */
  function spring(tau, zeta = 0.62, omega = 18) {
    if (tau <= 0) return 0;
    if (zeta < 1) {
      const wd = omega * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * omega * tau) * (Math.cos(wd * tau) + ((zeta * omega) / wd) * Math.sin(wd * tau));
    }
    return 1 - Math.exp(-omega * tau) * (1 + omega * tau);
  }
  /** 入场：弹簧上浮 + 一点放大 */
  function rise(t, t0, { dist = 22, zeta = 0.66, omega = 17 } = {}) {
    const k = spring(t - t0, zeta, omega);
    return { k, op: clamp(k * 1.6), dy: (1 - k) * dist, s: 0.95 + 0.05 * k };
  }
  /** 出场：在 t1 前 dur 秒里淡出并上移一点 */
  function leave(t, t1, dur = 0.3, dist = -10) {
    const k = ease.cubicOut(seg(t, t1 - dur, t1));
    return { op: 1 - k, dy: dist * k };
  }
  /** 一个可见窗口 [a, b]，两端各淡 fa / fb 秒 */
  const win = (t, a, b, fa = 0.25, fb = 0.25) => Math.min(ease.smooth(seg(t, a, a + fa)), 1 - ease.smooth(seg(t, b - fb, b)));

  /** 按关键点插值：keys = [[t, v], …]，每段用 curve */
  function keyed(t, keys, curve = ease.cubicIO) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [ta, va] = keys[i], [tb, vb, c] = keys[i + 1];
      if (t <= tb) return lerp(va, vb, (c ?? curve)(seg(t, ta, tb)));
    }
    return keys[keys.length - 1][1];
  }
  /** 计数器式伪随机：同样的键得同样的数 */
  function hash(...k) {
    let h = 2166136261;
    for (const v of k) {
      const s = String(v);
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function rrect(ctx, x, y, w, h, r) {
    const q = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + q, y);
    ctx.arcTo(x + w, y, x + w, y + h, q);
    ctx.arcTo(x + w, y + h, x, y + h, q);
    ctx.arcTo(x, y + h, x, y, q);
    ctx.arcTo(x, y, x + w, y, q);
    ctx.closePath();
  }

  root.L = { clamp, lerp, seg, ease, tw, spring, rise, leave, win, keyed, hash, rrect };
})(typeof window !== 'undefined' ? window : globalThis);
