#!/usr/bin/env python3
"""生成/更新 AI 人声录音（免费 edge-tts，无需账号）。
用法:  python3 scripts/gen_audio.py          # 补录缺的、删掉没用的、重写 audio/manifest.js
       python3 scripts/gen_audio.py --check  # 只检查覆盖率（缺录音时退出码 1）
依赖:  pip install edge-tts ; ffmpeg ; node
"""
import asyncio, hashlib, json, os, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, "audio")
VOICE, RATE, PITCH = "zh-CN-XiaoxiaoNeural", "-10%", "+0Hz"
KBPS = "32k"

def key(t): return hashlib.sha1((VOICE + "|" + RATE + "|" + t).encode("utf8")).hexdigest()[:12]

def texts():
    out = subprocess.check_output(["node", os.path.join(ROOT, "scripts", "list_speakables.js")])
    return sorted(set(json.loads(out)))

async def make(t, sem, edge_tts):
    dst = os.path.join(AUD, key(t) + ".mp3")
    if os.path.exists(dst): return True
    async with sem:
        for attempt in range(4):
            try:
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f: raw = f.name
                await edge_tts.Communicate(t, VOICE, rate=RATE, pitch=PITCH).save(raw)
                # 单声道、低码率，去掉首尾静音
                p = await asyncio.create_subprocess_exec("ffmpeg", "-y", "-loglevel", "error", "-i", raw,
                    "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.08",
                    "-ac", "1", "-ar", "24000", "-b:a", KBPS, dst + ".tmp.mp3")
                await p.wait(); os.unlink(raw)
                if p.returncode == 0 and os.path.getsize(dst + ".tmp.mp3") > 500:
                    os.replace(dst + ".tmp.mp3", dst); return True
            except Exception as e:
                print("retry", attempt, repr(t), e, file=sys.stderr); await asyncio.sleep(2 + attempt * 3)
        return False

def write_manifest(ts):
    m = {t: key(t) for t in ts if os.path.exists(os.path.join(AUD, key(t) + ".mp3"))}
    with open(os.path.join(AUD, "manifest.js"), "w", encoding="utf8") as f:
        f.write("// 自动生成：scripts/gen_audio.py · 语音 %s %s（edge-tts）· 文字 → audio/<hash>.mp3\n" % (VOICE, RATE))
        f.write("var AUDIO_MANIFEST = " + json.dumps(m, ensure_ascii=False, separators=(",", ":")) + ";\n")
    return m

def main():
    os.makedirs(AUD, exist_ok=True)
    ts = texts()
    if "--check" in sys.argv:
        src = open(os.path.join(AUD, "manifest.js"), encoding="utf8").read()
        m = json.loads(src[src.index("{"):src.rindex("}") + 1])
        miss = [t for t in ts if t not in m or not os.path.exists(os.path.join(AUD, m[t] + ".mp3"))]
        print("speakable texts: %d · recorded: %d · coverage %.2f%%" % (len(ts), len(ts) - len(miss), 100 * (len(ts) - len(miss)) / len(ts)))
        for t in miss[:50]: print("  MISSING:", t)
        sys.exit(1 if miss else 0)
    import edge_tts
    sil = os.path.join(AUD, "_silence.mp3")
    if not os.path.exists(sil):
        subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.2", "-b:a", "16k", sil])
    async def run():
        sem = asyncio.Semaphore(int(os.environ.get("TTS_JOBS", "12")))
        res = await asyncio.gather(*[make(t, sem, edge_tts) for t in ts])
        return [t for t, ok in zip(ts, res) if not ok]
    failed = asyncio.run(run())
    m = write_manifest(ts)
    keep = set(v + ".mp3" for v in m.values()) | {"manifest.js", "_silence.mp3"}
    for f in os.listdir(AUD):
        if f not in keep: os.unlink(os.path.join(AUD, f))
    print("texts %d · recorded %d · failed %d" % (len(ts), len(m), len(failed)))
    for t in failed: print("  FAILED:", t)

if __name__ == "__main__": main()
