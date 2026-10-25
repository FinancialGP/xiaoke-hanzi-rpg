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
# v7.8 剧情男声（台词清单来自 __xiaoke.voiced()；同一句话不同声音 → 不同文件，不会撞车）
VOICES = {"boy": ("zh-CN-YunxiaNeural", "+0%"), "man": ("zh-CN-YunxiNeural", "-10%"), "elder": ("zh-CN-YunyangNeural", "-10%"),
          "old": ("zh-CN-YunyangNeural", "-20%", "-25Hz")}   # v8.0 老爷爷：更慢更低

def spec(v):
    s = VOICES[v] if v else (VOICE, RATE)
    return s[0], s[1], (s[2] if len(s) > 2 else PITCH)

def key(t, v=None):
    vo, ra, pi = spec(v)
    return hashlib.sha1((vo + "|" + ra + ("" if pi == PITCH else "|" + pi) + "|" + t).encode("utf8")).hexdigest()[:12]

def voiced():
    out = subprocess.check_output(["node", os.path.join(ROOT, "scripts", "list_speakables.js"), "--voiced"])
    return {v: sorted(set(ts)) for v, ts in json.loads(out).items()}

def texts():
    out = subprocess.check_output(["node", os.path.join(ROOT, "scripts", "list_speakables.js")])
    return sorted(set(json.loads(out)))

async def make(t, sem, edge_tts, v=None):
    vo, ra, pi = spec(v)
    dst = os.path.join(AUD, key(t, v) + ".mp3")
    if os.path.exists(dst): return True
    async with sem:
        for attempt in range(4):
            try:
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f: raw = f.name
                await edge_tts.Communicate(t, vo, rate=ra, pitch=pi).save(raw)
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

def write_manifest(ts, vs):
    m = {t: key(t) for t in ts if os.path.exists(os.path.join(AUD, key(t) + ".mp3"))}
    mv = {v: {t: key(t, v) for t in l if os.path.exists(os.path.join(AUD, key(t, v) + ".mp3"))} for v, l in vs.items()}
    with open(os.path.join(AUD, "manifest.js"), "w", encoding="utf8") as f:
        f.write("// 自动生成：scripts/gen_audio.py · 语音 %s %s（edge-tts）· 文字 → audio/<hash>.mp3\n" % (VOICE, RATE))
        f.write("var AUDIO_MANIFEST = " + json.dumps(m, ensure_ascii=False, separators=(",", ":")) + ";\n")
        f.write("// 剧情男声：" + ", ".join("%s=%s" % (v, " ".join(x)) for v, x in VOICES.items()) + "\n")
        f.write("var AUDIO_VOICES = " + json.dumps(mv, ensure_ascii=False, separators=(",", ":")) + ";\n")
    return m, mv

def main():
    os.makedirs(AUD, exist_ok=True)
    ts = texts(); vs = voiced()
    if "--check" in sys.argv:
        src = open(os.path.join(AUD, "manifest.js"), encoding="utf8").read()
        a = src.index("AUDIO_MANIFEST = ") + 17; m = json.loads(src[a:src.index(";\n", a)])
        mv = json.loads(src[src.index("AUDIO_VOICES = ") + 15:src.rindex(";")]) if "AUDIO_VOICES" in src else {}
        miss = [t for t in ts if t not in m or not os.path.exists(os.path.join(AUD, m[t] + ".mp3"))]
        print("speakable texts: %d · recorded: %d · coverage %.2f%%" % (len(ts), len(ts) - len(miss), 100 * (len(ts) - len(miss)) / len(ts)))
        for v, l in vs.items():
            mm = [t for t in l if t not in mv.get(v, {}) or not os.path.exists(os.path.join(AUD, mv[v][t] + ".mp3"))]
            print("  male voice %-5s %s: %d lines · recorded %d" % (v, VOICES[v][0], len(l), len(l) - len(mm)))
            for t in mm[:20]: print("  MISSING[%s]: %s" % (v, t))
            miss += mm
        for t in miss[:50]: print("  MISSING:", t)
        sys.exit(1 if miss else 0)
    import edge_tts
    sil = os.path.join(AUD, "silence.mp3")
    if not os.path.exists(sil):
        subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.2", "-b:a", "16k", sil])
    async def run():
        sem = asyncio.Semaphore(int(os.environ.get("TTS_JOBS", "12")))
        jobs = [(t, None) for t in ts] + [(t, v) for v, l in vs.items() for t in l]
        res = await asyncio.gather(*[make(t, sem, edge_tts, v) for t, v in jobs])
        return [(v or "") + ":" + t for (t, v), ok in zip(jobs, res) if not ok]
    failed = asyncio.run(run())
    m, mv = write_manifest(ts, vs)
    keep = set(v + ".mp3" for v in m.values()) | set(h + ".mp3" for d in mv.values() for h in d.values()) | {"manifest.js", "silence.mp3"}
    for f in os.listdir(AUD):
        if f not in keep and os.path.isfile(os.path.join(AUD, f)): os.unlink(os.path.join(AUD, f))
    print("texts %d · recorded %d · male %s · failed %d" % (len(ts), len(m), {v: len(d) for v, d in mv.items()}, len(failed)))
    for t in failed: print("  FAILED:", t)

if __name__ == "__main__": main()
