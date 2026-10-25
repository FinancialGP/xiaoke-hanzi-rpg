/**
 * 小侠客汉字龙珠 v7（GitHub v6 存档/动画修复 + 主动阅读：点字听音、故事书架、龙珠雷达线索）
 * 模块：数据 · 玩家档案/存档 · 语音 · 间隔复习 · 出题（汉字为主 + 少量数学/英语） · 修炼(集龙珠) · 龙珠故事 · 双人 · UI
 * 纯静态网页：直接打开 index.html 即可。
 */
(function (global) {
  "use strict";

  /* ═══════════════ 字库 ═══════════════ */
  var DB = (typeof HANZI_DB !== "undefined") ? HANZI_DB : [];
  var BYC = {};
  DB.forEach(function (h) { BYC[h.c] = h; });
  var ORDER = DB.slice().sort(function (a, b) { return a.n - b.n; }).map(function (h) { return h.c; });
  // 启蒙模式的学习顺序：先象形字和数字
  var LITTLE_ORDER = (function () {
    var pref = "人大小口山水火日月一二三木手目耳心上下四五鱼鸟牛羊马虫花草雨云星车门书六七八九十爸妈龙球米石刀田头足";
    var have = (typeof LITTLE_CHARS !== "undefined") ? LITTLE_CHARS : [];
    var out = [];
    pref.split("").forEach(function (c) { if (have.indexOf(c) !== -1 && out.indexOf(c) === -1) out.push(c); });
    have.forEach(function (c) { if (out.indexOf(c) === -1) out.push(c); });
    return out;
  })();
  var KNOWN_WORDS = {};
  DB.forEach(function (h) { (h.w || []).forEach(function (w) { KNOWN_WORDS[w.w] = 1; }); });
  if (typeof CEDICT_WORDS2 === "string") for (var wi = 0; wi + 1 < CEDICT_WORDS2.length; wi += 2) KNOWN_WORDS[CEDICT_WORDS2.substr(wi, 2)] = 1;

  var STORE_KEY = "xiaoke_v4_store";
  var LEGACY_SLOT_PREFIX = "xiaoke_hanzi_rpg_slot_";
  var SESSION_LEN = 7;            // 一关 = 7 题 = 7 颗龙珠
  var DAY = 864e5;
  var INTERVALS = [0, 3 * 60e3, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY]; // 盒子 0-6 的复习间隔

  var $ = function (id) { return document.getElementById(id); };

  /* ═══════════════ 工具 ═══════════════ */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function now() { return Date.now(); }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* ═══════════════ 音效 ═══════════════ */
  var AudioCtx = global.AudioContext || global.webkitAudioContext;
  var audioCtx = null, soundOn = true;
  function initAudio() {
    try {
      if (!audioCtx && AudioCtx) audioCtx = new AudioCtx();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { /* 无音频也能玩 */ }
  }
  function beep(freq, dur, type, vol) {
    if (!soundOn || !AudioCtx) return;
    initAudio();
    if (!audioCtx) return;
    try {
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.frequency.value = freq; o.type = type || "triangle";
      g.gain.setValueAtTime(vol || 0.08, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* */ }
  }
  var SFX = {
    click: function () { beep(520, 0.05); },
    correct: function () { beep(660, 0.1); setTimeout(function () { beep(880, 0.14); }, 90); },
    soft: function () { beep(300, 0.15, "sine", 0.06); },          // 答错：温和的提示音
    blast: function () { [300, 500, 800, 1200].forEach(function (f, i) { setTimeout(function () { beep(f, 0.12, "sawtooth", 0.04); }, i * 60); }); },
    level: function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { beep(f, 0.16); }, i * 110); }); },
    ball: function () { beep(1046, 0.08); setTimeout(function () { beep(1318, 0.1); }, 70); },
    win: function () { [392, 494, 587, 784].forEach(function (f, i) { setTimeout(function () { beep(f, 0.2); }, i * 120); }); }
  };

  /* ═══════════════ v7.2 录好的 AI 人声：audio/<hash>.mp3，清单在 audio/manifest.js（scripts/gen_audio.js 生成） ═══════════════ */
  var RATE_KEY = "xiaoke_voice_rate";     // 单独一个键，不改存档格式；1 = 正常，0.75 = 慢速
  var VOICE = {
    map: (typeof AUDIO_MANIFEST !== "undefined" && AUDIO_MANIFEST) || {}, base: "audio/",
    el: null, job: null, misses: [], plays: [], n: (typeof AUDIO_MANIFEST !== "undefined" && AUDIO_MANIFEST) ? Object.keys(AUDIO_MANIFEST).length : 0,
    rate: (function () { try { return +localStorage.getItem(RATE_KEY) === 0.75 ? 0.75 : 1; } catch (e) { return 1; } })(),
    has: function (t) { return Object.prototype.hasOwnProperty.call(this.map, String(t)); },
    audio: function () {
      if (!this.el && typeof global.Audio === "function") { this.el = new global.Audio(); this.el.preload = "auto"; }
      return this.el;
    },
    unlock: function () { var a = this.audio(); if (!a || this.unlocked) return; this.unlocked = true; try { a.muted = true; a.src = this.base + "silence.mp3"; var p = a.play(); if (p && p.then) p.then(function () { a.pause(); a.muted = false; }, function () { a.muted = false; }); else a.muted = false; } catch (e) { a.muted = false; } },
    setRate: function (r) { this.rate = r === 0.75 ? 0.75 : 1; try { localStorage.setItem(RATE_KEY, String(this.rate)); } catch (e) { /* */ } if (this.el) this.el.playbackRate = this.rate; if (this.onRate) this.onRate(); },
    play: function (t, done) {
      var a = this.audio(), job = this.job, fired = false;
      var fin = function () { if (fired) return; fired = true; if (VOICE.job === job) done(); };
      if (!a) return fin();
      var url = this.base + this.map[String(t)] + ".mp3";
      a.onended = fin; a.onerror = function () { if (String(a.src).indexOf(url) < 0) return; VOICE.miss(t); fin(); };
      a.muted = false; a.src = url;
      a.preservesPitch = true; a.webkitPreservesPitch = true; a.mozPreservesPitch = true;
      a.defaultPlaybackRate = this.rate; a.playbackRate = this.rate;
      this.plays.push(String(t));
      try { var p = a.play(); if (p && p.catch) p.catch(function () { fin(); }); } catch (e) { fin(); }
    },
    stop: function () {
      this.job = null;
      if (this.el) { try { this.el.pause(); this.el.onended = null; this.el.onerror = null; } catch (e) { /* */ } }
      try { if (global.speechSynthesis) global.speechSynthesis.cancel(); } catch (e) { /* */ }
    },
    miss: function (t) { this.misses.push(String(t)); }
  };
  function zhVoice() { return TTS.ok || VOICE.n > 0; }
  /* ═══════════════ 语音（speechSynthesis）：中文为主，英语题用英文语音 ═══════════════ */
  var SPEECH_RATE = 0.65;          // 放慢语速，适合小朋友
  var TTS = {
    voice: null, enVoice: null, ok: false, enOk: false,
    supported: ("speechSynthesis" in global) && typeof global.SpeechSynthesisUtterance === "function",
    init: function () {
      if (!this.supported) return;
      var self = this;
      var pickVoice = function () {
        var vs = [];
        try { vs = global.speechSynthesis.getVoices() || []; } catch (e) { vs = []; }
        self.voice = vs.filter(function (v) { return /^(zh|cmn)[-_]?(CN|Hans)/i.test(v.lang); })[0] ||
          vs.filter(function (v) { return /^(zh|cmn)/i.test(v.lang); })[0] || null;
        self.enVoice = vs.filter(function (v) { return /^en[-_]?(US|GB|NZ|AU)/i.test(v.lang); })[0] ||
          vs.filter(function (v) { return /^en/i.test(v.lang); })[0] || null;
        self.ok = !!self.voice; self.enOk = !!self.enVoice;
        updateWho();
      };
      pickVoice();
      try { global.speechSynthesis.addEventListener("voiceschanged", pickVoice); } catch (e) { global.speechSynthesis.onvoiceschanged = pickVoice; }
    },
    /** text 可以是字符串，也可以是数组（逐句朗读）。v7.2：优先播放预先录好的 AI 人声（audio/），没录到的那一段才用手机朗读 */
    speak: function (voice, text, rate) {
      if (!soundOn || !text || !text.length) return false;
      var parts = [].concat(text).filter(function (t) { return t && String(t).length; });
      if (!parts.length) return false;
      var canClip = VOICE.has(parts[0]) || parts.some(function (t) { return VOICE.has(t); });
      if (!canClip && !voice) return false;
      VOICE.stop();
      var job = VOICE.job = {}, i = 0, self = this;
      var next = function () {
        if (VOICE.job !== job || i >= parts.length) return;
        var t = parts[i++];
        if (VOICE.has(t)) { VOICE.play(t, next); return; }
        VOICE.miss(t);
        if (!voice) return next();
        try {
          var u = new global.SpeechSynthesisUtterance(t);
          u.voice = voice; u.lang = voice.lang; u.rate = (rate || SPEECH_RATE) * VOICE.rate; u.pitch = 1.1;
          u.onend = next; u.onerror = next;
          global.speechSynthesis.speak(u);
        } catch (e) { next(); }
      };
      next();
      return true;
    },
    say: function (text, rate) { return this.speak(this.voice, text, rate); },
    sayEn: function (text, rate) { if (!this.enOk || !soundOn) return false; VOICE.stop(); try { var u = new global.SpeechSynthesisUtterance(text); u.voice = this.enVoice; u.lang = this.enVoice.lang; u.rate = (rate || 0.7) * VOICE.rate; global.speechSynthesis.speak(u); return true; } catch (e) { return false; } }
  };
  /** 单字朗读：先读字，停一下，再在词里读一次（如「大」→「大，大小的大」） */
  function charSpeech(c) {
    var it = BYC[c], w = it && (it.w || []).filter(function (x) { return x.w.length === 2; })[0];
    return w ? [c, w.w + "的" + c] : [c];
  }

  /* ═══════════════ 原创 SVG 图形 ═══════════════ */
  var STAR_POS = {
    1: [[50, 52]], 2: [[36, 50], [64, 54]], 3: [[50, 34], [34, 62], [66, 62]], 4: [[36, 36], [64, 36], [36, 64], [64, 64]],
    5: [[50, 30], [30, 48], [70, 48], [38, 70], [62, 70]], 6: [[34, 32], [66, 32], [28, 54], [72, 54], [38, 74], [62, 74]],
    7: [[50, 26], [30, 40], [70, 40], [50, 52], [30, 66], [70, 66], [50, 78]]
  };
  var ballUid = 0;
  function starPath(cx, cy, r) {
    var p = [];
    for (var i = 0; i < 10; i++) {
      var a = Math.PI / 5 * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      p.push((cx + Math.cos(a) * rr).toFixed(1) + "," + (cy + Math.sin(a) * rr).toFixed(1));
    }
    return "M" + p.join("L") + "Z";
  }
  /** 橙色水晶龙珠（原创绘制），stars = 1..7 */
  function ballSVG(stars, size, cls) {
    var id = "bg" + (++ballUid);
    var n = Math.max(1, Math.min(7, stars || 1));
    var r = n <= 2 ? 11 : n <= 4 ? 9 : 7.5;
    var s = '<svg class="dball ' + (cls || "") + '" style="--s:' + (size || 40) + 'px" viewBox="0 0 100 100">' +
      '<defs><radialGradient id="' + id + '" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fff8cf"/><stop offset=".25" stop-color="#ffc341"/>' +
      '<stop offset=".7" stop-color="#ff7d00"/><stop offset="1" stop-color="#c24a00"/></radialGradient></defs>' +
      '<circle cx="50" cy="50" r="46" fill="url(#' + id + ')" stroke="#141414" stroke-width="4"/>';
    STAR_POS[n].forEach(function (p) { s += '<path d="' + starPath(p[0], p[1], r) + '" fill="#e3262f" stroke="#8a0f14" stroke-width="1.2"/>'; });
    s += '<ellipse cx="34" cy="28" rx="13" ry="7" fill="#fff" opacity=".75" transform="rotate(-30 34 28)"/></svg>';
    return s;
  }
  /** 金色筋斗云风格飞云（原创绘制） */
  function cloudSVG() {
    return '<svg class="cloudsvg" viewBox="0 0 170 70"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3a0"/>' +
      '<stop offset=".6" stop-color="#ffd23a"/><stop offset="1" stop-color="#f29d00"/></linearGradient></defs>' +
      '<g fill="url(#cg)" stroke="#141414" stroke-width="3">' +
      '<path d="M8 44 Q-4 30 14 26 Q18 10 38 16 Q50 2 70 12 Q86 0 104 12 Q124 6 130 22 Q152 20 150 38 Q166 46 150 56 Q130 66 104 58 Q84 68 62 58 Q40 66 26 56 Q4 58 8 44Z"/></g>' +
      '<path d="M150 40 Q166 34 168 22" fill="none" stroke="#141414" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M30 40 Q60 48 92 40 Q118 48 140 40" fill="none" stroke="#e08a00" stroke-width="3" stroke-linecap="round"/></svg>';
  }

  /* ═══════════════ 原创 Q 版小武术家头像（致敬，非官方图） ═══════════════ */
  var AVATAR_INFO = {
    goku: { label: "小悟空", desc: "刺猬头 · 猴尾巴 · 如意棒" },
    krillin: { label: "小库林", desc: "小光头 · 额头六个点 · 爱笑" },
    tien: { label: "天津饭", desc: "光头 · 额头第三只眼 · 绿色上衣" },
    chiaotzu: { label: "饺子", desc: "小个子 · 白白的脸 · 红脸蛋 · 小帽子" },
    roshi: { label: "龟仙人", desc: "光头老爷爷 · 白胡子 · 墨镜 · 龟壳 · 拐杖" },
    yamcha: { label: "雅木查", desc: "长长的刺刺黑发 · 脸上的疤 · 橙色练功服" }
  };
  function chibiBody(top, trim) {
    // 练功服：上衣颜色 + 领口/腰带颜色
    top = top || "#ff8a00"; trim = trim || "#1e5bd8";
    return '<path d="M26 98 Q26 72 50 70 Q74 72 74 98 Z" fill="' + top + '" stroke="#141414" stroke-width="2.5"/>' +
      '<path d="M41 71 L50 84 L59 71 Z" fill="' + trim + '" stroke="#141414" stroke-width="2"/>' +
      '<rect x="27" y="86" width="46" height="7" rx="2" fill="' + trim + '" stroke="#141414" stroke-width="2"/>' +
      '<path d="M47 93 L44 99 M53 93 L56 99" stroke="' + trim + '" stroke-width="3" stroke-linecap="round"/>';
  }
  function chibiFace(bigSmile) {
    var mouth = bigSmile
      ? '<path d="M40 56 Q50 68 60 56 Z" fill="#7a1010" stroke="#141414" stroke-width="2" stroke-linejoin="round"/><path d="M43 57 L57 57" stroke="#fff" stroke-width="2.5"/>'
      : '<path d="M43 57 Q50 63 57 57" fill="none" stroke="#141414" stroke-width="2.5" stroke-linecap="round"/>';
    return '<ellipse cx="41" cy="47" rx="4" ry="5.5" fill="#141414"/><ellipse cx="59" cy="47" rx="4" ry="5.5" fill="#141414"/>' +
      '<circle cx="42.3" cy="45" r="1.6" fill="#fff"/><circle cx="60.3" cy="45" r="1.6" fill="#fff"/>' +
      '<ellipse cx="35" cy="54" rx="3.5" ry="2" fill="#ff9a8a" opacity=".7"/><ellipse cx="65" cy="54" rx="3.5" ry="2" fill="#ff9a8a" opacity=".7"/>' + mouth;
  }
  function baldHead(skin, cy, r) {
    return '<circle cx="28" cy="' + (cy + 4) + '" r="5" fill="' + skin + '" stroke="#141414" stroke-width="2"/><circle cx="72" cy="' + (cy + 4) + '" r="5" fill="' + skin + '" stroke="#141414" stroke-width="2"/>' +
      '<circle cx="50" cy="' + cy + '" r="' + r + '" fill="' + skin + '" stroke="#141414" stroke-width="2.5"/>' +
      '<ellipse cx="42" cy="' + (cy - 15) + '" rx="7" ry="3.5" fill="#fff" opacity=".6" transform="rotate(-20 42 ' + (cy - 15) + ')"/>';   // 光头高光
  }
  // 头像和故事人物共用的简笔部件
  function headBase(skin, top) {
    return '<path d="M24 100 Q24 76 50 74 Q76 76 76 100 Z" fill="' + top + '" stroke="#141414" stroke-width="2.5"/>' +
      '<circle cx="27" cy="50" r="5" fill="' + skin + '" stroke="#141414" stroke-width="2"/><circle cx="73" cy="50" r="5" fill="' + skin + '" stroke="#141414" stroke-width="2"/>' +
      '<circle cx="50" cy="48" r="23" fill="' + skin + '" stroke="#141414" stroke-width="2.5"/>';
  }
  function eyes(y, closed) {
    if (closed) return '<path d="M36 ' + y + ' Q41 ' + (y - 4) + ' 46 ' + y + ' M54 ' + y + ' Q59 ' + (y - 4) + ' 64 ' + y + '" fill="none" stroke="#141414" stroke-width="2.5" stroke-linecap="round"/>';
    return '<ellipse cx="41" cy="' + y + '" rx="3.6" ry="5" fill="#141414"/><ellipse cx="59" cy="' + y + '" rx="3.6" ry="5" fill="#141414"/>' +
      '<circle cx="42.2" cy="' + (y - 2) + '" r="1.4" fill="#fff"/><circle cx="60.2" cy="' + (y - 2) + '" r="1.4" fill="#fff"/>';
  }
  function smile(big) {
    return big ? '<path d="M41 58 Q50 68 59 58 Z" fill="#7a1010" stroke="#141414" stroke-width="2"/>'
      : '<path d="M43 59 Q50 64 57 59" fill="none" stroke="#141414" stroke-width="2.4" stroke-linecap="round"/>';
  }
  var AVATAR_DRAW = {
    goku: function () {
      return '<path d="M70 92 Q92 92 88 76 Q85 66 92 62" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round"/>' +   // 猴尾巴（描边）
        '<path d="M70 92 Q92 92 88 76 Q85 66 92 62" fill="none" stroke="#8a4b1f" stroke-width="5" stroke-linecap="round"/>' +
        '<g transform="rotate(-38 50 60)"><rect x="47" y="8" width="6" height="96" rx="3" fill="#d4232c" stroke="#141414" stroke-width="2"/>' +  // 背上的如意棒
        '<rect x="46" y="8" width="8" height="7" rx="2" fill="#ffc400" stroke="#141414" stroke-width="1.5"/><rect x="46" y="96" width="8" height="7" rx="2" fill="#ffc400" stroke="#141414" stroke-width="1.5"/></g>' +
        chibiBody() +
        '<circle cx="28" cy="49" r="5" fill="#ffd9b0" stroke="#141414" stroke-width="2"/><circle cx="72" cy="49" r="5" fill="#ffd9b0" stroke="#141414" stroke-width="2"/>' +
        '<circle cx="50" cy="48" r="22" fill="#ffd9b0" stroke="#141414" stroke-width="2.5"/>' +
        // 刺猬头黑发
        '<path d="M27 50 L16 36 L29 36 L19 18 L36 26 L36 8 L48 22 L58 4 L62 22 L78 10 L72 28 L88 24 L76 38 L85 46 L73 44 L70 36 L64 41 L59 32 L53 39 L47 31 L42 40 L36 33 L31 42 Z" fill="#141414" stroke="#141414" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M37 41 L45 43 M63 43 L55 41" stroke="#141414" stroke-width="2.5" stroke-linecap="round"/>' +
        chibiFace(false);
    },
    krillin: function () {
      return chibiBody() + baldHead("#ffd9b0", 46, 23) +
        // 额头六个小点（两排各三个）
        '<circle cx="43" cy="29" r="1.6" fill="#8a4b1f"/><circle cx="50" cy="28" r="1.6" fill="#8a4b1f"/><circle cx="57" cy="29" r="1.6" fill="#8a4b1f"/>' +
        '<circle cx="43" cy="35" r="1.6" fill="#8a4b1f"/><circle cx="50" cy="34" r="1.6" fill="#8a4b1f"/><circle cx="57" cy="35" r="1.6" fill="#8a4b1f"/>' +
        '<path d="M37 41 Q41 39 45 41 M55 41 Q59 39 63 41" fill="none" stroke="#141414" stroke-width="2.2" stroke-linecap="round"/>' +
        chibiFace(true);
    },
    tien: function () {
      // 光头 + 额头第三只眼 + 绿色上衣（红色腰带）
      return chibiBody("#2f9e4a", "#d4232c") + baldHead("#f5c99a", 46, 23) +
        '<ellipse cx="50" cy="31" rx="3.6" ry="5.2" fill="#fff" stroke="#141414" stroke-width="1.8"/><ellipse cx="50" cy="31.5" rx="2" ry="3.2" fill="#141414"/><circle cx="50.8" cy="30" r=".9" fill="#fff"/>' +
        '<path d="M35 41 L45 43.5 M65 41 L55 43.5" stroke="#141414" stroke-width="2.8" stroke-linecap="round"/>' +
        '<ellipse cx="41" cy="48" rx="3.6" ry="5" fill="#141414"/><ellipse cx="59" cy="48" rx="3.6" ry="5" fill="#141414"/>' +
        '<circle cx="42.2" cy="46" r="1.4" fill="#fff"/><circle cx="60.2" cy="46" r="1.4" fill="#fff"/>' +
        '<path d="M44 59 Q50 62 56 59" fill="none" stroke="#141414" stroke-width="2.4" stroke-linecap="round"/>';
    },
    chiaotzu: function () {
      // 小个子（整体缩小），白白的脸，红脸蛋，小红帽子
      return '<g transform="translate(9 14) scale(.82)">' + chibiBody("#2f9e4a", "#ffc400") +
        '<circle cx="28" cy="52" r="5" fill="#fdfaf6" stroke="#141414" stroke-width="2"/><circle cx="72" cy="52" r="5" fill="#fdfaf6" stroke="#141414" stroke-width="2"/>' +
        '<circle cx="50" cy="48" r="24" fill="#fdfaf6" stroke="#141414" stroke-width="2.5"/>' +
        '<path d="M31 34 Q50 8 69 34 Q50 28 31 34 Z" fill="#e3262f" stroke="#141414" stroke-width="2"/>' +
        '<circle cx="50" cy="15" r="4.5" fill="#ffc400" stroke="#141414" stroke-width="1.5"/>' +
        '<circle cx="35" cy="56" r="6" fill="#ff5a6a" opacity=".9"/><circle cx="65" cy="56" r="6" fill="#ff5a6a" opacity=".9"/>' +
        '<ellipse cx="42" cy="47" rx="3.4" ry="4.6" fill="#141414"/><ellipse cx="58" cy="47" rx="3.4" ry="4.6" fill="#141414"/>' +
        '<circle cx="43" cy="45.5" r="1.3" fill="#fff"/><circle cx="59" cy="45.5" r="1.3" fill="#fff"/>' +
        '<path d="M45 59 Q50 63 55 59" fill="none" stroke="#141414" stroke-width="2.3" stroke-linecap="round"/></g>';
    }
  };
  AVATAR_DRAW.roshi = function () {
    // 背上的龟壳 + 拐杖 + 光头 + 墨镜 + 长长的白胡子（故事里也用这个头像）
    return '<circle cx="50" cy="80" r="26" fill="#3f9b48" stroke="#141414" stroke-width="2.5"/><path d="M36 74 L50 66 L64 74 L64 88 L50 96 L36 88Z" fill="none" stroke="#1d5e25" stroke-width="2"/>' +
      '<path d="M86 30 Q92 24 88 18 Q83 14 80 20" fill="none" stroke="#8a4b1f" stroke-width="4.5" stroke-linecap="round"/><path d="M85 28 L80 99" stroke="#8a4b1f" stroke-width="4.5" stroke-linecap="round"/>' +
      headBase("#f5c99a", "#ff8a00") +
      '<path d="M30 58 Q32 92 50 96 Q68 92 70 58 Q60 66 50 64 Q40 66 30 58Z" fill="#fff" stroke="#141414" stroke-width="2"/>' +
      '<circle cx="41" cy="47" r="7" fill="#141414"/><circle cx="59" cy="47" r="7" fill="#141414"/><path d="M48 47 L52 47" stroke="#141414" stroke-width="3"/>' +
      '<ellipse cx="40" cy="32" rx="8" ry="3.5" fill="#fff" opacity=".6"/>' +
      '<path d="M44 62 Q50 66 56 62" fill="none" stroke="#141414" stroke-width="2"/>';
  };
  AVATAR_DRAW.yamcha = function () {
    // 长长的刺刺黑发 + 脸颊上的疤 + 橙色练功服（故事里也用这个头像）
    return '<path d="M22 70 L20 40 Q24 18 50 18 Q78 18 80 40 L78 70 L70 60 L68 72 L60 62 L40 62 L32 72 L30 60 Z" fill="#141414"/>' +
      chibiBody() +
      '<circle cx="27" cy="50" r="5" fill="#f5c99a" stroke="#141414" stroke-width="2"/><circle cx="73" cy="50" r="5" fill="#f5c99a" stroke="#141414" stroke-width="2"/>' +
      '<circle cx="50" cy="48" r="23" fill="#f5c99a" stroke="#141414" stroke-width="2.5"/>' +
      '<path d="M28 44 L32 24 L40 34 L46 20 L54 32 L62 20 L66 34 L74 26 L72 44 L64 36 L56 40 L48 34 L40 40 L34 36Z" fill="#141414"/>' +
      '<path d="M60 52 L68 58 M66 51 L61 60" stroke="#8a2b1f" stroke-width="2" stroke-linecap="round"/>' + eyes(47) + smile(false);
  };
  function avatarSVG(kind, size) {
    return '<svg class="avsvg" width="' + size + '" height="' + size + '" viewBox="0 0 100 100" role="img" aria-label="' + AVATAR_INFO[kind].label + '">' + AVATAR_DRAW[kind]() + "</svg>";
  }
  /** 头像：小悟空 / 小库林 / 天津饭 / 饺子 / 龟仙人 / 雅木查 用原创 SVG，其余是 emoji */
  function avatarHTML(ava, size) {
    size = size || 48;
    if (AVATAR_INFO[ava]) return avatarSVG(ava, size);
    return '<span class="avemo" style="font-size:' + Math.round(size * 0.8) + 'px">' + esc(ava) + "</span>";
  }
  function avatarLabel(ava) { return AVATAR_INFO[ava] ? AVATAR_INFO[ava].label : ava; }
  function riderHTML(ava, ava2) {
    return '<div class="rider"><span class="ava aura">' + avatarHTML(ava, 78) + (ava2 ? avatarHTML(ava2, 78) : "") + "</span>" + cloudSVG() + "</div>";
  }

  /* ═══════════════ 龙珠世界：修炼地点、贴纸、双人魔王 ═══════════════ */
  // 修炼地点跟着故事进度解锁（story = 已完成的章节数）；教练头像见 07b_story.js 的 portraitHTML
  var PLACES = [
    { id: "home", name: "深山小屋", emoji: "🏡", story: 0, coach: "bulma", line: "每天练一点点，我们一起去找龙珠！" },
    { id: "desert", name: "大沙漠", emoji: "🏜️", story: 2, coach: "yamcha", line: "沙漠里也要认真练字哦！" },
    { id: "kame", name: "龟仙屋", emoji: "🐢", story: 3, coach: "roshi", line: "认真、冷静、不放弃！" },
    { id: "arena", name: "天下第一武道会", emoji: "🏟️", story: 4, coach: "tien", line: "下一场比赛，看你的了！" }
  ];
  function currentPlace(pr) {
    var got = PLACES.filter(function (p) { return (pr.story || 0) >= p.story; });
    return got[got.length - 1];
  }
  var STICKERS = ["🥋", "☁️", "⚡", "🐉", "🍑", "🐒", "🥟", "🐢", "🏝️", "🏜️", "🏟️", "🌟", "🍜", "🦖", "🌋", "🪁", "🌈", "🚀", "🐟", "🥛", "🔴", "🏆", "🍙", "🦕"];
  var DUO_BOSSES = [
    { name: "大魔王", emoji: "👹" }, { name: "巨猿怪", emoji: "🦍" }, { name: "机器人兵", emoji: "🤖" },
    { name: "外星大王", emoji: "👾" }, { name: "恐龙怪", emoji: "🦖" }
  ];

  /* ═══════════════ 玩家档案（每人独立进度） ═══════════════ */
  var AVATARS = ["goku", "krillin", "tien", "chiaotzu", "roshi", "yamcha", "🧒", "👦", "👶", "🐵", "🐯", "🐲", "🦊", "🐼"];
  var COLORS = ["#ff8a00", "#1e5bd8", "#21a35b", "#c23bd4"];

  function defaultPlayer() { return { level: 1, exp: 0, expNeed: expNeed(1) }; }
  /** 升级所需经验：平缓，几关就能升一级 */
  function expNeed(lv) { return 50 + (lv - 1) * 20 + Math.max(0, lv - 6) * (lv - 6) * 6; }

  function newProfile(name, mode, avatar, color) {
    return {
      id: "p" + now().toString(36) + Math.floor(Math.random() * 1e4),
      name: name, mode: mode, avatar: avatar, color: color,
      player: defaultPlayer(), srs: {}, stage: 0, wishes: 0, stickers: [], story: 0,
      sessions: 0, lastDay: "", dayStreak: 0, createdAt: now(),
      extra: { math: 0, eng: 0, clue: 0 }, settings: { pinyin: false }, reads: {}, readHelp: {}, readBalls: 0, shelfSeen: [],
      pinyin: { lv: 0, items: {} }, radical: { items: {} }
    };
  }

  var store = { ver: 4, profiles: [], lastId: null };
  var prof = null;   // 当前玩家

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.profiles)) store = s;
      }
    } catch (e) { /* 存档损坏则重建 */ }
    // 不预置任何玩家：第一次打开时由玩家自己创建（名字、模式、头像）
    // 旧的默认头像（🧒/👶）一次性换成小悟空/小库林
    if (!store.avatarV2) {
      store.profiles.forEach(function (pr) { if (pr.avatar === "🧒") pr.avatar = "goku"; else if (pr.avatar === "👶") pr.avatar = "krillin"; });
      store.avatarV2 = true; saveStore();
    }
    store.profiles.forEach(normalizeProfile);
  }
  /** 补齐缺的字段；旧存档里的气血、金币、装备、任务、门派等字段（已删除的玩法）一并清掉 */
  function normalizeProfile(pr) {
    var old = pr.player && typeof pr.player === "object" ? pr.player : {};
    pr.player = defaultPlayer();
    if (old.level > 0) pr.player.level = Math.floor(old.level);
    if (old.exp >= 0) pr.player.exp = old.exp;
    pr.player.expNeed = expNeed(pr.player.level);
    if (!pr.srs || typeof pr.srs !== "object") pr.srs = {};
    if (!Array.isArray(pr.stickers)) pr.stickers = [];
    if (!pr.settings) pr.settings = { pinyin: false };
    if (!pr.extra || typeof pr.extra !== "object") pr.extra = { math: 0, eng: 0 };
    delete pr.balls;
    if (!pr.reads || typeof pr.reads !== "object") pr.reads = {};
    // v7：拼音 / 偏旁掌握情况（旧存档没有就从头开始）
    if (!pr.pinyin || typeof pr.pinyin !== "object") pr.pinyin = { lv: 0, items: {} };
    if (typeof pr.pinyin.lv !== "number") pr.pinyin.lv = 0;
    if (!pr.pinyin.items || typeof pr.pinyin.items !== "object") pr.pinyin.items = {};
    if (!pr.radical || typeof pr.radical !== "object") pr.radical = { items: {} };
    if (!pr.radical.items || typeof pr.radical.items !== "object") pr.radical.items = {};
    if (!pr.readHelp || typeof pr.readHelp !== "object") pr.readHelp = {};
    if (!Array.isArray(pr.shelfSeen)) pr.shelfSeen = [];
    ["stage", "wishes", "sessions", "dayStreak", "story", "readBalls"].forEach(function (k) { if (typeof pr[k] !== "number") pr[k] = 0; });
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); return true; }
    catch (e) { toast("⚠️ 存档失败（浏览器存储已满或被禁用）"); return false; }
  }
  function useProfile(pr) { if (pr !== prof && $("log")) $("log").innerHTML = ""; prof = pr; store.lastId = pr ? pr.id : null; updateWho(); }

  /* 旧版（v3 三个存档位）导入：等级、经验和学过的字 */
  function legacySlots() {
    var out = [];
    for (var s = 1; s <= 3; s++) {
      try {
        var raw = localStorage.getItem(LEGACY_SLOT_PREFIX + s);
        if (!raw) continue;
        var d = JSON.parse(raw);
        if (d && d.player) out.push({ slot: s, player: d.player });
      } catch (e) { /* */ }
    }
    return out;
  }
  function importLegacy(slotData, pr) {
    var old = slotData.player;
    pr.player = { level: old.level || 1, exp: old.exp || 0 };
    (old.hanziLearned || []).forEach(function (c) {
      if (BYC[c] && !pr.srs[c]) pr.srs[c] = { b: 1, due: 0, seen: 1, ok: 1, bad: 0 };
    });
    normalizeProfile(pr);
    saveStore();
  }

  /* ═══════════════ 间隔复习（Leitner 盒子） ═══════════════ */
  function rec(c, pr) {
    pr = pr || prof;
    if (!pr.srs[c]) pr.srs[c] = { b: 0, due: 0, seen: 0, ok: 0, bad: 0 };
    return pr.srs[c];
  }
  /** 数学/英语题只记一次就答对的次数（给家长看），不进复习盒 */
  function recordExtra(pr, kind, firstTry) { if (firstTry) pr.extra[kind] = (pr.extra[kind] || 0) + 1; }
  function learnedCount(pr) {
    pr = pr || prof;
    if (!pr) return 0;
    var n = 0;
    Object.keys(pr.srs).forEach(function (c) { if (pr.srs[c].ok > 0) n++; });
    return n;
  }
  function recordResult(pr, c, firstTry) {
    var r = rec(c, pr);
    r.seen++;
    r.last = now();
    if (firstTry) { r.ok++; if (r.b === 0 || r.due <= now()) r.b = Math.min(6, r.b + 1); } // 同一关里重复答对不算「升盒」，避免死记硬背
    else { r.bad++; r.b = Math.min(r.b, 1); r.miss = (r.miss || 0) + 1; }
    r.due = now() + INTERVALS[r.b];
  }
  /** 已解锁的字：侠客模式先 8 个、每过一阶段 +6；启蒙模式先 3 个、每阶段 +2 */
  function unlockedChars(pr) {
    if (pr.mode === "little") return LITTLE_ORDER.slice(0, Math.min(LITTLE_ORDER.length, 3 + pr.stage * 2));
    var list = ORDER.slice(0, Math.min(ORDER.length, 8 + pr.stage * 6));
    // 从旧版导入的、已经学过的字也一起复习
    Object.keys(pr.srs).forEach(function (c) { if (BYC[c] && pr.srs[c].seen && list.indexOf(c) === -1) list.push(c); });
    return list;
  }
  /** 当前已解锁的字都「至少两次一次答对」（或已进入复习盒 2）就解锁下一批新字；复习照常按间隔安排 */
  function maybeAdvanceStage(pr) {
    var list = unlockedChars(pr);
    var total = pr.mode === "little" ? LITTLE_ORDER.length : ORDER.length;
    if (list.length >= total) return false;
    var ready = list.every(function (c) { var r = pr.srs[c]; return r && (r.b >= 2 || r.ok >= 2); });
    if (ready) { pr.stage++; return true; }
    return false;
  }
  function masteryClass(r) { if (!r || !r.seen) return "m0"; if (r.b <= 1) return "m1"; if (r.b <= 2) return "m2"; if (r.b <= 4) return "m3"; return "m4"; }

  /* ═══════════════ 出题 ═══════════════ */
  var TONEMAP = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", "ü": "ǖǘǚǜ" };
  function toneVariants(py) {
    var chars = py.split(""), idx = -1, base = null;
    for (var i = 0; i < chars.length; i++) {
      for (var v in TONEMAP) { if (TONEMAP[v].indexOf(chars[i]) !== -1) { idx = i; base = v; } }
    }
    if (idx === -1) { // 轻声：按标调规则找主元音
      var s = py;
      idx = s.indexOf("a"); if (idx === -1) idx = s.indexOf("e");
      if (idx === -1 && s.indexOf("ou") !== -1) idx = s.indexOf("o");
      if (idx === -1) { for (var j = s.length - 1; j >= 0; j--) if (TONEMAP[s[j]]) { idx = j; break; } }
      if (idx === -1) return [];
      base = s[idx];
    }
    var out = [];
    for (var t = 0; t < 4; t++) {
      var c2 = chars.slice(); c2[idx] = TONEMAP[base][t];
      var w = c2.join("");
      if (w !== py) out.push(w);
    }
    return out;
  }

  function fallbackPool(pr) { return pr.mode === "little" ? LITTLE_ORDER : ORDER.slice(0, Math.max(60, unlockedChars(pr).length + 30)); }

  function distractChars(pr, c, k, needPic) {
    var target = BYC[c];
    var ok = function (x) { return x !== c && BYC[x] && BYC[x].py !== target.py && (!needPic || BYC[x].pic); };
    var pool = shuffle(unlockedChars(pr).filter(ok));
    if (pool.length < k) pool = pool.concat(shuffle(fallbackPool(pr).filter(function (x) { return ok(x) && pool.indexOf(x) === -1; })));
    return pool.slice(0, k);
  }

  function feasibleFill(pr, c) {
    var item = BYC[c];
    var ws = (item.w || []).filter(function (w) { return w.w.length === 2 && w.w.split(c).length === 2; });
    return ws.length ? ws : null;
  }

  function chooseType(pr, c) {
    var item = BYC[c], r = rec(c, pr);
    var can = {
      pic2char: !!item.pic, char2pic: !!item.pic, listen: zhVoice(), meaning: !!item.ok,
      word: (item.w || []).length > 0, fill: !!feasibleFill(pr, c), pinyin: true
    };
    var prefs;
    if (pr.mode === "little") prefs = r.b === 0 ? ["pic2char"] : ["pic2char", "char2pic", "listen", "pic2char"];
    else if (r.b === 0) prefs = ["pic2char", "listen", "meaning", "word"];
    else if (r.b === 1) prefs = ["meaning", "word", "listen", "char2pic", "pic2char"];
    else prefs = ["pinyin", "fill", "meaning", "listen", "word", "fill"];
    var list = prefs.filter(function (t) { return can[t]; });
    if (!list.length) list = ["word", "pinyin"].filter(function (t) { return can[t]; });
    return pick(list);
  }

  function optionCount(pr) {
    if (pr.mode === "little") return pr.stage < 2 ? 2 : 3;
    return pr.stage < 2 ? 3 : 4;
  }

  /** 生成一道题 */
  function makeQuestion(pr, c, forceType) {
    var item = BYC[c];
    var type = forceType || chooseType(pr, c);
    var n = optionCount(pr);
    var q = { c: c, type: type, wrongs: 0, done: false, options: [], answer: null, speak: charSpeech(c), autoSpeak: true };
    var little = pr.mode === "little";
    if (type === "listen") {
      q.title = "听一听，是哪个字？"; q.en = "Listen and pick the character";
      q.optCls = "hz";
      q.options = [c].concat(distractChars(pr, c, n - 1));
    } else if (type === "pic2char") {
      q.title = little ? "哪个是「" + item.pic + "」？" : "图里是哪个字？"; q.en = "Which character matches the picture?";
      q.pic = item.pic; q.optCls = "hz";
      if (little) q.speak = ["哪个是" + c].concat(charSpeech(c).slice(1));
      q.options = [c].concat(distractChars(pr, c, n - 1));
    } else if (type === "char2pic") {
      q.title = "这个字是哪张图？"; q.en = "Which picture is it?";
      q.show = c; q.optCls = "emo"; q.optMap = {};
      var ds = distractChars(pr, c, n - 1, true);
      q.options = [c].concat(ds);
      q.options.forEach(function (x) { q.optMap[x] = BYC[x].pic; });
    } else if (type === "meaning") {
      q.title = "这个字是什么意思？"; q.en = "What does it mean?";
      q.show = c; q.optCls = "en"; q.optMap = {};
      var seen = {}; seen[item.en.toLowerCase()] = 1;
      var pool = shuffle(unlockedChars(pr).concat(shuffle(ORDER.slice(0, 200))));
      var out = [c];
      for (var i = 0; i < pool.length && out.length < n; i++) {
        var x = pool[i], it = BYC[x];
        if (!it || x === c || !it.ok || seen[it.en.toLowerCase()]) continue;
        // 避免近义选项（共享实词，如 to see / to look）
        var wa = item.en.toLowerCase().replace(/^to /, "").split(/\W+/), wb = it.en.toLowerCase().replace(/^to /, "").split(/\W+/);
        if (wa.some(function (w) { return w.length > 2 && wb.indexOf(w) !== -1; })) continue;
        seen[it.en.toLowerCase()] = 1; out.push(x);
      }
      q.options = out;
      out.forEach(function (x) { q.optMap[x] = (BYC[x].pic && false ? BYC[x].pic + " " : "") + BYC[x].en; });
    } else if (type === "pinyin") {
      q.title = "这个字怎么读？"; q.en = "How do you read it?";
      q.show = c; q.optCls = "py"; q.autoSpeak = false; q.optMap = {};
      var opts = [item.py];
      shuffle(toneVariants(item.py)).slice(0, Math.max(1, n - 2)).forEach(function (v) { if (opts.indexOf(v) === -1) opts.push(v); });
      shuffle(unlockedChars(pr).concat(ORDER.slice(0, 80))).forEach(function (x) {
        if (opts.length < n && BYC[x] && opts.indexOf(BYC[x].py) === -1) opts.push(BYC[x].py);
      });
      q.options = opts; q.answerKey = item.py;
      opts.forEach(function (o) { q.optMap[o] = o; });
    } else if (type === "word") {
      var w = pick(item.w);
      q.title = "哪个词里有「" + c + "」？"; q.en = "Which word has this character?";
      q.show = c; q.optCls = "word"; q.optMap = {};
      var others = [];
      shuffle(unlockedChars(pr).concat(ORDER.slice(0, 150))).forEach(function (x) {
        if (others.length >= n - 1 || x === c || !BYC[x]) return;
        var cand = (BYC[x].w || []).filter(function (ww) { return ww.w.indexOf(c) === -1 && others.indexOf(ww.w) === -1 && ww.w !== w.w; });
        if (cand.length) others.push(pick(cand).w);
      });
      q.options = [w.w].concat(others); q.answerKey = w.w;
      q.options.forEach(function (o) { q.optMap[o] = o; });
      q.word = w;
    } else if (type === "fill") {
      var wf = pick(feasibleFill(pr, c));
      q.title = "缺了哪个字？"; q.en = "Which character is missing?";
      q.wordBlank = wf.w; q.word = wf; q.speak = wf.w; q.optCls = "hz";
      var cands = distractChars(pr, c, 12).filter(function (x) { return !KNOWN_WORDS[wf.w.replace(c, x)]; });
      q.options = [c].concat(cands.slice(0, n - 1));
    }
    if (!q.answerKey) q.answerKey = c;
    q.options = shuffle(q.options);
    return q;
  }

  /* ═══════════════ 少量数学题和英语题（汉字题仍占约 70% 以上） ═══════════════ */
  var EXTRA_RATE = 0.25;          // 故事和双人模式里每题出数学/英语的概率
  var EXTRA_PER_SESSION = 2;      // 修炼一关 7 题里最多 2 题（汉字题 ≥ 5/7 ≈ 71%）
  var ZH_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十"];
  // 「几个」的读法：2 读「两」
  function zhCount(n) { return n === 2 ? "两" : ZH_NUM[n]; }
  var COUNT_EMOJI = ["🍎", "🐟", "⭐", "🥟", "🍑", "🐢", "🔴", "🍙"];
  // 英语词：英文、图、中文（中文词和英文义都在 CC-CEDICT 里核对过，见 test/verify_english.py）
  var ENGLISH = [
    ["cat", "🐱", "猫"], ["dog", "🐶", "狗"], ["fish", "🐟", "鱼"], ["bird", "🐦", "鸟"], ["horse", "🐴", "马"],
    ["cow", "🐮", "牛"], ["sheep", "🐑", "羊"], ["monkey", "🐵", "猴子"], ["tiger", "🐯", "老虎"], ["rabbit", "🐰", "兔子"],
    ["apple", "🍎", "苹果"], ["banana", "🍌", "香蕉"], ["milk", "🥛", "牛奶"], ["egg", "🥚", "鸡蛋"], ["cake", "🎂", "蛋糕"],
    ["sun", "☀️", "太阳"], ["moon", "🌙", "月亮"], ["star", "⭐", "星星"], ["rain", "🌧️", "雨"], ["tree", "🌳", "树"],
    ["flower", "🌸", "花"], ["car", "🚗", "汽车"], ["book", "📖", "书"], ["water", "💧", "水"], ["fire", "🔥", "火"],
    ["hand", "✋", "手"], ["eye", "👁️", "眼睛"], ["ear", "👂", "耳朵"], ["dragon", "🐉", "龙"], ["ball", "⚽", "球"],
    ["red", "🔴", "红色"], ["blue", "🔵", "蓝色"], ["yellow", "🟡", "黄色"], ["green", "🟢", "绿色"],
    ["one", "1️⃣", "一"], ["two", "2️⃣", "二"], ["three", "3️⃣", "三"], ["four", "4️⃣", "四"], ["five", "5️⃣", "五"]
  ];
  var lastExtra = "eng";
  function nextExtraKind() { lastExtra = lastExtra === "math" ? "eng" : "math"; return lastExtra; }
  /** 故事 / 双人：按概率决定这一题是不是数学/英语题 */
  function maybeExtra(pr) { return Math.random() < EXTRA_RATE ? makeExtra(pr, nextExtraKind()) : null; }

  function numOpt(n) { return '<b>' + ZH_NUM[n] + "</b><small>" + n + "</small>"; }
  function nearNumbers(ans, lo, hi, k) {
    var c = [];
    [1, -1, 2, -2, 3, -3, 4, -4, 5, -5].forEach(function (d) { var x = ans + d; if (x >= lo && x <= hi && c.indexOf(x) === -1) c.push(x); });
    return shuffle(c.slice(0, Math.max(k + 1, 4))).slice(0, k);
  }
  function baseExtra(kind, type) {
    return { kind: kind, type: type, wrongs: 0, done: false, autoSpeak: true, optHTML: true, optMap: {}, options: [] };
  }

  /** 生成一道数学或英语题（答案在出题时就算好/查好） */
  function makeExtra(pr, kind) {
    var n = optionCount(pr), little = pr.mode === "little", q;
    if (kind === "math") {
      if (little) {
        var max = pr.stage < 3 ? 5 : 10, cnt = 1 + Math.floor(Math.random() * max), em = pick(COUNT_EMOJI);
        q = baseExtra("math", "count");
        q.title = "数一数，有几个？"; q.en = "How many?";
        q.mainHTML = '<div class="qcount" id="qTarget">' + new Array(cnt + 1).join("<span>" + em + "</span>") + "</div>";
        q.answer = cnt; q.speak = "数一数，有几个？"; q.sayAnswer = "一共有" + zhCount(cnt) + "个";
        q.hintHTML = '<span class="py">' + cnt + "</span> " + ZH_NUM[cnt];
        q.options = [cnt].concat(nearNumbers(cnt, 1, max, n - 1));
      } else {
        var lim = pr.stage < 3 ? 10 : 20, a, b, plus = Math.random() < 0.55;
        if (plus) { a = 1 + Math.floor(Math.random() * (lim - 1)); b = 1 + Math.floor(Math.random() * (lim - a)); }
        else { a = 2 + Math.floor(Math.random() * (lim - 1)); b = 1 + Math.floor(Math.random() * a); }
        var ans = plus ? a + b : a - b, op = plus ? "+" : "−", opZh = plus ? "加" : "减";
        q = baseExtra("math", plus ? "add" : "sub");
        q.title = "算一算"; q.en = a + " " + op + " " + b + " = ?";
        q.mainHTML = '<div class="qmath" id="qTarget">' + ZH_NUM[a] + " " + op + " " + ZH_NUM[b] + ' = <span class="blank">？</span></div>';
        q.answer = ans; q.speak = ZH_NUM[a] + opZh + ZH_NUM[b] + "等于几？";
        q.sayAnswer = ZH_NUM[a] + opZh + ZH_NUM[b] + "等于" + ZH_NUM[ans];
        q.hintHTML = '<span class="py">' + a + " " + op + " " + b + "</span> " +
          (lim <= 10 ? '<span class="dots">' + new Array(a + 1).join("●") + (plus ? " + " : " − ") + new Array(b + 1).join("●") + "</span>" : "");
        q.options = [ans].concat(nearNumbers(ans, 0, lim, n - 1));
      }
      q.answerKey = String(q.answer); q.optCls = "hz num";
      q.options = q.options.map(String);
      q.options.forEach(function (o) { q.optMap[o] = numOpt(+o); });
    } else {
      var it = pick(ENGLISH), others = shuffle(ENGLISH.filter(function (x) { return x !== it; })).slice(0, n - 1);
      var types = little ? ["en2pic"] : ["en2pic", "pic2en", "en2zh", "zh2en"];
      q = baseExtra("eng", pick(types));
      var all = [it].concat(others);
      q.item = it; q.speakEn = it[0]; q.sayAnswer = it[2];
      q.hintHTML = it[1] + ' <b>' + esc(it[0]) + "</b> " + esc(it[2]);
      if (q.type === "en2pic") {
        q.title = "英语：哪个是「" + it[0] + "」？"; q.en = "Which picture is \u201c" + it[0] + "\u201d?";
        q.mainHTML = '<div class="qword en" id="qTarget">' + esc(it[0]) + "</div>"; q.optCls = "emo";
        all.forEach(function (x) { q.optMap[x[0]] = esc(x[1]); });
      } else if (q.type === "pic2en") {
        q.title = "英语：这个用英语怎么说？"; q.en = "What is this in English?";
        q.mainHTML = '<div class="qpic">' + it[1] + "</div>"; q.optCls = "en"; q.speak = "这个用英语怎么说？"; q.speakEn = null;
        all.forEach(function (x) { q.optMap[x[0]] = esc(x[0]); });
      } else if (q.type === "en2zh") {
        q.title = "英语「" + it[0] + "」是哪个中文？"; q.en = "Which Chinese word means \u201c" + it[0] + "\u201d?";
        q.mainHTML = '<div class="qword en" id="qTarget">' + esc(it[0]) + "</div>"; q.optCls = "word";
        all.forEach(function (x) { q.optMap[x[0]] = esc(x[2]); });
      } else {
        q.title = "「" + it[2] + "」用英语怎么说？"; q.en = "How do you say it in English?";
        q.mainHTML = '<div class="qword" id="qTarget">' + esc(it[2]) + "</div>"; q.optCls = "en"; q.speak = it[2]; q.speakEn = null;
        all.forEach(function (x) { q.optMap[x[0]] = esc(x[0]); });
      }
      q.options = all.map(function (x) { return x[0]; });
      q.answerKey = it[0];
    }
    q.options = shuffle(q.options);
    return q;
  }

  /* ═══════════════ v7：拼音修炼 + 偏旁修炼（放在「修炼」里，和龙珠/复习/提示同一套流程） ═══════════════ */
  var TONE_MARK = { a: "āáǎà", o: "ōóǒò", e: "ēéěè", i: "īíǐì", u: "ūúǔù", "ü": "ǖǘǚǜ" };
  var TONE_NAME = ["", "一声 ˉ", "二声 ˊ", "三声 ˇ", "四声 ˋ"];
  var TONE_SAY = ["", "第一声", "第二声", "第三声", "第四声"];
  /** 把 "ma"+3 写成 "mǎ"（a/e 优先，ou 标 o，否则标最后一个元音） */
  function markTone(base, t) {
    if (!t) return base;
    var idx = base.search(/[ae]/);
    if (idx < 0) idx = base.indexOf("ou");
    if (idx < 0) { for (var k = base.length - 1; k >= 0; k--) if ("iuüo".indexOf(base[k]) >= 0) { idx = k; break; } }
    if (idx < 0) return base;
    return base.slice(0, idx) + TONE_MARK[base[idx]][t - 1] + base.slice(idx + 1);
  }
  /** "mǎ" → {base:"ma", t:3} */
  function splitTone(py) {
    var t = 0, out = "";
    for (var i = 0; i < py.length; i++) {
      var ch = py[i], hit = false;
      Object.keys(TONE_MARK).forEach(function (v) { var p = TONE_MARK[v].indexOf(ch); if (p >= 0) { out += v; t = p + 1; hit = true; } });
      if (!hit) out += ch;
    }
    return { base: out, t: t };
  }
  var INITIALS = ["b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "zh", "ch", "sh", "r", "z", "c", "s", "y", "w"];
  var SINGLE_F = ["a", "o", "e", "i", "u", "ü"];
  var COMPOUND_F = ["ai", "ei", "ui", "ao", "ou", "iu", "ie", "üe", "er", "an", "en", "in", "un", "ün", "ang", "eng", "ing", "ong"];
  var WHOLE = ["zhi", "chi", "shi", "ri", "zi", "ci", "si", "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying"];
  // 单韵母的读音用字（「哦」「鹅」可能不在字库里，只用来读）
  var SINGLE_SAY = { a: ["啊", "ā"], o: ["喔", "ō"], e: ["鹅", "é"], i: ["衣", "yī"], u: ["乌", "wū"], "ü": ["鱼", "yú"] };
  var PY_LEVELS = [
    { name: "单韵母", items: SINGLE_F },
    { name: "声母", items: INITIALS },
    { name: "复韵母", items: COMPOUND_F },
    { name: "整体认读", items: WHOLE }
  ];
  /** 从字库里整理出「音节 → 例字」（常用的字优先），拆成声母+韵母 */
  var SYL = null;
  function syllables() {
    if (SYL) return SYL;
    SYL = { list: [], byKey: {} };
    DB.slice().sort(function (a, b) { return (a.n || 9999) - (b.n || 9999); }).forEach(function (h) {
      if (!h.py || /\s/.test(h.py)) return;
      var s = splitTone(h.py.toLowerCase()); if (!s.t) return;
      var key = s.base + s.t;
      if (SYL.byKey[key]) { if (SYL.byKey[key].chars.length < 3) SYL.byKey[key].chars.push(h.c); return; }
      var ini = "", fin = s.base;
      for (var i = 0; i < INITIALS.length; i++) { var I = INITIALS[i]; if (s.base.indexOf(I) === 0 && I.length > ini.length) ini = I; }
      fin = s.base.slice(ini.length);
      if (/^[jqxy]/.test(ini) && fin[0] === "u") fin = "ü" + fin.slice(1);     // ju/qu/xu/yu 里的 u 其实是 ü
      var o = { key: key, base: s.base, t: s.t, ini: ini, fin: fin, py: h.py.toLowerCase(), chars: [h.c], whole: WHOLE.indexOf(s.base) >= 0 };
      SYL.byKey[key] = o; SYL.list.push(o);
    });
    return SYL;
  }
  function sylSpeak(o) { return o.chars[0]; }

  // 偏旁：意思提示 + 常用字（都用字库里有的字）+ 「偏旁 + 部件 = 字」
  var RADICALS = [
    { r: "氵", name: "三点水", m: "水", em: "💧", en: "water", cue: "和水有关", cs: "河湖海洗池江汗汁法活清没" },
    { r: "亻", name: "单人旁", m: "人", em: "🧍", en: "person", cue: "和人有关", cs: "他们你住体什休做位件信作" },
    { r: "口", name: "口字旁", m: "嘴巴", em: "👄", en: "mouth", cue: "和嘴巴、说话、吃喝有关", cs: "吃叫喝唱吗吧听呢吹呀" },
    { r: "木", name: "木字旁", m: "树木", em: "🌳", en: "tree / wood", cue: "和树、木头有关", cs: "林树桃村校板杯椅机" },
    { r: "扌", name: "提手旁", m: "手", em: "✋", en: "hand", cue: "和手的动作有关", cs: "打找拉拍推把抱提接扫" },
    { r: "女", name: "女字旁", m: "女孩", em: "👩", en: "woman", cue: "和女孩、妈妈有关", cs: "妈她好姐妹奶姓姑" },
    { r: "艹", name: "草字头", m: "草", em: "🌿", en: "grass", cue: "和花草有关", cs: "花草茶苹菜药英蓝" },
    { r: "日", name: "日字旁", m: "太阳", em: "☀️", en: "sun", cue: "和太阳、时间有关", cs: "明早晚时昨晴暗春" },
    { r: "月", name: "月字旁", m: "身体", em: "💪", en: "body (flesh)", cue: "常和身体有关", cs: "肚脸朋腿脚胖肥胆" },
    { r: "讠", name: "言字旁", m: "说话", em: "🗣️", en: "speech", cue: "和说话有关", cs: "说话语认识读让请谁课" },
    { r: "钅", name: "金字旁", m: "金属", em: "🔩", en: "metal", cue: "和金属有关", cs: "铁钱银针钟锅错铅" },
    { r: "火", name: "火字旁 / 四点底 灬", m: "火", em: "🔥", en: "fire", cue: "和火、热有关", cs: "炒灯烧烤炸点热照熊" },
    { r: "土", name: "提土旁", m: "泥土", em: "🟫", en: "earth", cue: "和泥土、地方有关", cs: "地场在坐城块坏" },
    { r: "忄", name: "竖心旁", m: "心情", em: "❤️", en: "heart", cue: "和心情有关", cs: "忙快怕情慢惯懂" },
    { r: "辶", name: "走之底", m: "走路", em: "🚶", en: "walk", cue: "和走路有关", cs: "近过还这道远进送边" }
  ];
  var BUILDS = [["氵", "也", "池"], ["亻", "也", "他"], ["女", "也", "她"], ["土", "也", "地"], ["木", "木", "林"], ["日", "月", "明"],
    ["口", "马", "吗"], ["女", "马", "妈"], ["扌", "丁", "打"], ["艹", "化", "花"], ["讠", "舌", "话"], ["钅", "中", "钟"],
    ["火", "丁", "灯"], ["忄", "亡", "忙"], ["亻", "木", "休"], ["口", "巴", "吧"], ["扌", "巴", "把"], ["女", "子", "好"],
    ["日", "寸", "时"], ["辶", "斤", "近"], ["讠", "人", "认"], ["氵", "先", "洗"], ["木", "寸", "村"], ["火", "少", "炒"],
    ["土", "成", "城"], ["亻", "尔", "你"], ["月", "土", "肚"], ["讠", "兑", "说"]];
  var RAD_BY = {}, RAD_OF = {};
  RADICALS.forEach(function (R) {
    R.list = R.cs.split("").filter(function (c) { return BYC[c]; });
    RAD_BY[R.r] = R; R.list.forEach(function (c) { RAD_OF[c] = R; });
  });
  BUILDS = BUILDS.filter(function (b) { return BYC[b[2]]; });

  /** 每个拼音项目/偏旁一个小复习盒（和汉字一样按间隔复习），只记在这个小侠客身上 */
  function skillRec(pr, kind, key) {
    var box = kind === "py" ? pr.pinyin : pr.radical;
    if (!box.items[key]) box.items[key] = { b: 0, due: 0, ok: 0, bad: 0 };
    return box.items[key];
  }
  function recordSkill(pr, kind, key, first) {
    var r = skillRec(pr, kind, key);
    if (first) { r.ok++; if (r.due <= now()) r.b = Math.min(6, r.b + 1); } else { r.bad++; r.b = Math.min(r.b, 1); }
    r.due = now() + INTERVALS[r.b];
    if (kind === "py") {
      var L = PY_LEVELS[pr.pinyin.lv];
      if (L && pr.pinyin.lv < PY_LEVELS.length - 1 && L.items.every(function (k) { var x = pr.pinyin.items[k]; return x && x.ok >= 1; })) { pr.pinyin.lv++; pr.pinyin.up = true; }
    }
  }
  /** 挑一个该练的项目：先挑答错的/到期的，再挑没练过的 */
  function pickSkillItem(pr, kind, keys) {
    var box = (kind === "py" ? pr.pinyin : pr.radical).items, t = now();
    var weak = keys.filter(function (k) { return box[k] && box[k].b <= 1 && box[k].bad > 0 && box[k].due <= t; });
    var due = keys.filter(function (k) { return box[k] && box[k].due <= t; });
    var fresh = keys.filter(function (k) { return !box[k]; });
    if (weak.length && Math.random() < 0.6) return pick(weak);
    if (fresh.length && Math.random() < 0.6) return fresh[0];
    if (due.length) return pick(due);
    return pick(keys);
  }
  function mastery(pr, kind) {
    var box = (kind === "py" ? pr.pinyin : pr.radical).items, keys = kind === "py" ? [].concat(SINGLE_F, INITIALS, COMPOUND_F, WHOLE) : RADICALS.map(function (R) { return R.r; });
    return { done: keys.filter(function (k) { return box[k] && box[k].b >= 2; }).length, total: keys.length };
  }
  function learnedList(pr) { return Object.keys(pr.srs).filter(function (c) { return pr.srs[c].ok > 0 && BYC[c]; }); }
  function pyOpt(s) { return '<b class="pyb">' + esc(s) + "</b>"; }
  function skillQ(kind, type) { var q = baseExtra(kind, type); q.optCls = "pyopt"; return q; }
  function finishOpts(q, ans, wrongs, fmt) {
    q.answerKey = ans;
    var seen = {}; q.options = [];
    [ans].concat(shuffle(wrongs)).forEach(function (o) { if (!seen[o] && q.options.length < q.nOpt) { seen[o] = 1; q.options.push(o); } });
    q.options.forEach(function (o) { q.optMap[o] = fmt ? fmt(o) : pyOpt(o); });
    q.options = shuffle(q.options);
    return q;
  }
  function sylsWith(f) { return syllables().list.filter(f); }

  /** 出一道拼音题。type 不给就按等级随机 */
  function makePinyin(pr, type) {
    var n = optionCount(pr), little = pr.mode === "little", lv = pr.pinyin.lv, q, o, w;
    var types;
    if (little) types = ["single"];        // 启蒙模式：听一听、点一点（只出单韵母，3 个大按钮）
    else if (lv === 0) types = ["single", "tone"];
    else if (lv === 1) types = ["initial", "join", "tone", "single"];
    else if (lv === 2) types = ["final", "join", "syl", "tone", "initial"];
    else types = ["whole", "syl", "join", "tone", "final"];
    if (!little && lv >= 1 && learnedList(pr).length >= 8) types.push("read");
    type = type || pick(types);
    if (type === "single") {
      var key = pickSkillItem(pr, "py", SINGLE_F), say = SINGLE_SAY[key];
      q = skillQ("py", "single"); q.nOpt = little ? 3 : n; q.item = key;
      q.title = little ? "听一听，点一点" : "听一听，是哪个单韵母？"; q.en = "Listen: which vowel?";
      q.mainHTML = '<div class="qpic" id="qTarget">🔊👂</div>';
      q.speak = say[0]; q.sayAnswer = say[0];
      q.hintHTML = '<span class="py">' + esc(say[1]) + "</span> " + esc(say[0]);
      return finishOpts(q, key, SINGLE_F.filter(function (x) { return x !== key; }), function (x) { return '<b class="pyb big">' + x + "</b>"; });
    }
    if (type === "tone") {
      var pool = lv === 0 ? sylsWith(function (s) { return !s.ini && SINGLE_F.indexOf(s.fin) >= 0 || (s.base.length <= 2 && /^[bpmfdtnl]/.test(s.base)); }) : syllables().list;
      o = pick(pool.slice(0, 120));
      q = skillQ("py", "tone"); q.nOpt = 4; q.item = "t" + o.t;
      q.title = "听一听，是第几声？"; q.en = "Which tone?";
      q.mainHTML = '<div class="qword en" id="qTarget">' + esc(o.base) + " 🔊</div>";
      q.speak = sylSpeak(o); q.sayAnswer = [sylSpeak(o), TONE_SAY[o.t]];
      q.hintHTML = '<span class="py">' + esc(o.py) + "</span> " + esc(o.chars[0]);
      return finishOpts(q, String(o.t), ["1", "2", "3", "4"], function (t) { return '<b class="pyb">' + markTone(o.base, +t) + "</b><small>" + TONE_NAME[+t] + "</small>"; });
    }
    if (type === "initial") {
      var ini = pickSkillItem(pr, "py", INITIALS);
      o = pick(sylsWith(function (s) { return s.ini === ini && !s.whole; }).slice(0, 8)) || pick(sylsWith(function (s) { return s.ini === ini; }));
      q = skillQ("py", "initial"); q.nOpt = n; q.item = ini;
      q.title = "听一听，声母是哪个？"; q.en = "Listen: which initial?";
      q.mainHTML = '<div class="qword en" id="qTarget">?' + esc(markTone(o.fin.replace("ü", /^[jqxy]/.test(ini) ? "u" : "ü"), o.t)) + " 🔊</div>";
      q.speak = sylSpeak(o); q.sayAnswer = sylSpeak(o);
      q.hintHTML = '<span class="py">' + esc(o.py) + "</span> " + esc(o.chars[0]);
      var near = { b: "pdm", p: "bqt", m: "nb", f: "hb", d: "tb", t: "dk", n: "lm", l: "nr", g: "kh", k: "gh", h: "fk", j: "qx", q: "jx", x: "qs", zh: "z,ch,sh", ch: "c,zh,sh", sh: "s,zh,ch", r: "l", z: "zh,c,s", c: "ch,z,s", s: "sh,z,c", y: "w", w: "y" }[ini];
      w = (near.indexOf(",") >= 0 ? near.split(",") : near.split("")).concat(shuffle(INITIALS));
      return finishOpts(q, ini, w.filter(function (x) { return x !== ini; }));
    }
    if (type === "final" || type === "join") {
      var keys = type === "final" || lv >= 2 ? COMPOUND_F : SINGLE_F;
      var fin = pickSkillItem(pr, "py", keys);
      var cand = sylsWith(function (s) { return s.fin === fin && s.ini && !s.whole && s.ini !== "y" && s.ini !== "w"; });
      o = pick(cand.slice(0, 8));
      if (!o) return makePinyin(pr, "tone");
      var shown = o.base.slice(o.ini.length);
      if (type === "final") {
        q = skillQ("py", "final"); q.nOpt = n; q.item = fin;
        q.title = "听一听，韵母是哪个？"; q.en = "Listen: which final?";
        q.mainHTML = '<div class="qword en" id="qTarget">' + esc(o.ini) + "? 🔊</div>";
        q.speak = sylSpeak(o); q.sayAnswer = sylSpeak(o);
        q.hintHTML = '<span class="py">' + esc(o.py) + "</span> " + esc(o.chars[0]);
        return finishOpts(q, shown, shuffle(COMPOUND_F.map(function (f) { return f.replace("ü", /^[jqx]/.test(o.ini) ? "u" : "ü"); })).filter(function (x) { return x !== shown; }));
      }
      q = skillQ("py", "join"); q.nOpt = n; q.item = o.ini;
      q.title = "拼一拼：声母 + 韵母 = ？"; q.en = "Blend the sounds";
      q.mainHTML = '<div class="qmath" id="qTarget"><span class="pyb">' + esc(o.ini) + '</span> + <span class="pyb">' + esc(markTone(shown, o.t)) + '</span> = <span class="blank">？</span></div>';
      q.sayAnswer = sylSpeak(o);
      q.speak = "拼一拼"; q.hintHTML = '<span class="py">' + esc(o.py) + "</span> " + esc(o.chars[0]);
      var others = [1, 2, 3, 4].filter(function (t) { return t !== o.t; }).map(function (t) { return markTone(o.base, t); })
        .concat(sylsWith(function (s) { return s.fin === o.fin && s.ini !== o.ini && s.t === o.t; }).slice(0, 4).map(function (s) { return s.py; }));
      return finishOpts(q, o.py, others);
    }
    if (type === "whole" || type === "syl") {
      var base;
      if (type === "whole") base = pickSkillItem(pr, "py", WHOLE);
      o = type === "whole" ? pick(sylsWith(function (s) { return s.base === base; }).slice(0, 3)) : pick(syllables().list.slice(0, 300));
      if (!o) return makePinyin(pr, "tone");
      q = skillQ("py", type); q.nOpt = n; q.item = type === "whole" ? base : (o.fin || o.base);
      q.title = type === "whole" ? "整体认读：听一听，选拼音" : "听一听，选拼音"; q.en = "Listen and pick the pinyin";
      q.mainHTML = '<div class="qpic" id="qTarget">🔊</div>';
      q.speak = sylSpeak(o); q.sayAnswer = sylSpeak(o);
      q.hintHTML = esc(o.chars[0]) + " · " + (type === "whole" ? "整体认读音节，不用拼" : "先听声母，再听韵母");
      var pool2 = type === "whole" ? WHOLE.map(function (b) { return markTone(b, o.t); }) : [];
      pool2 = pool2.concat([1, 2, 3, 4].filter(function (t) { return t !== o.t; }).map(function (t) { return markTone(o.base, t); }))
        .concat(sylsWith(function (s) { return s.ini === o.ini && s.fin !== o.fin && s.t === o.t; }).slice(0, 3).map(function (s) { return s.py; }));
      return finishOpts(q, o.py, shuffle(pool2.filter(function (x) { return x !== o.py; })));
    }
    // read：看拼音，选认识的字（只用这个小侠客学会的字）
    var learned = shuffle(learnedList(pr).filter(function (c) { return !/\s/.test(BYC[c].py); }));
    if (learned.length < 4) return makePinyin(pr, "tone");
    var c = learned[0];
    q = skillQ("py", "read"); q.nOpt = n; q.item = splitTone(BYC[c].py).base; q.optCls = "hz";
    q.title = "读拼音，哪个字是「" + BYC[c].py + "」？"; q.en = "Read the pinyin";
    q.mainHTML = '<div class="qword en" id="qTarget">' + esc(BYC[c].py) + "</div>";
    q.speak = "读一读拼音，找一找是哪个字"; q.sayAnswer = c;
    q.hintHTML = (BYC[c].pic || "") + " " + esc(BYC[c].en || "");
    var wr = learned.slice(1).filter(function (x) { return BYC[x].py !== BYC[c].py; });
    if (wr.length < n - 1) wr = wr.concat(shuffle(unlockedChars(pr).filter(function (x) { return x !== c && BYC[x].py !== BYC[c].py; })));
    return finishOpts(q, c, wr, function (x) { return esc(x); });
  }

  /** 字的池子：优先用学会的字，不够再用已解锁的字、偏旁常用字 */
  function radChars(pr, R) {
    var L = learnedList(pr), mine = R.list.filter(function (c) { return L.indexOf(c) >= 0; });
    return mine.length ? mine.concat(R.list.filter(function (c) { return mine.indexOf(c) < 0; })) : R.list;
  }
  function makeRadical(pr, type) {
    var n = optionCount(pr), q;
    var learned = learnedList(pr);
    // 先练学过的字里出现过的偏旁
    var keys = RADICALS.filter(function (R) { return R.list.length >= 3; }).map(function (R) { return R.r; });
    var mineKeys = keys.filter(function (k) { return RAD_BY[k].list.some(function (c) { return learned.indexOf(c) >= 0; }); });
    var key = pickSkillItem(pr, "rad", mineKeys.length >= 4 ? mineKeys : keys), R = RAD_BY[key];
    type = type || pick(["meaning", "which", "family", "build"]);
    var others = shuffle(RADICALS.filter(function (x) { return x !== R; }));
    if (type === "meaning") {
      q = skillQ("rad", "meaning"); q.nOpt = n; q.item = key; q.optCls = "word";
      q.title = "偏旁「" + R.r + "」和什么有关？"; q.en = "What does this radical mean?";
      q.mainHTML = '<div class="qchar aura" id="qTarget">' + esc(R.r) + "</div>";
      q.speak = [R.name, "和什么有关？"]; q.sayAnswer = [R.name, R.cue];
      q.hintHTML = "例字：" + radChars(pr, R).slice(0, 3).join(" ");
      return finishOpts(q, R.r, others.map(function (x) { return x.r; }), function (r) { return '<span class="emo-s">' + RAD_BY[r].em + "</span> " + esc(RAD_BY[r].m); });
    }
    if (type === "which" || type === "family") {
      var pool = radChars(pr, R), ans = pool[0];
      if (type === "family") { if (pool.length < 2) type = "which"; }
      var ref = type === "family" ? pool[1] : null;
      if (type === "family" && Math.random() < 0.5) { ans = pool[1]; ref = pool[0]; }
      q = skillQ("rad", type); q.nOpt = n; q.item = key; q.optCls = "hz";
      var wrong = [];
      others.forEach(function (x) { var p = radChars(pr, x); if (p.length) wrong.push(p[0]); });
      if (type === "which") {
        q.title = "哪个字有「" + R.r + "」？"; q.en = "Which character has this radical?";
        q.mainHTML = '<div class="qchar aura" id="qTarget">' + esc(R.r) + '</div><div class="qen">' + R.em + " " + esc(R.name) + " · " + esc(R.cue) + "</div>";
        q.speak = ["哪个字有", R.name];
      } else {
        q.title = "分一分：哪个字和「" + ref + "」是一家？"; q.en = "Same radical family";
        q.mainHTML = '<div class="qchar aura" id="qTarget">' + esc(ref) + "</div>";
        q.speak = ["哪个字和", ref, "是一家？"];
      }
      q.sayAnswer = [ans, "有" + R.name, R.cue];
      q.hintHTML = R.em + " 找有「" + esc(R.r) + "」的字 · " + esc(R.cue);
      return finishOpts(q, ans, wrong, function (x) { return esc(x); });
    }
    // build：偏旁 + 部件 = 字（偏旁先挑这个，没有就随便挑一个）
    var bs = BUILDS.filter(function (b) { return b[0] === key; });
    var B = bs.length ? pick(bs) : pick(BUILDS);
    var R2 = RAD_BY[B[0]];
    q = skillQ("rad", "build"); q.nOpt = n; q.item = B[0]; q.optCls = "hz";
    q.title = "拼字：「" + B[0] + "」+「" + B[1] + "」= ？"; q.en = "Build a character";
    q.mainHTML = '<div class="qmath" id="qTarget">' + esc(B[0]) + " + " + esc(B[1]) + ' = <span class="blank">？</span></div>';
    q.speak = [R2.name, "加", B[1], "是哪个字？"]; q.sayAnswer = B[2];
    q.hintHTML = '<span class="py">' + esc(BYC[B[2]].py) + "</span> " + R2.em + " " + esc(R2.cue);
    var wb = BUILDS.filter(function (b) { return b[2] !== B[2] && (b[1] === B[1] || b[0] === B[0]); }).map(function (b) { return b[2]; })
      .concat(shuffle(BUILDS.map(function (b) { return b[2]; })));
    return finishOpts(q, B[2], wb.filter(function (x) { return x !== B[2]; }), function (x) { return esc(x); });
  }
  function makeSkill(pr, kind) { return kind === "py" ? makePinyin(pr) : makeRadical(pr); }
  /** 新字卡上的偏旁提示 */
  function radicalHint(c) {
    var R = RAD_OF[c]; if (!R) return "";
    return '<div class="radhint">' + R.em + " 偏旁 <b>" + esc(R.r) + "</b>（" + esc(R.name) + "）· " + esc(R.cue) + "</div>";
  }
  var SKILL_RATE = 0.35;   // 普通修炼一关里大约三关里出一道拼音/偏旁题
  var lastSkill = "rad";
  function nextSkillKind(pr) {
    if (pr.mode === "little") return pr.stage >= 1 ? "py" : null;
    lastSkill = lastSkill === "py" && learnedCount(pr) >= 12 ? "rad" : "py";
    return lastSkill;
  }

  /* ═══════════════ UI 基础 ═══════════════ */
  var screen = "title";
  function addLog(msg, cls) {
    var log = $("log"), p = el("p", cls || "");
    p.textContent = msg;
    log.insertBefore(p, log.firstChild);
    while (log.children.length > 8) log.removeChild(log.lastChild);
  }
  function toast(msg) {
    var t = el("div", "toast"); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  function clearMenu() { $("menu").innerHTML = ""; }
  function setStory(html) { $("story").innerHTML = html; }
  function btn(label, fn, opts) {
    opts = opts || {};
    var b = el("button", "btn" + (opts.cls ? " " + opts.cls : ""));
    b.type = "button";
    b.innerHTML = label;
    if (opts.disabled) b.disabled = true;
    b.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (b.disabled) return;
      if (b._busy) return;            // 防连点
      b._busy = true; setTimeout(function () { b._busy = false; }, 350);
      SFX.click(); fn(ev);
    });
    return b;
  }
  /** 同一个网址下的数学游戏（math/），存档各自分开 */
  function goMath() { SFX.click(); try { saveStore(); } catch (e) { /* */ } VOICE.stop(); global.location.href = "math/"; }
  function addBtn(label, fn, opts) { var b = btn(label, fn, opts); $("menu").appendChild(b); return b; }
  function speedLines(on) { $("speed").classList.toggle("hidden", !on); }
  function showScene(show) { $("scene").classList.toggle("hidden", !show); }
  function hideQuiz() { curQ = null; $("quiz").classList.add("hidden"); $("quiz").innerHTML = ""; speedLines(false); }
  function updateWho() {
    var w = $("who");
    if (!w) return;
    var voice = zhVoice() ? "" : ' <span class="tag-voice">🔇无中文语音</span>';
    w.innerHTML = prof ? avatarHTML(prof.avatar, 34) + " " + esc(prof.name) + voice : "选择小侠客" + voice;
    $("homeBtn").classList.toggle("hidden", !prof);
    $("settingsBtn").classList.toggle("hidden", !prof);
  }
  function scrollTop() { try { global.scrollTo(0, 0); } catch (e) { /* */ } }

  function renderHUD() {
    var h = $("hud");
    if (!prof) { h.innerHTML = ""; return; }
    var P = prof.player, stats = "📚 " + learnedCount() + " 字 · 🐉×" + prof.wishes + " · 🌟" + prof.stickers.length;
    h.innerHTML = '<div class="hud"><div class="ava" style="background:' + prof.color + '">' + avatarHTML(prof.avatar, 56) + '</div><div class="info">' +
      '<div class="name">' + esc(prof.name) + (prof.mode === "hero" ? " · Lv." + P.level : "") + "</div>" +
      (prof.mode === "hero" ? '<div class="bar" title="经验"><span class="xp" style="width:' + Math.min(100, P.exp / P.expNeed * 100) + '%"></span></div>' : "") +
      stats + "</div></div>";
  }

  /* ═══════════════ 特效 ═══════════════ */
  function centerOf(e) { var r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function fxBlast(fromEl, toEl) {
    if (!fromEl || !toEl) return;
    var a = centerOf(fromEl), b = centerOf(toEl), fx = $("fx");
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
    var beam = el("div", "blast");
    beam.style.left = a.x + "px"; beam.style.top = (a.y - 17) + "px"; beam.style.width = len + "px";
    beam.style.transform = "rotate(" + Math.atan2(dy, dx) + "rad)";
    beam.style.transformOrigin = "left center";
    // rotate 与 scaleX 动画叠加：用包裹层
    var wrap = el("div"); wrap.style.cssText = "position:absolute;left:" + a.x + "px;top:" + (a.y - 17) + "px;width:" + len + "px;height:34px;transform-origin:left center;transform:rotate(" + Math.atan2(dy, dx) + "rad)";
    beam.style.left = "0"; beam.style.top = "0"; beam.style.transform = "";
    wrap.appendChild(beam); fx.appendChild(wrap);
    SFX.blast();
    setTimeout(function () {
      var boom = el("div", "boom"); boom.style.left = b.x + "px"; boom.style.top = b.y + "px"; fx.appendChild(boom);
      toEl.classList.remove("hit"); void toEl.offsetWidth; toEl.classList.add("hit");
      setTimeout(function () { boom.remove(); }, 650);
    }, 380);
    setTimeout(function () { wrap.remove(); }, 700);
  }
  function fxFlyBall(fromEl, toEl, stars) {
    if (!fromEl || !toEl) return;
    var a = centerOf(fromEl), b = centerOf(toEl);
    var d = el("div", "flyball", ballSVG(stars, 44));
    d.style.left = (a.x - 22) + "px"; d.style.top = (a.y - 22) + "px";
    $("fx").appendChild(d);
    requestAnimationFrame(function () { requestAnimationFrame(function () { d.style.left = (b.x - 22) + "px"; d.style.top = (b.y - 22) + "px"; }); });
    setTimeout(function () { d.remove(); }, 800);
  }
  function confetti(n) {
    var fx = $("fx"), items = ["⭐", "✨", "🌟", "💥", "🎉"];
    for (var i = 0; i < (n || 24); i++) {
      var c = el("div", "confetti"); c.textContent = pick(items);
      c.style.left = Math.random() * 100 + "vw"; c.style.animationDuration = (1.6 + Math.random() * 1.6) + "s";
      c.style.animationDelay = Math.random() * 0.6 + "s";
      fx.appendChild(c);
      (function (cc) { setTimeout(function () { cc.remove(); }, 3800); })(c);
    }
  }

  /* ═══════════════ 答题界面（通用） ═══════════════ */
  var curQ = null, curCtx = null;
  function charHint(c) {
    var it = BYC[c];
    return '<span class="py">' + esc(it.py) + "</span>" + (it.pic ? " " + it.pic : "") + (it.en ? ' <small class="cen">' + esc(it.en) + "</small>" : "");
  }
  function showQuiz(q, ctx) {
    curQ = q; curCtx = ctx;
    var pr = ctx.pr;
    showScene(false); speedLines(true);
    var box = $("quiz");
    box.classList.remove("hidden");
    var main = "";
    if (q.mainHTML) main = q.mainHTML;
    else if (q.pic) main = '<div class="qpic">' + q.pic + "</div>";
    else if (q.show) main = '<div class="qchar aura" id="qTarget">' + esc(q.show) + "</div>";
    else if (q.wordBlank) main = '<div class="qword" id="qTarget">' + q.wordBlank.split("").map(function (ch) { return ch === q.c ? '<span class="blank">' + ch + "</span>" : esc(ch); }).join("") + "</div>";
    else main = '<div class="qpic" id="qTarget">🔊</div>';
    var n = q.options.length;
    box.innerHTML = (ctx.header || "") +
      '<div class="qbox"><span class="qtag">' + (ctx.tag || "修炼") + '</span><div class="qtitle">' + (q.titleHTML || esc(q.title)) + '</div><div class="qen">' + esc(q.en) + "</div>" +
      main + '<div class="hintline" id="hintLine"></div>' +
      '<div class="tools"><button class="btn blue" type="button" id="sayBtn">🔊 听</button><button class="btn yellow" type="button" id="hintBtn">💡 拼音提示</button></div>' +
      '<div class="opts' + (n === 3 ? " three" : "") + '" id="opts"></div></div>';
    var opts = $("opts");
    q.options.forEach(function (key) {
      var label = q.optMap ? q.optMap[key] : key;
      var b = el("button", "btn opt " + (q.optCls || "hz"));
      b.type = "button"; b.dataset.key = key;
      if (q.optHTML) b.innerHTML = label; else b.textContent = label;
      b.addEventListener("click", function (ev) { ev.preventDefault(); answer(b, key); });
      opts.appendChild(b);
    });
    if (q.type === "pinyin" || q.kind) { $("hintBtn").innerHTML = "💡 提示"; }
    $("sayBtn").onclick = function () { SFX.click(); if (q.type === "pinyin" && !q.done && !q.hinted) { showHint(); } else sayQ(q); };
    $("hintBtn").onclick = function () { SFX.click(); showHint(); };
    if (!zhVoice()) { $("sayBtn").classList.add("hidden"); }
    if (q.kind === "eng" && q.speakEn && TTS.enOk) $("sayBtn").classList.remove("hidden");
    if (q.type === "listen" && !zhVoice()) showHint();
    if (pr.settings.pinyin && q.type !== "pinyin" && !q.kind) showHint(true);
    if (q.kind === "read" || q.kind === "clue") { var sb = $("sayBtn"); sb.classList.add("hidden"); bindReading(box, pr); if (q.kind === "clue") { sb.innerHTML = "🔊 整句读给我听"; var showSb = function () { if (curQ === q && TTS.ok) sb.classList.remove("hidden"); }; setTimeout(showSb, READ_HINT_DELAY); box.querySelectorAll(".rc").forEach(function (x) { x.addEventListener("click", showSb); }); } }
    clearMenu();
    (ctx.menu || []).forEach(function (m) { addBtn(m[0], m[1], m[2]); });
    if (q.autoSpeak) setTimeout(function () { if (curQ === q) sayQ(q); }, 300);
    scrollTop();
  }
  function sayQ(q) { if (q.speakEn && TTS.sayEn(q.speakEn)) return; TTS.say(q.speak); }
  /** 答对 / 答错后朗读的内容 */
  function sayAnswer(q) {
    if (q.kind === "eng") { if (!TTS.sayEn(q.item[0])) TTS.say(q.sayAnswer); return; }
    if (q.kind === "read") return;
    if (q.kind) return TTS.say(q.sayAnswer);
    TTS.say(q.type === "fill" ? q.word.w : charSpeech(q.c));
  }
  function showHint(silent) {
    var q = curQ; if (!q) return;
    q.hinted = true;
    var line = $("hintLine"); if (!line) return;
    var c = q.c;
    if (q.kind) { line.innerHTML = q.hintHTML; if (!silent) sayAnswer(q); return; }
    if (q.type === "pinyin") line.innerHTML = (BYC[c].pic ? BYC[c].pic + " " : "") + esc(BYC[c].ok ? BYC[c].en : "") + " · 听一听 👂";
    else if (q.word) line.innerHTML = '<span class="py">' + esc(q.word.py) + "</span> <small>" + esc(q.word.en) + "</small>";
    else line.innerHTML = charHint(c);
    if (!silent) sayAnswer(q);
  }
  function answer(b, key) {
    var q = curQ, ctx = curCtx;
    if (!q || q.done || b.disabled) return;
    if (key === q.answerKey) {
      q.done = true;
      document.querySelectorAll("#opts .opt").forEach(function (x) { x.disabled = true; });
      b.disabled = false; b.classList.add("right");
      SFX.correct();
      sayAnswer(q);
      var line = $("hintLine");
      if (line) line.innerHTML = (q.wrongs === 0 ? "✨ 太棒了！ " : "👍 对啦！ ") + (q.kind === "read" ? "" : q.kind ? q.hintHTML : charHint(q.c));
      setTimeout(function () { if (ctx.onDone) ctx.onDone(q.wrongs === 0, b, q); }, q.wrongs === 0 ? 1300 : 1700);
    } else {
      q.wrongs++;
      b.disabled = true; b.classList.add("wrong");
      SFX.soft();
      showHint(true);
      if (!q.kind) setTimeout(function () { if (curQ === q && !q.done) sayAnswer(q); }, 350);
      if (q.kind === "clue" && q.wrongs === 1) { var ln = $("hintLine"); if (ln) ln.innerHTML = "👀 再读一读：龙珠在哪里？"; }
      var left = Array.prototype.filter.call(document.querySelectorAll("#opts .opt"), function (x) { return !x.disabled; });
      if (q.wrongs >= 2 || ctx.pr.mode === "little") {
        left.forEach(function (x) { if (x.dataset.key === q.answerKey) x.classList.add("glow"); });
      }
      if (ctx.onWrong) ctx.onWrong(q);
    }
  }

  /* ═══════════════ 经验与等级（只用来鼓励，没有战斗数值） ═══════════════ */
  function gainExp(pr, amount) {
    var p = pr.player, up = false;
    p.exp += amount;
    while (p.exp >= p.expNeed) { p.exp -= p.expNeed; p.level++; p.expNeed = expNeed(p.level); up = true; }
    if (up && pr.mode === "hero") { SFX.level(); toast("🎉 " + pr.name + " 升级 Lv." + p.level + "！"); addLog("升级！Lv." + p.level, "win"); }
  }

  /* ═══════════════ 选人页（标题） ═══════════════ */
  var MAX_PROFILES = 4;
  function renderTitle() {
    screen = "title"; useProfile(null);
    hideQuiz(); showScene(true); renderHUD(); closeOverlay();
    $("logo").classList.remove("hidden");
    var none = !store.profiles.length;
    setStory(riderHTML("goku", "krillin") + '<div style="text-align:center">' +
      (none ? "欢迎！先创建一位小侠客吧。<br><small>Welcome! Make your player first.</small>"
            : "谁来修炼？点自己的头像开始！<br><small>Who is playing? Tap your picture.</small>") + "</div>");
    clearMenu();
    var grid = el("div", "profiles");
    store.profiles.forEach(function (pr) {
      var card = el("div", "pcard");
      card.setAttribute("role", "button");
      card.innerHTML = '<div class="ava">' + avatarHTML(pr.avatar, 96) + '</div>' + (AVATAR_INFO[pr.avatar] ? '<div class="avname">' + esc(AVATAR_INFO[pr.avatar].label) + '</div>' : "") + '<div class="pn">' + esc(pr.name) + '</div>' +
        '<span class="pm" style="background:' + pr.color + '">' + (pr.mode === "little" ? "🍼 启蒙模式" : "⚔️ 侠客模式") + "</span>" +
        "<small>认识 " + learnedCount(pr) + " 字 · 🐉×" + pr.wishes + (pr.mode === "hero" ? " · Lv." + pr.player.level : "") + "</small>";
      card.addEventListener("click", function () { SFX.click(); initAudio(); useProfile(pr); saveStore(); goHome(); });
      grid.appendChild(card);
    });
    if (store.profiles.length < MAX_PROFILES) {
      var add = el("div", "pcard addcard");
      add.setAttribute("role", "button");
      add.innerHTML = '<div class="ava"><span class="avemo" style="font-size:64px">➕</span></div><div class="pn">新玩家</div><small>New player（最多 ' + MAX_PROFILES + ' 人）</small>';
      add.addEventListener("click", function () { SFX.click(); initAudio(); renderProfileForm(null); });
      grid.appendChild(add);
    }
    $("menu").appendChild(grid);
    if (store.profiles.length >= 2) addBtn("🤝 同心协力 · 双人轮流打魔王", function () { chooseDuo(); }, { cls: "blue" });
    addBtn("🧮 数学大冒险 · 去森林算一算", goMath, { cls: "yellow" });
    addBtn("📥 导入存档（存档码 / 文件）", function () { renderImport(renderTitle); }, { cls: "small" });
    var done = store.legacySlotsDone || [];
    legacySlots().forEach(function (ls) {
      if (store.legacyDone || done.indexOf(ls.slot) !== -1) return;
      addBtn("📥 导入旧版存档 " + ls.slot + "（Lv." + (ls.player.level || 1) + "）", function () { chooseImportTarget(ls); }, { cls: "small" });
    });
    scrollTop();
  }

  /** 旧版存档导入：选一位侠客模式玩家，或新建一位再导入 */
  function chooseImportTarget(ls) {
    screen = "import"; hideQuiz(); showScene(true); clearMenu();
    setStory("📥 把旧版存档 " + ls.slot + "（Lv." + (ls.player.level || 1) + "）的等级和学过的字导入给谁？\n<small>旧存档本身不会被删除。</small>");
    var finish = function (pr) {
      importLegacy(ls, pr);
      store.legacySlotsDone = (store.legacySlotsDone || []).concat([ls.slot]);
      saveStore(); toast("📥 已导入给 " + pr.name); renderTitle();
    };
    store.profiles.filter(function (p) { return p.mode === "hero"; }).forEach(function (pr) {
      addBtn(avatarHTML(pr.avatar, 44) + " " + esc(pr.name), function () { finish(pr); }, { cls: "blue" });
    });
    if (store.profiles.length < MAX_PROFILES) addBtn("➕ 新建一位侠客再导入", function () { renderProfileForm(null, { mode: "hero", lockMode: true, onDone: finish }); }, { cls: "primary" });
    addBtn("↩️ 返回", renderTitle, { cls: "small" });
    scrollTop();
  }

  /** 新建 / 修改玩家：输入名字、选模式、选头像（大按钮，适合平板和手机） */
  function renderProfileForm(pr, opts) {
    opts = opts || {};
    var editing = !!pr;
    var d = { name: pr ? pr.name : "", mode: pr ? pr.mode : (opts.mode || "hero"), avatar: pr ? pr.avatar : AVATARS[store.profiles.length % 2] };
    screen = "profileForm"; hideQuiz(); showScene(true); renderHUD(); closeOverlay();
    $("logo").classList.add("hidden");
    setStory('<div class="big">' + (editing ? "✏️ 修改玩家" : "➕ 新玩家 · New player") + "</div>");
    clearMenu();
    var form = el("div", "pform");
    form.appendChild(el("div", "pflabel", "1️⃣ 名字 <small>Name</small>"));
    var inp = document.createElement("input");
    inp.type = "text"; inp.id = "pfName"; inp.className = "pfname"; inp.maxLength = 12; inp.value = d.name;
    inp.placeholder = "输入名字 / Type a name"; inp.autocomplete = "off"; inp.setAttribute("aria-label", "名字");
    form.appendChild(inp);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
    var modeBox = null;
    if (!editing) {
      form.appendChild(el("div", "pflabel", "2️⃣ 模式 <small>Mode</small>"));
      modeBox = el("div", "choices");
      [["little", "🍼 启蒙模式", "看图听音，几乎不用识字 · 适合 3–5 岁"], ["hero", "⚔️ 侠客模式", "识字闯关、打怪升级 · 适合 6 岁以上"]].forEach(function (m) {
        var b = btn("<strong>" + m[1] + "</strong><small>" + m[2] + "</small>", function () {
          if (opts.lockMode) return toast("导入旧存档需要侠客模式");
          d.mode = m[0]; modeBox.querySelectorAll(".choice").forEach(function (x) { x.classList.toggle("sel", x.dataset.mode === d.mode); });
        }, { cls: "choice" + (d.mode === m[0] ? " sel" : "") });
        b.dataset.mode = m[0];
        modeBox.appendChild(b);
      });
      form.appendChild(modeBox);
    }
    form.appendChild(el("div", "pflabel", (editing ? "2️⃣" : "3️⃣") + " 头像 <small>Avatar</small>"));
    var grid = el("div", "avgrid");
    AVATARS.forEach(function (a) {
      var b = btn(avatarHTML(a, 60) + (AVATAR_INFO[a] ? "<small>" + esc(AVATAR_INFO[a].label) + "</small>" : ""), function () {
        d.avatar = a; grid.querySelectorAll(".avpick").forEach(function (x) { x.classList.toggle("sel", x.dataset.ava === a); });
      }, { cls: "avpick" + (d.avatar === a ? " sel" : "") });
      b.dataset.ava = a; b.setAttribute("aria-label", avatarLabel(a));
      grid.appendChild(b);
    });
    form.appendChild(grid);
    $("menu").appendChild(form);
    addBtn(editing ? "✅ 保存" : "✅ 创建，开始修炼！", function () {
      var name = inp.value.replace(/\s+/g, " ").trim().slice(0, 12);
      if (!name) { toast("✏️ 先写上名字哦"); inp.focus(); return; }
      if (store.profiles.some(function (p) { return p !== pr && p.name === name; })) { toast("这个名字已经有人用了，换一个吧"); inp.focus(); return; }
      if (editing) {
        pr.name = name; pr.avatar = d.avatar; saveStore(); updateWho(); toast("已保存"); renderSettings(); return;
      }
      if (store.profiles.length >= MAX_PROFILES) { toast("最多 " + MAX_PROFILES + " 位玩家"); return renderTitle(); }
      var used = store.profiles.map(function (p) { return p.color; });
      var color = COLORS.filter(function (c) { return used.indexOf(c) === -1; })[0] || COLORS[0];
      var np = newProfile(name, d.mode, d.avatar, color);
      store.profiles.push(np); saveStore(); SFX.win();
      if (opts.onDone) return opts.onDone(np);
      useProfile(np); saveStore(); goHome();
    }, { cls: "primary" });
    addBtn("↩️ 返回", editing ? renderSettings : renderTitle, { cls: "small" });
    scrollTop();
    if (!editing && !("ontouchstart" in global)) setTimeout(function () { inp.focus(); }, 50);
  }

  function goHome() { if (!prof) return renderTitle(); if (prof.mode === "little") renderLittleHub(); else renderHub(); }

  /* ═══════════════ 侠客模式主页 ═══════════════ */
  function placeHTML(pr) {
    var pl = currentPlace(pr);
    return '<div class="place"><span class="pcoach">' + portraitHTML(pl.coach, 64) + '</span><div><div class="big">' + pl.emoji + " " + esc(pl.name) + "</div>" +
      esc(CAST[pl.coach].name) + "：「" + esc(pl.line) + "」</div></div>";
  }
  function renderHub() {
    screen = "hub"; duo = null; story = null;
    hideQuiz(); showScene(true); renderHUD();
    $("logo").classList.add("hidden");
    var list = unlockedChars(prof);
    var dueN = list.filter(function (c) { var r = prof.srs[c]; return r && r.seen && r.due <= now(); }).length;
    setStory(riderHTML(prof.avatar) + placeHTML(prof) +
      "\n📚 第 " + (prof.stage + 1) + " 阶 · 已解锁 " + list.length + " 字" + (dueN ? " · 🔁 " + dueN + " 个字该复习了" : ""));
    clearMenu();
    addBtn(ballSVG(7, 34) + " 修炼一关：集齐 7 颗龙珠", function () { startSession(); }, { cls: "primary" });
    addBtn("📖 龙珠故事 · " + (storyProgress(prof) >= STORY.length ? "全部通关 🏆" : esc(STORY[storyProgress(prof)].title)), renderStoryMap, { cls: "yellow" });
    var openL = unlockedStories(prof), unread = openL.filter(function (st) { return !prof.reads[st.id]; }).length;
    addBtn("📚 故事书架 · 能读 " + openL.length + " 本" + (unread ? " · 🆕" + unread : ""), renderShelf, { cls: "yellow" });
    var row = el("div", "row");
    row.appendChild(btn("🔤 字卡本", renderBook, { cls: "blue" }));
    row.appendChild(btn("🌟 贴纸", renderStickers, { cls: "blue" }));
    $("menu").appendChild(row);
    var pm = mastery(prof, "py"), rm = mastery(prof, "rad");
    var row2 = el("div", "row");
    row2.appendChild(btn("🅰️ 拼音修炼<br><small>" + PY_LEVELS[prof.pinyin.lv].name + " · " + pm.done + "/" + pm.total + "</small>", function () { startSession("py"); }, { cls: "skillbtn" }));
    row2.appendChild(btn("🧩 偏旁修炼<br><small>" + rm.done + "/" + rm.total + "</small>", function () { startSession("rad"); }, { cls: "skillbtn" }));
    $("menu").appendChild(row2);
    addBtn("🧮 数学大冒险", goMath, { cls: "small yellow" });
    if (store.profiles.length >= 2) addBtn("🤝 双人模式", chooseDuo, { cls: "small" });
    scrollTop();
  }

  /* ═══════════════ 启蒙模式主页（几乎不用识字） ═══════════════ */
  function renderLittleHub() {
    screen = "littleHub"; duo = null; story = null;
    hideQuiz(); showScene(true); renderHUD();
    $("logo").classList.add("hidden");
    setStory(riderHTML(prof.avatar) + '<div style="text-align:center" class="big">' + esc(prof.name) + " 🐉×" + prof.wishes + "</div>");
    clearMenu();
    var go = addBtn('<span style="font-size:2.4rem">▶️</span> ' + ballSVG(1, 40) + ballSVG(4, 40) + ballSVG(7, 40), function () { startSession(); }, { cls: "primary" });
    go.style.minHeight = "110px";
    go.setAttribute("aria-label", "开始");
    var sb = addBtn('<span style="font-size:2.2rem">📖</span> ' + portraitHTML("bulma", 54) + portraitHTML("roshi", 54) + portraitHTML("tien", 54), renderStoryMap, { cls: "yellow" });
    sb.setAttribute("aria-label", "龙珠故事");
    var row = el("div", "row");
    row.appendChild(btn('<span style="font-size:2rem">🔤</span>', renderBook, { cls: "blue" }));
    row.appendChild(btn('<span style="font-size:2rem">🌟</span>', renderStickers, { cls: "yellow" }));
    $("menu").appendChild(row);
    var pb = addBtn('<span style="font-size:2.2rem">👂</span> <b class="pyb big">a o e</b>', function () { startSession("py"); }, { cls: "skillbtn" });
    pb.setAttribute("aria-label", "拼音");
    TTS.say("点大按钮，开始！");
    scrollTop();
  }

  /* ═══════════════ 修炼一关（7 题 = 7 颗龙珠） ═══════════════ */
  var session = null;
  function pickSessionChars(pr, n) {
    var list = unlockedChars(pr), t = now();
    var byDue = function (a, b) { return rec(a, pr).due - rec(b, pr).due; };
    var seen = function (c) { return pr.srs[c] && pr.srs[c].seen > 0; };
    var missed = list.filter(function (c) { return seen(c) && pr.srs[c].b <= 1 && pr.srs[c].due <= t; }).sort(byDue);
    var due = list.filter(function (c) { return seen(c) && pr.srs[c].b >= 2 && pr.srs[c].due <= t; }).sort(byDue);
    var fresh = list.filter(function (c) { return !seen(c); });
    var maxNew = pr.mode === "little" ? 2 : 3;
    var out = [];
    var push = function (c) { if (out.length < n && out.indexOf(c) === -1) out.push(c); };
    missed.slice(0, 3).forEach(push);
    due.slice(0, 2).forEach(push);
    fresh.slice(0, maxNew).forEach(push);
    shuffle(list.filter(seen)).sort(function (a, b) { return rec(a, pr).b - rec(b, pr).b; }).forEach(push);
    fresh.forEach(push);
    var guard = 0;
    while (out.length < n && guard++ < 50) out.push(pick(list)); // 字太少时允许重复
    out = shuffle(out);
    for (var i = 1; i < out.length; i++) if (out[i] === out[i - 1]) { var j = (i + 2) % out.length; var tmp = out[i]; out[i] = out[j]; out[j] = tmp; }
    return out;
  }
  function trackerHTML() {
    var s = '<div class="tracker" id="tracker"><span class="trk-ava aura">' + avatarHTML(session.pr.avatar, 44) + "</span>";
    for (var i = 1; i <= SESSION_LEN; i++) s += '<span id="slot' + i + '">' + ballSVG(i, 38, i <= session.balls ? "" : "empty") + "</span>";
    return s + "</div>";
  }
  /** 7 题里换掉 1–2 题为数学/英语（优先换复习字，第一题不换） */
  function withExtras(queue) {
    var seen = function (i) { var r = prof.srs[queue[i].c]; return !!(r && r.seen); };
    var idx = queue.map(function (x, i) { return i; }).filter(function (i) { return i > 0; });
    var slots = shuffle(idx.filter(seen)).concat(shuffle(idx.filter(function (i) { return !seen(i); })));
    var k = Math.random() < 0.5 ? EXTRA_PER_SESSION : EXTRA_PER_SESSION - 1;
    slots.slice(0, k).forEach(function (i) { queue[i] = { extra: nextExtraKind(), retry: false }; });
    // v5：认识的字够了，大约每两关出一道「龙珠雷达线索」阅读题
    if (clueEligible(prof) && Math.random() < 0.5) { var free = idx.filter(function (i) { return !queue[i].extra; }); if (free.length) queue[pick(free)] = { clue: true, retry: false }; }
    // v7：偶尔混进一道拼音 / 偏旁题（汉字题仍是大多数）
    var sk = nextSkillKind(prof);
    if (sk && Math.random() < SKILL_RATE) { var free2 = idx.filter(function (i) { return !queue[i].extra && !queue[i].clue; }); if (free2.length > 3) queue[pick(free2)] = { skill: sk, retry: false }; }
    return queue;
  }
  function startSession(only) {
    var skillOnly = only === "py" || only === "rad";
    var queue = [];
    if (skillOnly) for (var k = 0; k < SESSION_LEN; k++) queue.push({ skill: only, retry: false });
    else queue = withExtras(pickSessionChars(prof, SESSION_LEN).map(function (c) { return { c: c, retry: false }; }));
    session = {
      pr: prof, queue: queue, only: skillOnly ? only : null,
      idx: 0, balls: 0, first: 0, missed: [], introduced: {}, newChars: []
    };
    screen = "session";     nextInSession();
  }
  function nextInSession() {
    if (!session) return goHome();
    if (session.idx >= session.queue.length) return endSession();
    var item = session.queue[session.idx], pr = session.pr, c = item.c;
    if (item.extra || item.clue || item.skill) return askInSession(item);
    var r = rec(c, pr);
    if (!r.seen && !session.introduced[c]) { session.introduced[c] = 1; session.newChars.push(c); return showIntro(c, function () { askInSession(item); }); }
    askInSession(item);
  }
  function sessionMenu() { return [["⏸ 休息一下（回主页）", function () { saveStore(); session = null; goHome(); }, { cls: "small" }]]; }
  function askInSession(item) {
    var pr = session.pr;
    var q = item.skill ? makeSkill(pr, item.skill) : item.clue ? makeClue(pr) : item.extra ? makeExtra(pr, item.extra) : makeQuestion(pr, item.c);
    var tag = item.retry ? "🔁 再练一次" : "第 " + Math.min(SESSION_LEN, session.balls + 1) + " 颗龙珠";
    if (item.extra) tag = (item.extra === "math" ? "🔢 数学 · " : "🔤 英语 · ") + tag;
    if (item.clue) tag = "📡 雷达线索 · " + tag;
    if (item.skill) tag = (item.skill === "py" ? "🅰️ 拼音 · " : "🧩 偏旁 · ") + tag;
    showQuiz(q, {
      pr: pr, tag: tag, header: trackerHTML(), menu: sessionMenu(),
      onDone: function (first, b) {
        if (item.skill) {
          recordSkill(pr, item.skill, q.item, first);
          if (pr.pinyin.up) { delete pr.pinyin.up; addLog("🎉 拼音升级：开始学「" + PY_LEVELS[pr.pinyin.lv].name + "」！", "good"); }
          if (!first && !item.retry && session.queue.length < SESSION_LEN + 3) session.queue.splice(Math.min(session.queue.length, session.idx + 3), 0, { skill: item.skill, retry: true });
        } else if (item.clue) { if (first) pr.extra.clue = (pr.extra.clue || 0) + 1; } else if (item.extra) recordExtra(pr, item.extra, first); else recordResult(pr, item.c, first);
        if (first) { if (!item.retry) session.first++; gainExp(pr, 8 + Math.min(10, pr.player.level)); }  // 「再练一次」答对不算进「一次就答对」
        else if (item.extra || item.clue || item.skill) gainExp(pr, 3);
        else {
          gainExp(pr, 3);
          if (session.missed.indexOf(item.c) === -1) session.missed.push(item.c);
          // 答错的字：本关稍后再练一次（间隔复习）
          if (!item.retry && session.queue.length < SESSION_LEN + 3) session.queue.splice(Math.min(session.queue.length, session.idx + 3), 0, { c: item.c, retry: true });
        }
        if (!item.retry && session.balls < SESSION_LEN) {
          session.balls++;
          var slot = $("slot" + session.balls);
          fxFlyBall(b, slot, session.balls); SFX.ball();
          if (slot) setTimeout(function () { slot.innerHTML = ballSVG(session.balls, 38, "pop"); }, 650);
        }
        fxBlast($("qTarget") || b, $("tracker"));
        saveStore();
        session.idx++;
        setTimeout(nextInSession, 750);
      }
    });
  }
  /** 新字卡：大字 + 拼音/图 + 2–3 个组词（CC-CEDICT 核对过、读音一致），逐个读出来 */
  function introWords(c) { return (BYC[c].w || []).slice(0, 3); }
  function introSpeech(c, little) {
    var ws = introWords(c);
    return charSpeech(c).concat(little ? [] : ws.map(function (w) { return w.w; }));
  }
  function showIntro(c, then) {
    var it = BYC[c], little = session.pr.mode === "little", ws = introWords(c);
    showScene(false); speedLines(true);
    var box = $("quiz"); box.classList.remove("hidden");
    var wl = (!little && ws.length) ? '<div class="introwords"><div class="qen">组词 · Words</div>' + ws.map(function (w, i) {
      return '<button class="btn small wordchip" type="button" data-i="' + i + '"><b>' + esc(w.w) + "</b><small>" + esc(w.py) + " · " + esc(w.en) + "</small></button>";
    }).join("") + "</div>" : "";
    box.innerHTML = trackerHTML() + '<div class="qbox newcard"><div class="newbadge">新字!</div><span class="qtag">认识新字 · New</span>' +
      (it.pic ? '<div class="qpic" style="font-size:4rem">' + it.pic + "</div>" : "") +
      '<div class="qchar aura">' + esc(c) + '</div><div class="hintline">' + charHint(c) + "</div>" + (little ? "" : radicalHint(c)) + wl +
      '<div class="tools"><button class="btn blue" type="button" id="sayBtn">🔊 再听一次</button></div></div>';
    $("sayBtn").onclick = function () { SFX.click(); TTS.say(introSpeech(c, little)); };
    box.querySelectorAll(".wordchip").forEach(function (b) {
      b.addEventListener("click", function () { SFX.click(); TTS.say(ws[+b.dataset.i].w); });
    });
    clearMenu();
    var next = (!little && ws.length) ? function () { wordPractice(c, then); } : then;
    addBtn(little ? '<span style="font-size:2.2rem">👉</span>' : "我记住了！ 👉", next, { cls: "primary" });
    sessionMenu().forEach(function (m) { addBtn(m[0], m[1], m[2]); });
    setTimeout(function () { TTS.say(introSpeech(c, little)); }, 300);
    scrollTop();
  }
  /** 组词小练习：「哪个词里有『大』？」（不计入复习记录，答错也没关系） */
  function wordPractice(c, then) {
    var q = makeQuestion(session.pr, c, "word");
    q.speak = ["哪个词里有", c];
    showQuiz(q, { pr: session.pr, tag: "🧩 组词练习", header: trackerHTML(), menu: sessionMenu(),
      onDone: function () { setTimeout(then, 400); } });
  }
  function endSession() {
    var s = session, pr = s.pr;
    pr.sessions++;
    var td = todayStr();
    if (pr.lastDay !== td) {
      var y = new Date(now() - DAY); var ys = y.getFullYear() + "-" + (y.getMonth() + 1) + "-" + y.getDate();
      pr.dayStreak = pr.lastDay === ys ? pr.dayStreak + 1 : 1; pr.lastDay = td;
    }
    gainExp(pr, 15);
    var advanced = maybeAdvanceStage(pr);
    s.advanced = advanced;
    saveStore();
    summonDragon(pr, function () { session = null; showSummary(s); });
  }

  /* ═══════════════ 召唤神龙 · 许愿 ═══════════════ */
  function closeOverlay() { var o = $("overlay"); o.classList.add("hidden"); o.innerHTML = ""; }
  function summonDragon(pr, after) {
    var o = $("overlay");
    var circle = '<div class="ballcircle">';
    for (var i = 1; i <= 7; i++) {
      var a = (i - 1) / 7 * Math.PI * 2;
      circle += '<span style="position:absolute;left:' + (130 + Math.cos(a) * 105 - 24) + "px;top:" + (130 + Math.sin(a) * 105 - 24) + 'px">' + ballSVG(i, 48) + "</span>";
    }
    circle += '</div><div class="dragon">🐉</div>';
    // 许愿：从三张贴纸里挑一张（优先给还没有的）
    var fresh = STICKERS.filter(function (x) { return pr.stickers.indexOf(x) === -1; });
    var choices = shuffle(fresh).concat(shuffle(STICKERS)).filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 3);
    var wishes = choices.map(function (st) { return { label: '<span style="font-size:2.6rem">' + st + "</span>", fn: function () { pr.stickers.push(st); gainExp(pr, 10); return "得到贴纸 " + st; } }; });
    o.innerHTML = '<div style="position:relative;width:260px;height:260px">' + circle + '</div><div class="wishtitle">神龙出现了！说出你的愿望吧！</div><div class="wishes" id="wishes"></div>';
    o.classList.remove("hidden");
    SFX.win(); TTS.say("七颗龙珠集齐了！神龙出现了！说出你的愿望吧！");
    var box = $("wishes");
    box.style.gridTemplateColumns = "1fr 1fr 1fr";
    wishes.forEach(function (w) {
      box.appendChild(btn(w.label, function () {
        var msg = w.fn();
        pr.wishes++; saveStore();
        confetti(30); toast("✨ " + msg);
        o.innerHTML = '<div class="dragon" style="animation:none;transform:translate(-50%,-60%) scale(1)">🐉</div><div class="wishtitle" style="margin-top:220px">愿望实现了！</div><div class="stickers">' + esc(msg) + "</div>";
        setTimeout(function () { closeOverlay(); after(); }, 1800);
      }, { cls: "yellow" }));
    });
  }
  function showSummary(s) {
    var pr = s.pr;
    screen = "summary";
    hideQuiz(); showScene(true); renderHUD();
    var stars = s.first >= 6 ? "⭐⭐⭐" : s.first >= 4 ? "⭐⭐" : "⭐";
    var html = '<div class="big">' + stars + " 这一关完成啦！</div>一次就答对：" + s.first + " / " + SESSION_LEN;
    if (s.newChars.length) html += "\n🆕 新学的字：" + s.newChars.join(" ");
    if (s.missed.length) html += "\n🔁 下次再练：" + s.missed.join(" ") + "（会自动安排复习）";
    if (s.advanced) html += "\n🚀 进阶！解锁了新的字，现在共 " + unlockedChars(pr).length + " 个字";
    if (pr.dayStreak > 1) html += "\n🔥 连续 " + pr.dayStreak + " 天修炼！";
    var newBooks = pr.mode === "little" ? [] : newlyUnlockedStories(pr);
    if (newBooks.length) { html += "\n📚 新故事解锁：" + newBooks.map(function (st) { return st.icon + st.title; }).join("、"); saveStore(); }
    setStory(html);
    clearMenu();
    if (newBooks.length) addBtn("📚 去读新故事！", renderShelf, { cls: "yellow" });
    addBtn("⚡ 再来一关", startSession, { cls: "primary" });
    addBtn(pr.mode === "little" ? "🏠" : "🏠 回主页", goHome, { cls: "blue" });
    if (s.advanced) { confetti(30); SFX.level(); }
    scrollTop();
  }

  /* ═══════════════ 对战画面（故事比赛 / 双人共用） ═══════════════ */
  var lastPicked = null;
  function pickOneChar(pr) {
    var list = unlockedChars(pr), t = now();
    var pool = list.length > 1 ? list.filter(function (c) { return c !== lastPicked; }) : list;
    var due = pool.filter(function (c) { var r = pr.srs[c]; return r && r.seen && r.due <= t; });
    var fresh = pool.filter(function (c) { return !(pr.srs[c] && pr.srs[c].seen); });
    var c, x = Math.random();
    if (due.length && x < 0.5) c = pick(due);
    else if (fresh.length && x < 0.8) c = fresh[0];   // 按学习顺序引入新字
    else c = pick(pool);
    lastPicked = c;
    return c;
  }

  function arenaHTML(leftAva, leftName, leftPct, foe, foePct) {
    return '<div class="panel arena"><div class="fighter"><span class="em aura" id="meEm">' + leftAva + '</span><div class="nm">' + esc(leftName) + '</div><div class="bar"><span class="hp" style="width:' + leftPct + '%"></span></div></div>' +
      '<div class="vs">VS</div><div class="fighter"><span class="em" id="foeEm">' + (foe.html || esc(foe.emoji)) + '</span><div class="nm">' + esc(foe.name) + '</div><div class="bar"><span class="hp" style="width:' + foePct + '%"></span></div></div></div>';
  }
  /* ═══════════════ 双人：同心协力 ═══════════════ */
  var duo = null;
  function chooseDuo() {
    var ps = store.profiles;
    if (ps.length === 2) return startDuo(ps[0], ps[1]);
    useProfile(null); hideQuiz(); showScene(true);     setStory("🤝 选两位小侠客一起打魔王：<br><small>Pick any two players.</small>");
    clearMenu();
    var chosen = [];
    ps.forEach(function (pr) {
      var b = addBtn(avatarHTML(pr.avatar, 44) + " " + esc(pr.name), function () {
        if (chosen.indexOf(pr) !== -1) return;
        chosen.push(pr); b.disabled = true;
        if (chosen.length === 2) startDuo(chosen[0], chosen[1]);
      }, { cls: "blue" });
    });
    addBtn("↩️ 返回", renderTitle, { cls: "small" });
  }
  function startDuo(a, b) {
    var boss = pick(DUO_BOSSES);
    duo = { players: [a, b], turn: 0, boss: { name: boss.name, emoji: boss.emoji }, hp: 10, max: 10, turns: 0 };
    useProfile(a);
    screen = "duo"; $("logo").classList.add("hidden");
    TTS.say("同心协力，一起打败" + boss.name + "！");
    duoTurn();
  }
  function duoTurn() {
    if (!duo) return renderTitle();
    var pr = duo.players[duo.turn];
    useProfile(pr); renderHUD();
    var q = maybeExtra(pr), c = q ? null : pickOneChar(pr);
    if (!q) q = makeQuestion(pr, c);
    var other = duo.players[1 - duo.turn];
    var header = '<div class="turnbar" style="background:' + pr.color + '">轮到 ' + avatarHTML(pr.avatar, 40) + " " + esc(pr.name) + (AVATAR_INFO[pr.avatar] ? "（" + esc(AVATAR_INFO[pr.avatar].label) + "）" : "") + "！</div>" +
      arenaHTML('<span class="duoava cur">' + avatarHTML(pr.avatar, 66) + '</span><span class="duoava">' + avatarHTML(other.avatar, 50) + "</span>", "同心协力", 100, duo.boss, duo.hp / duo.max * 100);
    showQuiz(q, {
      pr: pr, tag: "🤝 双人", header: header,
      menu: [["🏠 结束双人", function () { duo = null; renderTitle(); }, { cls: "small" }]],
      onDone: function (first) {
        if (q.kind) recordExtra(pr, q.kind, first); else recordResult(pr, c, first);
        gainExp(pr, first ? 6 : 2);
        var dmg = first ? 2 : 1;
        duo.hp = Math.max(0, duo.hp - dmg);
        fxBlast($("meEm"), $("foeEm"));
        saveStore();
        setTimeout(function () {
          if (!duo) return;
          if (duo.hp <= 0) return duoWin();
          duo.turn = 1 - duo.turn; duo.turns++;
          TTS.say("轮到" + duo.players[duo.turn].name + "了");
          duoTurn();
        }, 800);
      }
    });
  }
  function duoWin() {
    var d = duo; duo = null;
    SFX.win(); confetti(40);
    d.players.forEach(function (pr) {
      var st = pick(STICKERS); pr.stickers.push(st); gainExp(pr, 20); maybeAdvanceStage(pr);
    });
    saveStore(); screen = "duoWin";
    hideQuiz(); showScene(true); useProfile(null); renderHUD();
    setStory('<div class="big">🏆 二人同心，其利断金！</div>' + d.boss.emoji + esc(d.boss.name) + " 被打跑啦！\n两个人都得到了一张新贴纸和 20 经验。");
    clearMenu();
    addBtn("🤝 再打一个", function () { startDuo(d.players[0], d.players[1]); }, { cls: "primary" });
    addBtn("🏠 回选人页", renderTitle, { cls: "blue" });
  }

  /* ═══════════════ 龙珠故事模式（早期篇 · 原创改写的儿童版小场景） ═══════════════ */
  // 人物头像：全部是原创的简笔 Q 版致敬画像（SVG），不是官方图
  var PORTRAITS = {
    bulma: function () {
      return '<ellipse cx="50" cy="52" rx="32" ry="30" fill="#29b6c6" stroke="#141414" stroke-width="2.5"/>' + headBase("#ffe0c4", "#ff6fa8") +
        '<path d="M27 46 Q30 22 50 22 Q72 22 74 46 Q66 34 56 36 Q50 30 42 36 Q34 34 27 46Z" fill="#29b6c6" stroke="#141414" stroke-width="2"/>' +
        '<path d="M60 24 L72 16 L70 30 Z M60 24 L56 12 L68 18 Z" fill="#e3262f" stroke="#141414" stroke-width="1.5"/>' + eyes(48) + smile(true);
    },
    launch: function () {
      return '<ellipse cx="50" cy="54" rx="31" ry="30" fill="#2b3d8f" stroke="#141414" stroke-width="2.5"/>' + headBase("#ffe0c4", "#3f9b48") +
        '<path d="M27 46 Q28 22 50 22 Q72 22 73 46 Q64 32 50 34 Q36 32 27 46Z" fill="#2b3d8f" stroke="#141414" stroke-width="2"/>' +
        '<path d="M36 24 Q50 16 64 24" fill="none" stroke="#e3262f" stroke-width="5" stroke-linecap="round"/>' + eyes(48) + smile(false);
    }
  };
  var CAST = {
    narr: { name: "旁白", emoji: "📜" },
    goku: { name: "小悟空", svg: "goku" }, krillin: { name: "小库林", svg: "krillin" },
    bulma: { name: "布尔玛" }, yamcha: { name: "雅木查" }, roshi: { name: "龟仙人" },
    launch: { name: "蓝琪" }, chiaotzu: { name: "饺子" }, tien: { name: "天津饭" },
    // v7 新角色（只用 emoji，没有官方图片）
    oolong: { name: "乌龙", emoji: "🐷" }, puar: { name: "普尔", emoji: "🐱" }, oxking: { name: "牛魔王", emoji: "🐂" }, chichi: { name: "琪琪", emoji: "👧" },
    blue: { name: "布鲁将军", emoji: "🪖" }, tao: { name: "桃白白", emoji: "🥷" }, korin: { name: "卡林大人", emoji: "🐈" },
    demon: { name: "短笛大魔王", emoji: "😈" }, kami: { name: "天神", emoji: "👴" }, popo: { name: "波波先生", emoji: "🧞" },
    piccolo: { name: "短笛", emoji: "🟢" }, gohan: { name: "孙悟饭", emoji: "👦" }, raditz: { name: "拉蒂兹", emoji: "🦹" },
    kaio: { name: "界王", emoji: "🕶️" }, bubbles: { name: "泡泡", emoji: "🐒" }, gregory: { name: "格列格利", emoji: "🦗" },
    saibaman: { name: "栽培人", emoji: "🥬" }, nappa: { name: "那巴", emoji: "💪" }, vegeta: { name: "贝吉塔", emoji: "👑" },
    dende: { name: "丁迪", emoji: "🌱" }, elder: { name: "最长老", emoji: "🧓" }, nail: { name: "内鬼", emoji: "🛡️" },
    zarbon: { name: "撒保", emoji: "💎" }, dodoria: { name: "多多利亚", emoji: "🦛" }, frieza: { name: "弗利萨", emoji: "👾" },
    ginyu: { name: "基纽", emoji: "💜" }, jeice: { name: "吉斯", emoji: "🔥" }, burter: { name: "巴特", emoji: "💨" },
    recoome: { name: "利库姆", emoji: "🦍" }, guldo: { name: "古尔多", emoji: "🐸" }, porunga: { name: "波伦加", emoji: "🐲" }
  };
  function portraitHTML(key, size) {
    size = size || 80;
    if (AVATAR_INFO[key]) return avatarSVG(key, size);
    if (PORTRAITS[key]) return '<svg class="avsvg" width="' + size + '" height="' + size + '" viewBox="0 0 100 100" role="img" aria-label="' + CAST[key].name + '">' + PORTRAITS[key]() + "</svg>";
    var c = CAST[key];
    return '<span class="avemo" style="font-size:' + Math.round(size * 0.8) + 'px">' + (c ? c.emoji : key) + "</span>";
  }

  // 故事内容：照早期主线的顺序，用自己的话改写成很短的儿童版场景
  var STORY = [
    { title: "第一章 · 龙珠之旅", icon: "🔴", place: "深山小屋",
      intro: [["narr", "深山里住着一个有尾巴的男孩，他叫小悟空。"], ["bulma", "你好！我叫布尔玛，我在找七颗龙珠！"],
        ["goku", "我也有一颗！这是爷爷留给我的四星球。"], ["bulma", "集齐七颗龙珠，就能召唤神龙，实现一个愿望！"],
        ["narr", "他们一起出发了！答对汉字，就能抓住河里的大鱼当午饭。"]],
      matches: [{ name: "河里的大鱼", emoji: "🐟", hp: 6 }],
      outro: [["goku", "抓到啦！好大的鱼！"], ["bulma", "龙珠雷达亮了！下一颗在大沙漠。"]],
      reward: { exp: 30, sticker: "🔴" } },
    { title: "第二章 · 沙漠里的雅木查", icon: "🏜️", place: "大沙漠",
      intro: [["narr", "布尔玛和小悟空来到了热热的大沙漠。"], ["yamcha", "站住！我是沙漠里的雅木查！"],
        ["bulma", "他的动作好快呀……小悟空，加油！"], ["goku", "好，我们来比一比！"]],
      matches: [{ name: "雅木查", portrait: "yamcha", hp: 8 }],
      outro: [["yamcha", "你真厉害！我们交个朋友吧。"], ["narr", "雅木查也加入了找龙珠的队伍。"]],
      reward: { exp: 40, sticker: "🏜️" } },
    { title: "第三章 · 龟仙人的修行", icon: "🐢", place: "龟仙屋",
      intro: [["narr", "海边的小岛上有一座小房子，叫龟仙屋，住着武术老师龟仙人。"], ["roshi", "想变强吗？每天要练功，也要认真读书！"],
        ["krillin", "我是小库林，我也来拜师！"], ["launch", "我是蓝琪，我给大家做饭～ 阿……阿嚏！"],
        ["narr", "蓝琪一打喷嚏就会变样子！快去练功吧：背着龟壳去送牛奶！"]],
      matches: [{ name: "送牛奶修行", emoji: "🥛", hp: 8 }],
      outro: [["roshi", "很好！你们都进步了。送你们一套练功服！"], ["launch", "吃饭啦！练完功要多吃一点哦。"], ["roshi", "去参加天下第一武道会吧！"]],
      reward: { exp: 50, sticker: "🐢" } },
    { title: "第四章 · 武道会预选赛", icon: "🏟️", place: "天下第一武道会",
      intro: [["narr", "天下第一武道会开始啦！好多高手都来了。"], ["roshi", "先打赢预选赛，才能进正式比赛。"],
        ["krillin", "小悟空，我们一起加油！"]],
      matches: [{ name: "大力士选手", emoji: "💪", hp: 6 }, { name: "蒙面选手", emoji: "🥷", hp: 6 }],
      outro: [["narr", "预选赛通过！可以进正式比赛了！"], ["krillin", "太好了，我们都进去了！"]],
      reward: { exp: 60, sticker: "🏟️" } },
    { title: "第五章 · 对手饺子", icon: "🥟", place: "武道会擂台",
      intro: [["chiaotzu", "我是饺子，我会用超能力哦！"], ["tien", "饺子，别输给他们。"],
        ["krillin", "饺子好厉害，我们要冷静！"]],
      matches: [{ name: "饺子", portrait: "chiaotzu", hp: 8 }],
      outro: [["chiaotzu", "你们真强……下次我还要比！"], ["narr", "下一场就是决赛了！"]],
      reward: { exp: 70, sticker: "🥟" } },
    { title: "第六章 · 决赛：天津饭", icon: "🏆", place: "武道会决赛",
      intro: [["narr", "决赛到了！对手是有三只眼睛的天津饭。"], ["tien", "我练了很久很久，我不会输！"],
        ["goku", "我也会用尽全力！"], ["roshi", "记住：认真、冷静、不放弃！"]],
      matches: [{ name: "天津饭", portrait: "tien", hp: 10 }],
      outro: [["tien", "你赢了……原来练武不只是为了赢。"], ["goku", "我们做朋友吧！"], ["narr", "大家成了好朋友！早期篇完结，恭喜你！"]],
      reward: { exp: 100, sticker: "🏆" } },
    // ── v7：少年篇 · 红缎带军 · 短笛大魔王 · 赛亚人篇 · 那美克星篇（原创儿童版改写；need = 认识多少字才解锁）──
    { title: "第七章 · 乌龙、普尔和火焰山", icon: "🔥", place: "火焰山", need: 60, arc: "少年篇",
      intro: [["narr", "小悟空想起了以前找龙珠的路上，认识的好朋友。"], ["oolong", "我是乌龙，我会变身！可是只能变五分钟。"],
        ["puar", "我是普尔，我也会变身！我是雅木查的好朋友。"], ["chichi", "我叫琪琪，我爸爸是牛魔王。"],
        ["oxking", "我的城堡被大火包住了，我进不去！"], ["goku", "别担心，我去找龟仙人帮忙！"],
        ["narr", "答对汉字，帮小悟空一起把火灭掉！"]],
      matches: [{ name: "火焰山的大火", emoji: "🔥", hp: 8 }],
      outro: [["roshi", "看我的龟派气功！"], ["oxking", "火灭了！谢谢你们！"], ["chichi", "小悟空，我长大了要嫁给你！"],
        ["goku", "嫁？那是什么？好吃吗？"], ["oolong", "哈哈哈，小悟空什么都不懂！"]],
      reward: { exp: 100, sticker: "🔥" } },
    { title: "第八章 · 红缎带军来了", icon: "🎖️", place: "北边的雪山", need: 80, arc: "红缎带军篇",
      intro: [["narr", "武道会以后，小悟空一个人去找爷爷的四星球。"], ["narr", "有一个很大的坏军队，叫红缎带军，他们也想要龙珠。"],
        ["blue", "我是红缎带军的布鲁将军！龙珠是我们的！"], ["goku", "不行！龙珠不能给坏人！"],
        ["narr", "小悟空在雪山里认识了好心的小女孩，她给了小悟空热汤。"], ["goku", "谢谢你！我一定会打败红缎带军！"]],
      matches: [{ name: "红缎带军的士兵", emoji: "🪖", hp: 8 }, { name: "布鲁将军", portrait: "blue", hp: 8 }],
      outro: [["blue", "这个孩子太强了……我输了！"], ["krillin", "小悟空，我来帮你啦！"], ["goku", "小库林！有朋友在，真好！"]],
      reward: { exp: 110, sticker: "🎖️" } },
    { title: "第九章 · 卡林塔和仙豆", icon: "🫘", place: "卡林塔", need: 100, arc: "红缎带军篇",
      intro: [["tao", "我是杀手桃白白，红缎带军请我来打你！"], ["narr", "桃白白很强，小悟空被打败了。"],
        ["goku", "我不放弃！我要变得更强！"], ["narr", "小悟空爬上了很高很高的卡林塔。"],
        ["korin", "我是卡林大人。想喝我的超神水，要先从我手里拿到它。"], ["goku", "我每天都来练！"],
        ["korin", "好孩子，送你仙豆。吃一颗，伤就好了，肚子也饱了。"]],
      matches: [{ name: "卡林大人的修行", portrait: "korin", hp: 9 }],
      outro: [["goku", "拿到了！我觉得身体变轻了！"], ["korin", "你的速度快了很多。下去吧！"], ["tao", "什么？你又回来了？"],
        ["goku", "这次我不会输！"]],
      reward: { exp: 120, sticker: "🫘" } },
    { title: "第十章 · 打败红缎带军", icon: "⭐", place: "红缎带军基地", need: 120, arc: "红缎带军篇",
      intro: [["narr", "小悟空打败了桃白白，一个人来到红缎带军的大基地。"], ["goku", "我来拿回龙珠！"],
        ["bulma", "小悟空，我们也来了！"], ["yamcha", "我和普尔、乌龙一起来帮你！"], ["puar", "加油！加油！"],
        ["narr", "答对汉字，打开基地的大门！"]],
      matches: [{ name: "大机器人", emoji: "🤖", hp: 9 }, { name: "基地的大门", emoji: "🚪", hp: 6 }],
      outro: [["narr", "红缎带军被打败了，再也不能做坏事了！"], ["goku", "龙珠找回来了！"], ["bulma", "大家一起努力，什么都能做到！"]],
      reward: { exp: 130, sticker: "⭐" } },
    { title: "第十一章 · 短笛大魔王", icon: "😈", place: "武道会的会场", need: 140, arc: "短笛大魔王篇",
      intro: [["narr", "第22届武道会以后，出了一个很坏的大魔王，叫短笛大魔王。"], ["demon", "我要让全世界都怕我！"],
        ["narr", "小库林受了重伤，大家都很难过。"], ["goku", "小库林……我一定要打败大魔王！"],
        ["korin", "吃一颗仙豆吧。还要喝超神水，你会变得更强。"], ["tien", "小悟空，我和饺子也来帮你！"], ["chiaotzu", "我们是朋友！"]],
      matches: [{ name: "大魔王的手下", emoji: "🦇", hp: 8 }, { name: "短笛大魔王", portrait: "demon", hp: 10 }],
      outro: [["goku", "打败你了！世界平安了！"], ["narr", "大家用神龙的愿望，让小库林好起来了！"], ["krillin", "谢谢你，小悟空！"],
        ["goku", "朋友有危险，我一定来！"]],
      reward: { exp: 140, sticker: "😈" } },
    { title: "第十二章 · 天上的神殿", icon: "🏛️", place: "天神的神殿", need: 160, arc: "短笛大魔王篇",
      intro: [["narr", "卡林塔的上面，还有一座在云上的神殿。"], ["popo", "我是波波先生。欢迎你，小悟空。"],
        ["kami", "我是地球的天神。神龙也是我做出来的。"], ["kami", "大魔王留下了一个孩子，他也叫短笛。三年后他会来武道会。"],
        ["goku", "那我就在这里修炼三年！"], ["popo", "先学会安静。打扫神殿，也是修炼。"], ["narr", "小悟空每天都认真练习，长高了，也变强了。"]],
      matches: [{ name: "波波先生的考验", portrait: "popo", hp: 10 }],
      outro: [["popo", "你的心很安静了。"], ["kami", "去吧，武道会快开始了。"], ["goku", "谢谢天神，谢谢波波先生！"]],
      reward: { exp: 150, sticker: "🏛️" } },
    { title: "第十三章 · 第23届武道会：琪琪", icon: "💍", place: "第23届天下第一武道会", need: 180, arc: "短笛大魔王篇",
      intro: [["narr", "三年过去了，小悟空长成了大哥哥。"], ["krillin", "小悟空，你长得好高呀！"],
        ["chichi", "你还记得我吗？我是琪琪！你说过要娶我的！"], ["goku", "啊？我说过吗？"],
        ["chichi", "那我们比一比！你赢了，就要娶我！"], ["goku", "好，我们来比！"], ["narr", "答对汉字，和琪琪好好比一场！"]],
      matches: [{ name: "琪琪", portrait: "chichi", hp: 10 }],
      outro: [["goku", "我想起来了，在火焰山，我们见过！"], ["goku", "好，我们结婚吧！"], ["chichi", "太好了！"],
        ["oxking", "我的女儿要结婚啦，哈哈哈！"]],
      reward: { exp: 160, sticker: "💍" } },
    { title: "第十四章 · 决赛：短笛", icon: "🟢", place: "武道会决赛", need: 200, arc: "短笛大魔王篇",
      intro: [["narr", "决赛的对手是短笛。他是大魔王的孩子。"], ["piccolo", "孙悟空，我今天要打败你！"],
        ["goku", "我不会让你做坏事！"], ["kami", "小心，他会伸长手臂，还会变大！"], ["roshi", "悟空，用你学过的一切！"],
        ["narr", "这是很难的一场比赛，答对汉字，就能出招！"]],
      matches: [{ name: "短笛", portrait: "piccolo", hp: 11 }],
      outro: [["piccolo", "我……输了。"], ["goku", "给他一颗仙豆吧。"], ["krillin", "什么？你要帮他？"],
        ["goku", "我想以后再和他比一次！"], ["narr", "孙悟空第一次拿到了天下第一！"]],
      reward: { exp: 170, sticker: "🟢" } },
    { title: "第十五章 · 悟饭和拉蒂兹", icon: "👦", place: "龟仙屋", need: 230, arc: "赛亚人篇",
      intro: [["narr", "几年以后，悟空和琪琪有了一个儿子，叫孙悟饭。"], ["gohan", "大家好，我是悟饭，我四岁了！"],
        ["bulma", "悟饭好可爱！"], ["narr", "天上突然飞来一个长头发的人。"], ["raditz", "我是拉蒂兹，是你的哥哥！我们是赛亚人！"],
        ["goku", "我的哥哥？我是从别的星球来的？"], ["raditz", "跟我走，不然我就带走你的儿子！"], ["piccolo", "孙悟空，这一次我们一起打！"]],
      matches: [{ name: "拉蒂兹", portrait: "raditz", hp: 11 }],
      outro: [["gohan", "不许欺负我爸爸！"], ["narr", "悟饭很生气，突然变得好强！"], ["narr", "拉蒂兹被打败了，可是悟空也受了重伤。"],
        ["raditz", "还有两个更强的赛亚人，一年后就到……"], ["kami", "悟空，来天上吧。我带你去见界王。"]],
      reward: { exp: 180, sticker: "👦" } },
    { title: "第十六章 · 荒野里的悟饭", icon: "🏜️", place: "荒野", need: 260, arc: "赛亚人篇",
      intro: [["piccolo", "悟饭，你身上有很大的力量。我来教你。"], ["gohan", "我想要妈妈……"],
        ["piccolo", "一个人在荒野里活半年。要勇敢！"], ["narr", "悟饭一个人找吃的，晚上看着月亮。"],
        ["gohan", "我不哭了，我要像爸爸一样强！"], ["narr", "短笛每天教悟饭练功，有时候还给他做衣服。"]],
      matches: [{ name: "荒野里的大恐龙", emoji: "🦖", hp: 10 }, { name: "短笛的修行", portrait: "piccolo", hp: 8 }],
      outro: [["piccolo", "很好，你进步了。"], ["gohan", "谢谢短笛先生！"], ["narr", "短笛的心，也一点一点变温暖了。"]],
      reward: { exp: 190, sticker: "🏜️" } },
    { title: "第十七章 · 界王星的修行", icon: "🪐", place: "界王星", need: 290, arc: "赛亚人篇",
      intro: [["narr", "悟空在长长的蛇道上跑了很多天，到了小小的界王星。"], ["kaio", "我是北界王！先让我笑一下，我才教你。"],
        ["goku", "嗯……界王，界王，走路要小心，别掉下去！"], ["kaio", "哈哈哈！好吧，我教你！"],
        ["kaio", "第一个修行：抓住猴子泡泡。"], ["bubbles", "呜嗯呜嗯！"], ["kaio", "第二个修行：用锤子打到蝗虫格列格利。"],
        ["gregory", "来呀，打不到我！"]],
      matches: [{ name: "抓泡泡", portrait: "bubbles", hp: 8 }, { name: "打格列格利", portrait: "gregory", hp: 8 }],
      outro: [["kaio", "你学会了！我教你界王拳和元气弹。"], ["kaio", "元气弹要大家一点一点的元气，合起来才最强。"],
        ["goku", "大家的力量一起，好厉害！"], ["kaio", "快回地球！赛亚人到了！"]],
      reward: { exp: 200, sticker: "🪐" } },
    { title: "第十八章 · 栽培人来了", icon: "🌱", place: "地球的荒原", need: 320, arc: "赛亚人篇",
      intro: [["nappa", "我是那巴！我们种几个栽培人玩一玩。"], ["vegeta", "我是赛亚人的王子贝吉塔。"],
        ["narr", "地上长出了六个绿色的栽培人。"], ["tien", "大家小心！"], ["yamcha", "我来打第一个！"],
        ["narr", "雅木查受了重伤。饺子和天津饭也被打败了。"], ["krillin", "我不会让朋友白白受伤！"], ["gohan", "我也要战斗！"]],
      matches: [{ name: "栽培人", portrait: "saibaman", hp: 6 }, { name: "栽培人", portrait: "saibaman", hp: 6 }, { name: "那巴", portrait: "nappa", hp: 10 }],
      outro: [["piccolo", "悟饭，快躲开！"], ["narr", "短笛保护了悟饭，自己受了重伤。"], ["gohan", "短笛先生！"],
        ["goku", "我来了！大家辛苦了！"], ["narr", "悟空终于回到了地球！"]],
      reward: { exp: 210, sticker: "🌱" } },
    { title: "第十九章 · 界王拳！贝吉塔", icon: "👑", place: "地球的荒原", need: 350, arc: "赛亚人篇",
      intro: [["goku", "吃一颗仙豆吧，小库林、悟饭。"], ["vegeta", "下级战士，你打不过我！"],
        ["goku", "界王拳！两倍！三倍！"], ["vegeta", "什么？他变快了！"], ["narr", "贝吉塔变成了大猩猩，非常强大。"],
        ["krillin", "我们一起用元气弹！"], ["gohan", "爸爸，我来帮你！"]],
      matches: [{ name: "贝吉塔", portrait: "vegeta", hp: 12 }],
      outro: [["vegeta", "我会回来的……"], ["narr", "贝吉塔坐着小飞船走了。"], ["bulma", "地球的龙珠没有了，因为天神和短笛是一体的。"],
        ["krillin", "在那美克星上，还有那美克星的龙珠！"], ["bulma", "那我们坐宇宙飞船去那美克星！"]],
      reward: { exp: 220, sticker: "👑" } },
    { title: "第二十章 · 飞往那美克星", icon: "🚀", place: "宇宙飞船", need: 380, arc: "那美克星篇",
      intro: [["bulma", "这是天神的宇宙飞船，我会开！"], ["chichi", "悟饭，在飞船上也要读书哦！"],
        ["gohan", "好的，妈妈！"], ["krillin", "我们要飞一个月！"], ["narr", "宇宙好大，有很多星星。"],
        ["bulma", "大家坐好，飞船要穿过小石头了！"], ["narr", "答对汉字，开着飞船躲开太空里的大石头！"]],
      matches: [{ name: "太空里的大石头", emoji: "☄️", hp: 9 }],
      outro: [["narr", "他们到了绿色的那美克星！"], ["gohan", "天空是绿色的！"], ["bulma", "龙珠雷达有反应了！"],
        ["krillin", "可是这里有好多坏人……"]],
      reward: { exp: 230, sticker: "🚀" } },
    { title: "第二十一章 · 丁迪和最长老", icon: "🧓", place: "那美克星的村子", need: 410, arc: "那美克星篇",
      intro: [["narr", "宇宙里最坏的弗利萨也来了，他也想要龙珠。"], ["dodoria", "我是多多利亚！把龙珠交出来！"],
        ["dende", "救救我！"], ["gohan", "别怕！我们来保护你！"], ["dende", "我叫丁迪，是那美克星人。"],
        ["zarbon", "我是撒保，你们跑不掉的！"], ["krillin", "悟饭，带上丁迪，快飞！"]],
      matches: [{ name: "多多利亚", portrait: "dodoria", hp: 10 }, { name: "撒保", portrait: "zarbon", hp: 10 }],
      outro: [["dende", "我带你们去见最长老。"], ["elder", "你们是好孩子。我来帮你们打开潜力。"],
        ["krillin", "我觉得身体里有好多力量！"], ["gohan", "谢谢最长老！"]],
      reward: { exp: 240, sticker: "🧓" } },
    { title: "第二十二章 · 基纽特战队", icon: "💜", place: "那美克星的草原", need: 440, arc: "那美克星篇",
      intro: [["ginyu", "我们是——基纽特战队！"], ["jeice", "我是吉斯！"], ["burter", "我是巴特，宇宙里我跑得最快！"],
        ["recoome", "我是利库姆！"], ["guldo", "我是古尔多，我能让时间停下来！"], ["vegeta", "不好，他们很强！"],
        ["gohan", "我和库林叔叔一起打！"]],
      matches: [{ name: "古尔多", portrait: "guldo", hp: 6 }, { name: "利库姆", portrait: "recoome", hp: 7 },
        { name: "巴特和吉斯", portrait: "burter", hp: 7 }, { name: "基纽队长", portrait: "ginyu", hp: 8 }],
      outro: [["goku", "我来了！我在飞船上练了一百倍的重力！"], ["ginyu", "什么？这么强？"], ["narr", "悟空打败了基纽特战队！"],
        ["gohan", "爸爸好厉害！"]],
      reward: { exp: 260, sticker: "💜" } },
    { title: "第二十三章 · 神龙波伦加", icon: "🐲", place: "那美克星", need: 470, arc: "那美克星篇",
      intro: [["dende", "七颗那美克星的龙珠都在这里了！"], ["dende", "要说那美克星的话，我来说！"],
        ["porunga", "我是那美克星的神龙波伦加。我可以实现三个愿望！"], ["krillin", "第一个愿望：让受伤的朋友好起来！"],
        ["nail", "我是内鬼，最长老让我保护龙珠。"], ["frieza", "我是弗利萨。龙珠是我的！"], ["nail", "你们快走，我来挡住他！"]],
      matches: [{ name: "弗利萨的冲击波", emoji: "💥", hp: 10 }],
      outro: [["narr", "内鬼受了重伤，短笛来了，和内鬼合为一体。"], ["piccolo", "我现在更强了！悟饭，我来保护你！"],
        ["gohan", "短笛先生！"]],
      reward: { exp: 280, sticker: "🐲" } },
    { title: "第二十四章 · 超级赛亚人！", icon: "⚡", place: "那美克星", need: 500, arc: "那美克星篇",
      intro: [["frieza", "你们都打不过我！"], ["narr", "大家都受了重伤，小库林也被打败了。"],
        ["goku", "小库林！"], ["narr", "悟空非常生气，他的头发变成了金色！"], ["goku", "我是为了保护朋友，而变强的超级赛亚人！"],
        ["frieza", "怎么可能！"], ["gohan", "爸爸，加油！"], ["narr", "答对汉字，帮超级赛亚人悟空出招！"]],
      matches: [{ name: "弗利萨", portrait: "frieza", hp: 12 }, { name: "最后的弗利萨", portrait: "frieza", hp: 12 }],
      outro: [["frieza", "我……输了……"], ["goku", "不要再做坏事了！"], ["narr", "那美克星快要爆炸了！"],
        ["goku", "大家先坐飞船走，我也会回来的！"]],
      reward: { exp: 300, sticker: "⚡" } },
    { title: "第二十五章 · 大家回到地球", icon: "🌏", place: "地球 · 布尔玛家", need: 520, arc: "那美克星篇",
      intro: [["bulma", "大家都平安回到地球了！"], ["dende", "我是新的那美克星人朋友，谢谢地球的大家！"],
        ["popo", "用龙珠吧，让受伤的朋友都回来。"], ["porunga", "说出你们的愿望吧。"], ["krillin", "让大家都回到我们身边！"],
        ["narr", "雅木查、天津饭、饺子、小库林，都回来了！"], ["narr", "答对汉字，帮神龙实现最后的愿望！"]],
      matches: [{ name: "神龙的愿望", portrait: "porunga", hp: 8 }],
      outro: [["goku", "大家好！我回来啦！"], ["gohan", "爸爸！"], ["chichi", "悟饭，现在可以好好读书了吧！"],
        ["roshi", "好朋友，好好练功，好好读书，这就是最强的力量！"], ["narr", "那美克星篇完结！恭喜你，小侠客！"]],
      reward: { exp: 400, sticker: "🌏" } }
  ];

  var story = null;
  function storyProgress(pr) { return pr.story || 0; }
  /** v7：新章节要认识足够多的字才打开（启蒙模式减半）；1–6 章没有字数要求 */
  function chapterNeed(ch) { var n = ch.need || 0; return prof && prof.mode === "little" ? Math.round(n / 2) : n; }
  function renderStoryMap() {
    screen = "storyMap"; story = null;
    hideQuiz(); showScene(true); renderHUD();
    $("logo").classList.add("hidden");
    var done = storyProgress(prof);
    setStory('<div class="big">📖 龙珠故事</div>跟着小悟空和朋友们去冒险：天下第一武道会、红缎带军、短笛大魔王、赛亚人，一直到那美克星！\n<small>' + (prof.mode === "little" ? "故事会读出来；比赛靠答对汉字。" : "先自己读，不会的字点一下；比赛靠答对汉字。") + '</small>');
    clearMenu();
    var lc = learnedCount(prof), lastArc = "";
    STORY.forEach(function (ch, i) {
      var arc = ch.arc || "早期篇";
      if (arc !== lastArc && (i <= done + 1 || i < 6)) { $("menu").appendChild(el("div", "arc-head", "— " + esc(arc) + " —")); }
      lastArc = arc;
      if (i > done + 1 && i >= 6) return;            // 新章节只显示到下一章，后面的保持神秘
      var needMore = chapterNeed(ch) > lc;
      var locked = i > done || needMore;
      var label = (i < done ? "✅ " : locked ? "🔒 " : "▶️ ") + ch.icon + " " + ch.title + (i === done && needMore ? '<small style="display:block">再认识 ' + (chapterNeed(ch) - lc) + " 个字就能打开（现在 " + lc + " / " + chapterNeed(ch) + "）</small>" : "");
      addBtn(label, function () { playChapter(i); }, { cls: i === done && !needMore ? "primary" : locked ? "" : "yellow", disabled: locked });
    });
    if (Math.max(done + 1, 5) + 1 < STORY.length) $("menu").appendChild(el("div", "arc-head", "还有 " + (STORY.length - Math.max(done + 1, 5) - 1) + " 章在后面等着你…"));
    addBtn(prof.mode === "little" ? "🏠" : "🏠 回主页", goHome, { cls: "blue small" });
    TTS.say("龙珠故事");
    scrollTop();
  }
  function playChapter(i) {
    story = { i: i, ch: STORY[i], phase: "intro", scene: 0, match: 0 };
    screen = "story";
    storyStep();
  }
  function storyStep() {
    if (!story) return renderStoryMap();
    var ch = story.ch;
    var list = story.phase === "intro" ? ch.intro : story.phase === "outro" ? ch.outro : null;
    if (list && story.scene < list.length) return showStoryScene(list[story.scene]);
    if (story.phase === "intro") { story.phase = "match"; story.scene = 0; return startStoryMatch(); }
    if (story.phase === "outro") return finishChapter();
  }
  function plainText(t) { return t.replace(/[～…]/g, "，"); }
  function showStoryScene(sc) {
    var who = CAST[sc[0]] || CAST.narr, text = sc[1];
    var selfRead = prof.mode !== "little";   // v5：侠客模式先自己读、点字求助；启蒙模式照旧朗读
    hideQuiz(); showScene(true); renderHUD();
    setStory('<div class="storyhead">' + esc(story.ch.icon + " " + story.ch.title) + " · " + esc(story.ch.place) + "</div>" +
      '<div class="bubble"><div class="spk">' + portraitHTML(sc[0], 96) + '<div class="spkname">' + esc(who.name) + "</div></div>" +
      '<div class="say">' + (selfRead ? readLineHTML(text, learnedSet(prof), 0) : esc(text)) + "</div></div>" + (selfRead ? '<div class="rtip">👆 先自己读，不会的字点一下</div>' : ""));
    clearMenu();
    var tm = [];
    addBtn('<span style="font-size:1.8rem">👉</span> 继续', function () { tm.forEach(clearTimeout); story.scene++; storyStep(); }, { cls: "primary" });
    if (selfRead) { bindReading($("story"), prof); tm = armLineHelp($("story"), [text]); }
    else addBtn("🔊 再听一次", function () { TTS.say(plainText(text), 0.7); }, { cls: "small blue" });
    addBtn("⏸ 回故事目录", function () { tm.forEach(clearTimeout); renderStoryMap(); }, { cls: "small" });
    if (!selfRead) setTimeout(function () { TTS.say(plainText(text), 0.7); }, 200);
    scrollTop();
  }
  function startStoryMatch() {
    var m = story.ch.matches[story.match];
    story.foe = { name: m.name, emoji: m.emoji || "", html: m.portrait ? portraitHTML(m.portrait, 72) : null, hp: m.hp * 2, max: m.hp * 2 };
    TTS.say((m.portrait ? "对手：" : "挑战：") + m.name + "！答对汉字就能出招！");
    storyTurn();
  }
  function storyTurn() {
    if (!story) return;
    var f = story.foe, ch = story.ch;
    var clueTurn = !f.clued && clueEligible(prof); f.clued = true;
    var q = clueTurn ? makeClue(prof) : maybeExtra(prof), c = q ? null : pickOneChar(prof);
    if (!q) q = makeQuestion(prof, c);
    var tag = clueTurn ? "📡 先找到龙珠才能出招！" : ch.matches.length > 1 ? "第 " + (story.match + 1) + " 场 / " + ch.matches.length : "📖 " + ch.title.split(" · ")[0];
    showQuiz(q, {
      pr: prof, tag: tag, header: arenaHTML(avatarHTML(prof.avatar, 72), prof.name, 100, f, f.hp / f.max * 100),
      menu: [["⏸ 回故事目录", renderStoryMap, { cls: "small" }]],
      onDone: function (first) {
        if (q.kind === "clue") { if (first) prof.extra.clue = (prof.extra.clue || 0) + 1; } else if (q.kind) recordExtra(prof, q.kind, first); else recordResult(prof, c, first);
        gainExp(prof, first ? 6 : 2);
        f.hp = Math.max(0, f.hp - (first ? 2 : 1));
        fxBlast($("meEm"), $("foeEm"));
        addLog("💥 " + (first ? "气功波命中！" : "打中了！") + f.name, "win");
        saveStore();
        setTimeout(function () {
          if (!story) return;
          if (f.hp > 0) return storyTurn();
          SFX.win(); confetti(20);
          toast("🏆 打赢了 " + f.name + "！");
          story.match++;
          if (story.match < ch.matches.length) {
            setTimeout(startStoryMatch, 900);
          } else { story.phase = "outro"; story.scene = 0; setTimeout(storyStep, 900); }
        }, 750);
      }
    });
  }
  function finishChapter() {
    var i = story.i, ch = story.ch, r = ch.reward, first = storyProgress(prof) <= i;
    if (first) {
      prof.story = i + 1;
      gainExp(prof, r.exp); prof.stickers.push(r.sticker);
    } else gainExp(prof, 10);
    maybeAdvanceStage(prof);
    saveStore(); story = null; screen = "storyDone";
    hideQuiz(); showScene(true); renderHUD(); confetti(36); SFX.level();
    var html = '<div class="big">🎉 ' + esc(ch.title) + " 完成！</div>";
    html += first ? "奖励：+" + r.exp + " 经验 · 贴纸 " + r.sticker : "复习通关 +10 经验";
    if (i === 5) html += "\n\n🏆 早期篇全部通关！你真是天下第一的小侠客！";
    if (i + 1 >= STORY.length) html += "\n\n🏆 龙珠故事到那美克星篇全部通关！你是超级小侠客！";
    setStory(html);
    TTS.say(ch.title.split(" · ")[1] + "，完成！");
    clearMenu();
    if (i + 1 < STORY.length) { var nd = chapterNeed(STORY[i + 1]); if (learnedCount(prof) >= nd) addBtn("▶️ 下一章：" + STORY[i + 1].title, function () { playChapter(i + 1); }, { cls: "primary" }); else { setStory(html + "\n\n🔒 下一章「" + esc(STORY[i + 1].title) + "」：再认识 " + (nd - learnedCount(prof)) + " 个字就能打开，去修炼吧！"); addBtn("⚡ 去修炼认字", function () { startSession(); }, { cls: "primary" }); } }
    addBtn("📖 故事目录", renderStoryMap, { cls: "blue" });
    addBtn(prof.mode === "little" ? "🏠" : "🏠 回主页", goHome, { cls: "small" });
  }

  /* ═══════════════ 存档 / 读档（导出存档码、导入、每人 3 个手动存档位） ═══════════════ */
  var SAVE_PREFIX = "XKSAVE1:";
  var SLOT_KEY = "xiaoke_v4_slots_";     // + 玩家 id → [存档1, 存档2, 存档3]
  function b64encode(str) { return global.btoa(unescape(encodeURIComponent(str))); }
  function b64decode(b64) { return decodeURIComponent(escape(global.atob(b64.replace(/\s+/g, "")))); }
  function fmtTime(t) {
    var d = new Date(t), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function savePayload(list) { return { app: "xiaoke-hanzi-dragonball", v: 1, at: now(), profiles: list.map(clone) }; }
  function makeSaveCode(list) { return SAVE_PREFIX + b64encode(JSON.stringify(savePayload(list))); }

  /** 读入存档码 / JSON 文件内容，返回校验过的玩家数组；格式不对就抛出错误 */
  function parseSave(text) {
    text = String(text || "").trim();
    if (!text) throw new Error("存档是空的");
    var obj = null;
    if (text.indexOf(SAVE_PREFIX) === 0) text = text.slice(SAVE_PREFIX.length);
    if (text.charAt(0) === "{") obj = JSON.parse(text);
    else { try { obj = JSON.parse(b64decode(text)); } catch (e) { throw new Error("看不懂这个存档码"); } }
    var list = obj && Array.isArray(obj.profiles) ? obj.profiles : (obj && obj.name && obj.srs ? [obj] : null);
    if (!list || !list.length) throw new Error("存档里没有玩家");
    return list.map(function (p) {
      if (!p || typeof p.name !== "string" || !p.name.trim()) throw new Error("存档里的玩家没有名字");
      if (p.mode !== "hero" && p.mode !== "little") throw new Error("存档里的模式不对");
      if (p.srs && typeof p.srs !== "object") throw new Error("存档里的学习记录不对");
      var pr = clone(p);
      pr.name = pr.name.trim().slice(0, 12);
      if (!AVATAR_INFO[pr.avatar] && AVATARS.indexOf(pr.avatar) === -1) pr.avatar = "goku";
      if (!/^#[0-9a-f]{6}$/i.test(pr.color || "")) pr.color = COLORS[0];
      Object.keys(pr.srs || {}).forEach(function (c) { if (!BYC[c]) delete pr.srs[c]; });
      if (!pr.id) pr.id = "p" + now().toString(36) + Math.floor(Math.random() * 1e4);
      normalizeProfile(pr);
      return pr;
    });
  }
  /** 把导入的玩家放进存档：同 id 或同名的会先问是否覆盖 */
  function applyImport(list) {
    var added = 0, replaced = 0, skipped = 0;
    list.forEach(function (pr) {
      var old = store.profiles.filter(function (p) { return p.id === pr.id || p.name === pr.name; })[0];
      if (old) {
        if (!global.confirm("要用导入的存档覆盖「" + old.name + "」现在的进度吗？\n（覆盖后不能恢复）")) { skipped++; return; }
        pr.id = old.id;
        store.profiles[store.profiles.indexOf(old)] = pr;
        if (prof === old) useProfile(pr);
        replaced++;
      } else if (store.profiles.length < MAX_PROFILES) {
        store.profiles.push(pr); added++;
      } else { skipped++; }
    });
    saveStore();
    return { added: added, replaced: replaced, skipped: skipped };
  }

  function copyText(text, ta) {
    var fallback = function () {
      try {
        ta.removeAttribute("readonly"); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
        var ok = document.execCommand("copy"); ta.setAttribute("readonly", ""); ta.blur();
        toast(ok ? "📋 已复制" : "请长按文字框，选「全选 → 拷贝」");
      } catch (e) { toast("请长按文字框，选「全选 → 拷贝」"); }
    };
    if (global.navigator.clipboard && global.isSecureContext) {
      global.navigator.clipboard.writeText(text).then(function () { toast("📋 已复制"); }, fallback);
    } else fallback();
  }
  function downloadText(text, name, type) {
    try {
      var blob = new Blob([text], { type: type }), url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = name; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast("⬇️ 已下载 " + name);
    } catch (e) { toast("这个浏览器不能下载，请用「复制」"); }
  }

  /** ⚙️ → 💾 存档 / 读档 */
  function renderSaves() {
    if (!prof) return renderTitle();
    screen = "saves"; hideQuiz(); showScene(true); renderHUD(); clearMenu(); scrollTop();
    setStory('<div class="big">💾 存档 / 读档 · ' + esc(prof.name) + "</div>每答一题都会自动保存。这里可以另外存 3 个手动存档，或者导出存档码换到别的设备上玩。");
    var slots = loadSlots(prof);
    for (var i = 0; i < 3; i++) (function (i) {
      var s = slots[i], row = el("div", "slotrow");
      row.appendChild(el("div", "slotinfo", "存档" + (i + 1) + (s ? "<small>" + fmtTime(s.at) + " · " + (s.data.mode === "hero" ? "Lv." + s.data.player.level + " · " : "") +
        learnedCount(s.data) + " 字 · 故事 " + (s.data.story || 0) + " 章</small>" : "<small>（空）</small>")));
      var r = el("div", "row");
      r.appendChild(btn("💾 保存", function () {
        if (s && !global.confirm("存档" + (i + 1) + " 已经有内容，要覆盖吗？")) return;
        slots[i] = { at: now(), data: clone(prof) };
        if (writeSlots(prof, slots)) toast("💾 已存到存档" + (i + 1));
        renderSaves();
      }, { cls: "blue small" }));
      r.appendChild(btn("📂 读取", function () {
        if (!s) return toast("存档" + (i + 1) + " 是空的");
        if (!global.confirm("读取存档" + (i + 1) + "（" + fmtTime(s.at) + "）？\n现在的进度会被这个存档覆盖。")) return;
        var pr = clone(s.data); pr.id = prof.id; pr.name = prof.name; normalizeProfile(pr);
        store.profiles[store.profiles.indexOf(prof)] = pr; useProfile(pr); saveStore();
        toast("📂 已读取存档" + (i + 1)); renderSaves();
      }, { cls: "small", disabled: !s }));
      row.appendChild(r);
      $("menu").appendChild(row);
    })(i);
    addBtn("📤 导出存档（存档码 / 文件）", function () { renderExport(); }, { cls: "yellow" });
    addBtn("📥 导入存档", function () { renderImport(renderSaves); }, { cls: "yellow" });
    addBtn("↩️ 返回设置", renderSettings, { cls: "blue" });
  }
  function loadSlots(pr) {
    try { var a = JSON.parse(localStorage.getItem(SLOT_KEY + pr.id) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function writeSlots(pr, slots) {
    try { localStorage.setItem(SLOT_KEY + pr.id, JSON.stringify(slots)); return true; }
    catch (e) { toast("⚠️ 存档失败（浏览器存储已满或被禁用）"); return false; }
  }

  function renderExport(all) {
    screen = "export"; hideQuiz(); showScene(true); clearMenu(); scrollTop();
    var list = all || !prof ? store.profiles : [prof];
    var code = makeSaveCode(list);
    setStory('<div class="big">📤 导出存档</div>' + (list.length > 1 ? "全部 " + list.length + " 位玩家" : "玩家：" + esc(list[0].name)) +
      "\n把下面的存档码复制下来，或下载成文件，在别的设备上用「导入存档」读进去。");
    var ta = el("textarea", "savecode"); ta.readOnly = true; ta.value = code; ta.setAttribute("aria-label", "存档码");
    $("menu").appendChild(ta);
    addBtn("📋 复制存档码", function () { copyText(code, ta); }, { cls: "primary" });
    var day = fmtTime(now()).slice(0, 10);
    var r = el("div", "row");
    r.appendChild(btn("⬇️ 下载 .txt", function () { downloadText(code, "xiaoke-save-" + day + ".txt", "text/plain"); }, { cls: "blue small" }));
    r.appendChild(btn("⬇️ 下载 .json", function () { downloadText(JSON.stringify(savePayload(list), null, 1), "xiaoke-save-" + day + ".json", "application/json"); }, { cls: "blue small" }));
    $("menu").appendChild(r);
    if (prof && store.profiles.length > 1) addBtn(all ? "只导出 " + esc(prof.name) : "改成导出全部玩家", function () { renderExport(!all); }, { cls: "small" });
    addBtn("↩️ 返回", prof ? renderSaves : renderTitle, { cls: "small" });
  }

  function renderImport(back) {
    screen = "saveImport"; hideQuiz(); showScene(true); clearMenu(); scrollTop();
    setStory('<div class="big">📥 导入存档</div>把存档码粘贴到下面，或者选一个存档文件（.txt / .json）。同名玩家会先问你要不要覆盖。');
    var ta = el("textarea", "savecode"); ta.placeholder = "在这里粘贴存档码"; ta.setAttribute("aria-label", "粘贴存档码");
    $("menu").appendChild(ta);
    var lab = el("label", "filepick", "📄 选择存档文件");
    var inp = document.createElement("input"); inp.type = "file"; inp.id = "saveFile"; inp.accept = ".txt,.json,text/plain,application/json";
    lab.appendChild(inp); $("menu").appendChild(lab);
    var run = function (text) {
      var list;
      try { list = parseSave(text); } catch (e) { toast("⚠️ " + e.message); return; }
      var r = applyImport(list);
      toast("📥 导入完成：新增 " + r.added + " 位，覆盖 " + r.replaced + " 位" + (r.skipped ? "，跳过 " + r.skipped + " 位" : ""));
      if (r.added || r.replaced) setTimeout(renderTitle, 600);
    };
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { run(String(rd.result || "")); inp.value = ""; };
      rd.onerror = function () { toast("⚠️ 读不了这个文件"); };
      rd.readAsText(f);
    });
    addBtn("✅ 导入粘贴的存档码", function () { run(ta.value); }, { cls: "primary" });
    addBtn("↩️ 返回", back || renderTitle, { cls: "small" });
  }

  /* ═══════════════ v5 · 主动阅读：点字听音、故事书架、龙珠雷达线索 ═══════════════ */
  var NAMES = (typeof STORY_NAMES !== "undefined" ? STORY_NAMES : []).concat(["布尔玛", "龟仙人", "雅木查", "天津饭", "饺子", "蓝琪"])
    .concat(["乌龙", "普尔", "牛魔王", "琪琪", "红缎带军", "布鲁将军", "桃白白", "卡林大人", "卡林塔", "短笛大魔王", "短笛", "天神", "波波先生", "孙悟空", "孙悟饭", "悟饭", "拉蒂兹", "赛亚人", "北界王", "界王星", "界王", "泡泡", "格列格利", "栽培人", "那巴", "贝吉塔", "那美克星人", "那美克星", "丁迪", "最长老", "内鬼", "撒保", "多多利亚", "弗利萨", "基纽特战队", "基纽", "吉斯", "巴特", "利库姆", "古尔多", "波伦加", "库林", "小库林"])
    .filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(function (a, b) { return b.length - a.length; });
  // 字库里没有的专名用字，以及在句子里读音和字库默认读音不同的词（只覆盖用到的）
  var WORD_PY = {
    "小悟空": ["xiǎo", "wù", "kōng"], "悟空": ["wù", "kōng"], "布尔玛": ["bù", "ěr", "mǎ"], "龟仙人": ["guī", "xiān", "rén"],
    "饺子": ["jiǎo", "zi"], "跑得": ["pǎo", "de"], "睡觉": ["shuì", "jiào"], "蓝琪": ["lán", "qí"],
    // v7 新章节里的专名/招式
    "乌龙": ["wū", "lóng"], "普尔": ["pǔ", "ěr"], "牛魔王": ["niú", "mó", "wáng"], "琪琪": ["qí", "qí"], "红缎带军": ["hóng", "duàn", "dài", "jūn"], "布鲁将军": ["bù", "lǔ", "jiāng", "jūn"], "桃白白": ["táo", "bái", "bái"], "卡林大人": ["kǎ", "lín", "dà", "rén"], "卡林塔": ["kǎ", "lín", "tǎ"], "超神水": ["chāo", "shén", "shuǐ"], "仙豆": ["xiān", "dòu"], "短笛大魔王": ["duǎn", "dí", "dà", "mó", "wáng"], "短笛": ["duǎn", "dí"], "天神": ["tiān", "shén"], "波波先生": ["bō", "bō", "xiān", "sheng"], "孙悟空": ["sūn", "wù", "kōng"], "孙悟饭": ["sūn", "wù", "fàn"], "悟饭": ["wù", "fàn"], "拉蒂兹": ["lā", "dì", "zī"], "赛亚人": ["sài", "yà", "rén"], "界王拳": ["jiè", "wáng", "quán"], "北界王": ["běi", "jiè", "wáng"], "界王星": ["jiè", "wáng", "xīng"], "界王": ["jiè", "wáng"], "泡泡": ["pào", "pao"], "格列格利": ["gé", "liè", "gé", "lì"], "元气弹": ["yuán", "qì", "dàn"], "栽培人": ["zāi", "péi", "rén"], "那巴": ["nà", "bā"], "贝吉塔": ["bèi", "jí", "tǎ"], "那美克星人": ["nà", "měi", "kè", "xīng", "rén"], "那美克星": ["nà", "měi", "kè", "xīng"], "丁迪": ["dīng", "dí"], "最长老": ["zuì", "zhǎng", "lǎo"], "内鬼": ["nèi", "guǐ"], "撒保": ["sā", "bǎo"], "多多利亚": ["duō", "duō", "lì", "yà"], "弗利萨": ["fú", "lì", "sà"], "基纽特战队": ["jī", "niǔ", "tè", "zhàn", "duì"], "基纽": ["jī", "niǔ"], "吉斯": ["jí", "sī"], "巴特": ["bā", "tè"], "利库姆": ["lì", "kù", "mǔ"], "古尔多": ["gǔ", "ěr", "duō"], "波伦加": ["bō", "lún", "jiā"], "龟派气功": ["guī", "pài", "qì", "gōng"], "库林": ["kù", "lín"], "小库林": ["xiǎo", "kù", "lín"]
  };
  var READ_HINT_DELAY = 7000;          // 「整句读给我听」至少等 7 秒，或孩子先点过字
  function learnedSet(pr) { var s = {}; Object.keys(pr.srs).forEach(function (c) { if (pr.srs[c].ok > 0) s[c] = 1; }); return s; }
  function isHan(ch) { return /[\u4e00-\u9fff]/.test(ch); }
  /** 把句子切成 {ch, py, name, word}，专名和特殊读音词按整词处理 */
  function tokenize(text) {
    var out = [], i = 0;
    while (i < text.length) {
      var hit = null;
      NAMES.concat(Object.keys(WORD_PY)).forEach(function (n) { if (!hit && text.substr(i, n.length) === n) hit = n; });
      if (hit) {
        var isName = NAMES.indexOf(hit) !== -1, pys = WORD_PY[hit];
        for (var k = 0; k < hit.length; k++) out.push({ ch: hit[k], py: pys ? pys[k] : (BYC[hit[k]] ? BYC[hit[k]].py : ""), name: isName, word: hit });
        i += hit.length; continue;
      }
      var ch = text[i];
      out.push({ ch: ch, py: BYC[ch] ? BYC[ch].py : "", han: isHan(ch) });
      i++;
    }
    out.forEach(function (t) { if (t.name) t.han = true; });
    return out;
  }
  /** 只统计非专名的汉字：已学字所占比例（「只用已学字」用程序算，不靠估计） */
  function storyChars(st) {
    var hz = [];
    [st.title].concat(st.lines.map(function (l) { return l[1]; })).forEach(function (t) {
      tokenize(t).forEach(function (x) { if (x.han && !x.name) hz.push(x.ch); });
    });
    return hz;
  }
  var STORY_CHARS = {};
  (typeof READERS !== "undefined" ? READERS : []).forEach(function (st) { STORY_CHARS[st.id] = storyChars(st); });
  function knownRatio(st, known) {
    var hz = STORY_CHARS[st.id]; if (!hz.length) return 1;
    return hz.filter(function (c) { return known[c]; }).length / hz.length;
  }
  function unknownDistinct(st, known) { return STORY_CHARS[st.id].filter(function (c, i, a) { return !known[c] && a.indexOf(c) === i; }); }
  function storyUnlocked(st, known) { return knownRatio(st, known) >= 0.95; }
  function unlockedStories(pr) { var k = learnedSet(pr); return READERS.filter(function (st) { return storyUnlocked(st, k); }); }

  /** 生成可点读的句子：已学字不标拼音（先自己读），没学过的字和专名自动标拼音 */
  function readHTML(text, known) {
    return tokenize(text).map(function (t) {
      if (!t.han) return esc(t.ch);
      var ruby = t.name || !known[t.ch];
      var inner = ruby && t.py ? "<ruby>" + esc(t.ch) + "<rt>" + esc(t.py) + "</rt></ruby>" : esc(t.ch);
      return '<span class="rc' + (ruby ? " unk" : "") + '" data-c="' + esc(t.ch) + '" data-py="' + esc(t.py) + '"' + (t.word && WORD_PY[t.word] && !t.name ? ' data-w="' + esc(t.word) + '"' : "") + ">" + inner + "</span>";
    }).join("");
  }
  /** 点字求助：读这个字的音，短暂显示拼音；学过的字记成「弱字」进入复习 */
  function markHelp(pr, c) {
    if (!pr.readHelp) pr.readHelp = {};
    pr.readHelp[c] = (pr.readHelp[c] || 0) + 1;
    var r = pr.srs[c];
    if (BYC[c] && r && r.seen) { r.b = Math.min(r.b, 1); r.due = now(); r.help = (r.help || 0) + 1; }
  }
  function bindReading(root, pr, onTap) {
    root.querySelectorAll(".rc").forEach(function (sp) {
      sp.addEventListener("click", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var c = sp.dataset.c, w = sp.dataset.w;
        TTS.say(w || c);
        var old = sp.querySelector(".rpop"); if (old) old.remove();
        var pop = el("span", "rpop", esc(sp.dataset.py || "?")); sp.appendChild(pop);
        sp.classList.add("tapped");
        setTimeout(function () { pop.remove(); }, 1600);
        markHelp(pr, c); saveStore();
        if (onTap) onTap(sp);
      });
    });
  }
  /** 一句话 + 延迟出现的「整句读给我听」按钮 */
  function readLineHTML(text, known, idx) {
    return '<div class="rline" data-i="' + idx + '"><div class="rtext">' + readHTML(text, known) + '</div>' +
      '<button class="btn small blue rsay hidden" type="button" data-i="' + idx + '">🔊 整句读给我听</button></div>';
  }
  function armLineHelp(root, texts) {
    var timers = [];
    root.querySelectorAll(".rline").forEach(function (ln) {
      var b = ln.querySelector(".rsay"), i = +ln.dataset.i;
      var show = function () { b.classList.remove("hidden"); };
      timers.push(setTimeout(show, READ_HINT_DELAY));
      ln.querySelectorAll(".rc").forEach(function (sp) { sp.addEventListener("click", show); });
      b.addEventListener("click", function () { SFX.click(); TTS.say(plainText(texts[i]), 0.7); });
    });
    return timers;
  }

  /* ── 故事书架 ── */
  function readerCast(k) { return k === "mom" ? { name: "妈妈", emoji: "👩" } : CAST[k] || CAST.narr; }
  function renderShelf() {
    screen = "shelf"; story = null; reading = null;
    hideQuiz(); showScene(true); renderHUD(); clearMenu();
    $("logo").classList.add("hidden");
    var known = learnedSet(prof), open = unlockedStories(prof);
    setStory('<div class="big">📚 故事书架</div>你认识 ' + Object.keys(known).length + " 个字，能读 " + open.length + " / " + READERS.length + " 本小书。\n" +
      "<small>先自己读！不会的字点一下就能听。读完回答问题，得龙珠 " + ballSVG(1, 22) + "（" + (prof.readBalls || 0) % 7 + " / 7）</small>");
    var grid = el("div", "shelf");
    var sorted = open.slice().sort(function (a, b) { return ((prof.reads || {})[a.id] ? 1 : 0) - ((prof.reads || {})[b.id] ? 1 : 0); });
    sorted.forEach(function (st) {
      var n = (prof.reads || {})[st.id] || 0, pct = Math.round(knownRatio(st, known) * 100);
      grid.appendChild(btn('<span class="bk-ic">' + st.icon + "</span><b>" + readHTML(st.title, known) + "</b><small>" + (n ? "✅ 读过 " + n + " 次" : "🆕 新书") + " · 认识 " + pct + "%</small>",
        function () { readStory(st); }, { cls: "book-btn" + (n ? "" : " fresh") }));
    });
    var locked = READERS.filter(function (st) { return open.indexOf(st) === -1; })
      .sort(function (a, b) { return unknownDistinct(a, known).length - unknownDistinct(b, known).length; }).slice(0, 3);
    locked.forEach(function (st) {
      grid.appendChild(btn('<span class="bk-ic">🔒</span><b>' + st.icon + ' ？？？</b><small>再多认识一些字就能读</small>', function () {}, { cls: "book-btn locked", disabled: true }));
    });
    $("menu").appendChild(grid);
    if (!open.length) addBtn("⚡ 先去修炼认字", startSession, { cls: "primary" });
    addBtn("🏠 回主页", goHome, { cls: "blue" });
    scrollTop();
  }
  var reading = null;
  function readStory(st) {
    reading = { st: st, taps: 0, timers: [] };
    screen = "reading"; hideQuiz(); showScene(true); renderHUD(); clearMenu();
    var known = learnedSet(prof), texts = st.lines.map(function (l) { return l[1]; });
    var html = '<div class="storyhead">' + st.icon + " " + readHTML(st.title, known) + '</div><div class="reader">';
    st.lines.forEach(function (l, i) {
      var who = readerCast(l[0]);
      html += '<div class="rrow"><span class="rwho">' + (l[0] === "mom" ? '<span class="avemo" style="font-size:34px">👩</span>' : portraitHTML(l[0], 44)) + "</span>" + readLineHTML(l[1], known, i) + "</div>";
    });
    html += '</div><div class="rtip">👆 先自己读。不会的字，点一下！</div>';
    setStory(html);
    var root = $("story");
    bindReading(root, prof, function () { reading.taps++; });
    reading.timers = armLineHelp(root, texts);
    addBtn("✅ 我读完了！回答问题", function () { clearReadTimers(); askComprehension(st, 0, 0); }, { cls: "primary" });
    addBtn("📚 回书架", function () { clearReadTimers(); renderShelf(); }, { cls: "small" });
    scrollTop();
  }
  function clearReadTimers() { if (reading) reading.timers.forEach(clearTimeout); }
  function askComprehension(st, qi, firstCount) {
    var qd = st.qs[qi], known = learnedSet(prof);
    var q = { kind: "read", type: "comp", wrongs: 0, done: false, autoSpeak: false, optHTML: true, optMap: {}, options: [], optCls: "word" };
    q.title = qd.q; q.en = "Read and choose"; q.mainHTML = '<div class="qpic" style="font-size:3.2rem">' + st.icon + "📖</div>"; q.titleHTML = readHTML(qd.q, known);
    qd.opts.forEach(function (o, i) { q.options.push("o" + i); q.optMap["o" + i] = esc(o[0]); if (o[1]) q.answerKey = "o" + i; });
    q.options = shuffle(q.options);
    q.hintHTML = "📖 回去看看故事里怎么说的～"; q.sayAnswer = qd.q; q.speak = qd.q;
    showQuiz(q, {
      pr: prof, tag: "📚 读后小问题 " + (qi + 1) + " / " + st.qs.length,
      menu: [["📖 再看一遍故事", function () { readStory(st); }, { cls: "small" }]],
      onDone: function (first) {
        var fc = firstCount + (first ? 1 : 0);
        if (qi + 1 < st.qs.length) return askComprehension(st, qi + 1, fc);
        finishReading(st, fc);
      }
    });
  }
  function finishReading(st, firstCount) {
    if (!prof.reads) prof.reads = {};
    var firstTime = !prof.reads[st.id];
    prof.reads[st.id] = (prof.reads[st.id] || 0) + 1;
    var earn = firstCount > 0;            // 读后问题一次答对才得阅读龙珠
    if (earn) prof.readBalls = (prof.readBalls || 0) + 1;
    gainExp(prof, firstTime ? 20 : 8);
    var taps = reading ? reading.taps : 0;
    reading = null; saveStore();
    hideQuiz(); showScene(true); renderHUD(); clearMenu();
    var got = prof.readBalls % 7 || 7;
    setStory('<div class="big">🎉 读完了！</div>' + (earn ? '<div style="text-align:center">' + ballSVG(got, 64, "pop") + "</div>得到第 " + got + " 颗阅读龙珠！" : "💪 这次问题没有一次答对，下次读仔细一点，就能拿到龙珠！") +
      (taps ? "\n👆 你点了 " + taps + " 次字来求助，这些字会安排复习。" : "\n🌟 一个字都没点，全部自己读出来了！") +
      (firstCount === st.qs.length ? "\n✨ 问题一次就全答对了！" : ""));
    if (earn) { SFX.ball(); confetti(16); }
    TTS.say("读完了！真棒！");
    var after = function () {
      clearMenu();
      addBtn("📚 回书架，再读一本", renderShelf, { cls: "primary" });
      addBtn("🏠 回主页", goHome, { cls: "blue" });
    };
    if (earn && prof.readBalls % 7 === 0) return setTimeout(function () { summonDragon(prof, function () { renderShelf(); }); }, 1200);
    after();
  }
  /** 进阶后：看看有没有新解锁的故事 */
  function newlyUnlockedStories(pr) {
    if (!pr.shelfSeen) pr.shelfSeen = [];
    var fresh = unlockedStories(pr).filter(function (st) { return pr.shelfSeen.indexOf(st.id) === -1; });
    fresh.forEach(function (st) { pr.shelfSeen.push(st.id); });
    return fresh;
  }

  /* ── 龙珠雷达线索：读懂一句话才能找到龙珠 ── */
  var CLUE_PLACES = [
    ["山", "⛰️", ["上", "下"]], ["树", "🌳", ["上", "下"]], ["车", "🚗", ["上", "下", "里"]], ["床", "🛏️", ["上", "下"]],
    ["云", "☁️", ["上", "下"]], ["石", "🪨", ["上", "下"]], ["书", "📖", ["上", "下"]], ["水", "🌊", ["里"]],
    ["花", "🌸", ["里", "下"]], ["草", "🌿", ["里"]], ["家", "🏠", ["里"]], ["门", "🚪", ["外", "里"]], ["火", "🔥", ["里"]]
  ];
  function cluePlaces(pr) {
    var k = learnedSet(pr);
    if (!k["在"]) return [];
    return CLUE_PLACES.map(function (p) { return [p[0], p[1], p[2].filter(function (pos) { return k[pos]; })]; })
      .filter(function (p) { return k[p[0]] && p[2].length; });
  }
  function clueEligible(pr) { return pr.mode !== "little" && cluePlaces(pr).length >= 3; }
  function sceneHTML(emoji, pos) {
    var b = ballSVG(4, 30);
    if (pos === "上") return '<span class="scn"><span class="sb">' + b + '</span><span class="spl">' + emoji + "</span><span class=\"sb\"></span></span>";
    if (pos === "下") return '<span class="scn"><span class="sb"></span><span class="spl">' + emoji + '</span><span class="sb">' + b + "</span></span>";
    if (pos === "外") return '<span class="scn row"><span class="spl">' + emoji + '</span><span class="sb">' + b + "</span></span>";
    return '<span class="scn"><span class="sb"></span><span class="spl in">' + emoji + '<i class="sin">' + b + '</i></span><span class="sb"></span></span>';
  }
  function makeClue(pr) {
    var places = shuffle(cluePlaces(pr)), p = places[0], pos = pick(p[2]);
    var text = "龙珠在" + p[0] + pos + (pos === "里" ? "" : (learnedSet(pr)["面"] && Math.random() < 0.5 ? "面" : ""));
    var q = { kind: "clue", type: "clue", c: p[0], wrongs: 0, done: false, autoSpeak: false, optHTML: true, optMap: {}, options: [], optCls: "emo scene" };
    q.title = "龙珠雷达线索：读一读，龙珠在哪里？"; q.en = "Read the radar clue and find the ball";
    var known = learnedSet(pr);
    q.mainHTML = '<div class="clue" id="qTarget"><span class="radar">📡</span><span class="cluetext">' + readHTML(text, known) + "</span></div>";
    var key = p[0] + "|" + pos, opts = [key];
    // 干扰项：同一个地方的另一个位置（考「上/下」）+ 别的地方（考名词）
    p[2].concat(p[0] === "车" ? [] : ["上", "下"]).forEach(function (o) { if (o !== pos && opts.length < 2 && CLUE_PLACES.some(function (cp) { return cp[0] === p[0] && cp[2].indexOf(o) !== -1; })) opts.push(p[0] + "|" + o); });
    places.slice(1).forEach(function (o) { if (opts.length < 3) opts.push(o[0] + "|" + (o[2].indexOf(pos) !== -1 ? pos : o[2][0])); });
    opts.forEach(function (o) { var a = o.split("|"), em = CLUE_PLACES.filter(function (cp) { return cp[0] === a[0]; })[0][1]; q.optMap[o] = sceneHTML(em, a[1]); });
    q.options = shuffle(opts); q.answerKey = key;
    q.speak = text; q.sayAnswer = text;
    q.hintHTML = '<span class="py">' + tokenize(text).map(function (t) { return t.py; }).join(" ") + "</span>";
    return q;
  }

  /* ═══════════════ 字卡本 / 贴纸 ═══════════════ */
  function renderBook() {
    var little = prof.mode === "little";
    screen = "book"; hideQuiz(); showScene(true); renderHUD(); clearMenu(); scrollTop();
    $("logo").classList.add("hidden");
    var list = unlockedChars(prof);
    setStory('<div class="big">📖 ' + (little ? "我的字" : "字卡本") + "</div>点一下字就能听读音。颜色越深越熟练：白=新 · 橙=要多练 · 黄=认识 · 绿=熟练 · 蓝=大师");
    var grid = el("div", "book");
    list.forEach(function (c) {
      var r = prof.srs[c], b = el("button", "hzcell " + masteryClass(r));
      b.type = "button";
      b.innerHTML = esc(c) + (little && BYC[c].pic ? "<i>" + BYC[c].pic + "</i>" : (r && r.seen ? "<i>" + "★".repeat(Math.min(3, Math.ceil(r.b / 2))) + "</i>" : ""));
      b.addEventListener("click", function () {
        TTS.say(charSpeech(c));
        var it = BYC[c];
        var ws = (it.w || []).map(function (w) { return '<div class="bookword"><b>' + esc(w.w) + "</b> " + esc(w.py) + " · " + esc(w.en) + "</div>"; }).join("");
        setStory('<div style="text-align:center"><div class="qchar aura" style="font-size:5rem">' + esc(c) + '</div><div class="hintline">' + charHint(c) + "</div>" + (little ? "" : ws) + "</div>");
        scrollTop();
      });
      grid.appendChild(b);
    });
    $("menu").appendChild(grid);
    addBtn(little ? "🏠" : "🏠 回主页", goHome, { cls: "blue" });
  }
  function renderStickers() {
    screen = "stickers"; hideQuiz(); showScene(true); renderHUD(); clearMenu();
    $("logo").classList.add("hidden");
    setStory('<div class="big">🌟 我的贴纸</div><div class="stickers" style="font-size:3rem">' + (prof.stickers.join(" ") || "集齐龙珠召唤神龙，就能得到贴纸！") + "</div>");
    addBtn(prof.mode === "little" ? "🏠" : "🏠 回主页", goHome, { cls: "blue" });
  }

  /* ═══════════════ 设置（家长用） ═══════════════ */
  function renderSettings() {
    if (!prof) return;
    screen = "settings"; hideQuiz(); showScene(true); renderHUD(); clearMenu(); scrollTop();
    setStory('<div class="big">⚙️ 设置 · ' + esc(prof.name) + "</div>中文语音：✅ 录好的 AI 人声（" + Object.keys(VOICE.map).length + " 段）" + (TTS.ok ? "；没录到的用 " + esc(TTS.voice.name) : "") +
      "\n英文语音：" + (TTS.enOk ? "✅ " + esc(TTS.enVoice.name) : "❌ 没有（英语题只显示文字）") +
      "\n已解锁 " + unlockedChars(prof).length + " 字 · 第 " + (prof.stage + 1) + " 阶 · 共修炼 " + prof.sessions + " 关" +
      "\n数学题答对 " + prof.extra.math + " 次 · 英语题答对 " + prof.extra.eng + " 次" +
      "\n📚 读完小故事 " + Object.keys(prof.reads).length + " / " + READERS.length + " 本 · 雷达线索答对 " + (prof.extra.clue || 0) + " 次" +
      (Object.keys(prof.readHelp).length ? "\n👆 读书时点过的字：" + esc(Object.keys(prof.readHelp).sort(function (a, b) { return prof.readHelp[b] - prof.readHelp[a]; }).slice(0, 20).join(" ")) : ""));
    addBtn("🐢 朗读速度：" + (VOICE.rate === 0.75 ? "慢速 0.75 ✅ · 点一下换成正常" : "正常 ✅ · 点一下换成慢速 0.75"), function () { VOICE.setRate(VOICE.rate === 0.75 ? 1 : 0.75); renderSettings(); TTS.say("你好，小侠客！"); }, { cls: "small", id: "rateBtn" });
    addBtn("🔊 测试中文语音", function () { if (!TTS.say(["你好，小侠客！"].concat(charSpeech("大")))) toast("没有可用的中文语音"); }, { cls: "small" });
    addBtn("拼音提示：" + (prof.settings.pinyin ? "总是显示 ✅" : "点 💡 才显示"), function () { prof.settings.pinyin = !prof.settings.pinyin; saveStore(); renderSettings(); }, { cls: "small" });
    addBtn("模式：" + (prof.mode === "little" ? "🍼 启蒙模式（看图听音）" : "⚔️ 侠客模式") + " → 切换", function () {
      if (!global.confirm("切换模式？两种模式的学习进度分开计算。")) return;
      prof.mode = prof.mode === "little" ? "hero" : "little"; prof.stage = 0; saveStore(); renderSettings();
    }, { cls: "small" });
    addBtn("✏️ 改名字 / 换头像：" + avatarHTML(prof.avatar, 40) + (AVATAR_INFO[prof.avatar] ? " " + esc(AVATAR_INFO[prof.avatar].label) : ""), function () { renderProfileForm(prof); }, { cls: "small" });
    addBtn("💾 存档 / 读档（导出、导入、3 个存档位）", renderSaves, { cls: "yellow small" });
    addBtn("⏩ 字太简单？直接解锁下一批字", function () { prof.stage++; saveStore(); toast("已解锁 " + unlockedChars(prof).length + " 字"); renderSettings(); }, { cls: "small" });
    addBtn("🗑️ 删除这个玩家", function () {
      if (!global.confirm("确定删除 " + prof.name + " 的全部进度？不能恢复！")) return;
      try { localStorage.removeItem(SLOT_KEY + prof.id); } catch (e) { /* */ }
      store.profiles = store.profiles.filter(function (p) { return p !== prof; });
      saveStore(); renderTitle();
    }, { cls: "danger small" });
    addBtn("↩️ 返回", goHome, { cls: "blue" });
  }

  /* ═══════════════ 初始化 ═══════════════ */
  function init() {
    loadStore();
    TTS.init();
    $("homeBtn").onclick = function () {
      SFX.click();
      if ((session || duo || story || reading) && !global.confirm("回到选人页？进度已自动保存。")) return;
      session = null; duo = null; story = null; clearReadTimers(); reading = null; saveStore(); renderTitle();
    };
    $("settingsBtn").onclick = function () { SFX.click(); if (session || duo || story) { toast("先完成这一关再设置哦"); return; } renderSettings(); };
    if ($("rateBtnTop")) { var paintRate = function () { $("rateBtnTop").textContent = VOICE.rate === 0.75 ? "🐢" : "🐇"; $("rateBtnTop").setAttribute("aria-label", VOICE.rate === 0.75 ? "朗读速度：慢速0.75" : "朗读速度：正常"); };
      VOICE.onRate = paintRate; paintRate(); $("rateBtnTop").onclick = function () { VOICE.setRate(VOICE.rate === 0.75 ? 1 : 0.75); toast(VOICE.rate === 0.75 ? "🐢 慢速 0.75" : "🐇 正常速度"); TTS.say("你好，小侠客！"); }; }
    $("soundBtn").onclick = function () {
      soundOn = !soundOn; this.textContent = soundOn ? "🔊" : "🔇";
      if (soundOn) { initAudio(); SFX.click(); } else { VOICE.stop(); }
    };
    var unlock = function () { initAudio(); VOICE.unlock(); if (TTS.ok) { try { var u = new global.SpeechSynthesisUtterance(""); global.speechSynthesis.speak(u); } catch (e) { /* */ } } };
    document.body.addEventListener("touchstart", unlock, { once: true, passive: true });
    document.body.addEventListener("click", unlock, { once: true });
    renderTitle();
  }
  // 测试钩子（只读状态 + 少量操作，便于自动化测试）
  global.__xiaoke = {
    state: function () { return { screen: screen, store: store, prof: prof && prof.id, q: curQ && { c: curQ.c, kind: curQ.kind || null, type: curQ.type, answerKey: curQ.answerKey, options: curQ.options, answer: curQ.answer, title: curQ.title, en: curQ.en, item: curQ.item || null }, session: session && { idx: session.idx, balls: session.balls, len: session.queue.length, only: session.only }, story: story && { i: story.i, phase: story.phase, match: story.match } }; },
    makeQuestion: function (mode, c, type) { var pr = newProfile("t", mode, "🧒", "#000"); return makeQuestion(pr, c, type); },
    makeExtra: function (mode, kind, stage) { var pr = newProfile("t", mode, "🧒", "#000"); pr.stage = stage || 0; return makeExtra(pr, kind); },
    english: ENGLISH, charSpeech: charSpeech,
    readers: function () { return READERS.map(function (st) { return { id: st.id, chars: STORY_CHARS[st.id] }; }); },
    makeClue: function (chars) { var pr = newProfile("t", "hero", "🧒", "#000"); chars.split("").forEach(function (c) { pr.srs[c] = { b: 2, due: 0, seen: 1, ok: 1, bad: 0 }; }); return makeClue(pr); },
    tts: TTS,
    makeSkill: function (mode, kind, type, lv, chars) { var pr = newProfile("t", mode, "🧒", "#000"); pr.pinyin.lv = lv || 0; (chars || "").split("").forEach(function (c) { pr.srs[c] = { b: 2, due: 0, seen: 1, ok: 1, bad: 0 }; }); return kind === "py" ? makePinyin(pr, type) : makeRadical(pr, type); },
    radicals: RADICALS, builds: BUILDS,
    voice: VOICE,
    /** 列出游戏里所有可能读出来的中文（scripts/gen_audio.js 用它生成录音，并检查覆盖率） */
    speakables: function () {
      var out = {}, add = function (t) { [].concat(t).forEach(function (x) { if (x != null && String(x).length) out[String(x)] = 1; }); };
      var addText = function (t) { add(t); add(plainText(t)); tokenize(t).forEach(function (k) { if (k.han || isHan(k.ch)) add(k.ch); if (k.word) add(k.word); }); };
      DB.forEach(function (h) { var c = h.c; add(charSpeech(c)); add(introSpeech(c, false)); add("哪个是" + c); (h.w || []).forEach(function (w) { add(w.w); }); });
      add(["你好，小侠客！", "点大按钮，开始！", "七颗龙珠集齐了！神龙出现了！说出你的愿望吧！", "龙珠故事", "读完了！真棒！", "哪个词里有", "数一数，有几个？", "这个用英语怎么说？",
        "拼一拼", "读一读拼音，找一找是哪个字", "和什么有关？", "哪个字有", "哪个字和", "是一家？", "加", "是哪个字？"]);
      DUO_BOSSES.forEach(function (b) { add("同心协力，一起打败" + b.name + "！"); });
      STORY.forEach(function (ch) {
        (ch.intro || []).concat(ch.outro || []).forEach(function (sc) { addText(sc[1]); });
        (ch.matches || []).forEach(function (m) { add((m.portrait ? "对手：" : "挑战：") + m.name + "！答对汉字就能出招！"); });
        add(ch.title.split(" · ")[1] + "，完成！");
      });
      READERS.forEach(function (st) { st.lines.forEach(function (l) { addText(l[1]); }); st.qs.forEach(function (q) { addText(q.q); }); });
      CLUE_PLACES.forEach(function (p) { p[2].forEach(function (pos) { addText("龙珠在" + p[0] + pos); if (pos !== "里") addText("龙珠在" + p[0] + pos + "面"); }); });
      NAMES.concat(Object.keys(WORD_PY)).forEach(add);
      for (var n = 1; n <= 10; n++) add("一共有" + zhCount(n) + "个");
      for (var a = 0; a <= 20; a++) for (var b = 0; b <= 20; b++) {
        if (a + b <= 20) { add(ZH_NUM[a] + "加" + ZH_NUM[b] + "等于几？"); add(ZH_NUM[a] + "加" + ZH_NUM[b] + "等于" + ZH_NUM[a + b]); }
        if (b <= a) { add(ZH_NUM[a] + "减" + ZH_NUM[b] + "等于几？"); add(ZH_NUM[a] + "减" + ZH_NUM[b] + "等于" + ZH_NUM[a - b]); }
      }
      ENGLISH.forEach(function (it) { add(it[2]); });
      Object.keys(SINGLE_SAY).forEach(function (k) { add(SINGLE_SAY[k][0]); });
      syllables().list.forEach(function (o) { add(sylSpeak(o)); });
      TONE_SAY.forEach(add);
      RADICALS.forEach(function (R) { add([R.name, R.cue, "有" + R.name]); R.list.forEach(add); });
      BUILDS.forEach(function (B) { add([B[1], B[2]]); });
      return Object.keys(out);
    },
    _: 0
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
