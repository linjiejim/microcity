import { hhmm } from '@microcity/society';
import { runtime } from '../runtime.ts';
import { set, useApp } from '../store.ts';
import { Button } from '../ui/kit.tsx';
import { Avatar } from './Avatar.tsx';
import { fmtMoney, roleOf } from './format.ts';

const KIND_LABEL: Record<string, string> = {
  house: '院子',
  apartment: '居民楼',
  market: '菜市场',
  grocery: '小超市',
  eatery: '饭馆',
  teahouse: '茶馆',
  center: '活动中心',
  clinic: '卫生站',
  school: '小学',
  office: '办公楼',
  workshop: '车间',
  park: '公园',
  square: '广场',
  court: '球场',
  busstop: '公交站',
};

/** 地点卡：这是哪、现在谁在这里 */
export function PlaceCard() {
  const id = useApp((s) => s.place);
  const follow = useApp((s) => s.follow);
  useApp((s) => Math.floor(s.now / 120));
  const place = id ? runtime.stage.places[id] : undefined;
  const state = runtime.cursor?.state;
  if (!place || !state || follow) return null;
  const here = (state.here[place.id] ?? []).filter((pid) => !state.people[pid]?.act?.away);
  const away = (state.here[place.id] ?? []).length - here.length;
  const firm = place.firm ? runtime.def.firms.find((f) => f.id === place.firm) : undefined;
  return (
    <aside className="hud card" data-testid="place-card">
      <div className="card-head">
        <div className="grow">
          <div className="card-name serif">{place.name}</div>
          <div className="dim">
            {KIND_LABEL[place.kind]}
            {place.hours ? ` · ${hhmm(place.hours[0])}–${hhmm(place.hours[1])}` : ''}
            {firm ? ` · 账上 ${fmtMoney(state.accounts[firm.id] ?? 0)}` : ''}
          </div>
        </div>
        <Button icon="cross" variant="ghost" size="sm" onClick={() => set({ place: null })} testId="place-close" title="关闭" />
      </div>
      <div className="card-body">
        <div className="dim">
          现在有 {here.length} 个人在这里{away > 0 ? `，另有 ${away} 个人从这里去了城里` : ''}。
        </div>
        <ul className="people-list">
          {here.map((pid) => {
            const p = runtime.people[pid]!;
            return (
              <li key={pid}>
                <button type="button" className="person-row" onClick={() => runtime.follow(pid)} data-testid={`here-${pid}`}>
                  <Avatar look={p.look} size={28} />
                  <span className="grow">
                    <b>{p.name}</b>
                    <span className="dim"> {roleOf(p)}</span>
                    <span className="doing-line dim">{state.people[pid]?.act?.label ?? ''}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
