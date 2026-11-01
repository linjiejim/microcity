import { useEffect, useRef, useState } from 'react';
import type { Beat, SeriesPoint, WorldState } from '@microcity/sim';
import { api } from '../lib/api.ts';
import { useApp } from '../store.ts';

/** 复盘的时间：reviewT 为空 = 此刻（运行的最新时刻） */
export function useReviewTimes(): { t: number; base: number | null; now: number; firstPublish: number | null } {
  const run = useApp((s) => s.run);
  const scenario = useApp((s) => s.scenario);
  const reviewT = useApp((s) => s.reviewT);
  const reviewBase = useApp((s) => s.reviewBase);
  const now = run?.t ?? 0;
  const firstPublish = scenario?.script.find((x) => x.kind === 'publish')?.at ?? null;
  const t = reviewT === null ? now : Math.min(reviewT, now);
  // 默认基准：第一条通知发布前一分钟（还没发布时不对比）
  const base = reviewBase === -1 ? null : reviewBase !== null ? Math.min(reviewBase, t) : firstPublish !== null && firstPublish - 60 < t ? firstPublish - 60 : null;
  return { t, base, now, firstPublish };
}

const stateCache = new Map<string, WorldState>();

/** 某一刻的完整状态：此刻用实时镜像，过去的从服务端取（按运行+时刻缓存） */
export function useStateAt(t: number | null): { state?: WorldState; loading: boolean } {
  const runId = useApp((s) => s.runId);
  const live = useApp((s) => s.state);
  const rev = useApp((s) => s.rev);
  const now = useApp((s) => s.run?.t ?? 0);
  const [state, setState] = useState<WorldState>();
  const [loading, setLoading] = useState(false);
  const isNow = t === null || t >= now - 1;
  useEffect(() => {
    if (!runId || isNow || t === null) return;
    const k = `${runId}@${t}`;
    const hit = stateCache.get(k);
    if (hit) {
      setState(hit);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .stateAt(runId, t)
      .then((r) => {
        if (stateCache.size > 40) stateCache.delete(stateCache.keys().next().value!);
        stateCache.set(k, r.state);
        if (alive) setState(r.state);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [runId, t, isNow]);
  void rev;
  return isNow ? { state: live, loading: false } : { state, loading };
}

/** 关键节拍（章节）与曲线：运行推进时每隔几秒刷新 */
export function useChapters(): Beat[] {
  const runId = useApp((s) => s.runId);
  const live = useApp((s) => s.beats);
  const [beats, setBeats] = useState<Beat[]>([]);
  const lastLen = useRef(-1);
  useEffect(() => {
    if (!runId) return;
    const keyCount = live.filter((b) => b.level === 'key').length;
    if (keyCount === lastLen.current) return;
    lastLen.current = keyCount;
    api
      .chronicle(runId, 'key')
      .then(setBeats)
      .catch(() => {});
  }, [runId, live]);
  return beats;
}

export function useSeries(family: string): { points: SeriesPoint[]; loading: boolean } {
  const runId = useApp((s) => s.runId);
  const now = useApp((s) => s.run?.t ?? 0);
  const bucket = Math.floor(now / 1800);
  const [points, setPoints] = useState<SeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    setLoading(true);
    api
      .series(runId, 1800, family)
      .then((r) => alive && setPoints(r.points))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [runId, family, bucket]);
  return { points, loading };
}
