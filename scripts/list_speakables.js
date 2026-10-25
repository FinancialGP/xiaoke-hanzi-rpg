// 列出游戏里所有可能读出来的文字（直接跑 game.js 里的 __xiaoke.speakables()），输出 JSON 数组
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const w = { document: { readyState: "loading", addEventListener() {}, getElementById() { return null; } },
  localStorage: { getItem() { return null; }, setItem() {} }, navigator: { userAgent: "" }, setTimeout, console };
w.window = w; vm.createContext(w);
for (const f of ["hanzi_data.js", "words2.js", "stories.js", "scene_quiz.js", "game.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), w, { filename: f });
process.stdout.write(JSON.stringify(w.__xiaoke.speakables()));
