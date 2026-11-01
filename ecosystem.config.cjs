// PM2：公开演示站（部署说明见 DEPLOY.md）
// 同一个进程提供接口与构建好的前端；公开模式只开放规则模式，模型调用走小额总预算。
module.exports = {
  apps: [
    {
      name: 'microcity',
      cwd: __dirname,
      script: 'apps/server/src/main.ts',
      interpreter: 'node',
      interpreter_args: '--no-warnings=ExperimentalWarning --import tsx',
      env: {
        NODE_ENV: 'production',
        MICROCITY_HOST: '127.0.0.1',
        MICROCITY_PORT: '18908',
        MICROCITY_PUBLIC: '1',
        MICROCITY_STATIC_DIR: 'apps/web/dist',
        MICROCITY_DATA: 'data',
        // 模型调用（建镇对话、报告、独白）的总预算上限；密钥放服务器上的 .env.local，不进仓库
        MICROCITY_GLOBAL_BUDGET: '1',
        MICROCITY_RUN_BUDGET: '0.05',
      },
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '900M',
    },
  ],
};
