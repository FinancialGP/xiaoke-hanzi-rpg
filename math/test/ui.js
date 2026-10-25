// 390x844 端到端：录音 200、无设备朗读回退、速度切换、中/EN 切换+记住、再练一次、无报错、汉字存档不动
const { chromium } = require(process.env.PW || '/tmp/pw/node_modules/playwright-core');
const B = process.argv[2] || 'http://localhost:8807/gh-merge/math/', SS = process.argv[3] || '/workspace/hanzi-game/screenshots/';
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const p = await ctx.newPage();
  const errs = [], bad = [], clips = []; let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('response', r => { if (/\/audio\/(zh|en)\//.test(r.url())) { clips.push(r.status()); if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); } });
  const W = ms => p.waitForTimeout(ms);
  await p.goto(B); const hz = JSON.stringify({ players: [{ name: 'Tester' }] });
  await p.evaluate(h => { localStorage.setItem('xiaoke_v4_store', h); localStorage.removeItem('km_lang'); }, hz); await p.reload(); await W(500);
  ok(await p.isVisible('#langBtn'), 'lang button on start screen');
  await p.click('#addPl'); await W(200); await p.fill('#pname', 'Kiwi'); await p.locator('[data-tr="pri"]').click(); await p.click('#okP'); await W(400);
  await p.click('#setBtn'); await W(300); await p.selectOption('#sStart', { index: (await p.locator('#sStart option').count()) - 1 }); await W(300); await p.click('#sDone'); await W(300);
  const st = () => p.evaluate(() => ({ v: __km.voice, s: __km.state(), lang: __km.lang() }));
  const voice = () => p.evaluate(() => ({ plays: __km.voice.plays.slice(), fb: __km.voice.fallbacks.slice(), miss: __km.voice.misses.slice(), rate: __km.voice.rate }));
  // 玩几关：每关点完 7 题（先错一次再对，测“再练一次”）
  async function playLevel(idx, wrongFirst) { await p.evaluate(() => { const b = document.getElementById('homeBtn'); b && b.click(); }); await W(300);
    await p.locator('.lv[data-lv="' + idx + '"]').click(); await W(300); let practice = 0;
    for (let i = 0; i < 9; i++) { if (!(await p.locator('.opt').count())) break;
      if (await p.locator('.practice').count()) practice++;
      const ans = await p.evaluate(() => __km.state().round && __km.state().round.ans);
      if (wrongFirst && i === 0) { const w = p.locator('.opt:not([data-k="' + ans + '"])').first(); if (await w.count()) { await w.click(); await W(250); } }
      await p.locator('.opt[data-k="' + ans + '"]').first().click(); await W(1250); }
    return practice; }
  const s0 = await p.evaluate(() => __km.state()); ok(!!s0, 'state hook');
  const prac = await playLevel(0, true); ok(prac === 1, 'missed question came back once labelled 🔁 Practice again (' + prac + ')');
  await playLevel(4, false);
  let v = await voice(); ok(v.plays.some(x => x.startsWith('zh:')), 'zh clips played: ' + v.plays.length); ok(v.fb.length === 0, 'no device-TTS fallback zh ' + JSON.stringify(v.fb.slice(0, 5)));
  ok(v.rate === 1, 'default normal speed');
  await p.click('#spdBtn'); await W(300); v = await voice(); ok(v.rate === 0.75 && (await p.evaluate(() => localStorage.getItem('xiaoke_voice_rate'))) === '0.75', 'speed toggle → 0.75 shared key');
  ok(await p.evaluate(() => { const a = __km.voice.el; return !a || (a.playbackRate === 0.75 && a.preservesPitch !== false); }), 'playbackRate 0.75 + preservesPitch');
  await p.click('#spdBtn'); await W(200); ok((await voice()).rate === 1, 'back to normal');
  // 切英文
  await p.click('#langBtn'); await W(400); ok((await st()).lang === 'en' && (await p.evaluate(() => localStorage.getItem('km_lang'))) === 'en', 'switched to EN + saved');
  const n0 = (await voice()).plays.length; await playLevel(1, false); await playLevel(16, false);
  v = await voice(); const enP = v.plays.slice(n0); ok(enP.length > 0 && enP.every(x => x.startsWith('en:')), 'EN clips only after switch: ' + enP.length);
  ok(v.fb.length === 0, 'no fallback EN ' + JSON.stringify(v.fb.slice(0, 5)));
  const txt = await p.evaluate(() => document.body.innerText); const cj = txt.split('\n').filter(l => /[\u4e00-\u9fff]/.test(l) && !/^(EN\/中|🐉 汉字龙珠)$/.test(l.trim())); ok(cj.length === 0, 'no Chinese text on EN screen ' + JSON.stringify(cj));
  await p.evaluate(() => document.getElementById('homeBtn').click()); await W(300); await p.locator('.lv[data-lv="20"]').click(); await W(500);
  await p.screenshot({ path: SS + 'math-en-question.png' }); await p.evaluate(() => document.getElementById('homeBtn').click()); await W(300); await p.screenshot({ path: SS + 'math-en-map.png' });
  await p.reload(); await W(500); ok((await st()).lang === 'en' && /Forest Maths/.test(await p.title()), 'EN persists after reload');
  await p.screenshot({ path: SS + 'math-en-start.png' });
  await p.click('#langBtn'); await W(300); await p.reload(); await W(400); ok((await st()).lang === 'zh' && /森林数学/.test(await p.title()), 'back to 中文 + persists');
  // 大量抽题检查覆盖率（随机抽样，不只是测试里玩到的）
  const cov = await p.evaluate(() => { const km = __km, miss = { zh: [], en: [] }; let n = 0;
    const chk = (l, t) => { n++; if (t && !km.voice.parts(l, t)) miss[l].push(t); };
    km.statics().forEach(x => { chk('zh', x[0]); chk('en', x[1]); });
    for (const tr of ['pre', 'pri']) km.levels(tr).forEach(id => { for (let d = 0; d < 3; d++) for (let k = 0; k < 150; k++) { const q = km.gen(tr, id, d); chk('zh', q.sayZh || q.zh); chk('zh', q.sayHint || '看看提示'); chk('en', q.sayEn || q.en); chk('en', q.she); } });
    return { n, zh: [...new Set(miss.zh)], en: [...new Set(miss.en)] }; });
  ok(cov.zh.length + cov.en.length === 0, 'fresh-sample coverage ' + cov.n + ' texts, missing zh ' + cov.zh.length + ' en ' + cov.en.length + ' ' + JSON.stringify(cov.zh.concat(cov.en).slice(0, 8)));
  ok(clips.length > 0 && bad.length === 0, 'clip requests ' + clips.length + ', non-200: ' + bad.length + ' ' + bad.slice(0, 3));
  ok((await p.evaluate(() => localStorage.getItem('xiaoke_v4_store'))) === hz, 'hanzi save untouched');
  const km = JSON.parse(await p.evaluate(() => localStorage.getItem('km_v1_store'))); ok(km && km.players && km.players[0].seen, 'km_v1_store keeps players + seen list');
  ok(errs.length === 0, 'no console errors ' + JSON.stringify(errs));
  await br.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
