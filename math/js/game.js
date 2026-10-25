/*
 * 森林数学大冒险 v1 —— 给两个孩子的数学小游戏（静态网页，双击 index.html 即可）
 * 两条路线：学前档（约 4 岁）/ 小学档（约 NZ Year 3）。每关 7 题、答错可重试、自适应难度、贴纸奖励、中文/英文朗读。
 * 全部图形为原创 CSS/SVG/emoji。存档在本机 localStorage（km_v1_store），每个玩家单独存。
 */
(function (global) {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function now() { return Date.now(); }
  function bi(zh, en) { return esc(zh) + (en ? ' <span class="en">' + esc(en) + "</span>" : ""); }

  /* ═══════ 存档 ═══════ */
  var STORE_KEY = "km_v1_store", MAX_PLAYERS = 4;
  var store = { ver: 1, players: [], current: null };
  try { var raw = localStorage.getItem(STORE_KEY); if (raw) { var s = JSON.parse(raw); if (s && Array.isArray(s.players)) store = s; } } catch (e) { /* 隐私模式等 */ }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* */ } }
  function newPlayer(name, avatar, track) {
    return { id: "p" + now().toString(36) + rnd(100, 999), name: name, avatar: avatar, track: track, voice: "zh", sound: true,
      prog: { pre: {}, pri: {} }, unlock: { pre: 1, pri: 1 }, stickers: [], gems: 0, trophies: [], rounds: 0, created: now() };
  }
  function normalize(p) {
    if (!p.prog) p.prog = { pre: {}, pri: {} }; if (!p.prog.pre) p.prog.pre = {}; if (!p.prog.pri) p.prog.pri = {};
    if (!p.unlock) p.unlock = { pre: 1, pri: 1 };
    ["stickers", "trophies"].forEach(function (k) { if (!Array.isArray(p[k])) p[k] = []; });
    if (typeof p.gems !== "number") p.gems = 0; if (!p.voice) p.voice = "zh"; if (p.sound == null) p.sound = true;
  }
  store.players.forEach(normalize);
  var me = null;

  /* ═══════ 声音 ═══════ */
  var AC = null;
  function beep(f, d, type) {
    if (me && !me.sound) return;
    try { AC = AC || new (global.AudioContext || global.webkitAudioContext)(); var o = AC.createOscillator(), g = AC.createGain();
      o.type = type || "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.15, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + d);
      o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + d); } catch (e) { /* */ }
  }
  var SFX = { tap: function () { beep(600, 0.05); }, good: function () { beep(784, 0.1); setTimeout(function () { beep(1046, 0.15); }, 90); },
    bad: function () { beep(220, 0.15, "triangle"); }, win: function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { beep(f, 0.15); }, i * 110); }); } };
  /* ═══════ v2 语言 + 录好的 AI 人声（math/audio/，scripts/gen_audio.py 生成）═══════ */
  var LANG_KEY = "km_lang", RATE_KEY = "xiaoke_voice_rate";   // 语速键与汉字龙珠共用
  var LANG = (function () { try { return localStorage.getItem(LANG_KEY) === "en" ? "en" : "zh"; } catch (e) { return "zh"; } })();
  function T(zh, en) { return LANG === "en" ? en : zh; }
  function setLang(l) { LANG = l === "en" ? "en" : "zh"; try { localStorage.setItem(LANG_KEY, LANG); } catch (e) { /* */ } applyLang(); }
  function applyLang() { document.documentElement.lang = T("zh-CN", "en-NZ"); document.title = T("森林数学大冒险", "Forest Maths Adventure");
    var b = $("langBtn"); if (b) { b.textContent = T("中/EN", "EN/中"); b.setAttribute("aria-label", T("切换到英文 English", "Switch to Chinese 中文")); }
    var hz = document.querySelector(".hzlink"); if (hz) hz.textContent = T("🐉 汉字龙珠", "🐉 Hanzi game"); document.body.classList.toggle("lang-en", LANG === "en"); }
  var KA = (typeof KM_AUDIO !== "undefined" && KM_AUDIO) || { zh: {}, en: {} };
  function numEn(n) { return String(n); }
  var VOICE = {
    el: null, job: 0, plays: [], misses: [], fallbacks: [], base: "audio/",
    rate: (function () { try { return +localStorage.getItem(RATE_KEY) === 0.75 ? 0.75 : 1; } catch (e) { return 1; } })(),
    has: function (lang, t) { return Object.prototype.hasOwnProperty.call(KA[lang] || {}, t); },
    /** 整句有录音就整句播；否则按数字切开，逐段播（数字单独录音）；有一段没录音才用设备朗读 */
    parts: function (lang, text) { text = String(text).trim(); if (this.has(lang, text)) return [text];
      var segs = splitSay(text), self = this;
      if (lang === "zh") segs = segs.map(function (x, k) { return x === "2" && /^[个只颗条朵块根本张双位次]/.test(segs[k + 1] || "") ? "两" : x; });
      return segs.every(function (x) { return self.has(lang, x); }) ? segs : null; },
    audio: function () { if (!this.el && typeof global.Audio === "function") { this.el = new global.Audio(); this.el.preload = "auto"; } return this.el; },
    unlock: function () { var a = this.audio(); if (!a || this.unlocked) return; this.unlocked = true;
      try { a.muted = true; a.src = this.base + "silence.mp3"; var p = a.play(); if (p && p.then) p.then(function () { a.pause(); a.muted = false; }, function () { a.muted = false; }); else a.muted = false; } catch (e) { a.muted = false; } },
    setRate: function (r) { this.rate = r === 0.75 ? 0.75 : 1; try { localStorage.setItem(RATE_KEY, String(this.rate)); } catch (e) { /* */ } if (this.el) this.el.playbackRate = this.rate; },
    stop: function () { this.job++; if (this.el) try { this.el.onended = null; this.el.onerror = null; this.el.pause(); } catch (e) { /* */ } try { if (global.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* */ } },
    say: function (lang, text) { this.stop(); if (!text) return; var parts = this.parts(lang, text); if (!parts) return this.synth(lang, text);
      var job = this.job, self = this, i = 0, a = this.audio(); if (!a) return this.synth(lang, text);
      var next = function () { if (self.job === job && i >= parts.length) self.doneJob = job; if (self.job !== job || i >= parts.length) return; var t = parts[i++], url = self.base + lang + "/" + KA[lang][t] + ".mp3";
        a.onended = next; a.onerror = function () { if (String(a.src).indexOf(url) < 0 || self.job !== job) return; self.misses.push(t); self.synth(lang, parts.slice(i - 1).join(lang === "en" ? " " : "")); };
        a.muted = false; a.src = url; a.preservesPitch = true; a.webkitPreservesPitch = true; a.mozPreservesPitch = true; a.defaultPlaybackRate = self.rate; a.playbackRate = self.rate;
        self.plays.push(lang + ":" + t); try { var p = a.play(); if (p && p.catch) p.catch(function () { /* 自动播放被拦：等下一次点击 */ }); } catch (e) { /* */ } };
      next(); },
    /** v7.9：还在说话吗（录音或设备朗读） */
    busy: function () { var sp = false; try { sp = !!(global.speechSynthesis && speechSynthesis.speaking); } catch (e) { /* */ } return (this.doneJob !== this.job && this.el && !this.el.paused) || sp; },
    synth: function (lang, text) { this.fallbacks.push(lang + ":" + text); if (!global.speechSynthesis) return;
      try { var u = new SpeechSynthesisUtterance(text), v = TTS.voice(lang); u.lang = lang === "en" ? (v ? v.lang : "en-NZ") : "zh-CN"; if (v) u.voice = v; u.rate = this.rate; speechSynthesis.speak(u); } catch (e) { /* */ } }
  };
  /** 和 scripts/list_speakables.js 用同一套切分：数字单独成段，其余文字去掉首尾空格 */
  /** v7.9：等语音说完再继续（至少 minMs，最多 maxMs，慢速按比例放宽） */
  function afterVoice(fn, minMs, maxMs) { var t0 = now(), cap = (maxMs || 6000) / (VOICE.rate || 1);
    setTimeout(function poll() { if (VOICE.busy() && now() - t0 < cap) return setTimeout(poll, 100); setTimeout(fn, 250); }, minMs || 0); }
  function splitSay(t) { return String(t).split(/(\d+)/).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^[\s,.，。、:：;；!?！？]+$/.test(x); }); }
  var TTS = {
    ok: !!global.speechSynthesis,
    voice: function (lang) {
      if (!this.ok) return null; var vs = speechSynthesis.getVoices() || [];
      var pref = lang === "en" ? ["en-NZ", "en-AU", "en-GB", "en"] : ["zh-CN", "zh"];
      for (var i = 0; i < pref.length; i++) { var v = vs.filter(function (x) { return (x.lang || "").replace("_", "-").indexOf(pref[i]) === 0; })[0]; if (v) return v; }
      return null;
    },
    say: function (zh, en) { if (me && me.voice === "off") return; VOICE.say(LANG, LANG === "en" ? (en || zh) : zh); }
  };
  if (TTS.ok) try { speechSynthesis.onvoiceschanged = function () {}; speechSynthesis.getVoices(); } catch (e) { /* */ }
  document.addEventListener("pointerdown", function () { VOICE.unlock(); }, { capture: true });
  document.addEventListener("touchend", function () { VOICE.unlock(); }, { capture: true });
  /** 英文界面：把“中文 <span class=en>English</span>”这种双语块只留英文 */
  function enify(root) { if (LANG !== "en") return; [].forEach.call(root.querySelectorAll(".en"), function (sp) { var par = sp.parentNode; if (!par) return;
      [].slice.call(par.childNodes).forEach(function (c) { if (c === sp) return; if (c.nodeType === 3) c.nodeValue = c.nodeValue.replace(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+/g, "").replace(/\s{2,}/g, " "); else if (c.nodeName === "BR") par.removeChild(c); });
      sp.classList.remove("en"); sp.classList.add("en-main"); }); }
  function rateLabel() { return VOICE.rate === 0.75 ? T("🐢 慢速 0.75 ✅", "🐢 Slow 0.75 ✅") : T("🐇 正常速度 ✅", "🐇 Normal speed ✅"); }
  function toast(m) { var t = $("toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.add("hidden"); }, 2200); }

  /* ═══════ 图形（全部原创 SVG / emoji） ═══════ */
  var OBJ = [["🍎", "苹果", "apples"], ["🍓", "草莓", "strawberries"], ["🐟", "小鱼", "fish"], ["🌰", "松果", "nuts"], ["🍄", "蘑菇", "mushrooms"], ["🐞", "瓢虫", "ladybugs"],
    ["⭐", "星星", "stars"], ["🥕", "胡萝卜", "carrots"], ["🦋", "蝴蝶", "butterflies"], ["🐥", "小鸡", "chicks"], ["🍌", "香蕉", "bananas"], ["🌸", "小花", "flowers"]];
  var CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  function objsHTML(n, emo, opt) {
    opt = opt || {}; var s = '<div class="objs' + (opt.sm ? " sm" : "") + '">', gone = opt.gone || 0;
    for (var i = 0; i < n; i += 5) { s += '<div class="g5">'; for (var j = i; j < Math.min(n, i + 5); j++) s += '<span class="' + (j >= n - gone ? "gone" : "") + '">' + emo + "</span>"; s += "</div>"; }
    return s + "</div>";
  }
  /** 十格框 ten-frame：a 个蓝点 + b 个橙点，crossed 个划掉 */
  function tenFrame(a, b, crossed) {
    b = b || 0; crossed = crossed || 0; var total = a + b, frames = Math.max(1, Math.ceil(Math.max(total, 1) / 10)), s = "";
    for (var f = 0; f < frames; f++) {
      s += '<svg width="210" height="90" viewBox="0 0 210 90" role="img" aria-label="ten frame"><rect x="2" y="2" width="206" height="86" rx="8" fill="#fff" stroke="#2b2b2b" stroke-width="3"/>';
      for (var i = 0; i < 10; i++) {
        var k = f * 10 + i, x = 23 + (i % 5) * 41, y = 24 + Math.floor(i / 5) * 42;
        s += '<rect x="' + (x - 20) + '" y="' + (y - 20) + '" width="40" height="40" fill="none" stroke="#bbb"/>';
        if (k < total) { s += '<circle cx="' + x + '" cy="' + y + '" r="15" fill="' + (k < a ? "#2f7fd8" : "#ff9f1c") + '"/>';
          if (k >= total - crossed) s += '<path d="M' + (x - 14) + " " + (y - 14) + "L" + (x + 14) + " " + (y + 14) + "M" + (x + 14) + " " + (y - 14) + "L" + (x - 14) + " " + (y + 14) + '" stroke="#e5533d" stroke-width="5"/>'; }
      }
      s += "</svg>";
    }
    return s;
  }
  /** 十进制方块 base-ten blocks */
  function blocks(n) {
    var h = Math.floor(n / 100), t = Math.floor(n % 100 / 10), o = n % 10, w = h * 64 + t * 14 + Math.ceil(o / 5) * 14 + 40, s = "", x = 4;
    s = '<svg width="' + w + '" height="70" viewBox="0 0 ' + w + ' 70" role="img" aria-label="base ten blocks">';
    for (var i = 0; i < h; i++) { s += '<rect x="' + x + '" y="4" width="60" height="60" fill="#ffd23f" stroke="#2b2b2b" stroke-width="2"/>'; for (var g = 1; g < 10; g++) s += '<path d="M' + (x + g * 6) + " 4V64M" + x + " " + (4 + g * 6) + "H" + (x + 60) + '" stroke="#c9a000" stroke-width=".7"/>'; x += 64; }
    for (i = 0; i < t; i++) { s += '<rect x="' + x + '" y="4" width="10" height="60" fill="#7cc96f" stroke="#2b2b2b" stroke-width="2"/>'; for (g = 1; g < 10; g++) s += '<path d="M' + x + " " + (4 + g * 6) + "h10" + '" stroke="#3f7f3a" stroke-width=".7"/>'; x += 14; }
    for (i = 0; i < o; i++) s += '<rect x="' + (x + Math.floor(i / 5) * 14) + '" y="' + (4 + (i % 5) * 12) + '" width="10" height="10" fill="#ff9f1c" stroke="#2b2b2b" stroke-width="1.5"/>';
    return s + "</svg>";
  }
  /** 数轴 number line：lo..hi，每格 step；arrow 箭头；jump=[from,to] 跳跃弧线 */
  function numberLine(lo, hi, step, arrow, jump, labelAll) {
    var n = Math.round((hi - lo) / step), W = 340, pad = 18, dx = (W - 2 * pad) / n, s = '<svg width="100%" viewBox="0 0 ' + W + ' 96" style="max-width:520px" role="img" aria-label="number line"><path d="M6 60H' + (W - 6) + '" stroke="#2b2b2b" stroke-width="3"/>';
    var X = function (v) { return pad + (v - lo) / step * dx; };
    for (var i = 0; i <= n; i++) { var v = lo + i * step, x = pad + i * dx, lab = labelAll || i === 0 || i === n || v % (step * 5) === 0;
      s += '<path d="M' + x + " " + (lab ? 50 : 54) + "V70" + '" stroke="#2b2b2b" stroke-width="2"/>' + (lab ? '<text x="' + x + '" y="88" font-size="13" text-anchor="middle" font-weight="700">' + v + "</text>" : ""); }
    if (jump) { var a = X(jump[0]), b = X(jump[1]); s += '<path d="M' + a + " 56Q" + (a + b) / 2 + " 8 " + b + ' 56" fill="none" stroke="#ff9f1c" stroke-width="3"/><circle cx="' + b + '" cy="56" r="5" fill="#ff9f1c"/>'; }
    if (arrow != null) { var ax = X(arrow); s += '<path d="M' + ax + " 46L" + (ax - 9) + " 26H" + (ax + 9) + 'Z" fill="#e5533d"/><text x="' + ax + '" y="20" font-size="16" text-anchor="middle">❓</text>'; }
    return s + "</svg>";
  }
  function arrayDots(r, c) { var s = '<svg width="' + (c * 26 + 10) + '" height="' + (r * 26 + 10) + '" role="img" aria-label="array">'; for (var i = 0; i < r; i++) for (var j = 0; j < c; j++) s += '<circle cx="' + (18 + j * 26) + '" cy="' + (18 + i * 26) + '" r="9" fill="' + (i % 2 ? "#2f7fd8" : "#ff9f1c") + '"/>'; return s + "</svg>"; }
  function groupsHTML(total, g, emo) { var per = total / g, s = '<div class="vis">'; for (var i = 0; i < g; i++) s += '<div class="card" style="margin:0;padding:6px">' + objsHTML(per, emo, { sm: 1 }) + "</div>"; return s + "</div>"; }
  function clockSVG(h, m, size) {
    size = size || 190; var s = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 200 200" role="img" aria-label="clock"><circle cx="100" cy="100" r="92" fill="#fff" stroke="#2b2b2b" stroke-width="6"/>';
    for (var i = 1; i <= 12; i++) { var a = i * Math.PI / 6; s += '<text x="' + (100 + 72 * Math.sin(a)) + '" y="' + (108 - 72 * Math.cos(a)) + '" font-size="20" font-weight="800" text-anchor="middle">' + i + "</text>"; }
    for (i = 0; i < 60; i++) { var b = i * Math.PI / 30, r1 = i % 5 ? 86 : 82; s += '<path d="M' + (100 + r1 * Math.sin(b)) + " " + (100 - r1 * Math.cos(b)) + "L" + (100 + 90 * Math.sin(b)) + " " + (100 - 90 * Math.cos(b)) + '" stroke="#2b2b2b" stroke-width="' + (i % 5 ? 1 : 3) + '"/>'; }
    var ha = ((h % 12) + m / 60) * Math.PI / 6, ma = m * Math.PI / 30;
    s += '<path d="M100 100L' + (100 + 45 * Math.sin(ha)) + " " + (100 - 45 * Math.cos(ha)) + '" stroke="#2f7fd8" stroke-width="9" stroke-linecap="round"/>';
    s += '<path d="M100 100L' + (100 + 70 * Math.sin(ma)) + " " + (100 - 70 * Math.cos(ma)) + '" stroke="#e5533d" stroke-width="5" stroke-linecap="round"/><circle cx="100" cy="100" r="7" fill="#2b2b2b"/>';
    return s + "</svg>";
  }
  // 新西兰硬币和纸币（原创简化画法，不是真币图案）
  var MONEY = { 10: ["10c", "#c8733a", 44], 20: ["20c", "#c9ced6", 50], 50: ["50c", "#c9ced6", 58], 100: ["$1", "#e8c14a", 52], 200: ["$2", "#e8c14a", 56], 500: ["$5", "#ff9f6b"], 1000: ["$10", "#6fb7ff"], 2000: ["$20", "#7cd67c"] };
  function moneySVG(c) {
    var m = MONEY[c]; if (c >= 500) return '<svg width="96" height="54" viewBox="0 0 96 54" role="img" aria-label="' + m[0] + ' note"><rect x="2" y="2" width="92" height="50" rx="6" fill="' + m[1] + '" stroke="#2b2b2b" stroke-width="3"/><circle cx="70" cy="27" r="14" fill="rgba(255,255,255,.5)"/><text x="30" y="35" font-size="20" font-weight="900" text-anchor="middle">' + m[0] + "</text></svg>";
    var r = m[2] / 2; return '<svg width="' + m[2] + '" height="' + m[2] + '" role="img" aria-label="' + m[0] + ' coin"><circle cx="' + r + '" cy="' + r + '" r="' + (r - 2) + '" fill="' + m[1] + '" stroke="#2b2b2b" stroke-width="3"/><circle cx="' + r + '" cy="' + r + '" r="' + (r - 7) + '" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2"/><text x="' + r + '" y="' + (r + 6) + '" font-size="' + (r * 0.62) + '" font-weight="900" text-anchor="middle">' + m[0] + "</text></svg>";
  }
  function fmtMoney(c) { return c % 100 === 0 ? "$" + c / 100 : c < 100 ? c + "c" : "$" + (c / 100).toFixed(2); }
  function sayMoney(c) { var d = Math.floor(c / 100), ce = c % 100; return (d ? d + "元" : "") + (ce ? ce + "分" : ""); }
  function sayMoneyEn(c) { var d = Math.floor(c / 100), ce = c % 100; return (d ? d + " dollar" + (d > 1 ? "s" : "") : "") + (d && ce ? " " : "") + (ce ? ce + " cents" : ""); }
  var SHAPES2D = { circle: ["圆形", "circle", 0, 0], triangle: ["三角形", "triangle", 3, 3], square: ["正方形", "square", 4, 4], rectangle: ["长方形", "rectangle", 4, 4], pentagon: ["五边形", "pentagon", 5, 5], hexagon: ["六边形", "hexagon", 6, 6], oval: ["椭圆形", "oval", 0, 0] };
  function poly(n, r, rot) { var p = []; for (var i = 0; i < n; i++) { var a = rot + i * 2 * Math.PI / n; p.push((60 + r * Math.cos(a)).toFixed(1) + "," + (60 + r * Math.sin(a)).toFixed(1)); } return p.join(" "); }
  function shape2D(k, col) {
    col = col || pick(["#ff9f1c", "#2f7fd8", "#7cc96f", "#e5533d", "#b47cff"]); var st = 'fill="' + col + '" stroke="#2b2b2b" stroke-width="4"', s = '<svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="shape">';
    if (k === "circle") s += '<circle cx="60" cy="60" r="48" ' + st + "/>"; else if (k === "oval") s += '<ellipse cx="60" cy="60" rx="54" ry="34" ' + st + "/>";
    else if (k === "square") s += '<rect x="16" y="16" width="88" height="88" ' + st + "/>"; else if (k === "rectangle") s += '<rect x="6" y="30" width="108" height="60" ' + st + "/>";
    else s += '<polygon points="' + poly({ triangle: 3, pentagon: 5, hexagon: 6 }[k], 52, -Math.PI / 2) + '" ' + st + "/>";
    return s + "</svg>";
  }
  var SHAPES3D = { cube: ["正方体", "cube", 6, 8, "🎲"], cuboid: ["长方体", "cuboid (rectangular prism)", 6, 8, "📦"], sphere: ["球体", "sphere", 1, 0, "⚽"], cylinder: ["圆柱", "cylinder", 3, 0, "🥫"], cone: ["圆锥", "cone", 2, 1, "🍦"], pyramid: ["四棱锥", "square pyramid", 5, 5, "⛺"] };
  function shape3D(k) {
    var s = '<svg width="130" height="130" viewBox="0 0 130 130" role="img" aria-label="3D shape" stroke="#2b2b2b" stroke-width="3" stroke-linejoin="round">';
    if (k === "cube") s += '<polygon points="25,45 85,45 85,105 25,105" fill="#ffb347"/><polygon points="25,45 50,22 110,22 85,45" fill="#ffd28a"/><polygon points="85,45 110,22 110,82 85,105" fill="#e08a2c"/>';
    else if (k === "cuboid") s += '<polygon points="10,55 90,55 90,105 10,105" fill="#6fb7ff"/><polygon points="10,55 35,32 115,32 90,55" fill="#a9d4ff"/><polygon points="90,55 115,32 115,82 90,105" fill="#3f8fd8"/>';
    else if (k === "sphere") s += '<circle cx="65" cy="65" r="50" fill="#7cc96f"/><ellipse cx="65" cy="65" rx="50" ry="14" fill="none" stroke-dasharray="5 4"/><circle cx="48" cy="45" r="10" fill="#fff" stroke="none" opacity=".6"/>';
    else if (k === "cylinder") s += '<path d="M25 30V100A40 14 0 0 0 105 100V30" fill="#e5533d"/><ellipse cx="65" cy="30" rx="40" ry="14" fill="#ff8a78"/>';
    else if (k === "cone") s += '<path d="M65 12L105 100A40 14 0 0 1 25 100Z" fill="#b47cff"/><ellipse cx="65" cy="100" rx="40" ry="14" fill="#d2b0ff"/>';
    else s += '<polygon points="65,12 20,100 80,115" fill="#ffd23f"/><polygon points="65,12 80,115 112,95" fill="#d4a800"/><path d="M65 12L55 90L20 100M55 90L112 95" fill="none" stroke-dasharray="4 4"/>';
    return s + "</svg>";
  }

  /* ═══════ 出题 ═══════
   * 每个出题函数 gen(d) 返回一道题；d = 0/1/2 是关内难度（自适应调整）。
   * 题目：{zh, en, sayZh, sayEn, vis, opts:[{k, html}], ans, hint, kind}
   */
  function numOpts(ans, n, lo, hi, extra) {
    var set = [ans]; (extra || []).forEach(function (x) { if (set.length < n && x >= lo && x <= hi && set.indexOf(x) === -1) set.push(x); });
    var near = shuffle([1, -1, 2, -2, 10, -10, 3, -3]); near.forEach(function (d) { var x = ans + d; if (set.length < n && x >= lo && x <= hi && set.indexOf(x) === -1) set.push(x); });
    var guard = 0; while (set.length < n && guard++ < 200) { var y = rnd(lo, hi); if (set.indexOf(y) === -1) set.push(y); }
    return shuffle(set).map(function (x) { return { k: String(x), html: String(x) }; });
  }
  function Q(o) { o.ans = String(o.ans); o.kind = o.kind || "choice"; o.te = o.te || o.sayEn || o.en; o.she = o.she || "Look at the hint."; o.he = o.he || o.hint; return o; }
  function nOpts(d, pre) { return pre ? (d === 0 ? 2 : 3) : (d === 0 ? 3 : 4); }

  /* ── 学前档 ── */
  var G = {};
  G.count = function (max) { return function (d) {
    var lo = max === 20 ? 11 : 1, hi = max === 20 ? [14, 17, 20][d] : [Math.min(max, 3), Math.min(max, 5 + (max > 5 ? 2 : 0)), max][d];
    var n = rnd(lo, hi), o = pick(OBJ);
    return Q({ zh: "数一数，有几个" + o[1] + "？", en: "How many " + o[2] + "?", sayZh: "数一数，有几个" + o[1] + "？", sayEn: "Count. How many " + o[2] + "?",
      vis: objsHTML(n, o[0]), opts: numOpts(n, nOpts(d, 1), Math.max(1, lo - 2), max), ans: n,
      hint: "一边点，一边数：" + tenFrame(n) + "<br>用手指一个一个数 👆", sayHint: "我们一起慢慢数",
      he: "Touch each one as you count: " + tenFrame(n) + "<br>Count them one by one with your finger 👆", she: "Let's count them together." }); }; };
  G.hear = function (max) { return function (d) {
    var lo = max === 20 ? 11 : 1, n = rnd(lo, max);
    if (Math.random() < 0.45) { var ks = numOpts(n, nOpts(d, 1), Math.max(1, lo - 3), max); ks.forEach(function (k) { k.html = tenFrame(+k.k); });
      return Q({ zh: "🔊 哪一个是 " + n + "？", en: "Which one shows " + n + "?", sayZh: "哪一个是" + n + "？", sayEn: "Which one shows " + n + "?", vis: '<button class="btn blue" style="width:auto;font-size:2.4rem;padding:6px 30px" data-say="1">🔊</button>',
        opts: ks, ans: n, optCls: "grp", hint: "一排是 10 个格子。" + n + " 是这么多：" + tenFrame(n), sayHint: "这个数字是" + n, he: "One row is 10 boxes. " + n + " looks like this: " + tenFrame(n), she: "The number is " + n + "." }); }
    return Q({ zh: "🔊 找到数字 " + n, en: "Find the number " + n, sayZh: "找到数字" + n, sayEn: "Find the number " + n, vis: '<button class="btn blue" style="width:auto;font-size:2.4rem;padding:6px 30px" data-say="1">🔊</button>',
      opts: numOpts(n, nOpts(d, 1) + (d === 2 ? 1 : 0), Math.max(1, lo - 3), max, [n % 10 === n ? n + 10 : n - 10, Number(String(n).split("").reverse().join(""))]), ans: n,
      hint: "数字 " + n + " 是这么多：" + tenFrame(n), sayHint: "这个数字是" + n, he: "This is how many " + n + " is: " + tenFrame(n), she: "The number is " + n + ".", bigOpts: 1 }); }; };
  G.match = function (d) {
    var n = rnd(1, [5, 8, 10][d]), o = pick(OBJ), ks = numOpts(n, nOpts(d, 1), 1, 10);
    ks.forEach(function (k) { k.html = objsHTML(+k.k, o[0], { sm: 1 }); });
    return Q({ zh: "哪一组是 " + n + " 个？", en: "Which group has " + n + "?", sayZh: "哪一组是" + n + "个" + o[1] + "？", sayEn: "Which group has " + n + " " + o[2] + "?",
      vis: '<div class="bignum">' + n + "</div>", opts: ks, ans: n, optCls: "grp", hint: tenFrame(n), sayHint: n + "个，我们一个一个数", she: n + ". Let's count them one by one." });
  };
  G.compare = function (more) { return function (d) {
    var a = rnd(1, [6, 8, 10][d]), b; do { b = rnd(1, [6, 8, 10][d]); } while (Math.abs(a - b) < (d === 2 ? 1 : 2));
    var o = pick(OBJ), o2 = d === 2 ? pick(OBJ) : o, ans = (more ? a > b : a < b) ? "L" : "R";
    return Q({ zh: (more ? "哪边多？" : "哪边少？"), en: more ? "Which has more?" : "Which has fewer?", sayZh: more ? "哪边多？" : "哪边少？", sayEn: more ? "Which side has more?" : "Which side has fewer?",
      vis: "", opts: [{ k: "L", html: objsHTML(a, o[0], { sm: 1 }) }, { k: "R", html: objsHTML(b, o2[0], { sm: 1 }) }], ans: ans, optCls: "grp",
      hint: "排成一排比一比：<br>" + tenFrame(a) + "<br>" + tenFrame(b), sayHint: "左边" + a + "个，右边" + b + "个",
      he: "Line them up and compare:<br>" + tenFrame(a) + "<br>" + tenFrame(b), she: a + " on the left, " + b + " on the right." }); }; };
  G.oneMore = function (d) {
    var plus = Math.random() < 0.6, n = rnd(plus ? 1 : 2, [5, 8, 10][d] - (plus ? 1 : 0)), o = pick(OBJ), ans = plus ? n + 1 : n - 1;
    return Q({ zh: n + " 个" + o[1] + "，" + (plus ? "再来 1 个" : "走了 1 个") + "，现在有几个？", en: plus ? "One more" : "One less", sayZh: n + "个" + o[1] + "，" + (plus ? "再来一个" : "走了一个") + "，现在有几个？", sayEn: n + " " + o[2] + ". " + (plus ? "One more comes" : "One goes away") + ". How many now?",
      vis: objsHTML(n, o[0], { gone: plus ? 0 : 1 }) + (plus ? '<span style="font-size:2rem">➕' + o[0] + "</span>" : ""), opts: numOpts(ans, nOpts(d, 1), 0, 11, [n]), ans: ans,
      hint: numberLine(0, 10, 1, null, [n, ans], true), sayHint: plus ? n + "后面是几？" : n + "前面是几？", she: plus ? "What comes after " + n + "?" : "What comes before " + n + "?" });
  };
  G.addPic = function (max) { return function (d) {
    var top = max === 5 ? [3, 4, 5][d] : [6, 8, 10][d], a = rnd(1, top - 1), b = rnd(1, top - a), o = pick(OBJ);
    return Q({ zh: a + " 个" + o[1] + " 和 " + b + " 个" + o[1] + "，一共几个？", en: a + " + " + b + " = ?  add", sayZh: a + "个" + o[1] + "，再加" + b + "个，一共几个？", sayEn: a + " " + o[2] + " and " + b + " more. How many altogether?",
      vis: objsHTML(a, o[0]) + '<span style="font-size:2.2rem;font-weight:900">➕</span>' + objsHTML(b, o[0]), opts: numOpts(a + b, nOpts(d, 1), 1, 10, [a, b]), ans: a + b,
      hint: "蓝色 " + a + " 个，橙色 " + b + " 个，一起数：" + tenFrame(a, b) + "<br>✋ 左手伸 " + a + " 个手指，右手伸 " + b + " 个", sayHint: "一只手伸" + a + "个手指，另一只手伸" + b + "个，一起数",
      he: "Blue " + a + ", orange " + b + ". Count them all: " + tenFrame(a, b) + "<br>✋ Hold up " + a + " fingers on one hand and " + b + " on the other", she: "Hold up " + a + " fingers, then " + b + " more, and count them all." }); }; };
  G.subPic = function (d) {
    var n = rnd(2, [5, 8, 10][d]), m = rnd(1, n - 1), o = pick(OBJ);
    return Q({ zh: n + " 个" + o[1] + "，拿走 " + m + " 个，还剩几个？", en: n + " − " + m + " = ?  take away", sayZh: "有" + n + "个" + o[1] + "，拿走" + m + "个，还剩几个？", sayEn: n + " " + o[2] + ". Take away " + m + ". How many are left?",
      vis: objsHTML(n, o[0], { gone: m }), opts: numOpts(n - m, nOpts(d, 1), 0, 10, [m, n]), ans: n - m,
      hint: "划掉的不算，数没划掉的：" + tenFrame(n, 0, m), sayHint: "划掉的不算，数一数还剩几个", he: "Don't count the crossed-out ones. Count the rest: " + tenFrame(n, 0, m), she: "Skip the crossed-out ones and count what is left." });
  };

  /* ── 小学档：数感 ── */
  G.pv = function (d) {
    var n = d === 0 ? rnd(11, 99) : rnd(101, 999), places = d === 0 ? [["十位", "tens", 10], ["个位", "ones", 1]] : [["百位", "hundreds", 100], ["十位", "tens", 10], ["个位", "ones", 1]];
    if (Math.random() < 0.45) {
      return Q({ zh: "这些方块是多少？", en: "What number do the blocks show?", sayZh: "这些方块表示多少？", sayEn: "What number do the blocks show?", vis: blocks(n),
        opts: numOpts(n, 4, 10, 999, [Number(String(n).split("").reverse().join("")), n + 10, n - 10, n + 100]), ans: n,
        hint: "大方块=100，长条=10，小方块=1。<br>" + Math.floor(n / 100) + " 个百 + " + Math.floor(n % 100 / 10) + " 个十 + " + n % 10 + " 个一", sayHint: "先数百，再数十，最后数一",
        he: "Big square = 100, long stick = 10, small cube = 1.<br>" + Math.floor(n / 100) + " hundreds + " + Math.floor(n % 100 / 10) + " tens + " + n % 10 + " ones", she: "Count the hundreds, then the tens, then the ones." });
    }
    var p = pick(places), dig = Math.floor(n / p[2]) % 10, digits = String(n).split("").map(Number);
    return Q({ zh: n + " 的" + p[0] + "上是几？", en: "What is the " + p[1] + " digit?", sayZh: n + "的" + p[0] + "上是几？", sayEn: "In " + n + ", what is the " + p[1] + " digit?", vis: '<div class="bignum">' + n + "</div>" + blocks(n),
      opts: numOpts(dig, 4, 0, 9, digits), ans: dig, hint: places.map(function (x) { return x[0] + " " + x[1] + "：" + Math.floor(n / x[2]) % 10; }).join("<br>"), sayHint: "从右往左：个位、十位、百位", he: places.map(function (x) { return x[1] + ": " + Math.floor(n / x[2]) % 10; }).join("<br>"), she: "From the right: ones, tens, hundreds." });
  };
  G.nl = function (d) {
    var step = [1, 2, 10][d] === 2 ? pick([2, 5]) : [1, 2, 10][d], lo = d === 2 ? rnd(0, 9) * 10 : rnd(0, 10) * step, hi = lo + 10 * step, v = lo + rnd(1, 9) * step;
    return Q({ zh: "箭头指着哪个数？", en: "Number line: which number?", sayZh: "数轴上，箭头指着哪个数？", sayEn: "On the number line, which number is the arrow pointing to?",
      vis: numberLine(lo, hi, step, v), opts: numOpts(v, 4, lo, hi, [v + step, v - step]).map(function (o) { return o; }), ans: v,
      hint: "每一格是 " + step + "，从 " + lo + " 开始 " + step + "、" + step + " 地往后数", sayHint: "每一格是" + step, he: "Each jump is " + step + ". Start at " + lo + " and count on in " + step + "s", she: "Each jump is " + step + "." });
  };
  G.oe = function (d) {
    var n = d === 0 ? rnd(1, 20) : d === 1 ? rnd(21, 99) : rnd(100, 999), ans = n % 2 ? "odd" : "even";
    return Q({ zh: n + " 是单数还是双数？", en: "Odd or even?", sayZh: n + "是单数还是双数？", sayEn: "Is " + n + " odd or even?", vis: '<div class="bignum">' + n + "</div>",
      opts: [{ k: "odd", html: "单数<br><span class=\"en\">odd</span>" }, { k: "even", html: "双数<br><span class=\"en\">even</span>" }], ans: ans, optCls: "txt",
      hint: "只看个位 " + n % 10 + "：0 2 4 6 8 是双数，1 3 5 7 9 是单数。<br>" + (n <= 20 ? arrayDots(2, Math.ceil(n / 2)) : ""), sayHint: "只看个位", he: "Just look at the ones digit, " + n % 10 + ". 0 2 4 6 8 are even; 1 3 5 7 9 are odd.<br>" + (n <= 20 ? arrayDots(2, Math.ceil(n / 2)) : ""), she: "Just look at the ones digit." });
  };
  G.pat = function (d) {
    var step = pick([[2, 5, 10], [3, 4, 5, 10], [3, 4, 6, 25, 100]][d]), down = d > 0 && Math.random() < 0.35, start = down ? rnd(6, 12) * step : rnd(0, 6) * step, seq = [];
    for (var i = 0; i < 5; i++) seq.push(start + (down ? -1 : 1) * i * step);
    var miss = d === 0 ? 4 : rnd(1, 4), ans = seq[miss];
    return Q({ zh: "找规律，❓是几？", en: "Pattern: what comes next?", sayZh: "找规律，问号是几？", sayEn: "Find the pattern. What is the missing number?",
      vis: '<div class="eq">' + seq.map(function (x, i) { return i === miss ? "❓" : x; }).join(" , ") + "</div>", opts: numOpts(ans, 4, 0, 9999, [ans + 1, ans - 1, ans + step]), ans: ans,
      hint: "每次" + (down ? "减" : "加") + " " + step + "（" + (down ? "count back" : "skip count") + " by " + step + "）" + (step <= 10 && !down && seq[4] <= 100 ? numberLine(Math.floor(start / 10) * 10, Math.floor(start / 10) * 10 + 10 * step, step, null, null, true) : ""), sayHint: "每次" + (down ? "减" : "加") + step, he: (down ? "Count back" : "Skip count") + " by " + step + " each time" + (step <= 10 && !down && seq[4] <= 100 ? numberLine(Math.floor(start / 10) * 10, Math.floor(start / 10) * 10 + 10 * step, step, null, null, true) : ""), she: (down ? "Take away " : "Add ") + step + " each time." });
  };
  /* ── 加减法 ── */
  function colHTML(a, b, op) { var w = Math.max(String(a).length, String(b).length) + 1; var pad = function (x, s) { s = String(x); while (s.length < w) s = "\u2007" + s; return s; }; return '<div class="col">' + pad(a) + "<br>" + op + pad(b).slice(1) + "</div>"; }
  function addSub(kind) { return function (d) {
    var a, b, op, ans, ok = false;
    for (var g = 0; g < 100 && !ok; g++) {
      if (kind === "add2") { a = rnd(10, [40, 70, 89][d]); b = rnd(10, 99 - a); ok = a % 10 + b % 10 < 10; op = "+"; }
      else if (kind === "addR") { a = rnd([11, 15, 25][d], [49, 79, 99][d]); b = rnd([2, 12, 15][d], d === 0 ? 9 : 99 - a); ok = a % 10 + b % 10 >= 10 && a + b < 200; op = "+"; }
      else if (kind === "subR") { a = rnd([20, 30, 50][d], [50, 90, 99][d]); b = rnd(d === 0 ? 2 : 11, d === 0 ? 9 : a - 5); ok = a % 10 < b % 10 && b < a; op = "−"; }
      else { op = Math.random() < 0.5 ? "+" : "−"; a = rnd([100, 120, 200][d], [500, 800, 999][d]); b = rnd(d === 0 ? 10 : 100, d === 0 ? 99 : 400); ok = op === "+" ? a + b <= 999 : b < a; }
    }
    ans = op === "+" ? a + b : a - b;
    var noRegroup = op === "+" ? (Math.floor(a / 10) + Math.floor(b / 10)) * 10 + (a + b) % 10 : (Math.floor(a / 10) - Math.floor(b / 10)) * 10 + Math.abs(a % 10 - b % 10);
    var hint = op === "+" ? "先加个位 ones：" + a % 10 + " + " + b % 10 + " = " + (a % 10 + b % 10) + ((a % 10 + b % 10) >= 10 ? "，满十进一 regroup（10 个一换 1 个十）" : "") + "<br>再加十位 tens" + (a + b >= 100 ? "，最后百位 hundreds" : "")
      : "先算个位 ones：" + a % 10 + " 不够减 " + b % 10 + " 时，从十位借 1 个十（regroup）变成 " + (a % 10 + 10) + "<br>" + (a % 10 + 10) + " − " + b % 10 + " = " + (a % 10 + 10 - b % 10);
    var hintEn = op === "+" ? "Add the ones first: " + a % 10 + " + " + b % 10 + " = " + (a % 10 + b % 10) + ((a % 10 + b % 10) >= 10 ? ". That makes a ten, so regroup (10 ones = 1 ten)" : "") + "<br>Then add the tens" + (a + b >= 100 ? ", then the hundreds" : "")
      : "Ones first: " + a % 10 + " take away " + b % 10 + " doesn't work, so regroup 1 ten from the tens to make " + (a % 10 + 10) + "<br>" + (a % 10 + 10) + " − " + b % 10 + " = " + (a % 10 + 10 - b % 10);
    if (a < 100 && b < 100) { var bl = "<br>" + blocks(a) + (op === "+" ? " ➕ " + blocks(b) : ""); hint += bl; hintEn += bl; }
    return Q({ zh: (op === "+" ? "加法 add" : "减法 subtract") + "：算一算", en: a + " " + op + " " + b + " = ?", sayZh: a + (op === "+" ? "加" : "减") + b + "等于几？", sayEn: a + (op === "+" ? " plus " : " minus ") + b,
      vis: colHTML(a, b, op), opts: numOpts(ans, 4, 0, 1999, [noRegroup, ans + 10, ans - 10, ans + 1]), ans: ans, hint: hint, sayHint: "先算个位", te: a + " " + op + " " + b + " = ?", he: hintEn, she: "Start with the ones." }); }; }
  G.add2 = addSub("add2"); G.addR = addSub("addR"); G.subR = addSub("subR"); G.add3 = addSub("add3");
  /* ── 乘除 ── */
  function times(tables) { return function (d) {
    var t = pick(tables), n = rnd(1, [5, 10, 12][d]), flip = Math.random() < 0.4, a = flip ? n : t, b = flip ? t : n, ans = a * b;
    return Q({ zh: "乘法 multiply：" + a + " × " + b + " = ?", en: a + " groups of " + b, sayZh: a + "乘" + b + "等于几？", sayEn: a + " times " + b,
      vis: '<div class="eq">' + a + " × " + b + " = ❓</div>", opts: numOpts(ans, 4, 0, 150, [ans + t, ans - t, a + b]), ans: ans,
      hint: a + " 排，每排 " + b + " 个（array）：<br>" + arrayDots(a, b) + "<br>" + b + " 个 " + b + " 个地数：" + Array.apply(null, Array(a)).map(function (x, i) { return (i + 1) * b; }).join("、"), sayHint: b + "个" + b + "个地数", te: a + " × " + b + " = ?",
      he: a + " rows of " + b + " (an array):<br>" + arrayDots(a, b) + "<br>Skip count in " + b + "s: " + Array.apply(null, Array(a)).map(function (x, i) { return (i + 1) * b; }).join(", "), she: "Skip count in " + b + "s." }); }; }
  G.t2510 = times([2, 5, 10]); G.t34 = times([3, 4]);
  G.div = function (d) {
    var g = rnd(2, [3, 4, 5][d]), per = rnd(1, [4, 6, 10][d]), tot = g * per, o = pick(OBJ);
    return Q({ zh: tot + " 个" + o[1] + "平均分给 " + g + " 只小动物，每只分几个？", en: "Share: " + tot + " ÷ " + g + " = ?", sayZh: tot + "个" + o[1] + "，平均分给" + g + "只小动物，每只分几个？", sayEn: "Share " + tot + " " + o[2] + " equally between " + g + ". How many each?",
      vis: objsHTML(tot, o[0], { sm: 1 }) + '<div style="font-size:2rem">' + ["🐰", "🦔", "🐿️", "🐻", "🦉"].slice(0, g).join("") + "</div>", opts: numOpts(per, 4, 1, 20, [g, per + 1]), ans: per,
      hint: "一人一个轮流分（sharing）：" + groupsHTML(tot, g, o[0]), sayHint: "一人一个轮流分", he: "Share them out one at a time: " + groupsHTML(tot, g, o[0]), she: "Give one to each, then go round again." });
  };
  G.grp = function (d) {
    var size = rnd(2, [3, 5, 10][d]), n = rnd(2, [4, 6, 8][d]), tot = size * n, o = pick(OBJ);
    return Q({ zh: tot + " 个" + o[1] + "，每 " + size + " 个装一袋，可以装几袋？", en: "Grouping: " + tot + " ÷ " + size + " = ?", sayZh: tot + "个" + o[1] + "，每" + size + "个装一袋，可以装几袋？", sayEn: tot + " " + o[2] + ", " + size + " in each bag. How many bags?",
      vis: objsHTML(tot, o[0], { sm: 1 }), opts: numOpts(n, 4, 1, 20, [size, n + 1]), ans: n, hint: size + " 个圈一组（groups of " + size + "）：" + groupsHTML(tot, n, o[0]), sayHint: size + "个圈成一组", he: "Make groups of " + size + ": " + groupsHTML(tot, n, o[0]), she: "Make groups of " + size + "." });
  };
  /* ── 时间 ── */
  function hh(h) { return ((h - 1) % 12 + 12) % 12 + 1; }
  function tStr(h, m) { h = hh(h); var nx = h % 12 + 1; if (m === 0) return [h + "点", h + " o'clock"]; if (m === 30) return [h + "点半", "half past " + h]; if (m === 15) return [h + "点15分", "quarter past " + h]; if (m === 45) return [h + "点45分", "quarter to " + nx]; return [h + "点" + m + "分", h + ":" + (m < 10 ? "0" : "") + m]; }
  function tOpt(h, m) { h = hh(h); var t = tStr(h, m); return { k: h + ":" + m, html: esc(t[0]) + '<br><span class="en">' + esc(t[1]) + "</span>" }; }
  function readClock(mins) { return function (d) {
    var h = rnd(1, 12), m = pick(mins), ms = mins.length > 1 && d > 0 ? mins : [m], set = [h + ":" + m], opts = [tOpt(h, m)];
    var cand = shuffle([[h % 12 + 1, m], [(h + 10) % 12 + 1, m], [h, pick([0, 15, 30, 45])], [m === 0 ? 12 : m / 5, h * 5 % 60], [h % 12 + 1, pick(ms)]]);
    cand.forEach(function (c) { var k = c[0] + ":" + c[1]; if (opts.length < (d === 0 ? 3 : 4) && set.indexOf(k) === -1 && c[0] >= 1 && c[0] <= 12) { set.push(k); opts.push(tOpt(c[0], c[1])); } });
    return Q({ zh: "几点了？", en: "What time is it?", sayZh: "钟面上是几点？", sayEn: "What time does the clock show?", vis: clockSVG(h, m), opts: shuffle(opts), ans: h + ":" + m, optCls: "txt",
      hint: "🔵 短针 hour hand 指着钟点；🔴 长针 minute hand：指 12 是整点 o'clock，指 6 是半 half past，指 3 是 15 分 quarter past，指 9 是 45 分 quarter to", sayHint: "短针看钟点，长针看分钟", he: "🔵 The short hour hand shows the hour. 🔴 The long minute hand: at 12 it's o'clock, at 6 it's half past, at 3 it's quarter past, at 9 it's quarter to", she: "The short hand shows the hour. The long hand shows the minutes." }); }; }
  G.oclock = readClock([0]); G.half = readClock([0, 30]); G.quarter = readClock([15, 45, 30, 0]);
  G.setclock = function (d) { var h = rnd(1, 12), m = pick([[0], [0, 30], [0, 15, 30, 45]][d]), t = tStr(h, m);
    return Q({ kind: "clock", zh: "把钟拨到 " + t[0], en: "Set the clock to " + t[1], sayZh: "请把钟拨到" + t[0], sayEn: "Set the clock to " + t[1], target: [h, m], step: d === 0 ? 30 : 15, ans: h + ":" + m,
      hint: "先拨短针到 " + (m === 45 ? "快到 " + (h % 12 + 1) : h) + "，再拨长针：" + (m === 0 ? "指 12" : m === 30 ? "指 6" : m === 15 ? "指 3" : "指 9"), sayHint: "先拨短针，再拨长针",
      he: "Move the short hand to " + (m === 45 ? "nearly " + (h % 12 + 1) : h) + " first, then the long hand to " + (m === 0 ? "12" : m === 30 ? "6" : m === 15 ? "3" : "9"), she: "Move the short hand first, then the long hand." }); };
  /* ── 钱 NZD ── */
  var COINS = [10, 20, 50, 100, 200], NOTES = [500, 1000, 2000];
  G.coin = function (d) { if (Math.random() < 0.5) return coinFind(d); var pool = d === 0 ? COINS : COINS.concat(NOTES), c = pick(pool), opts = shuffle([c].concat(shuffle(pool.filter(function (x) { return x !== c; })).slice(0, 3)));
    return Q({ zh: "这是多少钱？", en: "Which coin or note is this?", sayZh: "这是多少钱？", sayEn: "How much is this coin or note worth?", vis: moneySVG(c) + '<div style="font-size:.9rem;color:#777">（简化画法）</div>',
      opts: opts.map(function (x) { return { k: String(x), html: fmtMoney(x) }; }), ans: c, optCls: "txt", hint: "看上面写的数字：c 是分 cents，$ 是元 dollars。100c = $1", sayHint: "看上面写的数字", he: "Read the number on it: c means cents, $ means dollars. 100c = $1", she: "Read the number on it." }); };
  function coinFind(d) { var pool = d === 0 ? COINS : COINS.concat(NOTES), c = pick(pool), opts = shuffle([c].concat(shuffle(pool.filter(function (x) { return x !== c; })).slice(0, d === 0 ? 2 : 3)));
    return Q({ zh: "找一找：" + fmtMoney(c), en: "Find " + fmtMoney(c), sayZh: "找一找" + sayMoney(c), sayEn: "Find " + sayMoneyEn(c), vis: '<div class="bignum">' + fmtMoney(c) + "</div>",
      opts: opts.map(function (x) { return { k: String(x), html: moneySVG(x) }; }), ans: c, optCls: "grp", hint: "看钱上写的数字，和 " + fmtMoney(c) + " 一样的就是", sayHint: "看上面写的数字", he: "Look for the one with " + fmtMoney(c) + " written on it", she: "Read the number on it." }); }
  G.total = function (d) { var n = rnd(2, [3, 4, 5][d]), pool = [[10, 20, 50], [10, 20, 50, 100], [10, 20, 50, 100, 200, 500]][d], cs = []; for (var i = 0; i < n; i++) cs.push(pick(pool)); cs.sort(function (a, b) { return b - a; });
    var tot = cs.reduce(function (a, b) { return a + b; }, 0), opts = numOpts(tot / 10, 4, 1, 2000, [tot / 10 + 10, tot / 10 - 10, tot / 10 + 5]);
    return Q({ zh: "一共多少钱？", en: "How much altogether?", sayZh: "一共多少钱？", sayEn: "How much money altogether?", vis: '<div class="tray">' + cs.map(moneySVG).join("") + "</div>",
      opts: opts.map(function (o) { var c = +o.k * 10; return { k: String(c), html: fmtMoney(c) }; }), ans: tot, optCls: "txt", hint: "从大的开始加：" + cs.map(fmtMoney).join(" + ") + " = " + fmtMoney(tot), sayHint: "从大的钱开始加", he: "Start with the biggest: " + cs.map(fmtMoney).join(" + ") + " = " + fmtMoney(tot), she: "Start adding from the biggest one." }); };
  G.make = function (d) { var t = rnd(1, [10, 20, 50][d]) * 10, pool = d === 0 ? [10, 20, 50] : d === 1 ? [10, 20, 50, 100, 200] : COINS.concat([500]);
    if (d === 2) t = rnd(5, 99) * 10;
    return Q({ kind: "coins", zh: "放钱进钱包，凑成 " + fmtMoney(t), en: "Make " + fmtMoney(t), sayZh: "请凑出" + sayMoney(t), sayEn: "Make " + sayMoneyEn(t), target: t, pool: pool, ans: t,
      hint: "先放大的，不够再放小的。例如 " + fmtMoney(t) + " = " + (function () { var r = t, out = []; pool.slice().sort(function (a, b) { return b - a; }).forEach(function (c) { while (r >= c) { out.push(fmtMoney(c)); r -= c; } }); return out.join(" + "); })(), sayHint: "先放大的钱", she: "Put the biggest money in first.", he: "Big ones first, then smaller ones. For example " + fmtMoney(t) + " = " + (function () { var r = t, out = []; pool.slice().sort(function (a, b) { return b - a; }).forEach(function (c) { while (r >= c) { out.push(fmtMoney(c)); r -= c; } }); return out.join(" + "); })() }); };
  G.change = function (d) { var paid = pick([[100, 200], [200, 500], [500, 1000, 2000]][d]), price = rnd(1, paid / 10 - 1) * 10, item = pick([["🍦", "冰淇淋", "an ice cream"], ["🧃", "果汁", "a juice"], ["📒", "本子", "a notebook"], ["🍪", "饼干", "a cookie"], ["✏️", "铅笔", "a pencil"]]), ch = paid - price;
    var opts = numOpts(ch / 10, 4, 1, 200, [ch / 10 + 10, ch / 10 - 10, price / 10]);
    return Q({ zh: item[0] + item[1] + " " + fmtMoney(price) + "，付了 " + fmtMoney(paid) + "，找回多少？", en: "Change from " + fmtMoney(paid) + "?", sayZh: item[1] + sayMoney(price) + "，付了" + sayMoney(paid) + "，要找回多少钱？", sayEn: item[2] + " costs " + sayMoneyEn(price) + ". You pay " + sayMoneyEn(paid) + ". How much change?",
      vis: '<div style="font-size:3rem">' + item[0] + '</div><div class="tray">' + moneySVG(paid) + "</div>", opts: opts.map(function (o) { var c = +o.k * 10; return { k: String(c), html: fmtMoney(c) }; }), ans: ch, optCls: "txt",
      hint: "从 " + fmtMoney(price) + " 往上数到 " + fmtMoney(paid) + "（count up）：" + fmtMoney(paid) + " − " + fmtMoney(price) + " = ?", sayHint: "从价钱往上数到付的钱", he: "Count up from " + fmtMoney(price) + " to " + fmtMoney(paid) + ": " + fmtMoney(paid) + " − " + fmtMoney(price) + " = ?", she: "Count up from the price to what you paid." }); };
  /* ── 形状 ── */
  G.s2d = function (d) { var keys = Object.keys(SHAPES2D), k = pick(d === 0 ? ["circle", "triangle", "square", "rectangle"] : keys), opts = shuffle([k].concat(shuffle(keys.filter(function (x) { return x !== k; })).slice(0, d === 0 ? 2 : 3)));
    return Q({ zh: "这是什么形状？", en: "Name the 2D shape", sayZh: "这是什么形状？", sayEn: "What is this shape called?", vis: shape2D(k), opts: opts.map(function (x) { return { k: x, html: SHAPES2D[x][0] + '<br><span class="en">' + SHAPES2D[x][1] + "</span>" }; }), ans: k, optCls: "txt",
      hint: "数一数有几条边 sides：" + SHAPES2D[k][2] + (k === "rectangle" ? "（两条长边、两条短边）" : k === "square" ? "（四条边一样长）" : ""), sayHint: "数一数有几条边", he: "Count the sides: " + SHAPES2D[k][2] + (k === "rectangle" ? " (two long sides, two short sides)" : k === "square" ? " (all four sides the same length)" : ""), she: "Count the sides." }); };
  G.s3d = function (d) { if (Math.random() < 0.4) return G.s3dObj(d); var keys = Object.keys(SHAPES3D), k = pick(keys), opts = shuffle([k].concat(shuffle(keys.filter(function (x) { return x !== k; })).slice(0, d === 0 ? 2 : 3)));
    return Q({ zh: "这是什么立体图形？", en: "Name the 3D shape", sayZh: "这是什么立体图形？", sayEn: "What is this 3D shape called?", vis: shape3D(k) + (d < 2 ? '<div style="font-size:2.4rem">' + SHAPES3D[k][4] + "</div>" : ""), opts: opts.map(function (x) { return { k: x, html: SHAPES3D[x][0] + '<br><span class="en">' + SHAPES3D[x][1] + "</span>" }; }), ans: k, optCls: "txt",
      hint: "生活里像：" + SHAPES3D[k][4], sayHint: "想一想生活里什么东西像它", he: "It looks like: " + SHAPES3D[k][4], she: "Think of something at home that looks like it." }); };
  G.s3dObj = function (d) { var keys = Object.keys(SHAPES3D), k = pick(keys), opts = shuffle([k].concat(shuffle(keys.filter(function (x) { return x !== k; })).slice(0, d === 0 ? 2 : 3)));
    return Q({ zh: "这个东西像哪种立体图形？", en: "Which 3D shape is this like?", sayZh: "这个东西像哪种立体图形？", sayEn: "Which 3D shape is this object like?", vis: '<div style="font-size:4rem">' + SHAPES3D[k][4] + "</div>", opts: opts.map(function (x) { return { k: x, html: SHAPES3D[x][0] + '<br><span class="en">' + SHAPES3D[x][1] + "</span>" }; }), ans: k, optCls: "txt",
      hint: "它是" + SHAPES3D[k][0] + "：" + shape3D(k), sayHint: "看看它的样子", he: "It is a " + SHAPES3D[k][1] + ": " + shape3D(k), she: "Look at its shape." }); };
  G.sides = function (d) { var k, a, what;
    if (d < 2 || Math.random() < 0.5) { k = pick(["triangle", "square", "rectangle", "pentagon", "hexagon"]); what = pick(["边 sides", "角 corners"]); a = SHAPES2D[k][what[0] === "边" ? 2 : 3];
      return Q({ zh: "这个" + SHAPES2D[k][0] + "有几个" + what.split(" ")[0] + "？", en: "How many " + what.split(" ")[1] + "?", sayZh: "这个图形有几个" + (what[0] === "边" ? "边" : "角") + "？", sayEn: "How many " + what.split(" ")[1] + " does it have?", vis: shape2D(k), opts: numOpts(a, 4, 2, 8), ans: a, hint: "用手指沿着边走一圈，一边走一边数。三角形 3，四边形 4，五边形 5，六边形 6", sayHint: "沿着边走一圈数一数", he: "Run your finger around the edge and count as you go. Triangle 3, quadrilateral 4, pentagon 5, hexagon 6", she: "Trace around the edge and count." }); }
    k = pick(["cube", "cuboid", "pyramid"]); var face = Math.random() < 0.5; a = SHAPES3D[k][face ? 2 : 3];
    return Q({ zh: SHAPES3D[k][0] + "有几个" + (face ? "面 faces" : "顶点 vertices（角）") + "？", en: "How many " + (face ? "faces" : "vertices") + "?", sayZh: SHAPES3D[k][0] + "有几个" + (face ? "面" : "顶点") + "？", sayEn: "How many " + (face ? "faces" : "vertices") + " does a " + SHAPES3D[k][1] + " have?", vis: shape3D(k), opts: numOpts(a, 4, 2, 12), ans: a,
      hint: k === "pyramid" ? "底面 1 个正方形 + 4 个三角形面；顶点：底下 4 个 + 顶上 1 个" : "上下 2 个面 + 前后 2 个 + 左右 2 个 = 6 个面；顶点：上面 4 个 + 下面 4 个 = 8", sayHint: "上下前后左右数一数", he: k === "pyramid" ? "1 square base + 4 triangle faces; vertices: 4 at the bottom + 1 on top" : "Top and bottom 2 + front and back 2 + left and right 2 = 6 faces; vertices: 4 on top + 4 underneath = 8", she: "Count top, bottom, front, back, left and right." }); };
  /* ── 关底挑战（多步应用题）── */
  function wp(zh, en, ans, hint, lo, hi, extra, he) { return Q({ zh: zh, en: en, sayZh: zh, sayEn: en, vis: "", opts: numOpts(ans, 4, lo || 0, hi || 9999, extra), ans: ans, hint: hint, sayHint: "一步一步来", he: he || hint, she: "One step at a time.", wordy: 1 }); }
  var BOSS = {
    b1: function (d) { var a = rnd(2, 8), b = rnd(1, 9), n = a * 10 + b; return pick([function () { return wp("小松鼠有 " + a + " 袋松果，每袋 10 个，还有 " + b + " 个散的。一共几个？", "Squirrel has " + a + " bags of pine cones with 10 in each bag, and " + b + " loose ones. How many altogether?", n, a + " 个十 + " + b + " 个一", 10, 99, [b * 10 + a], a + " tens + " + b + " ones"); },
      function () { var x = rnd(10, 80); return wp("比 " + x + " 多 10 的数，再加 1，是多少？", "What is 10 more than " + x + ", then 1 more?", x + 11, x + " → " + (x + 10) + " → ?", 0, 120, [x + 10, x + 1]); },
      function () { var x = rnd(3, 30) * 2 + 1; return wp("一个单数 odd 比 " + x + " 大，而且最接近它。是几？", "What is the next odd number after " + x + "?", x + 2, "单数每次 +2", 0, 99, [x + 1], "Odd numbers go up by 2"); }])(); },
    b2: function (d) { var a = rnd(15, 60), b = rnd(12, 30), c = rnd(5, 20); return pick([function () { return wp("森林车上有 " + a + " 只小动物，下去 " + c + " 只，又上来 " + b + " 只。现在有几只？", "The forest bus has " + a + " animals. " + c + " get off, then " + b + " get on. How many now?", a - c + b, "先算 " + a + " − " + c + " = " + (a - c) + "，再加 " + b, 0, 200, [a + c + b, a - c], "First " + a + " − " + c + " = " + (a - c) + ", then add " + b); },
      function () { return wp("小熊摘了 " + a + " 个莓果，小兔摘了 " + b + " 个。小熊比小兔多几个？", "Bear picked " + a + " berries and Rabbit picked " + b + ". How many more did Bear pick?", a - b > 0 ? a - b : b - a, "大的减小的", 0, 100, [a + b], "Take the smaller number from the bigger one"); },
      function () { return wp("树上有 " + (a + b) + " 个苹果，掉下 " + b + " 个，又掉下 " + c + " 个。还剩几个？", "A tree has " + (a + b) + " apples. " + b + " fall down, then " + c + " more fall. How many are left?", a - c, (a + b) + " − " + b + " − " + c, 0, 200, [a, a + c]); }])(); },
    b3: function (d) { var g = rnd(3, 6), p = pick([2, 3, 4, 5, 10]), x = rnd(1, 5); return pick([function () { return wp(g + " 只瓢虫，每只 " + p + " 个斑点，又飞来一只有 " + x + " 个斑点的。一共几个斑点？", g + " ladybirds have " + p + " spots each. Then one more flies in with " + x + " spots. How many spots altogether?", g * p + x, "先算 " + g + " × " + p + " = " + g * p, 0, 100, [g * p, (g + 1) * p], "First " + g + " × " + p + " = " + g * p); },
      function () { var t = g * p; return wp(t + " 块饼干平均分给 " + g + " 只小狐，每只吃掉 1 块后，每只还剩几块？", t + " biscuits are shared equally between " + g + " foxes. Each fox eats 1. How many does each fox have left?", p - 1, "先算 " + t + " ÷ " + g + " = " + p, 0, 20, [p], "First " + t + " ÷ " + g + " = " + p); },
      function () { return wp("每辆小车坐 " + p + " 只小鸡，" + g + " 辆车坐满了，还有 " + x + " 只在走路。一共几只小鸡？", "Each little car holds " + p + " chicks. " + g + " cars are full, and " + x + " chicks are walking. How many chicks altogether?", g * p + x, g + " 个 " + p, 0, 100, [g * p], g + " groups of " + p); }])(); },
    b4: function (d) { var h = rnd(1, 9), dur = pick([1, 2, 3]); return pick([function () { var t = tStr(h + dur, 0); return Q({ zh: "小狐 " + h + " 点出发，走了 " + dur + " 小时。到达时间是？", en: "Elapsed time: " + dur + " hours", sayZh: "小狐" + h + "点出发，走了" + dur + "小时，几点到？", sayEn: "Little Fox leaves at " + h + " o'clock and walks for " + dur + (dur > 1 ? " hours" : " hour") + ". What time does Fox arrive?", vis: clockSVG(h, 0, 150), opts: shuffle([tOpt(h + dur, 0), tOpt(h + dur + 1, 0), tOpt(h, 30), tOpt(h + dur, 30)]), ans: hh(h + dur) + ":0", optCls: "txt", hint: "短针往前走 " + dur + " 格", sayHint: "往前数" + dur + "个小时", he: "Move the hour hand on " + dur, she: "Count on " + dur + (dur > 1 ? " hours." : " hour.") }); },
      function () { return Q({ zh: "电影 " + h + " 点开始，演了半小时。几点结束？", en: "Half an hour later", sayZh: "电影" + h + "点开始，演了半小时，几点结束？", sayEn: "A movie starts at " + h + " o'clock and lasts half an hour. When does it finish?", vis: clockSVG(h, 0, 150), opts: shuffle([tOpt(h, 30), tOpt(h + 1, 0), tOpt(h, 15), tOpt(h + 1, 30)]), ans: hh(h) + ":30", optCls: "txt", hint: "半小时 = 30 分，长针从 12 走到 6", sayHint: "半小时就是三十分钟", he: "Half an hour = 30 minutes. The long hand goes from 12 to 6", she: "Half an hour is thirty minutes." }); },
      function () { return wp("一小时有 60 分钟。" + dur + " 小时又 15 分钟是几分钟？", "There are 60 minutes in an hour. How many minutes is " + dur + (dur > 1 ? " hours" : " hour") + " and 15 minutes?", dur * 60 + 15, dur + " × 60 + 15", 0, 300, [dur * 60, dur * 15 + 60]); }])(); },
    b5: function (d) { var a = rnd(2, 9) * 10, b = rnd(2, 9) * 10, paid = 200, tot = a + b; return pick([function () { var o = numOpts(tot / 10, 4, 1, 100, [tot / 10 + 10]); return Q({ zh: "买 🍎 " + fmtMoney(a) + " 和 🍌 " + fmtMoney(b) + "，一共多少钱？", en: "Total cost", sayZh: "买苹果" + sayMoney(a) + "和香蕉" + sayMoney(b) + "，一共多少钱？", sayEn: "An apple costs " + sayMoneyEn(a) + " and a banana costs " + sayMoneyEn(b) + ". How much altogether?", vis: "", opts: o.map(function (x) { return { k: String(+x.k * 10), html: fmtMoney(+x.k * 10) }; }), ans: tot, optCls: "txt", hint: a + "c + " + b + "c", sayHint: "把两个价钱加起来", she: "Add the two prices together.", wordy: 1 }); },
      function () { var o = numOpts((paid - tot) / 10, 4, 1, 100, [tot / 10]); return Q({ zh: "买 🍎 " + fmtMoney(a) + " 和 🍌 " + fmtMoney(b) + "，付了 $2，找回多少？", en: "Two items, pay $2, change?", sayZh: "买苹果" + sayMoney(a) + "和香蕉" + sayMoney(b) + "，付两元，找回多少？", sayEn: "An apple costs " + sayMoneyEn(a) + " and a banana costs " + sayMoneyEn(b) + ". You pay two dollars. How much change?", vis: moneySVG(200), opts: o.map(function (x) { return { k: String(+x.k * 10), html: fmtMoney(+x.k * 10) }; }), ans: paid - tot, optCls: "txt", hint: "先算一共 " + fmtMoney(tot) + "，再用 $2 去减", sayHint: "先算一共多少钱", he: "First the total, " + fmtMoney(tot) + ", then take it away from $2", she: "First work out the total.", wordy: 1 }); },
      function () { var n = rnd(2, 5), c = pick([20, 50]); return wp("每支铅笔 " + c + "c，买 " + n + " 支要几分钱（cents）？", "Each pencil costs " + c + " cents. How many cents for " + n + " pencils?", n * c, n + " 个 " + c, 0, 500, [n + c, (n + 1) * c], n + " lots of " + c); }])(); },
    b6: function (d) { return pick([function () { var a = rnd(1, 4), b = rnd(1, 3); return wp(a + " 个三角形和 " + b + " 个正方形，一共有几条边？", a + (a > 1 ? " triangles" : " triangle") + " and " + b + (b > 1 ? " squares" : " square") + ". How many sides altogether?", a * 3 + b * 4, a + " × 3 + " + b + " × 4", 0, 40, [a + b, a * 4 + b * 3]); },
      function () { var n = rnd(2, 3); return wp(n + " 个正方体（cube）一共有几个面？", "How many faces do " + n + " cubes have altogether?", n * 6, "每个正方体 6 个面", 0, 30, [n * 8, n * 4], "Each cube has 6 faces"); },
      function () { return wp("一个五边形和一个六边形，角一共有几个？", "A pentagon and a hexagon. How many corners altogether?", 11, "5 + 6", 0, 20, [10, 12]); }])(); }
  };

  /* ═══════ 关卡地图 ═══════ */
  function L(id, zh, en, gen, extra) { var o = { id: id, zh: zh, en: en, gen: gen }; for (var k in extra || {}) o[k] = extra[k]; return o; }
  var TRACKS = {
    pre: { zh: "学前档", en: "Pre-school", stages: [
      { icon: "🍄", zh: "蘑菇村", en: "Counting", levels: [L("c5", "数到 5", "count to 5", G.count(5)), L("c10", "数到 10", "count to 10", G.count(10)), L("c20", "数到 20", "count to 20", G.count(20))] },
      { icon: "🏞️", zh: "小溪边", en: "Numerals", levels: [L("hear10", "听数字 1-10", "find the numeral", G.hear(10)), L("match10", "数字配一配", "match number & group", G.match), L("hear20", "听数字 11-20", "numerals to 20", G.hear(20))] },
      { icon: "🌳", zh: "大树下", en: "More / less", levels: [L("more", "哪边多", "more", G.compare(true)), L("less", "哪边少", "fewer", G.compare(false)), L("onemore", "多一个 少一个", "one more / one less", G.oneMore)] },
      { icon: "🌈", zh: "彩虹桥", en: "Add & take away", levels: [L("add5", "加一加 (5 以内)", "add within 5", G.addPic(5)), L("add10", "加一加 (10 以内)", "add within 10", G.addPic(10)), L("sub10", "拿走了几个", "take away within 10", G.subPic)] }
    ] },
    pri: { zh: "小学档", en: "Primary (Y3)", stages: [
      { icon: "🍄", zh: "数字村", en: "Number sense", boss: ["🐢", "糊涂乌龟", "Muddled Turtle"], levels: [L("pv", "数位 place value", "hundreds tens ones", G.pv), L("nl", "数轴 number line", "number line", G.nl), L("oe", "单双数 odd/even", "odd & even", G.oe), L("pat", "找规律 patterns", "patterns", G.pat), L("b1", "关底挑战", "challenge", BOSS.b1, { boss: 1 })] },
      { icon: "🏞️", zh: "加减小溪", en: "Add & subtract", boss: ["🦦", "调皮水獭", "Cheeky Otter"], levels: [L("add2", "两位数加法", "2-digit add", G.add2), L("addR", "进位加法", "add with regrouping", G.addR), L("subR", "退位减法", "subtract with regrouping", G.subR), L("add3", "三位数加减", "3-digit + −", G.add3), L("b2", "关底挑战", "challenge", BOSS.b2, { boss: 1 })] },
      { icon: "🌳", zh: "乘除大树", en: "× and ÷", boss: ["🦉", "猫头鹰博士", "Doctor Owl"], levels: [L("t2510", "2、5、10 乘法表", "2, 5, 10 times tables", G.t2510), L("t34", "3、4 乘法表", "3, 4 times tables", G.t34), L("div", "平均分 sharing", "division: sharing", G.div), L("grp", "分组 grouping", "division: grouping", G.grp), L("b3", "关底挑战", "challenge", BOSS.b3, { boss: 1 })] },
      { icon: "⏰", zh: "时钟山洞", en: "Time", boss: ["🦇", "迷糊蝙蝠", "Dozy Bat"], levels: [L("oclock", "整点 o'clock", "o'clock", G.oclock), L("half", "半点 half past", "half past", G.half), L("quarter", "一刻 quarter", "quarter past / to", G.quarter), L("setclock", "我来拨钟", "set the clock", G.setclock), L("b4", "关底挑战", "challenge", BOSS.b4, { boss: 1 })] },
      { icon: "🪙", zh: "森林小店", en: "Money (NZD)", boss: ["🦝", "精明浣熊", "Clever Raccoon"], levels: [L("coin", "认识钱币", "coins & notes", G.coin), L("total", "一共多少钱", "total", G.total), L("make", "凑钱 make it", "make an amount", G.make), L("change", "找零 change", "giving change", G.change), L("b5", "关底挑战", "challenge", BOSS.b5, { boss: 1 })] },
      { icon: "🔷", zh: "形状城堡", en: "Shapes", boss: ["🐉", "积木小龙", "Block Dragon"], levels: [L("s2d", "平面图形 2D", "2D shapes", G.s2d), L("s3d", "立体图形 3D", "3D shapes", G.s3d), L("sides", "边、角、面", "sides, corners, faces", G.sides), L("b6", "关底挑战", "challenge", BOSS.b6, { boss: 1 })] }
    ] }
  };
  function flat(track) { var out = []; TRACKS[track].stages.forEach(function (st, si) { st.levels.forEach(function (lv) { lv.si = si; lv.idx = out.length; out.push(lv); }); }); return out; }
  var FLAT = { pre: flat("pre"), pri: flat("pri") };
  var AVATARS = ["🦊", "🐼", "🐯", "🐰", "🐨", "🐸", "🦁", "🐧", "🐵", "🦄", "🐙", "🦖"];
  var STICKERS = ["🐿️", "🦔", "🦉", "🐻", "🦌", "🐇", "🦡", "🐢", "🦆", "🐝", "🐛", "🐌", "🦋", "🐞", "🐦", "🦜", "🐳", "🦭", "🦩", "🦚", "🐊", "🦥", "🦦", "🦘", "🐑", "🐮", "🐷", "🐔", "🦀", "🐠"];
  var PRAISE = [["真棒！", "Great!"], ["答对了！", "Correct!"], ["太厉害了！", "Awesome!"], ["好聪明！", "Clever!"], ["对啦！", "Yes!"]];
  var RETRY = [["再试试！", "Try again!"], ["没关系，再想想", "That's okay, have another go"], ["差一点点！", "So close!"]];
  var ROUND_LEN = 7, BOSS_SECONDS = 150;

  /* ═══════ 界面 ═══════ */
  var main = $("main"), screen = "title", R = null;
  function show(html) { VOICE.stop(); main.innerHTML = html; enify(main); main.scrollTop = 0; try { global.scrollTo(0, 0); } catch (e) { /* */ } }
  function topbar(on) { $("top").classList.toggle("hidden", !on); if (on && me) { $("who").innerHTML = esc(me.avatar) + " " + esc(me.name) + ' <small class="trk">' + T(TRACKS[me.track].zh, TRACKS[me.track].en) + "</small>"; $("gems").textContent = "💎 " + me.gems; } }
  function stopTimer() { if (R && R.timer) { clearInterval(R.timer); R.timer = null; } }
  $("homeBtn").onclick = function () { SFX.tap(); stopTimer(); R = null; if (me) mapScreen(); else title(); };
  $("setBtn").onclick = function () { SFX.tap(); stopTimer(); R = null; if (me) settings(); };

  function title() {
    screen = "title"; me = null; topbar(false);
    var h = '<div class="guide"><div class="face">🦊</div><div class="bubble">' + T('我是小狐！欢迎来到<b>森林数学大冒险</b>。<br>谁来玩？点你的头像 <span class="en">Who is playing?</span>', "I'm Little Fox! Welcome to <b>Forest Maths Adventure</b>.<br>Who is playing? Tap your animal.") + '</div></div><div class="players">';
    store.players.forEach(function (p) { h += '<button class="pl" data-pid="' + esc(p.id) + '"><span class="ava">' + esc(p.avatar) + "</span><b>" + esc(p.name) + '</b><small>' + T(TRACKS[p.track].zh, TRACKS[p.track].en) + " · 💎" + p.gems + "</small></button>"; });
    if (store.players.length < MAX_PLAYERS) h += '<button class="pl" id="addPl"><span class="ava">➕</span><b>' + T("新玩家", "New player") + '</b>' + T('<small class="en">new player</small>', "") + '</button>';
    h += '</div><p style="text-align:center;color:#6b5b3e;font-size:.9rem">' + T("最多 4 个玩家，每人单独存档（只存在这台设备上）", "Up to 4 players, each with their own save (kept on this device only)") + "</p>";
    show(h);
    [].forEach.call(main.querySelectorAll("[data-pid]"), function (b) { b.onclick = function () { SFX.tap(); choose(b.getAttribute("data-pid")); }; });
    if ($("addPl")) $("addPl").onclick = function () { SFX.tap(); profileForm(); };
  }
  function choose(pid) { me = store.players.filter(function (p) { return p.id === pid; })[0]; if (!me) return title(); store.current = pid; save(); mapScreen(); TTS.say("你好！我们出发吧！", "Kia ora! Let's go!"); }
  function profileForm() {
    screen = "profile"; topbar(false); var av = AVATARS[0], tr = null;
    show('<div class="card"><h2>新玩家 <span class="en">New player</span></h2><p>1. 写你的名字（或者小名）<span class="en">your name</span></p><input class="name" id="pname" maxlength="8" placeholder="' + T("名字", "Name") + '" autocomplete="off">' +
      '<p>2. 选一个头像 <span class="en">pick an animal</span></p><div class="avgrid">' + AVATARS.map(function (a, i) { return '<button class="btn' + (i ? "" : " sel") + '" data-av="' + a + '">' + a + "</button>"; }).join("") + "</div>" +
      '<p>3. 选路线 <span class="en">choose a track</span></p><div class="two"><button class="btn" data-tr="pre">' + T("🐣 学前档<br><small>数数、认数字、加减 10 以内</small>", "🐣 Pre-school<br><small>counting, numerals, + and − within 10</small>") + '</button><button class="btn" data-tr="pri">' + T("🚀 小学档<br><small>Year 3：加减乘除、时间、钱、形状</small>", "🚀 Primary<br><small>Year 3: + − × ÷, time, money, shapes</small>") + "</button></div>" +
      '<div class="row"><button class="btn" id="cancel">' + T("返回", "Back") + '</button><button class="btn primary" id="okP" disabled>' + T("出发！🌲", "Let's go! 🌲") + "</button></div></div>");
    function upd() { $("okP").disabled = !($("pname").value.trim() && tr); }
    $("pname").oninput = upd;
    [].forEach.call(main.querySelectorAll("[data-av]"), function (b) { b.onclick = function () { SFX.tap(); av = b.getAttribute("data-av"); [].forEach.call(main.querySelectorAll("[data-av]"), function (x) { x.classList.toggle("sel", x === b); }); }; });
    [].forEach.call(main.querySelectorAll("[data-tr]"), function (b) { b.onclick = function () { SFX.tap(); tr = b.getAttribute("data-tr"); [].forEach.call(main.querySelectorAll("[data-tr]"), function (x) { x.classList.toggle("sel", x === b); }); upd(); }; });
    $("cancel").onclick = title;
    $("okP").onclick = function () { var n = $("pname").value.trim().slice(0, 8); if (!n || !tr || store.players.length >= MAX_PLAYERS) return; var p = newPlayer(n, av, tr); if (tr === "pre") p.voice = "zh"; store.players.push(p); save(); choose(p.id); };
  }
  function mapScreen() {
    screen = "map"; topbar(true); var TK = TRACKS[me.track], fl = FLAT[me.track], un = me.unlock[me.track] || 1;
    var h = '<div class="guide"><div class="face">🦊</div><div class="bubble">' + (LANG === "en" ? (me.track === "pre" ? "Tap a bright level!" : "Pick a level to start! " + ROUND_LEN + " questions each.") : (me.track === "pre" ? "点一个亮着的关卡！" : "选一关开始冒险！每关 " + ROUND_LEN + " 题。") + ' <span class="en">Pick a level</span>') + "</div></div>";
    TK.stages.forEach(function (st, si) {
      h += '<div class="stage"><h2><span class="sic">' + st.icon + "</span> " + (LANG === "en" ? "Stop " + (si + 1) + ": " + esc(st.en) : "第" + (si + 1) + "站 " + esc(st.zh) + ' <span class="en">' + esc(st.en) + "</span>") + '</h2><div class="levels">';
      st.levels.forEach(function (lv) { var pr = me.prog[me.track][lv.id] || {}, locked = lv.idx >= un, stars = pr.stars || 0;
        h += '<button class="lv' + (locked ? " locked" : "") + (lv.boss ? " boss" : "") + '" data-lv="' + lv.idx + '"' + (locked ? " disabled" : "") + ">" + (locked ? "🔒" : lv.boss ? (st.boss ? st.boss[0] : "👾") : lv.idx + 1) + "<small>" + esc(T(lv.zh, lv.en)) + '</small><span class="stars">' + (locked ? "" : "★★★".slice(0, stars) + "☆☆☆".slice(0, 3 - stars)) + "</span></button>"; });
      h += "</div></div>" + (si < TK.stages.length - 1 ? '<div class="path">🐾 🐾 🐾</div>' : "");
    });
    h += '<div class="row"><button class="btn blue" id="coll">🎒 ' + T("我的收藏", "My collection") + " (" + me.stickers.length + ')</button><button class="btn" id="swap">👥 ' + T("换玩家", "Change player") + "</button></div>";
    show(h);
    [].forEach.call(main.querySelectorAll("[data-lv]"), function (b) { b.onclick = function () { if (b.disabled) return; SFX.tap(); startRound(+b.getAttribute("data-lv")); }; });
    $("coll").onclick = function () { SFX.tap(); collection(); }; $("swap").onclick = function () { SFX.tap(); title(); };
  }

  /* ═══════ 一轮 7 题 ═══════ */
  function startRound(idx) {
    var lv = FLAT[me.track][idx], pr = me.prog[me.track][lv.id] || {};
    R = { idx: idx, lv: lv, d: pr.d == null ? 0 : pr.d, i: 0, first: 0, streak: 0, badQ: 0, q: null, wrong: 0, t0: now(), left: BOSS_SECONDS, timer: null, done: false, used: {}, prev: null, deck: null, redo: [] };
    screen = "round";
    if (lv.boss) { var st = TRACKS[me.track].stages[lv.si]; TTS.say(st.boss[1] + "来捣乱啦！在时间用完前答完7道题，就能赢得奖杯！", st.boss[2] + " is here to cause trouble! Answer 7 questions before time runs out to win a trophy!");
      R.timer = setInterval(function () { if (!R || R.done) return; R.left--; var t = main.querySelector(".timer i"); if (t) t.style.width = Math.max(0, R.left / BOSS_SECONDS * 100) + "%"; if (R.left <= 0) { stopTimer(); toast(T("⏰ 时间到！" + st.boss[1] + "溜走了，下次再挑战", "⏰ Time's up! " + st.boss[2] + " got away. Try again next time")); finish(true); } }, 1000); }
    nextQ();
  }
  /* ── 出题：洗牌牌堆，不重复 ──
     每关每个难度先抽样出整个题库（去重）→ 洗牌 → 最近几轮见过的放到后面；
     同一轮里不出重复题，也不连着出“换个顺序的同一题”或同一个答案。答错的题会在 3 题后“再练一次”（只一次）。 */
  var SEEN_MAX = 60;
  function qKey(q) { var s = [q.kind, q.sayZh || q.zh, q.sayHint || "", q.ans, q.vis || ""].join("|"), h = 5381; for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function qShape(q) { var t = String(q.sayZh || q.zh); return { tpl: t.replace(/\d+/g, "#"), nums: (t.match(/\d+/g) || []).sort().join(",") }; }
  function nearDup(q, prev) { if (!prev) return false; if (String(q.ans) === String(prev.ans) && !/^[LR]$/.test(q.ans)) return true; var a = qShape(q), b = qShape(prev); return a.nums !== "" && a.tpl === b.tpl && a.nums === b.nums; }
  function buildDeck(lv, d, seen) { var by = {}, list = [];
    for (var n = 0; n < 260; n++) { var q = lv.gen(d); q._k = qKey(q); if (!by[q._k]) { by[q._k] = 1; list.push(q); } }
    list = shuffle(list); var age = {}; (seen || []).forEach(function (k, i) { age[k] = i + 1; });
    return list.map(function (q, i) { return [age[q._k] || 0, i, q]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; }); }
  /** ctx: {lv, d, deck, deckD, used, prev, i, redo}; seen: 最近见过的题 key（旧→新） */
  function drawQ(ctx, seen) {
    if (ctx.redo && ctx.redo.length && ctx.redo[0].at <= ctx.i) { var r = ctx.redo.shift(); r.q.practice = 1; ctx.prev = r.q; return r.q; }
    if (!ctx.deck || ctx.deckD !== ctx.d || !ctx.deck.length) { ctx.deck = buildDeck(ctx.lv, ctx.d, seen); ctx.deckD = ctx.d; }
    var recent = {}; (seen || []).slice(-SEEN_MAX).forEach(function (k) { recent[k] = 1; });
    for (var pass = 0; pass < 3; pass++) for (var j = 0; j < ctx.deck.length; j++) { var q = ctx.deck[j];
      if (ctx.used[q._k]) continue; if (pass < 2 && nearDup(q, ctx.prev)) continue; if (pass < 1 && recent[q._k]) continue;
      ctx.deck.splice(j, 1); ctx.used[q._k] = 1; ctx.prev = q; return q; }
    var g = 0, q2; do { q2 = ctx.lv.gen(ctx.d); q2._k = qKey(q2); g++; } while (g < 30 && (ctx.used[q2._k] || nearDup(q2, ctx.prev))); ctx.used[q2._k] = 1; ctx.prev = q2; return q2;
  }
  function nextQ() {
    if (!R) return; if (R.i >= ROUND_LEN) return finish(false);
    me.seen = me.seen || {}; var sl = me.seen[R.lv.id] = me.seen[R.lv.id] || [];
    var q = drawQ(R, sl); if (!q.practice) { var at = sl.indexOf(q._k); if (at >= 0) sl.splice(at, 1); sl.push(q._k); if (sl.length > SEEN_MAX) sl.splice(0, sl.length - SEEN_MAX); }
    R.q = q; R.wrong = 0; R.qStart = now(); renderQ();
  }
  function renderQ() {
    var q = R.q, pre = me.track === "pre", prog = "";
    for (var i = 0; i < ROUND_LEN; i++) prog += '<span class="' + (i < R.i ? "done" : i === R.i ? "now" : "") + '"></span>';
    var h = '<div class="qtop"><div class="prog">' + prog + '</div><small>' + esc(T(R.lv.zh, R.lv.en)) + (R.d ? T(" · 难度", " · level ") + "⭐".repeat(R.d + 1) : "") + "</small></div>" + (q.practice ? '<div class="practice">🔁 ' + T('再练一次 <span class="en">Practice again</span>', "Practice again") + "</div>" : "");
    if (R.lv.boss) { var st = TRACKS[me.track].stages[R.lv.si]; h += '<div class="guide"><div class="face">' + st.boss[0] + '</div><div class="bubble">' + (LANG === "en" ? esc(st.boss[2]) + ": beat me if you can!" : esc(st.boss[1]) + '：打败我吧！<span class="en">Boss challenge</span>') + '</div></div><div class="timer"><i style="width:' + R.left / BOSS_SECONDS * 100 + '%"></i></div>'; }
    h += '<div class="qbox"><div class="qtext"><button class="ibtn" id="sayBtn" aria-label="' + T("再听一次", "Hear it again") + '">🔊</button> ' + (LANG === "en" ? '<span class="en-q">' + esc(q.te) + "</span>" : esc(q.zh) + (q.en ? '<span class="en">' + esc(q.en) + "</span>" : "")) + "</div>";
    if (q.vis) h += '<div class="vis">' + q.vis + "</div>";
    if (q.kind === "clock") { R.ch = rnd(1, 12); R.cm = 0; if (R.ch === q.target[0]) R.ch = hh(R.ch + 3);
      h += '<div class="vis" id="clk"></div><div class="clockctl"><span>🔵 ' + T('短针<br><small class="en">hour</small>', "hour") + '</span><button class="btn small" data-c="h-1">◀</button><button class="btn small" data-c="h1">▶</button><span>🔴 ' + T('长针<br><small class="en">minute</small>', "minute") + '</span><button class="btn small" data-c="m-1">◀</button><button class="btn small" data-c="m1">▶</button></div><div class="row"><button class="btn primary" id="check">✅ ' + T("确定", "Check") + "</button></div>"; }
    else if (q.kind === "coins") { R.wallet = [];
      h += '<div class="tray">' + q.pool.map(function (c) { return '<button data-coin="' + c + '" aria-label="' + fmtMoney(c) + '">' + moneySVG(c) + "</button>"; }).join("") + '</div><div class="wallet" id="wallet"></div><div class="row"><button class="btn small" id="undo">↩️ ' + T("拿回一个", "Take one back") + '</button><button class="btn primary" id="check">✅ ' + T("确定", "Check") + "</button></div>"; }
    else { var n = q.opts.length; h += '<div class="opts' + (n === 3 ? " three" : n === 1 ? " one" : "") + '">' + q.opts.map(function (o) { return '<button class="btn opt' + (q.optCls ? " " + q.optCls : "") + '" data-k="' + esc(o.k) + '">' + o.html + "</button>"; }).join("") + "</div>"; }
    h += '<div class="hint hidden" id="hint"></div><div class="cheer" id="cheer"></div></div>';
    if (pre) h += '<div class="tools"><button class="btn small" id="helpBtn">🦊 ' + T('帮帮我 <span class="en">help</span>', "Help me") + "</button></div>"; else h += '<div class="tools"><button class="btn small" id="helpBtn">💡 ' + T("提示 hint", "Hint") + "</button></div>";
    show(h);
    speakQ();
    $("sayBtn").onclick = speakQ; var sb = main.querySelector("[data-say]"); if (sb) sb.onclick = speakQ;
    $("helpBtn").onclick = function () { showHint(); };
    if (q.kind === "clock") { drawClock(); [].forEach.call(main.querySelectorAll("[data-c]"), function (b) { b.onclick = function () { SFX.tap(); var c = b.getAttribute("data-c"), v = +c.slice(1);
      if (c[0] === "h") R.ch = hh(R.ch + v); else { R.cm = (R.cm + v * q.step + 60) % 60; } drawClock(); }; }); $("check").onclick = function () { answer(R.ch + ":" + R.cm); }; }
    else if (q.kind === "coins") { drawWallet(); [].forEach.call(main.querySelectorAll("[data-coin]"), function (b) { b.onclick = function () { SFX.tap(); if (R.wallet.length < 20) R.wallet.push(+b.getAttribute("data-coin")); drawWallet(); }; });
      $("undo").onclick = function () { R.wallet.pop(); drawWallet(); }; $("check").onclick = function () { answer(String(R.wallet.reduce(function (a, b) { return a + b; }, 0))); }; }
    else [].forEach.call(main.querySelectorAll(".opt"), function (b) { b.onclick = function () { if (b.disabled || R.locked) return; answer(b.getAttribute("data-k"), b); }; });
    R.locked = false;
  }
  function speakQ() { if (R && R.q) TTS.say(R.q.sayZh || R.q.zh, R.q.sayEn || R.q.en); }
  function drawClock() { var c = $("clk"); if (c) c.innerHTML = clockSVG(R.ch, R.cm) + '<div style="font-weight:800">' + esc(tStr(R.ch, R.cm)[LANG === "en" ? 1 : 0]) + "</div>"; }
  function drawWallet() { var w = $("wallet"), s = R.wallet.reduce(function (a, b) { return a + b; }, 0); if (w) w.innerHTML = '<div>👛 ' + T("钱包 wallet：", "Wallet: ") + '<b>' + fmtMoney(s) + "</b></div>" + R.wallet.map(function (c) { return '<span style="display:inline-block;transform:scale(.7)">' + moneySVG(c) + "</span>"; }).join(""); }
  function showHint(quiet) { var hn = $("hint"); if (!hn || !R) return; hn.innerHTML = "💡 " + (LANG === "en" ? R.q.he : R.q.hint); enify(hn); hn.classList.remove("hidden"); if (!quiet) TTS.say(R.q.sayHint || "看看提示", R.q.she); }
  function answer(k, btn) {
    if (!R || R.locked || R.done) return; var q = R.q;
    if (k === q.ans) {
      R.locked = true; SFX.good(); var p = pick(PRAISE); $("cheer").textContent = "🎉 " + (LANG === "en" ? p[1] : p[0] + " " + p[1]); TTS.say(p[0], p[1]);
      if (btn) btn.classList.add("good");
      var quick = now() - R.qStart < (me.track === "pre" ? 12000 : q.wordy ? 30000 : 15000);
      if (R.wrong === 0) { R.first++; R.badQ = 0; R.streak = quick ? R.streak + 1 : 0;
        if (R.streak >= 3 && R.d < 2) { R.d++; R.streak = 0; toast(T("🚀 你好快！题目变难一点 Level up!", "🚀 So fast! Level up!")); } }
      else { R.streak = 0; R.badQ++; if (R.badQ >= 2 && R.d > 0) { R.d--; R.badQ = 0; toast(T("🌱 我们先练简单一点的", "🌱 Let's practise some easier ones")); } }
      var r0 = R; afterVoice(function () { if (R && R === r0 && R.q === q) { R.i++; nextQ(); } }, 1100, 6000); return;
    }
    R.wrong++; SFX.bad();
    if (R.wrong === 1 && !q.practice && !q._redo && R.i + 3 < ROUND_LEN) { q._redo = 1; R.redo.push({ q: q, at: R.i + 3 }); } var r = pick(RETRY); $("cheer").textContent = "🤗 " + T(r[0], r[1]); TTS.say(r[0], r[1]);
    if (btn) { btn.classList.add("bad"); btn.disabled = true; }
    if (R.wrong >= 1) { var hq = q; showHint(true); afterVoice(function () { if (R && R.q === hq && !R.done && !R.locked) TTS.say(hq.sayHint || "看看提示", hq.she); }, 0, 4000); }
    if (R.wrong >= 2) {
      if (q.kind === "choice") { var g = main.querySelector('.opt[data-k="' + q.ans.replace(/"/g, '\\"') + '"]'); if (g) g.classList.add("glow"); }
      else if (R.wrong >= 3) { // 拨钟/凑钱：第三次时示范正确答案
        R.locked = true;
        if (q.kind === "clock") { R.ch = q.target[0]; R.cm = q.target[1]; drawClock(); } else { var rem = q.target; R.wallet = []; q.pool.slice().sort(function (a, b) { return b - a; }).forEach(function (c) { while (rem >= c) { R.wallet.push(c); rem -= c; } }); drawWallet(); }
        $("cheer").textContent = T("👀 看，这样就对了！ This is how.", "👀 Look, this is how."); TTS.say("看，这样就对了", "Look, this is how"); R.streak = 0; R.badQ++; if (R.badQ >= 2 && R.d > 0) { R.d--; R.badQ = 0; }
        var r1 = R; afterVoice(function () { if (R && R === r1 && R.q === q) { R.i++; nextQ(); } }, 2600, 7000);
      }
    }
  }
  function finish(timeout) {
    if (!R || R.done) return; R.done = true; stopTimer(); var lv = R.lv, P = me.prog[me.track], pr = P[lv.id] || { stars: 0, plays: 0 };
    var stars = timeout ? 1 : R.first >= 6 ? 3 : R.first >= 4 ? 2 : 1, newSt = STICKERS.filter(function (s) { return me.stickers.indexOf(s) === -1; }), st = newSt.length ? pick(newSt) : null, troph = null;
    pr.stars = Math.max(pr.stars || 0, stars); pr.plays = (pr.plays || 0) + 1; pr.d = R.d; pr.best = Math.max(pr.best || 0, R.first); P[lv.id] = pr;
    me.gems += R.first + (stars === 3 ? 3 : 0); me.rounds = (me.rounds || 0) + 1; if (st) me.stickers.push(st);
    if (lv.boss && !timeout) { troph = TRACKS[me.track].stages[lv.si].boss[0]; if (me.trophies.indexOf(lv.id) === -1) me.trophies.push(lv.id); }
    var fl = FLAT[me.track], nxt = lv.idx + 1; if (nxt < fl.length && (me.unlock[me.track] || 1) <= nxt) me.unlock[me.track] = nxt + 1;
    save(); topbar(true); SFX.win();
    screen = "summary";
    TTS.say(timeout ? "时间到了，你已经很努力了！" : "完成啦！你得到了" + stars + "颗星！", timeout ? "Time is up. Great effort!" : "Finished! You got " + stars + (stars > 1 ? " stars!" : " star!"));
    show('<div class="card" style="text-align:center"><h1>' + (timeout ? "⏰ 时间到！" : "🎉 完成啦！") + ' <span class="en">' + (timeout ? "Time's up" : "Round complete") + '</span></h1><div class="big">' + "⭐".repeat(stars) + "</div><p>" + T("第一次就答对 <b>" + R.first + "</b> / " + ROUND_LEN + " 题", "Right first time: <b>" + R.first + "</b> / " + ROUND_LEN) + " · 💎 +" + (R.first + (stars === 3 ? 3 : 0)) + "</p>" +
      (st ? '<p>新贴纸 <span class="en">new sticker</span></p><div class="big">' + st + "</div>" : "<p>" + T("贴纸已经全部集齐啦！", "You've collected every sticker!") + "</p>") + (troph ? "<p>🏆 " + T("打败了关底挑战！得到奖杯 ", "You beat the challenge! Trophy: ") + troph + "</p>" : "") +
      '<div class="row"><button class="btn" id="again">🔁 ' + T("再玩一次", "Play again") + "</button>" + (nxt < fl.length ? '<button class="btn primary" id="next">' + T("下一关 ▶", "Next level ▶") + "</button>" : "") + '<button class="btn blue" id="map">🗺️ ' + T("地图", "Map") + "</button></div></div>");
    var idx = lv.idx; R = null;
    $("again").onclick = function () { startRound(idx); }; if ($("next")) $("next").onclick = function () { startRound(nxt); }; $("map").onclick = mapScreen;
  }
  function collection() {
    screen = "collection"; topbar(true);
    var h = '<div class="card"><h2>🎒 我的收藏 <span class="en">My collection</span></h2><p>' + T("贴纸 stickers：", "Stickers: ") + me.stickers.length + " / " + STICKERS.length + '</p><div class="stickers">' + STICKERS.map(function (s) { return '<div class="stk' + (me.stickers.indexOf(s) === -1 ? " no" : "") + '">' + (me.stickers.indexOf(s) === -1 ? "❔" : s) + "</div>"; }).join("") + "</div>";
    h += '<h2>🏆 ' + T("奖杯 trophies", "Trophies") + '</h2><div class="stickers">' + TRACKS.pri.stages.concat([]).map(function (st, i) { var id = "b" + (i + 1), got = me.trophies.indexOf(id) !== -1; return '<div class="stk' + (got ? "" : " no") + '" title="' + esc(T(st.zh, st.en)) + '">' + (got ? st.boss[0] : "🔒") + "</div>"; }).join("") + '</div><p class="small-note">' + T("小学档每站的关底挑战在时间内完成就能得到奖杯。", "Beat each Primary stop's challenge level in time to win its trophy.") + "</p>";
    h += "<p>💎 " + T("宝石 gems：" + me.gems + " · 玩了 " + (me.rounds || 0) + " 轮", "Gems: " + me.gems + " · rounds played: " + (me.rounds || 0)) + '</p><div class="row"><button class="btn primary" id="back">🗺️ ' + T("回地图", "Back to map") + "</button></div></div>";
    show(h); $("back").onclick = mapScreen;
  }
  function settings() {
    screen = "settings"; topbar(true); var tr = me.track, fl = FLAT[tr];
    var on = me.voice !== "off";
    var h = '<div class="card set"><h2>⚙️ ' + T('家长设置 <span class="en">Parent settings</span>', "Parent settings") + "</h2><p>" + T("玩家：", "Player: ") + esc(me.avatar) + " " + esc(me.name) + "</p>" +
      "<label>" + T("路线 track", "Track") + ' <select id="sTrack"><option value="pre"' + (tr === "pre" ? " selected" : "") + ">" + T("学前档 Pre-school", "Pre-school") + '</option><option value="pri"' + (tr === "pri" ? " selected" : "") + ">" + T("小学档 Primary (Y3)", "Primary (Year 3)") + "</option></select></label>" +
      "<label>" + T("从哪一关开始（解锁到这里） start level", "Start level (unlock up to here)") + ' <select id="sStart">' + fl.map(function (lv) { return '<option value="' + lv.idx + '"' + (lv.idx === (me.unlock[tr] || 1) - 1 ? " selected" : "") + ">" + (lv.idx + 1) + ". " + esc(T(TRACKS[tr].stages[lv.si].zh, TRACKS[tr].stages[lv.si].en)) + " · " + esc(T(lv.zh, lv.en)) + "</option>"; }).join("") + "</select></label>" +
      "<label>" + T("界面和朗读语言 language", "Language (screen + voice)") + ' <select id="sLang"><option value="zh"' + (LANG === "zh" ? " selected" : "") + '>中文 普通话</option><option value="en"' + (LANG === "en" ? " selected" : "") + ">English (NZ)</option></select></label>" +
      '<div class="row"><button class="btn small" id="sVoiceOn">' + (on ? T("🔊 朗读：开", "🔊 Voice: on") : T("🔇 朗读：关", "🔇 Voice: off")) + '</button><button class="btn small" id="rateBtn">' + rateLabel() + "</button></div>" +
      '<div class="row"><button class="btn small" id="sTest">🔊 ' + T("试听 test", "Test") + '</button><button class="btn small" id="sSound">' + (me.sound ? T("🔔 音效：开", "🔔 Sounds: on") : T("🔕 音效：关", "🔕 Sounds: off")) + "</button></div>" +
      '<p style="font-size:.85rem;color:#777">' + T("朗读用预先录好的 AI 人声（中文 Xiaoxiao，英文 NZ Molly）；万一缺录音才用设备自带朗读。慢速设置和汉字龙珠共用。", "Voice uses pre-recorded neural voices (NZ English: Molly; Chinese: Xiaoxiao), with the device voice only as a backup. The slow-speed setting is shared with the Hanzi game.") + "</p>" +
      '<div class="row"><button class="btn red small" id="sReset">' + T("清空进度 reset", "Reset progress") + '</button><button class="btn red small" id="sDel">' + T("删除玩家 delete", "Delete player") + '</button></div><div class="row"><button class="btn primary" id="sDone">' + T("完成 ✓", "Done ✓") + "</button></div></div>";
    show(h);
    $("sTrack").onchange = function () { me.track = this.value; save(); settings(); toast(T("已切换到 " + TRACKS[me.track].zh, "Switched to " + TRACKS[me.track].en)); };
    $("sStart").onchange = function () { var v = +this.value + 1; me.unlock[me.track] = Math.max(1, v); save(); toast(T("已解锁到第 " + v + " 关", "Unlocked up to level " + v)); };
    $("sLang").onchange = function () { setLang(this.value); settings(); };
    $("sVoiceOn").onclick = function () { me.voice = me.voice === "off" ? "zh" : "off"; save(); settings(); };
    $("rateBtn").onclick = function () { VOICE.setRate(VOICE.rate === 0.75 ? 1 : 0.75); this.textContent = rateLabel(); TTS.say("你好，我是小狐，我们一起学数学！", "Kia ora, I'm Little Fox. Let's do some maths!"); };
    $("sTest").onclick = function () { TTS.say("你好，我是小狐，我们一起学数学！", "Kia ora, I'm Little Fox. Let's do some maths!"); };
    $("sSound").onclick = function () { me.sound = !me.sound; save(); this.textContent = me.sound ? T("🔔 音效：开", "🔔 Sounds: on") : T("🔕 音效：关", "🔕 Sounds: off"); };
    function twice(btn, label, fn) { btn.onclick = function () { if (btn.getAttribute("data-arm")) return fn(); btn.setAttribute("data-arm", "1"); btn.textContent = T("⚠️ 再点一次确认 ", "⚠️ Tap again to confirm ") + label; setTimeout(function () { btn.removeAttribute("data-arm"); }, 4000); }; }
    twice($("sReset"), "reset", function () { me.prog[me.track] = {}; me.unlock[me.track] = 1; save(); toast(T("这条路线的进度已清空（贴纸保留）", "Progress on this track cleared (stickers kept)")); settings(); });
    twice($("sDel"), "delete", function () { store.players = store.players.filter(function (p) { return p !== me; }); store.current = null; save(); toast(T("玩家已删除", "Player deleted")); title(); });
    $("sDone").onclick = mapScreen;
  }

  /* ═══════ 启动 + 测试钩子 ═══════ */
  global.__km = {
    /** 测试用：按旧方法(old=true)或新牌堆方法模拟 rounds 轮，返回 {qs, repeats(同一轮内重复), b2b(连着同答案/近似重复), cross(和上一轮重复)} */
    sim: function (track, id, d, rounds, old) { var lv = FLAT[track].filter(function (x) { return x.id === id; })[0], seen = [], out = { qs: 0, repeats: 0, b2b: 0, cross: 0 }, last = {};
      for (var r = 0; r < rounds; r++) { var ctx = { lv: lv, d: d, used: {}, prev: null, deck: null, redo: [], i: 0 }, here = {}, prev = null, lk = null;
        for (var i = 0; i < ROUND_LEN; i++) { ctx.i = i; var q;
          if (old) { var g = 0; do { q = lv.gen(d); g++; } while (g < 8 && (q.zh + q.ans + (q.vis || "")) === lk); lk = q.zh + q.ans + (q.vis || ""); q._k = qKey(q); }
          else { q = drawQ(ctx, seen); var at = seen.indexOf(q._k); if (at >= 0) seen.splice(at, 1); seen.push(q._k); if (seen.length > SEEN_MAX) seen.shift(); }
          out.qs++; if (here[q._k]) out.repeats++; if (nearDup(q, prev)) out.b2b++; if (last[q._k]) out.cross++; here[q._k] = 1; prev = q; }
        last = here; }
      return out; },
    voice: VOICE, lang: function () { return LANG; }, split: splitSay,
    /** 所有固定的朗读句子 [中文, 英文]（给 scripts/list_speakables.js 用） */
    statics: function () { var out = PRAISE.concat(RETRY).concat([["你好！我们出发吧！", "Kia ora! Let's go!"], ["看看提示", "Look at the hint."], ["看，这样就对了", "Look, this is how"],
        ["时间到了，你已经很努力了！", "Time is up. Great effort!"], ["你好，我是小狐，我们一起学数学！", "Kia ora, I'm Little Fox. Let's do some maths!"], ["我是小狐，我们一起学数学！", "I'm Little Fox. Let's do some maths!"]]);
      [1, 2, 3].forEach(function (n) { out.push(["完成啦！你得到了" + n + "颗星！", "Finished! You got " + n + (n > 1 ? " stars!" : " star!")]); });
      TRACKS.pri.stages.forEach(function (st) { out.push([st.boss[1] + "来捣乱啦！在时间用完前答完7道题，就能赢得奖杯！", st.boss[2] + " is here to cause trouble! Answer 7 questions before time runs out to win a trophy!"]); });
      return out; },
    state: function () { return { screen: screen, player: me && { name: me.name, track: me.track, gems: me.gems, stickers: me.stickers.length, unlock: me.unlock }, players: store.players.length,
      round: R && { level: R.lv.id, i: R.i, d: R.d, first: R.first, kind: R.q && R.q.kind, ans: R.q && R.q.ans, target: R.q && R.q.target, left: R.left } }; },
    gen: function (track, id, d) { var lv = FLAT[track].filter(function (x) { return x.id === id; })[0]; return lv && lv.gen(d || 0); },
    levels: function (track) { return FLAT[track].map(function (x) { return x.id; }); }
  };
  (function () { var b = $("langBtn"); if (b) b.onclick = function () { SFX.tap(); setLang(LANG === "en" ? "zh" : "en"); stopTimer(); R = null;
      if (screen === "settings" && me) settings(); else if (screen === "collection" && me) collection(); else if (screen === "profile") profileForm(); else if (me && screen !== "title") mapScreen(); else title();
      if (screen === "title") TTS.say("我是小狐，我们一起学数学！", "I'm Little Fox. Let's do some maths!"); }; })();
  (function () { var b = $("spdBtn"); if (!b) return; var lab = function () { b.textContent = VOICE.rate === 0.75 ? "🐢" : "🐇"; b.title = rateLabel(); }; lab();
    b.onclick = function () { VOICE.setRate(VOICE.rate === 0.75 ? 1 : 0.75); lab(); toast(rateLabel()); if (screen === "round") speakQ(); else TTS.say("你好，我是小狐，我们一起学数学！", "Kia ora, I'm Little Fox. Let's do some maths!"); }; })();
  applyLang();
  title();
})(window);
