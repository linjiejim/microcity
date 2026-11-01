/** 预设规格：设计工作区的模板（spec v1 §2.5） */
import { classicSpec, generatedDefaults, type TownSpec } from './spec.ts';

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  spec: TownSpec;
}

export function presets(): Preset[] {
  const classic = classicSpec();
  const old = generatedDefaults();
  Object.assign(old, {
    name: '老城区',
    seed: 11,
    population: { size: 40, seniors: 0.4, youth: 0.1, northShare: 0.5 },
    facilities: { cafe: 1, restaurant: 1, convenience: 2, supermarket: 1, studio: 0, clinic: 1, library: 1, newsroom: 1, parks: 2 },
    culture: { trustGov: 0.72, anxiety: 0.55, sociability: 0.68, detail: 0.5 },
    media: { push: 0.12, website: 0.2, boards: 2 },
    network: { friends: 2.6, crossDistrict: 0.3, kin: 0.6 },
  } satisfies Partial<TownSpec>);
  const young = generatedDefaults();
  Object.assign(young, {
    name: '年轻新区',
    seed: 23,
    population: { size: 24, seniors: 0.05, youth: 0.5, northShare: 0.6 },
    facilities: { cafe: 2, restaurant: 1, convenience: 1, supermarket: 1, studio: 1, clinic: 1, library: 1, newsroom: 0, parks: 1 },
    culture: { trustGov: 0.4, anxiety: 0.4, sociability: 0.75, detail: 0.45 },
    media: { push: 0.6, website: 0.3, boards: 1 },
    network: { friends: 3, crossDistrict: 0.5, kin: 0.2 },
  } satisfies Partial<TownSpec>);
  young.events = [{ ...structuredClone(young.events[0]!), notice: { at: 'D03 08:05', channels: ['website', 'push'], headline: 'coarse', advice: ['charge_devices', 'plan_elsewhere'] } }];
  const big = generatedDefaults();
  Object.assign(big, {
    name: '大镇两轮通知',
    seed: 42,
    population: { size: 60, seniors: 0.25, youth: 0.25, northShare: 0.5 },
    facilities: { cafe: 2, restaurant: 2, convenience: 2, supermarket: 1, studio: 1, clinic: 1, library: 1, newsroom: 1, parks: 2 },
    culture: { trustGov: 0.6, anxiety: 0.45, sociability: 0.6, detail: 0.58 },
    media: { push: 0.3, website: 0.25, boards: 2 },
    network: { friends: 2.5, crossDistrict: 0.3, kin: 0.4 },
  } satisfies Partial<TownSpec>);
  big.events = [
    structuredClone(big.events[0]!),
    { id: 'E2', area: 'south', day: 6, from: '10:00', to: '12:00', notice: { at: 'D05 09:00', channels: ['website', 'push', 'board'], headline: 'coarse', advice: ['charge_devices'] }, clarify: null, workOrder: true },
  ];
  return [
    { id: 'classic', name: '河岸小镇（经典 30 人）', blurb: 'v0 的手工小镇：北区 20 人、南区 10 人，一轮北区停电通知。修饰只改文化、媒介、朋友与剧本。', spec: classic },
    { id: 'oldtown', name: '老城区（40 人）', blurb: '四成是老人，信官方、少推送、爱串门，公告栏多。', spec: old },
    { id: 'newtown', name: '年轻新区（24 人）', blurb: '一半是年轻人，手机不离手、爱社交，不太信官方。', spec: young },
    { id: 'bigtwo', name: '大镇两轮通知（60 人）', blurb: '周四北区停电，周六南区再停一次：看第一轮的经历怎样影响第二轮。', spec: big },
  ];
}
