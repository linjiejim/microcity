import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatTime, forkTimeFor, untilFor, type BranchSpec, type ExperimentManifest, type Prediction, type TownSpec } from '@microcity/sim';
import { ROOT } from './config.ts';
import type { ExperimentRunner } from './experiments.ts';
import type { RunManager } from './runs.ts';

/**
 * 实验广场（spec v3 §2.4）：精选实验的卡片——问题、先让访客猜、再揭晓两种心智的答案；
 * 规则模式可以在本机（或演示站）一键重跑。内容来自 docs/experiments/gallery.json（由 scripts/lab/gallery.ts 生成）。
 */
export interface GalleryEntry {
  id: string;
  version: number;
  title: string;
  /** 经典出处，一句话 */
  classic: string;
  question: string;
  guess: { prompt: string; options: string[]; answer: number; explain: string };
  /** 结果要点：每条可附规则 / Jev 两种心智下的判定 */
  findings: Array<{ text: string; rule?: string; jev?: string }>;
  /** 仓库里的实验记录（相对路径与锚点） */
  doc?: string;
  /** 卡片上的示意图（v4 D59）：数字取自实验记录，猜之前只画中性的图形 */
  figure?: GalleryFigure;
  spec: TownSpec;
  branches: Record<string, BranchSpec>;
  predictions?: Prediction[];
  seeds: number[];
}

/** 示意图：两张点图对比 / 两组人两个条件下的快慢 / 每一手的保留比例 / 结论的稳健度 / 两种心智的正负分歧 */
export type GalleryFigure =
  | { kind: 'dots'; total: number; unit: string; a: { label: string; value: number }; b: { label: string; value: number }; note: string }
  | { kind: 'race'; unit: string; aLabel: string; bLabel: string; rows: Array<{ label: string; a: number; b: number; aText: string; bText: string }>; note: string }
  | { kind: 'chain'; hops: string[]; rows: Array<{ label: string; values: number[] }>; note: string }
  | { kind: 'robust'; rows: Array<{ label: string; rule: number; jev: number }>; note: string }
  | { kind: 'diverge'; unit: string; rows: Array<{ label: string; value: number; text: string }>; note: string };

export interface GalleryCard extends Omit<GalleryEntry, 'spec'> {
  scenario: string;
  town: { name: string; population: number };
  experiment: { id: string; status: string } | null;
}

export class Gallery {
  private entries: GalleryEntry[] = [];
  constructor(
    private runs: RunManager,
    private experiments: ExperimentRunner,
    file = resolve(ROOT, 'docs/experiments/gallery.json'),
  ) {
    if (existsSync(file)) this.entries = (JSON.parse(readFileSync(file, 'utf8')) as { entries: GalleryEntry[] }).entries;
  }

  private manifestId = (e: GalleryEntry): string => `gallery:${e.id}@v${e.version}`;

  private existing(e: GalleryEntry): { id: string; status: string } | null {
    const hit = this.runs.store.listExperiments().find((x) => (x.manifest as ExperimentManifest).id === this.manifestId(e) && x.status !== 'failed');
    return hit ? { id: hit.id, status: hit.status } : null;
  }

  list(): GalleryCard[] {
    return this.entries.map((e) => {
      const { spec, ...rest } = e;
      const { id: scenario } = this.runs.scenarios.register(spec, 'api');
      return { ...rest, scenario, town: { name: spec.name, population: spec.population.size }, experiment: this.existing(e) };
    });
  }

  /** 用规则模式跑这个精选实验（已有就复用）；返回实验 id */
  run(id: string): { id: string; status: string } | undefined {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return undefined;
    const hit = this.existing(e);
    if (hit) return hit;
    const { id: scenario, scenario: sc } = this.runs.scenarios.register(e.spec, 'api');
    const m: ExperimentManifest = {
      id: this.manifestId(e),
      name: e.title,
      question: e.question,
      scenario,
      seeds: e.seeds,
      provider: 'rule',
      forkAt: formatTime(forkTimeFor(sc, e.branches)),
      until: formatTime(untilFor(sc)),
      branches: e.branches,
      ...(e.predictions?.length ? { predictions: e.predictions } : {}),
    };
    return { id: this.experiments.start(m), status: 'running' };
  }
}
