#!/bin/bash
# 帧 + 混音 → H.264 + AAC 的 mp4（faststart），再出海报与带播放键的海报。
# 用法：bash docs/video/encode.sh [海报取第几秒]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$HERE/.work"
OUT="$HERE/../assets/v5/video"
mkdir -p "$OUT"
POSTER_T="${1:-}"
[ -z "$POSTER_T" ] && POSTER_T="$(grep -o 'POSTER_T=[0-9.]*' "$HERE/build.sh" | head -1 | cut -d= -f2)"

# 目标约 1.05 Mbps 的视频：100 秒左右的片子落在 13 MB 上下。两遍编码，码率才准。
cd "$W"
ffmpeg -v error -y -framerate 30 -i frames/%05d.jpg -c:v libx264 -preset slow -b:v 1050k -maxrate 2600k -bufsize 5200k \
  -pix_fmt yuv420p -profile:v high -tune animation -g 60 -pass 1 -passlogfile x264 -an -f mp4 /dev/null
ffmpeg -v error -y -framerate 30 -i frames/%05d.jpg -i mix.wav -c:v libx264 -preset slow -b:v 1050k -maxrate 2600k -bufsize 5200k \
  -pix_fmt yuv420p -profile:v high -tune animation -g 60 -pass 2 -passlogfile x264 \
  -c:a aac -b:a 128k -ar 48000 -shortest -movflags +faststart "$OUT/microcity-intro.mp4"
rm -f x264*.log x264*.mbtree

# 海报：片中一帧，不带字幕，左上角换成片名（1920×1080，压到 400 KB 以内）
Q=poster node "$HERE/stills.mjs" "$W/poster-src.png" "$POSTER_T" > /dev/null
q=3
while :; do
  ffmpeg -v error -y -i "$W/poster-src.png" -q:v $q "$OUT/microcity-intro-poster.jpg"
  [ "$(stat -f%z "$OUT/microcity-intro-poster.jpg")" -lt 390000 ] && break
  q=$((q + 1))
done
node "$HERE/poster_play.mjs" "$W/poster-src.png" "$OUT/microcity-intro-poster-play.jpg"
ls -la "$OUT"
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=nw=1 "$OUT/microcity-intro.mp4"
