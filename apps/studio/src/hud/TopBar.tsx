import { runtime } from '../runtime.ts';
import { set, useApp } from '../store.ts';
import { Button, Icon, Segmented } from '../ui/kit.tsx';
import type { CameraMode } from '../world3d/types.ts';
import { fmtClock, fmtDay, WEATHER_LABEL } from './format.ts';

/** 顶栏：左边是“这是哪、现在几点”，右边是镜头与入口 */
export function TopBar() {
  const now = useApp((s) => s.now);
  const weather = useApp((s) => s.weather);
  const camera = useApp((s) => s.camera);
  const follow = useApp((s) => s.follow);
  const peopleOpen = useApp((s) => s.peopleOpen);
  const computed = useApp((s) => s.computed);
  const target = useApp((s) => s.target);
  const night = now % 86400 < 6 * 3600 || now % 86400 > 19 * 3600;
  return (
    <header className="topbar">
      <div className="hud where" data-testid="where">
        <div className="where-name serif">{runtime.def.name}</div>
        <div className="where-time">
          <span className="clock num serif" data-testid="clock">
            {fmtClock(now)}
          </span>
          <span className="dim">{fmtDay(now)}</span>
          <span className="dim weather">
            <Icon name={night ? 'moon' : 'sun'} size={14} />
            {WEATHER_LABEL[weather]}
          </span>
        </div>
      </div>
      <div className="grow" />
      {computed < target && (
        <div className="hud chip dim" data-testid="computing">
          后面的日子还在算：{computed} / {target} 天
        </div>
      )}
      <div className="hud tools">
        <Segmented<CameraMode>
          testId="camera"
          value={camera}
          onChange={(mode) => {
            if (mode === 'follow' && !follow) return set({ peopleOpen: true });
            set({ camera: mode });
            runtime.world?.setCameraMode(mode);
          }}
          options={[
            { value: 'overview', label: '俯瞰', icon: 'map', title: '俯瞰整个社区' },
            { value: 'street', label: '街道', icon: 'cube', title: '拉近到街道' },
            { value: 'follow', label: '跟随', icon: 'eye', title: follow ? '跟着这个人' : '先选一个人' },
          ]}
        />
        <Button icon="person" on={peopleOpen} onClick={() => set({ peopleOpen: !peopleOpen })} testId="people-toggle" title="居民名单">
          居民
        </Button>
        <Button icon="sliders" onClick={() => set({ settingsOpen: true })} testId="settings-open" title="模型与用量" />
      </div>
    </header>
  );
}
