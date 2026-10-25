// 每关每个难度玩 10 轮，比较旧出题法 vs 新牌堆出题法的重复率
const { chromium } = require(process.env.PW || '/tmp/pw/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage(); await p.goto(process.argv[2] || 'http://localhost:8807/gh-merge/math/');
  const rows = await p.evaluate(() => { const km = __km, o = [];
    for (const tr of ['pre', 'pri']) km.levels(tr).forEach(id => { for (let d = 0; d < 3; d++) o.push([tr, id, d, km.sim(tr, id, d, 10, true), km.sim(tr, id, d, 10, false)]); });
    return o; });
  const pct = (x, n) => (100 * x / n).toFixed(1) + '%'; const tot = { o: [0, 0, 0, 0], n: [0, 0, 0, 0] };
  console.log('level d | OLD in-round repeat / back-to-back / vs-last-round | NEW same');
  for (const [tr, id, d, o, n] of rows) { [['o', o], ['n', n]].forEach(([k, r]) => { tot[k][0] += r.qs; tot[k][1] += r.repeats; tot[k][2] += r.b2b; tot[k][3] += r.cross; });
    console.log(`${tr}/${id} d${d} | ${pct(o.repeats, o.qs)} ${pct(o.b2b, o.qs)} ${pct(o.cross, o.qs)} | ${pct(n.repeats, n.qs)} ${pct(n.b2b, n.qs)} ${pct(n.cross, n.qs)}`); }
  for (const k of ['o', 'n']) console.log(k === 'o' ? 'TOTAL OLD' : 'TOTAL NEW', 'in-round', pct(tot[k][1], tot[k][0]), 'back-to-back', pct(tot[k][2], tot[k][0]), 'vs-last-round', pct(tot[k][3], tot[k][0]));
  const worst = rows.filter(r => r[4].repeats > 0).map(r => r[0] + '/' + r[1] + ' d' + r[2] + ':' + r[4].repeats);
  console.log('NEW levels with any in-round repeat:', worst.join(' ') || 'none');
  await b.close(); process.exit(worst.length ? 1 : 0);
})();
