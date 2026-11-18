import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * 后期：环境光遮蔽 → 辉光 → 移轴景深 + 暗角 → 色调映射。
 * 移轴：画面中间一条带是清楚的，越往上下越糊，这是微缩摄影的标志。
 */

const TiltShift = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    focus: { value: 0.5 },
    band: { value: 0.2 },
    amount: { value: 2.0 },
    vignette: { value: 0.34 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  // 一遍完成：中心 + 一圈八个采样点（内外两个半径交替），再叠暗角和一点暖色
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 texel;
    uniform float focus; uniform float band; uniform float amount; uniform float vignette;
    varying vec2 vUv;
    void main(){
      float d = abs(vUv.y - focus);
      vec2 r = texel * amount * smoothstep(band, 0.62, d);
      vec4 c = texture2D(tDiffuse, vUv) * 0.2;
      c += (texture2D(tDiffuse, vUv + r * vec2(3.0, 0.0)) + texture2D(tDiffuse, vUv + r * vec2(-3.0, 0.0)) + texture2D(tDiffuse, vUv + r * vec2(0.0, 3.0)) + texture2D(tDiffuse, vUv + r * vec2(0.0, -3.0))) * 0.08;
      c += (texture2D(tDiffuse, vUv + r * vec2(1.2, 1.2)) + texture2D(tDiffuse, vUv + r * vec2(-1.2, 1.2)) + texture2D(tDiffuse, vUv + r * vec2(1.2, -1.2)) + texture2D(tDiffuse, vUv + r * vec2(-1.2, -1.2))) * 0.12;
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.38, 0.95, length(q * vec2(1.0, 0.86)));
      c.rgb *= 1.0 - vignette * v;
      c.rgb *= vec3(1.035, 1.0, 0.955);
      gl_FragColor = c;
    }`,
};

export class Post {
  readonly composer: EffectComposer;
  private readonly gtao: GTAOPass | null;
  private readonly bloom: UnrealBloomPass;
  private readonly tilt: ShaderPass;
  private pixelRatio = 1;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, high: boolean, noAo: THREE.Object3D) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: high ? 4 : 0 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    if (high) {
      const g = new GTAOPass(scene, camera, size.x, size.y);
      g.blendIntensity = 0.85;
      g.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 1.4, scale: 1.1, samples: 8, screenSpaceRadius: false });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1.5, rings: 2, samples: 8 });
      // 透明的东西（雨、光斑、头顶图标）不参与遮蔽计算
      const render = g.render.bind(g);
      g.render = (...args: Parameters<GTAOPass['render']>) => {
        const was = noAo.visible;
        noAo.visible = false;
        render(...args);
        noAo.visible = was;
      };
      // 遮蔽在半分辨率下算：省一半以上的开销，结果本来就是糊的
      const setSize = g.setSize.bind(g);
      g.setSize = (w: number, h: number) => setSize(Math.ceil(w / 2), Math.ceil(h / 2));
      g.setSize(size.x, size.y);
      this.composer.addPass(g);
      this.gtao = g;
    } else this.gtao = null;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.6, 1.0);
    this.composer.addPass(this.bloom);
    this.tilt = new ShaderPass(TiltShift);
    this.composer.addPass(this.tilt);
    this.composer.addPass(new OutputPass());
  }

  /** night：0–1；blur：移轴强度（像素，按 1x 计）；aoRadius：遮蔽半径（米），随镜头距离调 */
  tune(night: number, blur: number, band: number, aoRadius: number): void {
    this.bloom.strength = 0.1 + 0.18 * night;
    this.bloom.radius = 0.4;
    this.bloom.threshold = 1.0;
    this.tilt.uniforms.amount!.value = blur * this.pixelRatio;
    this.tilt.uniforms.band!.value = band;
    if (this.gtao) this.gtao.updateGtaoMaterial({ radius: aoRadius });
  }

  resize(w: number, h: number, pixelRatio: number): void {
    this.pixelRatio = pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.tilt.uniforms.texel!.value = new THREE.Vector2(1 / (w * pixelRatio), 1 / (h * pixelRatio));
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
