# AGENTS.md

微缩城 MicroCity：一座可以做社会实验的微缩小镇。
- 设计：按模板生成小镇，支持对话建镇；
- 观察：结构化主张传播；
- 复盘：可审计决策、信任演化、多 seed 对照、以事实表为界的 LLM 报告。

先读 [README](README.md)、[docs/specs](docs/specs/README.md) 与 [docs/experiments](docs/experiments/README.md)；改动前对照当前方案的决定记录（D1…D61）。

## 仓库结构

```
packages/sim/    确定性内核（纯 TS，无 IO，前后端同构）
  scenario/      town30（经典手工小镇）、events（事件规格 → 剧本）、spec（TownSpec 与规范化）、generate（生成器）、presets、stats
  mind/          候选与效用（reaction）、social（信任裁决 social_v1）、thought（人物画像与想法）
  metrics/       漏斗与后果、chronicle（节拍）、series（曲线）
apps/server/     Node 22：运行、SQLite（node:sqlite）、HTTP/WS、Jev/DeepSeek 适配、场景登记、建镇会话、多 seed 实验、复盘计算、报告
apps/web/        React + react-three-fiber：shell（顶栏、诊断）、gallery（实验广场）、design、observe、review、city、panels（弹窗与档案）
e2e/             Playwright 端到端测试
scripts/         开发脚本（冒烟、多 seed 对比、真实 Jev 实验、截图）
  lab/           实验脚本：敏感性、Jev 对规则与拟合、中英模板、信任面板、社会实验
docs/specs/      方案（日期前缀文件名 + 索引）
docs/experiments/ 实验记录（预注册的假设、结果、洞察）、模板 TEMPLATE.md、汇总数据 results/、实验广场内容 gallery.json
```

## 内核规则（packages/sim）

- 状态只通过事件改变：新增状态字段就新增事件类型，并在 `state/reducer.ts` 里处理；前端用同一个 reducer 重建状态。
- 禁止 `Math.random`、`Date.now`（oxlint 会拦）：随机数用 `core/rng.ts` 的计数器式 `rand(seed, ...key)`，键要能说明用途（人、决策种类、主张族、局部计数）。
- 事件里的 id 由序号或内容哈希派生，不用自增全局变量；遍历对象按插入顺序，保证确定性。
- 模型永远不直接改世界：它只回答语义因子，选择由 `mind/reaction.ts` 的效用 + 抽样完成，执行前再校验合法性。
- 不要写死地点 id：用 `TownMap.nearestOf` / `placesOfKind` 按类型找（生成的小镇 id 各不相同）。
- 剧本由 `OutageEventSpec` 生成（`scenario/events.ts`）；分支是对事件规格打补丁（`experiment.ts`），不要手改脚本里的新闻。一轮事件可以是虚惊（`mode: 'false_alarm'`），也可以在分支里设为不存在（`absent`）。
- 心智规则里的常数都在 `params.ts` 的 `RuleParams`，不要在规则模块里写新的魔法数：
  - 默认值（params_v2）来自校准，依据写在 v2 方案的 D40–D42；改默认值要升 `PARAMS_VERSION`，并写明依据；
  - 实验要换参数，用引擎选项或分支的 `params` 覆盖，不要改默认值。
- 信任变化只能由 `mind/social.ts` 的规则表在“真相可见”时产生：
  - 写成 `trust_changed` 与 `experience` 事件；
  - 改规则表要升 `SOCIAL_RULES_VERSION`。
- 改候选的生成或效用公式要升 `POLICY_VERSION`（记录在每条决策里）。
- 生成器 `scenario/generate.ts` 是纯函数：同一规格必须生成同一场景；默认经典规格必须与 `town30()` 逐字段相等（有测试）。
- 新机制必须带测试：不变量（`checks/invariants.ts`）、重放一致、分叉前后哈希、知识隔离不能被破坏；生成小镇要过可达与浸泡。

## 服务端规则（apps/server）

- 公开演示站（`MICROCITY_PUBLIC=1`）的限制都在 `config.publicLimits`：
  - 新增会调用模型或会写库的接口，要接上 `throttled` 限速；
  - 调用 Jev 的接口要接上 `jevBlocked`。
- 预测（`ExperimentManifest.predictions`）的指标键由 `isMetricKey` 校验。新增指标要同时加进 `OutageMetrics`、`METRIC_DEFS` 和前端“对照”的指标表。

- 场景只存 id：`town30` 内置，其余按规格内容哈希登记为 `sc_<hash>`，需要时由生成器重建（`scenarios.ts`）。
- 生成模型（DeepSeek）的调用都走 `providers/chat.ts`：预算闸、答案缓存（只缓存通过校验的答案）、记账。
- 以下改动都要升对应的模板版本（缓存键随之变化）：
  - 改 Jev 问题模板：升 `JEV_TEMPLATE_VERSION`；
  - 改建镇提示：升 `BUILDER_TEMPLATE_VERSION`；
  - 改报告提示或事实表：升 `REPORT_TEMPLATE_VERSION`；
  - 改独白提示：升 `MONOLOGUE_TEMPLATE_VERSION`。
