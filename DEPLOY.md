# 部署：公开演示站

官方演示站在 <https://microcity.linjiejim.com>，结构很简单：Caddy → PM2 → `127.0.0.1:18908`，一个 Node 进程同时提供接口与构建好的前端。推送到 `main` 后由 GitHub Actions 自动部署（`.github/workflows/deploy.yml`，见下文“推送即部署”）。

想自己架一个，照下面做；用 nginx、systemd 或别的进程管理器也行，要点只有三个：`MICROCITY_PUBLIC=1`、提供 `apps/web/dist`、`data/` 留在服务器上。

| 项 | 值 |
| --- | --- |
| 进程 | PM2 `microcity`（`ecosystem.config.cjs`），`node --import tsx apps/server/src/main.ts` |
| 端口 | `18908`（只听 127.0.0.1，由反向代理对外；被占用就改 `ecosystem.config.cjs` 里的 `MICROCITY_PORT`） |
| 目录 | 仓库克隆所在的目录（`ecosystem.config.cjs` 用自身所在目录作工作目录） |
| 数据 | 仓库目录下的 `data/`（已 gitignore；`git reset --hard` 不会动它） |
| 密钥 | 服务器上的 `.env.local`（不进仓库）；没有密钥也能跑，只是建镇对话、报告、独白退回模板 |

## 公开模式（`MICROCITY_PUBLIC=1`）

访客能做的：看实验广场、猜、在演示站上用规则模式重跑精选实验、复制并修改、建镇、观察、复盘。

限制（都可用环境变量调整，见 `apps/server/src/config.ts`）：

- 只开放规则模式；Jev 的结果是预先跑好、写在实验广场卡片里的。
- 每个实验最多 10 个随机种子；同时在跑的实验最多 2 个。
- 每个 IP 每小时：实验 10 次、运行 20 次、模型调用 30 次。
- 模型调用走总预算 `MICROCITY_GLOBAL_BUDGET`（演示站设为 $1），用完自动退回模板。
- 在线运行不自动生成对话台词（避免访客把预算烧光）。
- 闲置 15 分钟的运行存快照后从内存卸下；访客的实验与运行 48 小时后清理，精选实验保留。

## 第一次上线

需要 Node 22、pnpm、PM2 和一个反向代理（下面用 Caddy）。

1. 克隆仓库，装依赖、构建、启动：

   ```bash
   git clone https://github.com/linjiejim/microcity.git && cd microcity
   pnpm install --frozen-lockfile
   pnpm --filter @microcity/web build
   pm2 start ecosystem.config.cjs && pm2 save
   curl -s localhost:18908/api/health
   ```

   有的主机会忽略 esbuild 的安装脚本，启动报 esbuild 相关的错时，补一句 `pnpm rebuild esbuild`。

2. 可选：在仓库目录放一份只含 `OPENROUTER_API_KEY` 的 `.env.local`（权限 600）。额度在 OpenRouter 那边给这个密钥设上限。
3. 反向代理，例如在 Caddyfile 里加：

   ```
   microcity.example.com {
   	encode zstd gzip
   	reverse_proxy 127.0.0.1:18908
   }
   ```

4. 域名加一条 A 记录指向服务器。

## 推送即部署（可选）

`.github/workflows/deploy.yml` 先跑 `pnpm check`，再 SSH 到服务器拉代码、按需装依赖、构建、`pm2 startOrRestart`，最后轮询 `/api/health`。它只在配了仓库变量 `DEPLOY_ENVIRONMENT` 的仓库里运行，fork 里默认不会触发。要启用：

- 建一个 GitHub environment，配好这些 secret：
  - `DEV_SERVER_HOST` / `DEV_SERVER_PORT` / `DEV_SERVER_USERNAME` / `DEV_SERVER_SSH_KEY`（用 CI 专用的登录钥匙，不用个人钥匙）；
  - `DEPLOY_APP_DIR`（服务器上的仓库目录）、`DEPLOY_APP_PORT`（与 `ecosystem.config.cjs` 里的 `MICROCITY_PORT` 一致）。这两个不算机密，放 secrets 是为了在公开仓库的运行日志里打码；
- 配一个仓库变量 `DEPLOY_ENVIRONMENT`，值是上面那个 environment 的名字。

服务器拉代码用只读 deploy key（`~/.ssh/deploy_microcity`），经 `ssh.github.com:443` 走 SSH，仓库私有或公开都一样。不需要的话把那几行换成 `git fetch` 公开地址即可。

## 日常

- 部署：推送到 `main`，或在 Actions 里手动运行 “Deploy demo site”。
- 日志：`pm2 logs microcity`，或看 `logs/`。
- 数据库 schema 升级（`SCHEMA_VERSION`）：预发布阶段不做迁移——停进程、删掉 `data/`、重启即可；精选实验会在访客点击时按需重跑。
- 回滚：`git reset --hard <上一个提交> && pnpm --filter @microcity/web build && pm2 restart microcity`。
