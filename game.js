/**
 * 小侠客汉字龙珠 v4（基于「小侠客汉字江湖」v3 改版）
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
    /** text 可以是字符串，也可以是数组（逐句朗读，句子之间自然停顿） */
    speak: function (voice, text, rate) {
      if (!voice || !soundOn || !text || !text.length) return false;
      try {
        global.speechSynthesis.cancel();
        [].concat(text).forEach(function (t) {
          var u = new global.SpeechSynthesisUtterance(t);
          u.voice = voice; u.lang = voice.lang; u.rate = rate || SPEECH_RATE; u.pitch = 1.1;
          global.speechSynthesis.speak(u);
        });
        return true;
      } catch (e) { return false; }
    },
    say: function (text, rate) { return this.ok && this.speak(this.voice, text, rate); },
    sayEn: function (text, rate) { return this.enOk && this.speak(this.enVoice, text, rate || 0.7); }
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
    chiaotzu: { label: "饺子", desc: "小个子 · 白白的脸 · 红脸蛋 · 小帽子" }
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
  function avatarSVG(kind, size) {
    return '<svg class="avsvg" width="' + size + '" height="' + size + '" viewBox="0 0 100 100" role="img" aria-label="' + AVATAR_INFO[kind].label + '">' + AVATAR_DRAW[kind]() + "</svg>";
  }
  /** 头像：小悟空 / 小库林 / 天津饭 / 饺子 用原创 SVG，其余是 emoji */
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
  var AVATARS = ["goku", "krillin", "tien", "chiaotzu", "🧒", "👦", "👶", "🐵", "🐯", "🐲", "🦊", "🐼"];
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
      extra: { math: 0, eng: 0 }, settings: { pinyin: false }
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
    ["stage", "wishes", "sessions", "dayStreak", "story"].forEach(function (k) { if (typeof pr[k] !== "number") pr[k] = 0; });
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
      pic2char: !!item.pic, char2pic: !!item.pic, listen: TTS.ok, meaning: !!item.ok,
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
  function addBtn(label, fn, opts) { var b = btn(label, fn, opts); $("menu").appendChild(b); return b; }
  function speedLines(on) { $("speed").classList.toggle("hidden", !on); }
  function showScene(show) { $("scene").classList.toggle("hidden", !show); }
  function hideQuiz() { curQ = null; $("quiz").classList.add("hidden"); $("quiz").innerHTML = ""; speedLines(false); }
  function updateWho() {
    var w = $("who");
    if (!w) return;
    var voice = TTS.ok ? "" : ' <span class="tag-voice">🔇无中文语音</span>';
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
    return '<span class="py">' + esc(it.py) + "</span>" + (it.pic ? " " + it.pic : "") + (it.ok ? ' <small>' + esc(it.en) + "</small>" : "");
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
      '<div class="qbox"><span class="qtag">' + (ctx.tag || "修炼") + '</span><div class="qtitle">' + esc(q.title) + '</div><div class="qen">' + esc(q.en) + "</div>" +
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
    if (!TTS.ok) { $("sayBtn").classList.add("hidden"); }
    if (q.kind === "eng" && q.speakEn && TTS.enOk) $("sayBtn").classList.remove("hidden");
    if (q.type === "listen" && !TTS.ok) showHint();
    if (pr.settings.pinyin && q.type !== "pinyin" && !q.kind) showHint(true);
    clearMenu();
    (ctx.menu || []).forEach(function (m) { addBtn(m[0], m[1], m[2]); });
    if (q.autoSpeak) setTimeout(function () { if (curQ === q) sayQ(q); }, 300);
    scrollTop();
  }
  function sayQ(q) { if (q.speakEn && TTS.sayEn(q.speakEn)) return; TTS.say(q.speak); }
  /** 答对 / 答错后朗读的内容 */
  function sayAnswer(q) {
    if (q.kind === "eng") { if (!TTS.sayEn(q.item[0])) TTS.say(q.sayAnswer); return; }
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
      if (line) line.innerHTML = (q.wrongs === 0 ? "✨ 太棒了！ " : "👍 对啦！ ") + (q.kind ? q.hintHTML : charHint(q.c));
      setTimeout(function () { if (ctx.onDone) ctx.onDone(q.wrongs === 0, b, q); }, q.wrongs === 0 ? 1300 : 1700);
    } else {
      q.wrongs++;
      b.disabled = true; b.classList.add("wrong");
      SFX.soft();
      showHint(true);
      if (!q.kind) setTimeout(function () { if (curQ === q && !q.done) sayAnswer(q); }, 350);
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
    var row = el("div", "row");
    row.appendChild(btn("🔤 字卡本", renderBook, { cls: "blue" }));
    row.appendChild(btn("🌟 贴纸", renderStickers, { cls: "blue" }));
    $("menu").appendChild(row);
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
    return queue;
  }
  function startSession() {
    session = {
      pr: prof, queue: withExtras(pickSessionChars(prof, SESSION_LEN).map(function (c) { return { c: c, retry: false }; })),
      idx: 0, balls: 0, first: 0, missed: [], introduced: {}, newChars: []
    };
    screen = "session";     nextInSession();
  }
  function nextInSession() {
    if (!session) return goHome();
    if (session.idx >= session.queue.length) return endSession();
    var item = session.queue[session.idx], pr = session.pr, c = item.c;
    if (item.extra) return askInSession(item);
    var r = rec(c, pr);
    if (!r.seen && !session.introduced[c]) { session.introduced[c] = 1; session.newChars.push(c); return showIntro(c, function () { askInSession(item); }); }
    askInSession(item);
  }
  function sessionMenu() { return [["⏸ 休息一下（回主页）", function () { saveStore(); session = null; goHome(); }, { cls: "small" }]]; }
  function askInSession(item) {
    var pr = session.pr;
    var q = item.extra ? makeExtra(pr, item.extra) : makeQuestion(pr, item.c);
    var tag = item.retry ? "🔁 再练一次" : "第 " + Math.min(SESSION_LEN, session.balls + 1) + " 颗龙珠";
    if (item.extra) tag = (item.extra === "math" ? "🔢 数学 · " : "🔤 英语 · ") + tag;
    showQuiz(q, {
      pr: pr, tag: tag, header: trackerHTML(), menu: sessionMenu(),
      onDone: function (first, b) {
        if (item.extra) recordExtra(pr, item.extra, first); else recordResult(pr, item.c, first);
        if (first) { session.first++; gainExp(pr, 8 + Math.min(10, pr.player.level)); }
        else if (item.extra) gainExp(pr, 3);
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
      '<div class="qchar aura">' + esc(c) + '</div><div class="hintline">' + charHint(c) + "</div>" + wl +
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
    setStory(html);
    clearMenu();
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
  var PORTRAITS = {
    bulma: function () {
      return '<ellipse cx="50" cy="52" rx="32" ry="30" fill="#29b6c6" stroke="#141414" stroke-width="2.5"/>' + headBase("#ffe0c4", "#ff6fa8") +
        '<path d="M27 46 Q30 22 50 22 Q72 22 74 46 Q66 34 56 36 Q50 30 42 36 Q34 34 27 46Z" fill="#29b6c6" stroke="#141414" stroke-width="2"/>' +
        '<path d="M60 24 L72 16 L70 30 Z M60 24 L56 12 L68 18 Z" fill="#e3262f" stroke="#141414" stroke-width="1.5"/>' + eyes(48) + smile(true);
    },
    yamcha: function () {
      return '<path d="M22 70 L20 40 Q24 18 50 18 Q78 18 80 40 L78 70 L70 60 L68 72 L60 62 L40 62 L32 72 L30 60 Z" fill="#141414"/>' + headBase("#f5c99a", "#3f9b48") +
        '<path d="M28 44 L32 24 L40 34 L46 20 L54 32 L62 20 L66 34 L74 26 L72 44 L64 36 L56 40 L48 34 L40 40 L34 36Z" fill="#141414"/>' +
        '<path d="M60 52 L68 58 M66 51 L61 60" stroke="#8a2b1f" stroke-width="2" stroke-linecap="round"/>' + eyes(47) + smile(false);
    },
    roshi: function () {
      return '<circle cx="50" cy="80" r="26" fill="#3f9b48" stroke="#141414" stroke-width="2.5"/><path d="M36 74 L50 66 L64 74 L64 88 L50 96 L36 88Z" fill="none" stroke="#1d5e25" stroke-width="2"/>' +
        headBase("#f5c99a", "#ff8a00") +
        '<path d="M30 58 Q32 92 50 96 Q68 92 70 58 Q60 66 50 64 Q40 66 30 58Z" fill="#fff" stroke="#141414" stroke-width="2"/>' +
        '<circle cx="41" cy="47" r="7" fill="#141414"/><circle cx="59" cy="47" r="7" fill="#141414"/><path d="M48 47 L52 47" stroke="#141414" stroke-width="3"/>' +
        '<ellipse cx="40" cy="32" rx="8" ry="3.5" fill="#fff" opacity=".6"/>' +
        '<path d="M44 62 Q50 66 56 62" fill="none" stroke="#141414" stroke-width="2"/>';
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
    launch: { name: "蓝琪" }, chiaotzu: { name: "饺子" }, tien: { name: "天津饭" }
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
      reward: { exp: 100, sticker: "🏆" } }
  ];

  var story = null;
  function storyProgress(pr) { return pr.story || 0; }
  function renderStoryMap() {
    screen = "storyMap"; story = null;
    hideQuiz(); showScene(true); renderHUD();
    $("logo").classList.add("hidden");
    var done = storyProgress(prof);
    setStory('<div class="big">📖 龙珠故事 · 早期篇</div>跟着小悟空、布尔玛、小库林和龟仙人去冒险，参加天下第一武道会！\n<small>故事会读出来；比赛靠答对汉字。</small>');
    clearMenu();
    STORY.forEach(function (ch, i) {
      var locked = i > done;
      var label = (i < done ? "✅ " : locked ? "🔒 " : "▶️ ") + ch.icon + " " + ch.title;
      addBtn(label, function () { playChapter(i); }, { cls: i === done ? "primary" : locked ? "" : "yellow", disabled: locked });
    });
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
    hideQuiz(); showScene(true); renderHUD();
    setStory('<div class="storyhead">' + esc(story.ch.icon + " " + story.ch.title) + " · " + esc(story.ch.place) + "</div>" +
      '<div class="bubble"><div class="spk">' + portraitHTML(sc[0], 96) + '<div class="spkname">' + esc(who.name) + "</div></div>" +
      '<div class="say">' + esc(text) + "</div></div>");
    clearMenu();
    addBtn('<span style="font-size:1.8rem">👉</span> 继续', function () { story.scene++; storyStep(); }, { cls: "primary" });
    addBtn("🔊 再听一次", function () { TTS.say(plainText(text), 0.7); }, { cls: "small blue" });
    addBtn("⏸ 回故事目录", renderStoryMap, { cls: "small" });
    setTimeout(function () { TTS.say(plainText(text), 0.7); }, 200);
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
    var q = maybeExtra(prof), c = q ? null : pickOneChar(prof);
    if (!q) q = makeQuestion(prof, c);
    var tag = ch.matches.length > 1 ? "第 " + (story.match + 1) + " 场 / " + ch.matches.length : "📖 " + ch.title.split(" · ")[0];
    showQuiz(q, {
      pr: prof, tag: tag, header: arenaHTML(avatarHTML(prof.avatar, 72), prof.name, 100, f, f.hp / f.max * 100),
      menu: [["⏸ 回故事目录", renderStoryMap, { cls: "small" }]],
      onDone: function (first) {
        if (q.kind) recordExtra(prof, q.kind, first); else recordResult(prof, c, first);
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
    if (i + 1 >= STORY.length) html += "\n\n🏆 早期篇全部通关！你真是天下第一的小侠客！";
    setStory(html);
    TTS.say(ch.title.split(" · ")[1] + "，完成！");
    clearMenu();
    if (i + 1 < STORY.length) addBtn("▶️ 下一章：" + STORY[i + 1].title, function () { playChapter(i + 1); }, { cls: "primary" });
    addBtn("📖 故事目录", renderStoryMap, { cls: "blue" });
    addBtn(prof.mode === "little" ? "🏠" : "🏠 回主页", goHome, { cls: "small" });
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
        var ws = (it.w || []).map(function (w) { return w.w + " " + w.py; }).join(" · ");
        setStory('<div style="text-align:center"><div class="qchar aura" style="font-size:5rem">' + esc(c) + '</div><div class="hintline">' + charHint(c) + "</div>" + (little ? "" : "<small>" + esc(ws) + "</small>") + "</div>");
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
    setStory('<div class="big">⚙️ 设置 · ' + esc(prof.name) + "</div>中文语音：" + (TTS.ok ? "✅ " + esc(TTS.voice.name) : "❌ 本设备没有中文语音（会改用拼音/图片提示）") +
      "\n英文语音：" + (TTS.enOk ? "✅ " + esc(TTS.enVoice.name) : "❌ 没有（英语题只显示文字）") +
      "\n已解锁 " + unlockedChars(prof).length + " 字 · 第 " + (prof.stage + 1) + " 阶 · 共修炼 " + prof.sessions + " 关" +
      "\n数学题答对 " + prof.extra.math + " 次 · 英语题答对 " + prof.extra.eng + " 次");
    addBtn("🔊 测试中文语音", function () { if (!TTS.say(["你好，小侠客！"].concat(charSpeech("大")))) toast("没有可用的中文语音"); }, { cls: "small" });
    addBtn("拼音提示：" + (prof.settings.pinyin ? "总是显示 ✅" : "点 💡 才显示"), function () { prof.settings.pinyin = !prof.settings.pinyin; saveStore(); renderSettings(); }, { cls: "small" });
    addBtn("模式：" + (prof.mode === "little" ? "🍼 启蒙模式（看图听音）" : "⚔️ 侠客模式") + " → 切换", function () {
      if (!global.confirm("切换模式？两种模式的学习进度分开计算。")) return;
      prof.mode = prof.mode === "little" ? "hero" : "little"; prof.stage = 0; saveStore(); renderSettings();
    }, { cls: "small" });
    addBtn("✏️ 改名字 / 换头像：" + avatarHTML(prof.avatar, 40) + (AVATAR_INFO[prof.avatar] ? " " + esc(AVATAR_INFO[prof.avatar].label) : ""), function () { renderProfileForm(prof); }, { cls: "small" });
    addBtn("⏩ 字太简单？直接解锁下一批字", function () { prof.stage++; saveStore(); toast("已解锁 " + unlockedChars(prof).length + " 字"); renderSettings(); }, { cls: "small" });
    addBtn("🗑️ 删除这个玩家", function () {
      if (!global.confirm("确定删除 " + prof.name + " 的全部进度？不能恢复！")) return;
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
      if ((session || duo || story) && !global.confirm("回到选人页？进度已自动保存。")) return;
      session = null; duo = null; story = null; saveStore(); renderTitle();
    };
    $("settingsBtn").onclick = function () { SFX.click(); if (session || duo || story) { toast("先完成这一关再设置哦"); return; } renderSettings(); };
    $("soundBtn").onclick = function () {
      soundOn = !soundOn; this.textContent = soundOn ? "🔊" : "🔇";
      if (soundOn) { initAudio(); SFX.click(); } else { try { global.speechSynthesis.cancel(); } catch (e) { /* */ } }
    };
    var unlock = function () { initAudio(); if (TTS.ok) { try { var u = new global.SpeechSynthesisUtterance(""); global.speechSynthesis.speak(u); } catch (e) { /* */ } } };
    document.body.addEventListener("touchstart", unlock, { once: true, passive: true });
    document.body.addEventListener("click", unlock, { once: true });
    renderTitle();
  }
  // 测试钩子（只读状态 + 少量操作，便于自动化测试）
  global.__xiaoke = {
    state: function () { return { screen: screen, store: store, prof: prof && prof.id, q: curQ && { c: curQ.c, kind: curQ.kind || null, type: curQ.type, answerKey: curQ.answerKey, options: curQ.options, answer: curQ.answer, title: curQ.title, en: curQ.en, item: curQ.item || null }, session: session && { idx: session.idx, balls: session.balls, len: session.queue.length } }; },
    makeQuestion: function (mode, c, type) { var pr = newProfile("t", mode, "🧒", "#000"); return makeQuestion(pr, c, type); },
    makeExtra: function (mode, kind, stage) { var pr = newProfile("t", mode, "🧒", "#000"); pr.stage = stage || 0; return makeExtra(pr, kind); },
    english: ENGLISH, charSpeech: charSpeech,
    tts: TTS
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window);
