#!/bin/bash
# 微缩城介绍片：从文字到成片。
#   1. 起新版应用的开发服务器（只有重录镜头时需要）：
#        MICROCITY_STUDIO_PORT=5340 pnpm --filter @microcity/studio exec vite --port 5340 --strictPort --host 127.0.0.1
#      然后 node docs/video/record.mjs [镜头名…]   # 不带名字就全录
#   2. bash docs/video/build.sh [zh|en]             # 配音 → 声音 → 渲染 → 编码 → 海报（默认 zh）
# 改数字或旁白只需要改 content.js 再跑第 2 步；改了的句子要用 MiniMax 重念，
# 需要环境变量 MINIMAX_API_KEY（没改的句子直接用 vo/ 里存好的录音，不需要密钥）。
# 英文版的画面按中文旁白编排，所以先有 timing.js（跑过中文的 make_vo）再做英文。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FILM_LANG="${1:-zh}"
node "$HERE/make_vo.mjs" --lang zh
[ "$FILM_LANG" = en ] && node "$HERE/make_vo.mjs" --lang en
node "$HERE/sound.mjs" --lang "$FILM_LANG"
rm -rf "$HERE/.work/frames"
node "$HERE/render.mjs" --workers 7 --lang "$FILM_LANG"
bash "$HERE/encode.sh" "$FILM_LANG"
