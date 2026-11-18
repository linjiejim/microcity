import * as THREE from 'three';

/**
 * 表面细节：不用贴图，在着色器里按世界坐标给墙、屋顶、地板加一点纹理。
 * 每个顶点带一个“表面种类”（Geo.kind → 顶点属性 aK）：
 *   0 素面；1 抹灰墙（深浅不匀、墙脚发暗）；2 砖墙（错缝的砖缝）；3 瓦屋面（一垄一垄）；
 *   4 木地板（拼缝与木纹）；5 剖面里烘进墙的玻璃（天黑后发暖光）。
 * 细节随距离淡出，远看不闪；颜色只是在原色上乘一个 0.85–1.15 的系数，整体色调不变。
 */

export const K_PLAIN = 0;
export const K_PLASTER = 1;
export const K_BRICK = 2;
export const K_TILE = 3;
export const K_WOOD = 4;
export const K_GLASS = 5;

/** 所有带细节的材质共用：uGlow 是夜的程度（0–1），uWet 是地面的湿润程度，uSky 是天色 */
export const detailUniforms = { uGlow: { value: 0 }, uWet: { value: 0 }, uSky: { value: new THREE.Color('#B4BBBD') } };

const NOISE = /* glsl */ `
  float dHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float dHash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float dNoise(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;

const VERT_HEAD = /* glsl */ `
  attribute float aK;
  varying float vK;
  varying vec3 vWP;
  varying vec3 vWN;`;

const VERT_BODY = /* glsl */ `
  vK = aK;
  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWN = normalize(mat3(modelMatrix) * objectNormal);`;

const FRAG_HEAD = /* glsl */ `
  varying float vK;
  varying vec3 vWP;
  varying vec3 vWN;
  uniform float uGlow;
  uniform float uWet;
  uniform vec3 uSky;
  ${NOISE}`;

const FRAG_SURFACE = /* glsl */ `
  {
    float k = floor(vK + 0.5);
    float m = 1.0;
    // 沿墙面的水平坐标：法线朝哪边，就取与它垂直的那个水平方向
    float u = vWP.x * (-vWN.z) + vWP.z * vWN.x;
    float px = max(fwidth(vWP.y), max(fwidth(vWP.x), fwidth(vWP.z)));
    if (k == 1.0) {
      m = 0.94 + 0.09 * dNoise(vWP * 1.3) + 0.035 * dNoise(vWP * 9.0);
      m *= 1.0 - 0.07 * smoothstep(1.3, 0.1, vWP.y);
      m = mix(1.0, m, 1.0 - smoothstep(0.08, 0.5, px));
    } else if (k == 2.0) {
      float row = floor(vWP.y / 0.15);
      float uu = u / 0.44 + mod(row, 2.0) * 0.5;
      float mortar = max(1.0 - step(0.13, fract(vWP.y / 0.15)), 1.0 - step(0.045, fract(uu)));
      float t = dHash2(vec2(floor(uu), row));
      m = mix(0.9 + 0.2 * t, 1.16, mortar);
      m = mix(0.99, m, 1.0 - smoothstep(0.03, 0.12, px));
    } else if (k == 3.0) {
      // 瓦：顺着坡往下一排一排，排与排错开
      float row = floor(vWP.y / 0.2);
      float fy = fract(vWP.y / 0.2);
      float fx = fract(u / 0.34 + mod(row, 2.0) * 0.5);
      m = 1.0 - 0.14 * (1.0 - smoothstep(0.0, 0.22, fy)) - 0.06 * (1.0 - step(0.07, fx));
      m += 0.07 * (dHash2(vec2(floor(u / 0.34 + mod(row, 2.0) * 0.5), row)) - 0.5) + 0.05 * (dNoise(vWP * 0.9) - 0.5);
      m = mix(0.97, m, 1.0 - smoothstep(0.04, 0.16, px));
    } else if (k == 4.0) {
      float plank = floor(vWP.x / 0.16);
      float seam = 1.0 - step(0.035, fract(vWP.x / 0.16));
      float joint = 1.0 - step(0.012, fract(vWP.z / 1.4 + dHash2(vec2(plank, 3.0))));
      m = 0.96 + 0.08 * dHash2(vec2(plank, 7.0)) + 0.03 * dNoise(vec3(vWP.x * 30.0, 0.0, vWP.z * 2.0));
      m *= 1.0 - 0.12 * max(seam, joint);
      m = mix(1.0, m, 1.0 - smoothstep(0.02, 0.1, px));
    }
    diffuseColor.rgb *= m;
  }`;

const FRAG_GLOW = /* glsl */ `
  if (floor(vK + 0.5) == 5.0) totalEmissiveRadiance += uGlow * vec3(1.0, 0.76, 0.46) * 1.5;`;

/** 给一个标准材质接上表面细节 */
export function withDetail<T extends THREE.MeshStandardMaterial>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = detailUniforms.uGlow;
    shader.uniforms.uWet = detailUniforms.uWet;
    shader.uniforms.uSky = detailUniforms.uSky;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERT_HEAD}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SURFACE}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_GLOW}`);
  };
  mat.customProgramCacheKey = () => 'detail-v1';
  return mat;
}

const FRAG_WET_ROUGH = /* glsl */ `
  float wetPud = smoothstep(0.42, 0.7, dNoise(vWP * 0.33) * 0.7 + dNoise(vWP * 1.7) * 0.3) * uWet;
  roughnessFactor = mix(roughnessFactor, 0.16, uWet * 0.45 + wetPud * 0.5);`;

const FRAG_WET_OUT = /* glsl */ `
  {
    vec3 wv = normalize(cameraPosition - vWP);
    float fres = pow(1.0 - max(wv.y, 0.0), 3.0);
    outgoingLight = mix(outgoingLight, uSky * 1.05, clamp(uWet * (0.05 + 0.5 * fres) + wetPud * (0.16 + 0.5 * fres), 0.0, 0.85));
  }`;

/** 地面：雨天变深、变亮滑，低洼处映着天色 */
export function withWetness<T extends THREE.MeshStandardMaterial>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = detailUniforms.uGlow;
    shader.uniforms.uWet = detailUniforms.uWet;
    shader.uniforms.uSky = detailUniforms.uSky;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\nuniform float uWet;\nuniform vec3 uSky;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.3 * uWet;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_WET_ROUGH}`)
      .replace('#include <opaque_fragment>', `${FRAG_WET_OUT}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'wet-v1';
  return mat;
}

/** 新建一份带细节的静态世界材质（半透明的替身、剖面零件各要一份自己的） */
export function detailMaterial(): THREE.MeshStandardMaterial {
  return withDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
}
