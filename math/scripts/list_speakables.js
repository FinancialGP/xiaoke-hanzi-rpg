// 用 Chrome 打开数学游戏，大量抽样每一关的题目，列出所有要朗读的句子（中文 + 英文）。
// 输出 JSON: {zh:{full:[...], segs:[...]}, en:{...}, maxNum}
// 用法: node scripts/list_speakables.js http://localhost:8807/gh-merge/math/ [每关每档抽样次数]
const { chromium } = require(process.env.PW || '/tmp/pw/node_modules/playwright-core');
(async () => {
  const url = process.argv[2] || 'http://localhost:8807/gh-merge/math/';
  const N = +(process.argv[3] || 400);
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const pg = await b.newPage(); await pg.goto(url);
  const out = await pg.evaluate((N) => {
    const km = window.__km, res = { zh: { full: new Set(), segs: new Set() }, en: { full: new Set(), segs: new Set() } };
    const nums = new Set();
    const add = (lang, t, full) => { t = String(t || '').trim(); if (!t) return; if (full) res[lang].full.add(t);
      km.split(t).forEach(x => { if (/^\d+$/.test(x)) nums.add(+x); else res[lang].segs.add(x); }); };
    km.statics().forEach(p => { add('zh', p[0], true); add('en', p[1], true); });
    for (const tr of ['pre', 'pri']) km.levels(tr).forEach((id) => {
      const seen = { zh: new Set(), en: new Set() }, items = [];
      for (let d = 0; d <= 2; d++) for (let k = 0; k < N; k++) { const q = km.gen(tr, id, d);
        const z = [q.sayZh || q.zh, q.sayHint || '看看提示'], e = [q.sayEn || q.en, q.she];
        items.push([z, e]); z.forEach(x => seen.zh.add(x)); e.forEach(x => seen.en.add(x)); }
      const small = seen.zh.size + seen.en.size <= 160;   // 题目种类少 → 整句录音（更自然）
      items.forEach(([z, e]) => { z.forEach(x => add('zh', x, small || !/\d/.test(x))); e.forEach(x => add('en', x, small || !/\d/.test(x))); });
    });
    return { nums: [...nums].sort((a,b)=>a-b), zh: { full: [...res.zh.full], segs: [...res.zh.segs] }, en: { full: [...res.en.full], segs: [...res.en.segs] } };
  }, N);
  process.stdout.write(JSON.stringify(out));
  await b.close();
})();
