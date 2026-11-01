import { useCallback, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * 城市上的 DOM 叠层（地点标签、名字、对话气泡、停电横幅）。
 * 不用 drei <Html>（每个都是一个独立 React 根）；改为一个投影器每帧把世界坐标写成 transform。
 */
interface Anchor {
  el: HTMLElement;
  get: () => { x: number; y: number; z: number } | null;
  dy: number;
}

const anchors = new Map<string, Anchor>();
/** 居民当前的世界坐标（People 每帧写入） */
export const agentPos = new Map<string, { x: number; y: number; z: number; visible: boolean }>();

export function useAnchor(id: string, get: Anchor['get'], dy = 0): (el: HTMLElement | null) => void {
  // 始终读最新的 getter，避免 ref 回调里闭包过期（例如停电横幅首帧时还没停电）
  const latest = useRef(get);
  latest.current = get;
  return useCallback(
    (el: HTMLElement | null) => {
      if (el) anchors.set(id, { el, get: () => latest.current(), dy });
      else anchors.delete(id);
    },
    [id, dy],
  );
}

const v = new THREE.Vector3();

export function OverlayProjector() {
  const { camera, size } = useThree();
  useFrame(() => {
    for (const a of anchors.values()) {
      const p = a.get();
      if (!p) {
        a.el.style.visibility = 'hidden';
        continue;
      }
      v.set(p.x, p.y, p.z).project(camera);
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) {
        a.el.style.visibility = 'hidden';
        continue;
      }
      const x = Math.round(((v.x + 1) / 2) * size.width);
      const y = Math.round(((1 - v.y) / 2) * size.height + a.dy);
      a.el.style.visibility = 'visible';
      a.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  });
  return null;
}
