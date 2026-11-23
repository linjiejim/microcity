import { describeIntervention, formatTime } from '@microcity/society';
import { useState } from 'react';
import { runtime } from '../runtime.ts';
import { worldLink } from '../share.ts';
import { set, useApp, type View } from '../store.ts';
import { Button, Icon, Segmented } from '../ui/kit.tsx';
import type { CameraMode } from '../world3d/types.ts';
import { fmtClock, fmtDay, WEATHER_LABEL } from './format.ts';

/** 顶栏：左边是“这是哪、现在几点”，中间是三个工作区，右边是这一屏用得上的入口 */
export function TopBar() {
  const now = useApp((s) => s.now);
  const weather = useApp((s) => s.weather);
  const camera = useApp((s) => s.camera);
  const follow = useApp((s) => s.follow);
  const peopleOpen = useApp((s) => s.peopleOpen);
  const computed = useApp((s) => s.computed);
  const target = useApp((s) => s.target);
  const view = useApp((s) => s.view);
  useApp((s) => s.worldKey);
  const [copied, setCopied] = useState(false);
  const night = now % 86400 < 6 * 3600 || now % 86400 > 19 * 3600;
  const ivs = runtime.config.interventions;
  const go = (v: View) => {
    runtime.visible = v === 'world';
    set({ view: v });
  };
  return (
    <header className={`topbar${view === 'world' ? '' : ' solid'}`}>
      <div className="hud where" data-testid="where">
        <button type="button" className="where-name serif" onClick={() => set({ communityOpen: true })} data-testid="community-open" title="换一个社区">
          {runtime.def.name}
          <Icon name="down" size={12} />
        </button>
        {view === 'world' && (
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
        )}
      </div>
      <div className="hud tools nav">
        <Segmented<View>
          testId="nav"
          value={view}
          onChange={go}
          options={[
            { value: 'world', label: '世界', icon: 'cube', title: '看这个社区过日子' },
            { value: 'portrait', label: '画像', icon: 'activity', title: '这是个什么样的社区' },
            { value: 'lab', label: '实验台', icon: 'fork', title: '放一件事进去，看会怎样' },
          ]}
        />
      </div>
      <div className="grow" />
      {view === 'world' && ivs.length > 0 && (
        <div className="hud chip" data-testid="iv-chip" title={ivs.map((iv) => describeIntervention(iv, (ref) => runtime.stage.places[ref]?.name ?? runtime.def.map.places.find((p) => p.kind === ref)?.name ?? String(ref))).join('\n')}>
          <Icon name="fork" size={14} /> 这是一条有干预的世界线
          <button type="button" className="linkish" onClick={() => runtime.boot({ ...runtime.config, interventions: [] })} data-testid="iv-clear">
            回到基线
          </button>
        </div>
      )}
      {computed < target && (
        <div className="hud chip dim" data-testid="computing">
          后面的日子还在算：{computed} / {target} 天
        </div>
      )}
      <div className="hud tools">
        {view === 'world' && (
          <>
            <Segmented<CameraMode>
              testId="camera"
              value={camera}
              onChange={(mode) => {
                if ((mode === 'follow' || mode === 'pov') && !follow) return set({ peopleOpen: true });
                set({ camera: mode });
                runtime.world?.setCameraMode(mode);
              }}
              options={[
                { value: 'overview', label: '俯瞰', icon: 'map', title: '俯瞰整个社区' },
                { value: 'street', label: '街道', icon: 'cube', title: '拉近到街道' },
                { value: 'follow', label: '跟随', icon: 'eye', title: follow ? '跟着这个人' : '先选一个人' },
                { value: 'pov', label: '贴身', icon: 'person', title: follow ? '站在这个人身后看' : '先选一个人' },
              ]}
            />
            <Button icon="person" on={peopleOpen} onClick={() => set({ peopleOpen: !peopleOpen })} testId="people-toggle" title="居民名单">
              居民
            </Button>
            <Button
              icon="link"
              testId="share-moment"
              title="复制这一刻的链接：打开就停在这里"
              onClick={() => {
                void navigator.clipboard?.writeText(worldLink(location.origin + location.pathname, runtime.config, { t: formatTime(Math.floor(now)), who: follow }));
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? '已复制' : undefined}
            </Button>
          </>
        )}
        <Button icon="sliders" onClick={() => set({ settingsOpen: true })} testId="settings-open" title="模型与用量" />
        {location.pathname.startsWith('/app') && (
          <a className="btn icon" href="/" title="关于微缩城：由来、视频、实验结果" aria-label="关于微缩城" data-testid="about">
            <Icon name="question" size={16} />
          </a>
        )}
      </div>
    </header>
  );
}
