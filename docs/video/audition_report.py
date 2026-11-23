"""试音报告：每个嗓音的时长、语速、音高中位数与起伏（半音）、停顿占比、Whisper 听写。
用法：.work/venv/bin/python docs/video/audition_report.py .work/audition/zh zh
（起伏小于 ±2.5 半音的嗓音听起来平，像念稿；Whisper 听写用来查 Jim、Jev 这些词念得对不对。）"""
import glob, os, subprocess, sys, tempfile
import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

d, lang = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'zh')
m = WhisperModel('small', device='cpu', compute_type='int8')


def load(p):
    with tempfile.TemporaryDirectory() as t:
        w = os.path.join(t, 'a.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', p, '-ar', '16000', '-ac', '1', w], check=True)
        x, sr = sf.read(w)
    return x, sr


def f0(x, sr):
    fr, hop = int(0.04 * sr), int(0.01 * sr)
    out = []
    for i in range(0, len(x) - fr, hop):
        s = x[i:i + fr] * np.hanning(fr)
        if np.sqrt(np.mean(s ** 2)) < 0.02:
            continue
        ac = np.correlate(s, s, 'full')[fr - 1:]
        lo, hi = int(sr / 400), int(sr / 70)
        k = lo + np.argmax(ac[lo:hi])
        if ac[k] > 0.4 * ac[0]:
            out.append(sr / k)
    return np.array(out)


for p in sorted(glob.glob(os.path.join(d, '*.mp3'))):
    x, sr = load(p)
    dur = len(x) / sr
    env = np.convolve(np.abs(x), np.ones(400) / 400, 'same')
    quiet = np.mean(env < 0.01)
    f = f0(x, sr)
    st = 12 * np.log2(f / np.median(f)) if len(f) else np.array([0])
    segs, _ = m.transcribe(x.astype(np.float32), language=lang)
    txt = ''.join(s.text.strip() for s in segs) if lang == 'zh' else ' '.join(s.text.strip() for s in segs)
    n = len([c for c in txt if '一' <= c <= '鿿']) if lang == 'zh' else len(txt.split())
    unit = '字/s' if lang == 'zh' else 'w/s'
    print(f"{os.path.basename(p)[:-4]:40s} {dur:5.1f}s {n / dur:4.2f} {unit}  f0 {np.median(f):4.0f}Hz ±{np.std(st):3.1f}st  停顿 {quiet:4.0%}\n    {txt}")
