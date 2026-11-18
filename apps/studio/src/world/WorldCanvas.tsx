import { useEffect, useRef } from 'react';
import { runtime } from '../runtime.ts';
import { set, useApp } from '../store.ts';
import { createWorld3D } from '../world3d/index.ts';

/** 立体世界的画布：建好世界，接上运行时，每帧画一次 */
export function WorldCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const ready = useApp((s) => s.phase !== 'loading' || s.computed > 0);
  const worldKey = useApp((s) => s.worldKey);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !ready) return;
    const world = createWorld3D({
      canvas,
      def: runtime.def,
      looks: runtime.stage.looks,
      onPick: (hit) => {
        if (!hit) return;
        if (hit.kind === 'actor') runtime.follow(hit.id);
        else {
          if (useApp.getState().follow) runtime.follow(null);
          set({ place: hit.id });
        }
      },
      onCameraMode: (mode) => set({ camera: mode }),
      // 画质可以用链接降档（?q=low）：没有独立显卡的机器、无头测试用
      quality: new URLSearchParams(location.search).get('q') === 'low' ? 'low' : 'high',
    });
    runtime.world = world;
    world.setCameraMode(useApp.getState().camera);
    world.setFollow(useApp.getState().follow);
    const fit = () => world.resize(canvas.clientWidth, canvas.clientHeight, Math.min(2, window.devicePixelRatio || 1));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      runtime.frame(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      runtime.world = null;
      world.dispose();
    };
  }, [ready, worldKey]);

  return <canvas ref={ref} className="world" data-testid="world" />;
}
