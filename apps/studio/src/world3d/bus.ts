import * as THREE from 'three';
import { CELL, hm, SHIFTS, type CommunityDef } from '@microcity/society';
import { Geo } from './geo.ts';

/**
 * 公交车（纯表现，D77）：在“有人要去城里、有人从城里回来”的那些时刻前后，
 * 一辆车从东头开进主街，在公交站停一会儿，再往西开出社区。
 * 时刻取自内核的班次表（所有去城里的班次的起止）与中学生上下学的时间；位置只由当天秒数决定。
 */

const LEN = 9.6;
const WID = 2.3;
const APPROACH = 200;
const DWELL_BEFORE = 70;
const DWELL_AFTER = 50;
const LEAVE = 240;

export function busTimes(): number[] {
  const set = new Set<number>([hm(7, 10), hm(17, 20)]);
  for (const id in SHIFTS) {
    const s = SHIFTS[id]!;
    if (!s.away) continue;
    for (const [a, b] of s.segs) {
      set.add(a);
      set.add(b);
    }
  }
  return [...set].sort((a, b) => a - b);
}

function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 192;
  cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 192, 64);
  g.fillStyle = fg;
  g.font = "700 40px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 96, 35);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Bus {
  readonly group = new THREE.Group();
  private readonly times = busTimes();
  private readonly stopX: number;
  private readonly fromX: number;
  private readonly toX: number;
  private readonly lights: THREE.MeshBasicMaterial;
  private readonly windows: THREE.MeshBasicMaterial;
  /** 当前位置与是否在场（验收用） */
  x = 0;
  shown = false;

  constructor(def: CommunityDef, material: THREE.Material) {
    const stop = def.map.places.find((p) => p.kind === 'busstop');
    const W = def.map.w * CELL;
    // 车头朝西：靠右行驶，正好贴着街北边的站台
    this.stopX = stop ? (stop.x + stop.w / 2) * CELL - 0.5 : W - 10;
    const z = stop ? (stop.door.y + 0.5) * CELL - 0.55 : 70;
    this.fromX = W + 260;
    this.toX = -280;

    // 车身沿 x：车头在 -x 一侧
    const g = new Geo();
    const body = '#F3EBDA';
    const band = '#1F5F63';
    g.box(0, 1.72, 0, LEN, 2.3, WID, body);
    g.box(0, 0.86, 0, LEN + 0.02, 0.5, WID + 0.02, band);
    g.box(0, 2.93, 0, LEN - 0.5, 0.12, WID - 0.3, '#E2D8C4');
    g.box(1.6, 3.05, 0, 2.2, 0.22, 1.3, '#CFC6B4');
    // 保险杠、车门（朝北 = -z）
    g.box(-LEN / 2 - 0.05, 0.62, 0, 0.14, 0.22, WID - 0.1, '#55565A');
    g.box(LEN / 2 + 0.05, 0.62, 0, 0.14, 0.22, WID - 0.1, '#55565A');
    for (const dx of [-LEN / 2 + 1.5, 0.9]) {
      g.box(dx, 1.5, -WID / 2 - 0.012, 1.05, 2.0, 0.03, '#3E5A66');
      g.box(dx, 1.5, -WID / 2 - 0.03, 0.04, 2.0, 0.02, '#D8D0C0');
    }
    // 车轮
    for (const wx of [-LEN / 2 + 2.0, LEN / 2 - 2.1])
      for (const s of [-1, 1]) {
        g.rod(wx, 0.48, s * (WID / 2 - 0.3), wx, 0.48, s * (WID / 2 + 0.02), 0.48, '#2B2A2C', 12);
        g.rod(wx, 0.48, s * (WID / 2 + 0.02), wx, 0.48, s * (WID / 2 + 0.05), 0.24, '#B9B4AA', 10);
        g.box(wx, 1.0, s * (WID / 2 + 0.01), 1.25, 0.14, 0.06, band);
      }
    // 后视镜
    for (const s of [-1, 1]) g.box(-LEN / 2 + 0.2, 2.25, s * (WID / 2 + 0.22), 0.1, 0.4, 0.2, '#3B3A3C');
    const mesh = new THREE.Mesh(g.build(), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // 车窗：白天映天色，夜里车厢亮着
    this.windows = new THREE.MeshBasicMaterial({ color: '#6F8FA0' });
    const wg = new Geo();
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) if (!(s === -1 && (i === 0 || i === 4))) wg.box(-LEN / 2 + 1.5 + i * 1.32, 2.12, s * (WID / 2 + 0.012), 1.08, 0.9, 0.02, '#ffffff');
    wg.box(-LEN / 2 - 0.012, 2.05, 0, 0.02, 1.1, WID - 0.36, '#ffffff');
    wg.box(LEN / 2 + 0.012, 2.2, 0, 0.02, 0.8, WID - 0.5, '#ffffff');
    this.group.add(new THREE.Mesh(wg.build(), this.windows));

    // 车灯
    this.lights = new THREE.MeshBasicMaterial({ color: '#FFF3D0' });
    const lg = new Geo();
    for (const s of [-1, 1]) lg.box(-LEN / 2 - 0.09, 0.95, s * (WID / 2 - 0.4), 0.06, 0.2, 0.34, '#ffffff');
    this.group.add(new THREE.Mesh(lg.build(), this.lights));

    // 线路牌：车头与车门一侧
    const tex = signTexture('1 路 · 城区', '#22302F', '#FFD98A');
    const signMat = new THREE.MeshBasicMaterial({ map: tex });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), signMat);
    front.position.set(-LEN / 2 - 0.02, 2.72, 0);
    front.rotation.y = -Math.PI / 2;
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.36), signMat);
    side.position.set(-1.2, 2.72, -WID / 2 - 0.02);
    side.rotation.y = Math.PI;
    this.group.add(front, side);

    this.group.position.set(this.fromX, 0, z);
    this.group.visible = false;
  }

  /** 按当天秒数摆车；night 决定车灯与车窗的亮度 */
  update(sec: number, night: number, sky: THREE.Color): void {
    let x: number | null = null;
    for (const t of this.times) {
      const d = sec - t;
      if (d < -(APPROACH + DWELL_BEFORE) || d > DWELL_AFTER + LEAVE) continue;
      if (d < -DWELL_BEFORE) {
        // 进站：越近越慢
        const k = (d + APPROACH + DWELL_BEFORE) / APPROACH;
        x = this.fromX + (this.stopX - this.fromX) * (1 - (1 - k) ** 2.4);
      } else if (d <= DWELL_AFTER) x = this.stopX;
      else {
        const k = (d - DWELL_AFTER) / LEAVE;
        x = this.stopX + (this.toX - this.stopX) * k ** 2.2;
      }
      break;
    }
    this.shown = x !== null;
    this.group.visible = this.shown;
    if (x === null) return;
    this.x = x;
    this.group.position.x = x;
    this.lights.color.set('#FFF3D0').multiplyScalar(0.9 + 2.6 * night);
    this.windows.color.copy(sky).multiplyScalar(0.55).lerp(new THREE.Color('#FFD9A0').multiplyScalar(1.3), Math.min(1, night * 1.2));
  }
}
