#!/bin/bash
# v8.0 拼音真人录音：从 hugolpz/audio-cmn（Chen Wang 录音，CC BY-SA）取需要的音节，去掉首尾静音、统一音量，写 audio/py/ + audio/py/manifest.js
# 用法：bash scripts/build_py_audio.sh /path/to/audio-cmn  （需要的文件名列表来自 __xiaoke.pyFiles()）
set -e
SRC="${1:-/tmp/audio-cmn}/64k/syllabs"; cd "$(dirname "$0")/.."
node -e 'const vm=require("vm"),fs=require("fs");const w={document:{readyState:"loading",addEventListener(){},getElementById(){return null}},localStorage:{getItem(){return null},setItem(){}},navigator:{userAgent:""},setTimeout,console};w.window=w;vm.createContext(w);for(const f of ["hanzi_data.js","words2.js","stories.js","scene_quiz.js","game.js"])vm.runInContext(fs.readFileSync(f,"utf8"),w);console.log(w.__xiaoke.pyFiles().join("\n"))' > /tmp/pyfiles.txt
keys=()
for f in $(cat /tmp/pyfiles.txt); do
  [ -f "$SRC/cmn-$f.mp3" ] || { echo "no recording: $f (falls back to TTS of a character)"; continue; }
  ffmpeg -nostdin -loglevel error -y -i "$SRC/cmn-$f.mp3" -af "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=1:stop_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,adelay=60,apad=pad_dur=0.12,loudnorm=I=-16:TP=-1.5" -ac 1 -ar 24000 -b:a 48k "audio/py/$f.mp3"
  keys+=("\"py:$f\":1")
done
( echo "// v8.0 自动生成：scripts/build_py_audio.sh。真人拼音录音 audio/py/<音节><声调>.mp3，来源和许可见 audio/py/LICENSE.md"; echo -n "var PY_AUDIO = {"; (IFS=,; echo -n "${keys[*]}"); echo "};" ) > audio/py/manifest.js
echo "${#keys[@]} clips"
