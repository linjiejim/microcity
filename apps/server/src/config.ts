import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** 读 .env.local（不引 dotenv；已存在的环境变量优先） */
function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const key = m[1]!;
    if (process.env[key] === undefined) process.env[key] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
}
loadEnvFile(resolve(ROOT, '.env.local'));

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.MICROCITY_PORT, 5317),
  host: process.env.MICROCITY_HOST ?? '127.0.0.1',
  dataDir: resolve(ROOT, process.env.MICROCITY_DATA ?? 'data'),
  dbFile: process.env.MICROCITY_DB ?? 'microcity.sqlite',
  openrouterKey: process.env.OPENROUTER_API_KEY ?? '',
  openrouterBase: process.env.OPENROUTER_BASE ?? 'https://openrouter.ai/api',
  jevModel: process.env.MICROCITY_JEV_MODEL ?? 'typesafe/jev-1.13',
  genModel: process.env.MICROCITY_GEN_MODEL ?? 'deepseek/deepseek-v4-flash',
  /** 每次运行的模型花费上限（美元） */
  runBudgetUsd: num(process.env.MICROCITY_RUN_BUDGET, 0.5),
  /** 全局累计上限（含开发测试） */
  globalBudgetUsd: num(process.env.MICROCITY_GLOBAL_BUDGET, 3),
  jevTimeoutMs: num(process.env.MICROCITY_JEV_TIMEOUT, 20_000),
  jevConcurrency: num(process.env.MICROCITY_JEV_CONCURRENCY, 6),
  /** 测试时关掉真实模型调用 */
  offline: process.env.MICROCITY_OFFLINE === '1',
  /** 生产环境：由服务端直接提供构建好的前端（例如 apps/web/dist）；开发时由 Vite 提供 */
  staticDir: process.env.MICROCITY_STATIC_DIR ? resolve(ROOT, process.env.MICROCITY_STATIC_DIR) : '',
  /**
   * 公开演示站（v3）：访客只能跑规则模式；种子数、并发实验、每个 IP 每小时的次数有上限；
   * 在线运行不自动生成对话台词；访客的实验与运行 48 小时后清理；闲置的运行从内存卸下。
   */
  publicMode: process.env.MICROCITY_PUBLIC === '1',
  publicLimits: {
    maxSeeds: num(process.env.MICROCITY_PUBLIC_MAX_SEEDS, 10),
    maxRunningExperiments: num(process.env.MICROCITY_PUBLIC_MAX_RUNNING, 2),
    experimentsPerHour: num(process.env.MICROCITY_PUBLIC_EXP_PER_HOUR, 10),
    runsPerHour: num(process.env.MICROCITY_PUBLIC_RUNS_PER_HOUR, 20),
    modelCallsPerHour: num(process.env.MICROCITY_PUBLIC_MODEL_PER_HOUR, 30),
    keepHours: num(process.env.MICROCITY_PUBLIC_KEEP_HOURS, 48),
    idleMinutes: num(process.env.MICROCITY_PUBLIC_IDLE_MINUTES, 15),
  },
};

export const hasModelAccess = (): boolean => !config.offline && config.openrouterKey.startsWith('sk-or-');
