# 介绍视频

成片在 [docs/assets/v5/video](../assets/v5/video/)：中文 `microcity-intro.mp4`，英文 `microcity-intro-en.mp4`，各带一张海报和一张带播放键的海报（README 用）。落地页按语言放对应的一份。

## 怎么做出来的

一张画布、一个 `draw(t)`（[comp.html](comp.html)）：画面是新版应用的真实录屏（[record.mjs](record.mjs) 录到 `.work/footage/`）加上画布上画的卡片、标签和字幕。所有文字和数字都在 [content.js](content.js)。

旁白是作者自己的口吻：讲由来和做了什么时用“我”（“我在测试 Jev”“后来，我把它重做成…”），不用第三人称的“Jim”。

```bash
bash docs/video/build.sh       # 中文：配音 → 声音 → 渲染 → 编码 → 海报
bash docs/video/build.sh en    # 英文
```

- **配音**：[make_vo.mjs](make_vo.mjs) 用 MiniMax（`speech-2.8-hd`）一句一句念，念好的 mp3 存在 `vo/zh/`、`vo/en/` 并进仓库。按嗓音、语速和文字缓存：只有改过的句子才重念，那时需要环境变量 `MINIMAX_API_KEY`（只从环境变量读，不打印、不落盘）。`ENGINE=say` 可以退回 macOS 的 say 先对时间。
- **时间**：配音量出每句的起止和句中停顿，写成 `timing.js` / `timing.en.js`；画面、字幕、声音事件都从这里来。
- **声音**：[sound.mjs](sound.mjs) 本地合成铺底与点击声，人声出现时铺底自动压低，整体到 −16 LUFS。

## 英文版

同一个 `comp.html`，加 `?lang=en`，不另起一份。

- 画面仍按中文旁白的时间线编排；英文旁白的每句起止，加上句中意思相同的词（`LINES_EN` 的 `k`），把片子的时间映射回编排时间。英文比中文长约 15%，画面相应放慢。
- 画面上的字查 `UI_EN`（中文原文 → 英文）。缺了的会在控制台报“没有英文”。
- 片名“微缩城”两种语言都保留；应用本身的界面是中文的，录屏不变。
- 改了 `comp.html` 以后，中文版要和改之前逐像素相同（拿旧文件截几帧比哈希）。

## 嗓音（2026-11-23 试音后选定）

之前用 macOS 的婷婷，太僵硬。试音的做法：同样三句（开头、“重来一百遍”、结尾）给十来个嗓音念，量语速和音高起伏，再用 Whisper 听写看英文词念得对不对（`audition.mjs` + `audition_report.py`，结果在 `.work/audition/`）。

- **中文**：`Chinese (Mandarin)_Gentleman`（温润男声），语速 1.15。起伏最大、断句自然，Whisper 把它念的“Jim”听写成 Jim（电台男主播、播报男声、阅历姐姐的被听成 James）。“重来、重做、重演”用拼音词典固定成 chóng。
- **英文**：`English_expressive_narrator`，语速 1.1。起伏最大（±6 个半音），Whisper 把它念的“Jev”听写成 Jev（多数嗓音的被听成 JEV 或 Jeff，像是在拼字母）。
- 换嗓音：改 `make_vo.mjs` 的 `VOICES`，或临时 `VOICE_ZH=… SPEED_ZH=… bash docs/video/build.sh`（英文用 `VOICE_EN` / `SPEED_EN`）。中国站的系统嗓音列表里只列了几个英文嗓音，但试过的十几个 `English_*` 嗓音都能用。