- 报告只能引用事实表（`report.ts`）：数字、时刻、人名、引用都要能在事实表里找到；校验失败就回退模板报告，并记录原因。
- 建镇补丁走白名单（`builder.ts` 的 `applyPatch`），再过 `normalizeSpec`，把调整原因告诉用户。

## 前端规则（apps/web）

视觉语言见 [v4 方案](docs/specs/20260930-microcity-v4-design-language.md)（暖色纸面 + 深青强调，D53–D61）：
- 颜色只用 `theme/tokens.css` 的变量；canvas 与三维场景读不到 CSS 变量，用 `theme/palette.ts` 的同一套值。
  - 内核给的场景颜色（建筑、人物）经 `soft()` 映射到暖色系，不要改内核的颜色（D56）。
  - 知情三态（还不知道 / 听说了 / 相信了）的颜色全站统一：城市、地图、图例、大数字。
- 字体用系统字体：正文无衬线，标题与“想法”用衬线（`.serif`）；字号阶梯 12 / 13 / 14 / 16 / 20 / 24 / 32。圆角 6 / 10 / 14，描边 1px，阴影用 `--sh-1/2/3`，过渡 150ms。
- 图标只用 `ui/icons.ts` 的线性图标（24×24 路径，UI 与 canvas 共用）；组件用 `ui/kit.tsx`（Button / Tabs / Badge / Meter / Modal / Segmented / Check / Switch / Popover / BigNumber）。
- 城市有两种视图：3D 微缩小镇（`city/CityView.tsx`）与平面地图（`city/FlatMap.tsx`），共用 `selectedAgent`。城市上的文字用 `city/overlay.tsx` 的 DOM 叠层（`useAnchor`），不要用 drei `<Html>`。三维代码只能从观察页按需加载（D60），别的模块不要直接引用 `city/` 下的三维文件。
- 地图来自 `store.map`（按运行载入的场景），不要从内核直接取 `town30()`。
- 信息减法：每个工作区默认只回答一个问题（D55）：
  - 观察：城市、一个大数字、关键节拍、精简人物卡；倍速、单步、快进、发布新闻在顶栏的“更多”里；
  - 分析性内容放复盘，对照页先给问题与判定；
  - 开发诊断放“诊断”弹窗；
  - 新增控件先问“它回答的是这一屏的问题吗”，不是就收进二级。
- 图表用 canvas 自己画（抗锯齿折线与面积），不引入图表库。
- 广场的示意图由 `gallery.json` 的 `figure` 驱动（D59）；猜之前不能泄露答案（按钮中性、图只画骨架）。
- 可交互元素加 `data-testid`，E2E 依赖它们；不要把按钮嵌在按钮里；界面文字不用“他 / 她”指代居民。

## 常用命令

```bash
pnpm dev          # 服务端 5317 + 前端 5318
pnpm test         # vitest：内核 + 服务端
pnpm e2e          # Playwright（离线，独立端口与数据库）
pnpm typecheck
pnpm lint
```

## 密钥与花费

- `OPENROUTER_API_KEY` 只放 `.env.local`（已 gitignore），不进仓库、不下发前端。
- 测试默认离线（`MICROCITY_OFFLINE=1`），模型路径用夹具测试；真实调用前确认预算闸（`MICROCITY_RUN_BUDGET` / `MICROCITY_GLOBAL_BUDGET`）。

## 实验

- 实验记录放 `docs/experiments/`：先写问题与假设并提交（预注册），再跑；结果与洞察追加在后面，不回改假设。
- 结论要看分布：
  - 规则模式跑多个 seed、多座镇；
  - 关键实验再用 Jev 跑一遍；
  - 只在两种心智下都成立、且对参数不敏感的，才算结论。
- 跑模型的实验脚本写主库，先停 dev 服务；规则批量用 `scripts/lab/pool.ts`，只在内存里跑。
- 汇总数据放 `docs/experiments/results/`（不能叫 `data/`，会被 .gitignore 吃掉）。
- 实验广场的卡片：改 `scripts/lab/gallery.ts` 后重新生成 `docs/experiments/gallery.json`，不要手改 JSON；卡片里的数字要与实验记录一致。

## 部署

公开演示站：推送到 main 后由 GitHub Actions 部署到作者的服务器，见 [DEPLOY.md](DEPLOY.md)。

## 数据

`data/` 下的 SQLite 带 `SCHEMA_VERSION`（当前 2）。预发布阶段不做迁移，版本不一致时删掉 `data/` 重建。
