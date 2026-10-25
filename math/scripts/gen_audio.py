#!/usr/bin/env python3
"""数学游戏的 AI 人声录音（免费 edge-tts，正常语速 +0%）。
中文: zh-CN-XiaoxiaoNeural   英文: en-NZ-MollyNeural
用法:  python3 scripts/gen_audio.py [URL]          # 补录缺的、删没用的、重写 audio/manifest.js
       python3 scripts/gen_audio.py --check [URL]  # 只查覆盖率（缺录音退出码 1）
题目里带数字的长尾句子按“文字片段 + 数字”分段录，游戏里连着播；种类少的题整句录。
依赖: pip install edge-tts ; ffmpeg ; node + playwright-core（list_speakables.js 用）; 本地服务器
"""
import asyncio, hashlib, json, os, re, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, "audio")
VOICES = {"zh": "zh-CN-XiaoxiaoNeural", "en": "en-NZ-MollyNeural"}
RATE, PITCH, KBPS = "+0%", "+0Hz", "32k"
URL = next((a for a in sys.argv[1:] if a.startswith("http")), "http://localhost:8807/gh-merge/math/")

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
def en_words(n):
    """新西兰/英式读法：345 → three hundred and forty-five"""
    if n < 20: return ONES[n]
    if n < 100: return TENS[n // 10] + ("" if n % 10 == 0 else "-" + ONES[n % 10])
    if n < 1000: return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " and " + en_words(n % 100))
    return en_words(n // 1000) + " thousand" + ("" if n % 1000 == 0 else (" and " if n % 1000 < 100 else " ") + en_words(n % 1000))

def tts_input(lang, t):
    if lang == "en": return re.sub(r"\d+", lambda m: en_words(int(m.group())), t)
    return t

def key(lang, t): return hashlib.sha1((VOICES[lang] + "|" + RATE + "|" + t).encode("utf8")).hexdigest()[:12]

def texts():
    d = json.loads(subprocess.check_output(["node", os.path.join(ROOT, "scripts", "list_speakables.js"), URL]))
    out = {}
    for lang in ("zh", "en"):
        # 数字 0..1000 全录（抽样每次不同，所以录整段范围）
        s = set(d[lang]["full"]) | set(d[lang]["segs"]) | {str(n) for n in range(0, max([1000] + d["nums"]) + 1)}
        if lang == "zh": s.add("两")
        out[lang] = sorted(s)
    return out

async def make(lang, t, sem, edge_tts):
    dst = os.path.join(AUD, lang, key(lang, t) + ".mp3")
    if os.path.exists(dst): return True
    async with sem:
        for attempt in range(5):
            try:
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f: raw = f.name
                await edge_tts.Communicate(tts_input(lang, t), VOICES[lang], rate=RATE, pitch=PITCH).save(raw)
                p = await asyncio.create_subprocess_exec("ffmpeg", "-y", "-loglevel", "error", "-i", raw,
                    "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.06",
                    "-ac", "1", "-ar", "24000", "-b:a", KBPS, dst + ".tmp.mp3")
                await p.wait(); os.unlink(raw)
                if p.returncode == 0 and os.path.getsize(dst + ".tmp.mp3") > 400:
                    os.replace(dst + ".tmp.mp3", dst); return True
            except Exception as e:
                print("retry", attempt, lang, repr(t), e, file=sys.stderr); await asyncio.sleep(2 + attempt * 3)
        return False

def write_manifest(ts):
    m = {lang: {t: key(lang, t) for t in ts[lang] if os.path.exists(os.path.join(AUD, lang, key(lang, t) + ".mp3"))} for lang in ts}
    with open(os.path.join(AUD, "manifest.js"), "w", encoding="utf8") as f:
        f.write("// 自动生成：scripts/gen_audio.py · zh %s / en %s · rate %s（edge-tts）· 文字 → audio/<lang>/<hash>.mp3\n" % (VOICES["zh"], VOICES["en"], RATE))
        f.write("var KM_AUDIO = " + json.dumps(m, ensure_ascii=False, separators=(",", ":")) + ";\n")
    return m

def main():
    ts = texts()
    if "--check" in sys.argv:
        src = open(os.path.join(AUD, "manifest.js"), encoding="utf8").read()
        m = json.loads(src[src.index("{"):src.rindex("}") + 1]); bad = 0
        for lang in ts:
            have = lambda t: t in m.get(lang, {}) and os.path.exists(os.path.join(AUD, lang, m[lang][t] + ".mp3"))
            def split(t): return [x.strip() for x in re.split(r"(\d+)", t) if x.strip() and not re.fullmatch(r"[\s,.，。、:：;；!?！？]+", x.strip())]
            # 和游戏里 VOICE.parts 一样：整句有录音，或者每一段都有录音，就算覆盖
            miss = [t for t in ts[lang] if not have(t) and not (len(split(t)) > 1 and all(have(x) for x in split(t)))]
            n = len(ts[lang]); bad += len(miss)
            print("%s: speakable %d · recorded %d · coverage %.2f%%" % (lang, n, n - len(miss), 100 * (n - len(miss)) / n))
            for t in miss[:30]: print("  MISSING:", lang, t)
        sys.exit(1 if bad else 0)
    import edge_tts
    for lang in ts: os.makedirs(os.path.join(AUD, lang), exist_ok=True)
    sil = os.path.join(AUD, "silence.mp3")
    if not os.path.exists(sil):
        subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.2", "-b:a", "16k", sil])
    async def run():
        sem = asyncio.Semaphore(int(os.environ.get("TTS_JOBS", "12")))
        jobs = [(l, t) for l in ts for t in ts[l]]
        res = await asyncio.gather(*[make(l, t, sem, edge_tts) for l, t in jobs])
        return [j for j, ok in zip(jobs, res) if not ok]
    failed = asyncio.run(run())
    m = write_manifest(ts)
    for lang in ts:
        keep = set(v + ".mp3" for v in m[lang].values())
        for f in os.listdir(os.path.join(AUD, lang)):
            if f not in keep: os.unlink(os.path.join(AUD, lang, f))
    print("recorded zh %d en %d · failed %d" % (len(m["zh"]), len(m["en"]), len(failed)))
    for j in failed: print("  FAILED:", j)

if __name__ == "__main__": main()
