// 检查：每一章的开场/结尾对话都有 2–3 道理解题；题目格式正确；启蒙模式至少 1 题；答案不和干扰项重复；
// 提示句存在；题目文字多数是孩子在这一章能认的字（本章及以前所有对话里出现过的字 + 已学字表前 N 个）。
const vm = require("vm"), fs = require("fs"), path = require("path"), root = path.join(__dirname, "..");
const w = { document: { readyState: "loading", addEventListener() {}, getElementById() { return null; } }, localStorage: { getItem() { return null; }, setItem() {} }, navigator: { userAgent: "" }, setTimeout, console };
w.window = w; vm.createContext(w);
for (const f of ["hanzi_data.js", "words2.js", "stories.js", "scene_quiz.js", "game.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), w, { filename: f });
const src = fs.readFileSync(path.join(root, "game.js"), "utf8"), a = src.indexOf("  var STORY = ["), b = src.indexOf("\n  ];", a);
const STORY = vm.runInNewContext(src.slice(a, b + 4).replace("var STORY =", "S =") + "; S");
const Q = w.SCENE_QUIZ, X = w.__xiaoke, CAST = X.cast;
const DBC = (vm.runInContext('HANZI_DB.map(function(h){return h.c})', w) || []);
let bad = [], total = 0, little = 0, seenChars = new Set(DBC.slice(0, 150)), han = /[\u4e00-\u9fff]/g, ratios = [];
STORY.forEach((ch, i) => {
  ["intro", "outro"].forEach(k => ch[k].forEach(l => (l[1].match(han) || []).forEach(c => seenChars.add(c))));
  (ch.matches || []).forEach(m => (m.name.match(han) || []).forEach(c => seenChars.add(c)));
  ["i", "o"].forEach(ph => {
    const lines = ph === "i" ? ch.intro : ch.outro, qs = (Q[i] || {})[ph] || [], tag = `ch${i + 1}.${ph === "i" ? "intro" : "outro"}`;
    if (!lines.length) return;
    if (qs.length < 2 || qs.length > 3) bad.push(`${tag}: ${qs.length} questions (need 2–3)`);
    if (!qs.some(d => d[4])) bad.push(`${tag}: no 启蒙 question`);
    let tot = 0, ok = 0;
    qs.forEach((d, n) => {
      total++; if (d[4]) little++;
      if (!(typeof d[0] === "string" && typeof d[1] === "string" && Array.isArray(d[2]) && d[2].length >= 2)) bad.push(`${tag}#${n}: bad shape`);
      if (!(d[3] >= 0 && d[3] < lines.length)) bad.push(`${tag}#${n}: hint line ${d[3]} out of range`);
      if (d[2].includes(d[1])) bad.push(`${tag}#${n}: answer repeated in distractors`);
      [d[1]].concat(d[2]).forEach(o => { if (o[0] === "@" && !CAST[o.slice(1)]) bad.push(`${tag}#${n}: unknown cast ${o}`); });
      const txt = d[0] + [d[1]].concat(d[2]).filter(o => o[0] !== "@").join("");
      (txt.match(han) || []).forEach(c => { tot++; if (seenChars.has(c)) ok++; });
    });
    ratios.push([tag, tot ? ok / tot : 1]);
  });
});
const low = ratios.filter(r => r[1] < 0.9);
console.log(`chapters ${STORY.length} · scenes ${ratios.length} · questions ${total} · 启蒙 ${little}`);
console.log(`chars already seen in the story so far: avg ${(ratios.reduce((s, r) => s + r[1], 0) / ratios.length * 100).toFixed(1)}%` + (low.length ? ` · below 90%: ${low.map(r => r[0] + " " + (r[1] * 100).toFixed(0) + "%").join(", ")}` : ""));
if (bad.length) { console.log("PROBLEMS:\n" + bad.join("\n")); process.exit(1); } else console.log("OK: every dialogue scene has questions");
