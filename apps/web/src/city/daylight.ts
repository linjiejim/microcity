import * as THREE from 'three';

export interface Daylight {
  sky: THREE.Color;
  ambient: THREE.Color;
  ambientI: number;
  sun: THREE.Color;
  sunI: number;
  sunDir: THREE.Vector3;
  night: number; // 0..1，窗户与路灯亮度
}

const K = (hex: string) => new THREE.Color(hex);

/** 按一天中的时刻插值的光照关键帧：白天是纸面一样的暖白，夜里是深蓝灰（不是黑），保证小镇始终看得清 */
const KEYS: Array<{ h: number; sky: string; amb: string; ai: number; sun: string; si: number; night: number }> = [
  { h: 0, sky: '#2e3445', amb: '#8d97b0', ai: 0.75, sun: '#9fb0cf', si: 0.35, night: 1 },
  { h: 5, sky: '#363c50', amb: '#949bb2', ai: 0.8, sun: '#b3a5c6', si: 0.4, night: 1 },
  { h: 6.5, sky: '#eadacb', amb: '#f3dccb', ai: 1.0, sun: '#ffcb94', si: 1.4, night: 0.35 },
  { h: 8, sky: '#f2efe8', amb: '#ffffff', ai: 1.15, sun: '#fff1dc', si: 2.0, night: 0 },
  { h: 12, sky: '#f4f1ea', amb: '#ffffff', ai: 1.2, sun: '#ffffff', si: 2.2, night: 0 },
  { h: 16.5, sky: '#f3eee4', amb: '#fff6ea', ai: 1.15, sun: '#ffecc9', si: 2.0, night: 0 },
  { h: 18.5, sky: '#eed8c6', amb: '#f4d9c4', ai: 1.0, sun: '#ffb97c', si: 1.4, night: 0.3 },
  { h: 19.6, sky: '#6f6679', amb: '#aa9db2', ai: 0.85, sun: '#c893a4', si: 0.7, night: 0.8 },
  { h: 21, sky: '#363c50', amb: '#949bb2', ai: 0.8, sun: '#9fb0cf', si: 0.4, night: 1 },
  { h: 24, sky: '#2e3445', amb: '#8d97b0', ai: 0.75, sun: '#9fb0cf', si: 0.35, night: 1 },
];

export function daylight(hour: number): Daylight {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.h <= hour) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const f = Math.max(0, Math.min(1, (hour - a.h) / (b.h - a.h)));
  // 太阳从东南升起，西南落下；夜里改为月光方向
  const sunAngle = ((hour - 6) / 12) * Math.PI;
  const up = Math.max(0.35, Math.sin(Math.max(0, Math.min(Math.PI, sunAngle))));
  const dir = new THREE.Vector3(Math.cos(sunAngle) * 0.8 + 0.3, up + 0.45, 0.65).normalize();
  return {
    sky: K(a.sky).lerp(K(b.sky), f),
    ambient: K(a.amb).lerp(K(b.amb), f),
    ambientI: a.ai + (b.ai - a.ai) * f,
    sun: K(a.sun).lerp(K(b.sun), f),
    sunI: a.si + (b.si - a.si) * f,
    sunDir: dir,
    night: a.night + (b.night - a.night) * f,
  };
}
