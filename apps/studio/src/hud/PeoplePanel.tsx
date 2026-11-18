import { useMemo, useState } from 'react';
import { runtime } from '../runtime.ts';
import { set, useApp } from '../store.ts';
import { Button, Segmented } from '../ui/kit.tsx';
import { Avatar } from './Avatar.tsx';
import { roleOf } from './format.ts';

type Group = 'all' | 'elder' | 'worker' | 'young';

/** 居民名单：找一个人，点一下就跟着看 */
export function PeoplePanel() {
  const open = useApp((s) => s.peopleOpen);
  const follow = useApp((s) => s.follow);
  // 名单上的“此刻在做什么”每秒更新几次就够
  useApp((s) => Math.floor(s.now / 300));
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>('all');
  const people = runtime.def.people;
  const list = useMemo(() => {
    const needle = q.trim();
    return people.filter((p) => {
      if (needle && !p.name.includes(needle) && !roleOf(p).includes(needle)) return false;
      if (group === 'elder') return p.age >= 60;
      if (group === 'worker') return !!p.job;
      if (group === 'young') return p.age < 18;
      return true;
    });
  }, [people, q, group]);
  if (!open) return null;
  const state = runtime.cursor?.state;
  return (
    <aside className="hud people" data-testid="people">
      <div className="people-head">
        <input className="input" placeholder={`在 ${people.length} 位居民里找`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="people-search" />
        <Button icon="cross" variant="ghost" size="sm" onClick={() => set({ peopleOpen: false })} testId="people-close" title="收起" />
      </div>
      <Segmented<Group>
        testId="people-group"
        value={group}
        onChange={setGroup}
        options={[
          { value: 'all', label: '全部' },
          { value: 'elder', label: '老人' },
          { value: 'worker', label: '上班的' },
          { value: 'young', label: '孩子' },
        ]}
      />
      <ul className="people-list">
        {list.map((p) => {
          const ps = state?.people[p.id];
          const doing = !ps ? '' : ps.loc.k === 'move' ? `去${runtime.placeName(ps.loc.move.to)}` : (ps.act?.label ?? '');
          return (
            <li key={p.id}>
              <button type="button" className={`person-row${follow === p.id ? ' on' : ''}`} onClick={() => runtime.follow(p.id)} data-testid={`person-${p.id}`}>
                <Avatar look={p.look} size={30} />
                <span className="grow">
                  <b>{p.name}</b>
                  <span className="dim">
                    {' '}
                    {p.age} 岁 · {roleOf(p)}
                  </span>
                  <span className="doing-line dim">{doing}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
