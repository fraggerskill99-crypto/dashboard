// Запуск: node gold/test/engine.test.js
const assert = require('assert');
const E = require('../engine.js');

// Детерминированное случайное блуждание с режимами тренда — похоже на M15 золота
function series(n, seed = 7, start = 2300, sec = 900) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = []; let p = start, drift = 0;
  const t0 = Math.floor(Date.UTC(2026, 0, 5) / 1000);
  for (let i = 0; i < n; i++) {
    if (i % 150 === 0) drift = (rnd() - 0.5) * 0.6;
    const o = p, vol = 1.5 + rnd() * 2.5;
    const c = o + drift + (rnd() - 0.5) * vol * 2;
    const h = Math.max(o, c) + rnd() * vol, l = Math.min(o, c) - rnd() * vol;
    out.push({ t: t0 + i * sec, o, h, l, c }); p = c;
  }
  return out;
}

const ltf = series(4000);
const htf = E.resample(ltf, 14400);
const res = E.analyze(ltf, htf, 900, 14400, { minScore: 0, strictBias: false });

assert(res.structure.events.length > 50, 'есть события структуры');
assert(res.liquidity.events.length > 20, 'есть снятия ликвидности');
assert(res.htf.levels.length > 10, 'есть SNR-уровни');
assert(res.setups.length > 5, 'есть сетапы: ' + res.setups.length);
for (const s of res.setups) {
  assert(s.dir === 1 ? s.sl < s.entry && s.entry < s.tp : s.sl > s.entry && s.entry > s.tp, 'порядок стоп/вход/тейк');
  assert(s.score >= 0 && s.score <= E.SCORE_MAX);
}
for (const t of res.trades) assert(t.exit >= t.fill && t.fill > t.created);

// Без заглядывания в будущее: сетапы, созданные до обрезки, совпадают
const cut = 3000;
const ltf2 = ltf.slice(0, cut), htf2 = E.resample(ltf2, 14400);
const res2 = E.analyze(ltf2, htf2, 900, 14400, { minScore: 0, strictBias: false });
const key = s => [s.created, s.dir, s.entry.toFixed(4), s.sl.toFixed(4), s.score].join('|');
const a = res.setups.filter(s => s.created < cut - 10).map(key);
const b = res2.setups.filter(s => s.created < cut - 10).map(key);
assert.deepStrictEqual(b, a, 'сетапы не зависят от будущих баров');

const rows = E.backtest(ltf, htf, 900, 14400, { strictBias: false });
assert.strictEqual(rows.length, E.SCORE_MAX + 1);
for (let s = 1; s < rows.length; s++) assert(rows[s].n <= rows[s - 1].n + 5);

const snap = E.snapshot(E.analyze(ltf, htf, 900, 14400, {}), ltf, htf);
assert(typeof snap.price === 'number');

console.log('setups', res.setups.length, 'trades', res.trades.length);
console.log(rows.map(r => `>=${r.min}: n=${r.n} wr=${(r.winrate * 100).toFixed(0)}% net=${r.net.toFixed(1)}R`).join('\n'));
console.log('OK');
