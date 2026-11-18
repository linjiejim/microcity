import * as THREE from 'three';
import type { Weather } from './types.ts';

/**
 * 天空与光：太阳随时间走，天色、雾、环境光跟着变；夜里只剩月光和灯。
 * 这里只决定“看起来是什么时候、什么天气”，不改任何模拟状态。
 */

const HOUR = 3600;
const SUNRISE = 5.9 * HOUR;
const SUNSET = 18.6 * HOUR;

interface Key {
  top: string;
  horizon: string;
  sun: string;
  hemiSky: string;
  hemiGround: string;
}

const NIGHT: Key = { top: '#131C36', horizon: '#2C3759', sun: '#9DB4EA', hemiSky: '#5568A8', hemiGround: '#2A3048' };
const DUSK: Key = { top: '#6F86C0', horizon: '#F9C39A', sun: '#FFBE86', hemiSky: '#C9B6D6', hemiGround: '#9A8470' };
const DAY: Key = { top: '#86BDE6', horizon: '#E4EEF0', sun: '#FFF1DC', hemiSky: '#CFE3F2', hemiGround: '#B9A98C' };
const OVERCAST: Key = { top: '#B4BEC6', horizon: '#D9DDDD', sun: '#E9EDF0', hemiSky: '#D5DBDF', hemiGround: '#A9A396' };
const RAIN: Key = { top: '#8C979F', horizon: '#B4BBBD', sun: '#C9D2D8', hemiSky: '#B3BCC2', hemiGround: '#8E8C84' };

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const ca = new THREE.Color();
const cb = new THREE.Color();
function lerpKey(out: Record<keyof Key, THREE.Color>, a: Key, b: Key, k: number): void {
  for (const f of Object.keys(out) as Array<keyof Key>) out[f].copy(ca.set(a[f])).lerp(cb.set(b[f]), k);
}

export class Environment {
  readonly sun = new THREE.DirectionalLight('#ffffff', 2);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#888888', 1);
  readonly dome: THREE.Mesh;
  readonly fog = new THREE.Fog('#ffffff', 200, 1200);
  /** 0 白天 … 1 深夜：窗、路灯、辉光都看它 */
  night = 0;
  /** 太阳（或月亮）方向：从场景指向光源 */
  readonly dir = new THREE.Vector3(0.3, 0.8, 0.5);
  weather: Weather = 'sun';
  exposure = 1;
  private readonly key = { top: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color() };
  private readonly domeUniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };

  constructor(shadowSize: number) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 2.5;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1800, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.domeUniforms,
        vertexShader: 'varying float vy; void main(){ vy = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying float vy; void main(){ float k = smoothstep(-0.02, 0.55, vy); gl_FragColor = vec4(mix(horizon, top, k), 1.0); }',
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
  }

  set(secOfDay: number, weather: Weather): void {
    this.weather = weather;
    const t = ((secOfDay % 86400) + 86400) % 86400;
    const d = (t - SUNRISE) / (SUNSET - SUNRISE);
    const up = d > 0 && d < 1;
    const elev = up ? Math.sin(Math.PI * d) : 0;
    // 清晨与傍晚各有一小时左右的暖色过渡
    const twilight = Math.max(smooth(SUNRISE - 1.1 * HOUR, SUNRISE + 0.2 * HOUR, t) * (1 - smooth(SUNRISE + 0.2 * HOUR, SUNRISE + 1.7 * HOUR, t)), smooth(SUNSET - 1.8 * HOUR, SUNSET - 0.3 * HOUR, t) * (1 - smooth(SUNSET - 0.2 * HOUR, SUNSET + 1.0 * HOUR, t)));
    this.night = 1 - smooth(SUNRISE - 0.8 * HOUR, SUNRISE + 0.6 * HOUR, t) * (1 - smooth(SUNSET - 0.5 * HOUR, SUNSET + 0.9 * HOUR, t));

    lerpKey(this.key, NIGHT, DAY, 1 - this.night);
    if (twilight > 0) for (const f of Object.keys(this.key) as Array<keyof Key>) this.key[f].lerp(ca.set(DUSK[f]), twilight * 0.85);
    const w = weather === 'rain' ? RAIN : weather === 'cloud' ? OVERCAST : null;
    if (w) {
      const k = (weather === 'rain' ? 0.85 : 0.6) * (1 - this.night * 0.8);
      for (const f of Object.keys(this.key) as Array<keyof Key>) this.key[f].lerp(ca.set(w[f]), k);
    }

    // 方向：白天是太阳（东 → 南 → 西），夜里是固定在西南高处的月亮
    if (up && elev > 0.02) {
      const a = Math.PI * d;
      // 太阳再低也按二十度以上来打光：贴着地平线的光只会让地面发黑
      const e = ((0.34 + 0.66 * elev) * 62 * Math.PI) / 180;
      this.dir.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e) * 0.9 + 0.25).normalize();
    } else this.dir.set(-0.45, 0.75, 0.5).normalize();

    const weatherSun = weather === 'rain' ? 0.18 : weather === 'cloud' ? 0.5 : 1;
    const weatherHemi = weather === 'rain' ? 0.95 : weather === 'cloud' ? 1.1 : 1;
    const sunI = up ? 0.5 + 2.5 * smooth(0, 0.2, elev) : 0;
    this.sun.intensity = Math.max(sunI * weatherSun * (1 - this.night * 0.7), 0.7 * this.night);
    this.sun.color.copy(this.key.sun);
    this.hemi.intensity = (0.85 + 0.35 * (1 - this.night)) * weatherHemi;
    this.hemi.color.copy(this.key.hemiSky);
    this.hemi.groundColor.copy(this.key.hemiGround);
    this.domeUniforms.top.value.copy(this.key.top);
    this.domeUniforms.horizon.value.copy(this.key.horizon);
    this.fog.color.copy(this.key.horizon);
    this.exposure = 1.0 + 0.12 * this.night;
  }

  /** 让阴影相机跟着镜头目标走；size 是覆盖范围的一半（米） */
  follow(target: THREE.Vector3, size: number): void {
    const s = this.sun.shadow.camera;
    // 对齐到阴影贴图的像素格，镜头移动时阴影边缘不抖
    const texel = (size * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx, 0, tz).addScaledVector(this.dir, 320);
    if (Math.abs(s.right - size) > 0.5) {
      s.left = -size;
      s.right = size;
      s.top = size;
      s.bottom = -size;
      s.near = 20;
      s.far = 700;
      s.updateProjectionMatrix();
    }
    this.dome.position.set(target.x, 0, target.z);
  }
}
