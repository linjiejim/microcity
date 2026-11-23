#!/bin/bash
# 帧 + 混音 → H.264 + AAC 的 mp4（faststart），再出海报与带播放键的海报。
# 用法：bash docs/video/encode.sh [zh|en] [海报取片子的第几秒]
#   zh → microcity-intro.mp4、microcity-intro-poster.jpg、microcity-intro-poster-play.jpg
#   en → microcity-intro-en.mp4、microcity-intro-en-poster.jpg、microcity-intro-en-poster-play.jpg
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$HERE/.work"
OUT="$HERE/../assets/v5/video"
mkdir -p "$OUT"
FILM_LANG="${1:-zh}"
if [ "$FILM_LANG" = en ]; then SUF=.en; NAME=microcity-intro-en; TIMING=timing.en.js; Q='poster&lang=en'; else SUF=; NAME=microcity-intro; TIMING=timing.js; Q=poster; fi
POSTER_T="${2:-}"
# 默认：海报取“后来，它被重做成…”这一句开始后 2.3 秒（俯瞰，入夜，灯亮了）
[ -z "$POSTER_T" ] && POSTER_T="$(node -e "const s=require('fs').readFileSync('$HERE/$TIMING','utf8');const m=JSON.parse(s.slice(s.indexOf('{'),s.lastIndexOf('}')+1));console.log((m.lines.find(l=>l.id==='v1').t0+2.31).toFixed(2))")"

# 目标约 1.05 Mbps 的视频：100 秒左右的片子落在 14 MB 上下。两遍编码，码率才准。
cd "$W"
ffmpeg -v error -y -framerate 30 -i frames/%05d.jpg -c:v libx264 -preset slow -b:v 1050k -maxrate 2600k -bufsize 5200k \
  -pix_fmt yuv420p -profile:v high -tune animation -g 60 -pass 1 -passlogfile x264 -an -f mp4 /dev/null
ffmpeg -v error -y -framerate 30 -i frames/%05d.jpg -i "mix$SUF.wav" -c:v libx264 -preset slow -b:v 1050k -maxrate 2600k -bufsize 5200k \
  -pix_fmt yuv420p -profile:v high -tune animation -g 60 -pass 2 -passlogfile x264 \
  -c:a aac -b:a 128k -ar 48000 -shortest -movflags +faststart "$OUT/$NAME.mp4"
rm -f x264*.log x264*.mbtree

# 海报：片中一帧，不带字幕，左上角换成片名（1920×1080，压到 400 KB 以内）
Q="$Q" node "$HERE/stills.mjs" "$W/poster-src$SUF.png" "$POSTER_T" > /dev/null
q=3
while :; do
  ffmpeg -v error -y -i "$W/poster-src$SUF.png" -q:v $q "$OUT/$NAME-poster.jpg"
  [ "$(stat -f%z "$OUT/$NAME-poster.jpg")" -lt 390000 ] && break
  q=$((q + 1))
done
node "$HERE/poster_play.mjs" "$W/poster-src$SUF.png" "$OUT/$NAME-poster-play.jpg"
ls -la "$OUT"
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=nw=1 "$OUT/$NAME.mp4"
