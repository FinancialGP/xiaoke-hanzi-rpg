# 拼音真人录音 · Pinyin syllable recordings

`audio/py/*.mp3` (885 syllable+tone clips) come from **audio-cmn** — https://github.com/hugolpz/audio-cmn (`64k/syllabs/cmn-<pinyin><tone>.mp3`).

- Speaker / author: **Chen Wang** ("syllabs v.2" set)
- Curation & compression: Hugo Lopez (PLIDAM, INALCO); recording software: Nicolas Vion (SWAC / Shtooka)
- Licence: **Creative Commons Attribution-ShareAlike (CC BY-SA)** — https://creativecommons.org/licenses/by-sa/4.0/ (as stated in the audio-cmn README)

Changes made here (scripts/build_py_audio.sh): trimmed leading/trailing silence, loudness-normalised, resampled to 24 kHz mono 48 kbps mp3, renamed to `<pinyin><tone>.mp3` (ü written as v).
These modified clips are shared under the same CC BY-SA licence. The rest of the game is not affected by this licence.

Missing in the source: `ju4` — the game falls back to TTS of a common character for that one.
