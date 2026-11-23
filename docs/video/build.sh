#!/bin/bash
# 微缩城介绍片：从文字到成片。
#   1. 起新版应用的开发服务器（只有重录镜头时需要）：
#        MICROCITY_STUDIO_PORT=5340 pnpm --filter @microcity/studio exec vite --port 5340 --strictPort --host 127.0.0.1
#      然后 node docs/video/record.mjs [镜头名…]   # 不带名字就全录
#   2. bash docs/video/build.sh                     # 配音 → 声音 → 渲染 → 编码 → 海报
# 改数字或旁白只需要改 content.js 再跑第 2 步。
set -euo pipefail
POSTER_T=32.6   # 海报取第几秒（俯瞰，入夜，灯亮了）
HERE="$(cd "$(dirname "$0")" && pwd)"
node "$HERE/make_vo.mjs"
node "$HERE/sound.mjs"
rm -rf "$HERE/.work/frames"
node "$HERE/render.mjs" --workers 7
bash "$HERE/encode.sh" "$POSTER_T"
