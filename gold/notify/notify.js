#!/usr/bin/env node
/*
 * Проверка рынка и отправка сигналов Aurum SMC в Telegram.
 * Запускается по расписанию из GitHub Actions (.github/workflows/gold-signals.yml),
 * работает при закрытом приложении и выключенном телефоне.
 *
 * Переменные окружения:
 *   TELEGRAM_TOKEN, TELEGRAM_CHAT_ID — бот и чат; без них сообщения печатаются в лог
 *   TWELVE_KEY  — ключ Twelve Data: тогда котировки XAU/USD спот, иначе PAXG с Binance
 *   GOLD_LTF (15m), GOLD_HTF (4h), GOLD_MIN_SCORE (8), GOLD_RR (2), GOLD_ENTRY (ob50)
 *   STATE_FILE — где помнить отправленное (по умолчанию рядом со скриптом)
 * Флаг --test отправляет проверочное сообщение с текущим разбором рынка.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');

const TF = {
  '5m': { sec: 300, bn: '5m', td: '5min', label: 'M5' },
  '15m': { sec: 900, bn: '15m', td: '15min', label: 'M15' },
  '30m': { sec: 1800, bn: '30m', td: '30min', label: 'M30' },
  '1h': { sec: 3600, bn: '1h', td: '1h', label: 'H1' },
  '4h': { sec: 14400, bn: '4h', td: '4h', label: 'H4' },
  '1d': { sec: 86400, bn: '1d', td: '1day', label: 'D1' },
};

const env = (k, d) => (process.env[k] || '').trim() || d;
const CFG = {
  ltf: env('GOLD_LTF', '15m'),
  htf: env('GOLD_HTF', '4h'),
  minScore: +env('GOLD_MIN_SCORE', '8'),
  rr: +env('GOLD_RR', '2'),
  entryMode: env('GOLD_ENTRY', 'ob50'),
  token: env('TELEGRAM_TOKEN', ''),
  chat: env('TELEGRAM_CHAT_ID', ''),
  twelve: env('TWELVE_KEY', ''),
  stateFile: env('STATE_FILE', path.join(__dirname, 'state.json')),
};
if (!TF[CFG.ltf] || !TF[CFG.htf] || TF[CFG.htf].sec <= TF[CFG.ltf].sec) throw new Error('Неверные GOLD_LTF / GOLD_HTF');

const fmt = p => p.toFixed(2);
const when = t => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

function dropWeekend(c, tf) {
  return c.filter(k => {
    const d = new Date(k.t * 1000), wd = d.getUTCDay(), h = d.getUTCHours();
    if (tf === '1d') return wd !== 0 && wd !== 6;
    return !(wd === 6 || (wd === 0 && h < 22) || (wd === 5 && h >= 21));
  });
}

async function fetchBinance(tf, total) {
  let lastErr;
  for (const host of ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api.binance.us']) {
    try {
      let out = [], end = null;
      while (out.length < total) {
        const lim = Math.min(1000, total - out.length);
        const r = await fetch(`${host}/api/v3/klines?symbol=PAXGUSDT&interval=${TF[tf].bn}&limit=${lim}` + (end ? `&endTime=${end}` : ''));
        if (!r.ok) throw new Error(`${host} ответил ${r.status}`);
        const rows = await r.json();
        if (!rows.length) break;
        out = rows.map(x => ({ t: x[0] / 1000, o: +x[1], h: +x[2], l: +x[3], c: +x[4] })).concat(out);
        end = rows[0][0] - 1;
        if (rows.length < lim) break;
      }
      if (out.length) return dropWeekend(out, tf);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Нет котировок Binance');
}

async function fetchTwelve(tf, total) {
  const r = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${TF[tf].td}&outputsize=${Math.min(total, 5000)}&timezone=UTC&order=ASC&apikey=${encodeURIComponent(CFG.twelve)}`);
  const j = await r.json();
  if (j.status === 'error' || !j.values) throw new Error('Twelve Data: ' + (j.message || 'ошибка'));
  return j.values.map(v => ({ t: Date.parse(v.datetime.replace(' ', 'T') + (v.datetime.length > 10 ? 'Z' : 'T00:00:00Z')) / 1000, o: +v.open, h: +v.high, l: +v.low, c: +v.close }));
}

async function telegram(text) {
  if (!CFG.token || !CFG.chat) { console.log('--- (нет TELEGRAM_TOKEN/CHAT_ID, сообщение не отправлено)\n' + text); return; }
  const r = await fetch(`https://api.telegram.org/bot${CFG.token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CFG.chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error('Telegram: ' + j.description);
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(CFG.stateFile, 'utf8')); } catch (e) { return null; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(CFG.stateFile), { recursive: true });
  fs.writeFileSync(CFG.stateFile, JSON.stringify(s));
}

const key = s => `${s.t}:${s.dir}`;

function signalText(s, src) {
  const L = TF[CFG.ltf].label;
  const side = s.dir === 1 ? '🟢 <b>BUY XAU/USD</b>' : '🔴 <b>SELL XAU/USD</b>';
  return [
    `${side} · оценка ${s.score}/${E.SCORE_MAX}`,
    '',
    `Вход (лимит): <b>${fmt(s.entry)}</b>`,
    `Стоп: ${fmt(s.sl)}`,
    `Тейк 1:${s.rr}: ${fmt(s.tp)}`,
    '',
    s.checks.map(x => (x.ok ? '✅ ' : '▫️ ') + x.label).join('\n'),
    '',
    `${L}, сигнал ${when(s.t)}. Ордер действует ${CFG.pendingBars || 32} свечей ${L}.`,
    `Котировки: ${src}. Риск — не больше 1% депозита.`,
  ].join('\n');
}

function resultText(s) {
  const win = s.R > 0;
  const tag = s.result === 'time' ? '⏱ Закрыто по времени' : win ? '🎯 Тейк' : '🛑 Стоп';
  return `${tag}: ${s.dir === 1 ? 'BUY' : 'SELL'} от ${when(s.t)} · вход ${fmt(s.entry)} → ${s.R > 0 ? '+' : ''}${s.R.toFixed(1)}R`;
}

async function main() {
  const test = process.argv.includes('--test');
  const src = CFG.twelve ? 'XAU/USD спот (Twelve Data)' : 'PAXG/USDT (Binance)';
  const f = CFG.twelve ? fetchTwelve : fetchBinance;
  const [ltfAll, htf] = await Promise.all([f(CFG.ltf, 3000), f(CFG.htf, 1000)]);
  const now = Date.now() / 1000;
  const ltf = ltfAll.filter(k => k.t + TF[CFG.ltf].sec <= now);
  const res = E.analyze(ltf, htf, TF[CFG.ltf].sec, TF[CFG.htf].sec, { minScore: CFG.minScore, rr: CFG.rr, entryMode: CFG.entryMode });
  CFG.pendingBars = res.opts.pendingBars;
  const last = ltf[ltf.length - 1];
  console.log(`Свечей ${ltf.length}, последняя ${when(last.t)}, цена ${fmt(last.c)}, сетапов ≥${CFG.minScore}: ${res.setups.filter(s => s.score >= CFG.minScore).length}`);

  if (test) {
    const snap = E.snapshot(res, ltf, htf);
    const tr = d => d === 1 ? 'бычий' : d === -1 ? 'медвежий' : 'нет';
    const live = snap.live[snap.live.length - 1];
    await telegram([
      '✅ <b>Aurum SMC подключён</b>',
      `Цена ${fmt(snap.price)} · ${src}`,
      `Тренд ${TF[CFG.htf].label}: ${tr(snap.htfTrend)}, ${TF[CFG.ltf].label}: ${tr(snap.ltfTrend)}`,
      live ? `Активный сигнал: ${live.dir === 1 ? 'BUY' : 'SELL'} ${fmt(live.entry)}` : `Сигнала A+ сейчас нет (порог ${CFG.minScore}/${E.SCORE_MAX}).`,
      'Новые сигналы и их итоги будут приходить сюда.',
    ].join('\n'));
  }

  const prev = loadState();
  const state = prev || { sent: [], done: [] };
  const sent = new Set(state.sent), done = new Set(state.done);
  const recent = ltf.length - 1 - res.opts.pendingBars;

  // Новые сигналы: ордер ещё ждёт заполнения или сделка уже идёт
  for (const s of res.setups) {
    if (s.score < CFG.minScore || s.created < recent || sent.has(key(s))) continue;
    if (s.state !== 'pending' && s.state !== 'open') continue;
    // при первом запуске не шлём старое — только сигналы последних двух свечей
    if (prev || s.created >= ltf.length - 2) await telegram(signalText(s, src));
    sent.add(key(s));
  }
  // Итоги отправленных сигналов
  for (const s of res.setups) {
    if (!sent.has(key(s)) || done.has(key(s))) continue;
    if (s.state === 'closed') { await telegram(resultText(s)); done.add(key(s)); }
    else if (s.state === 'expired' || s.state === 'missed' || s.state === 'skipped') {
      await telegram(`⌛ Ордер ${s.dir === 1 ? 'BUY' : 'SELL'} ${fmt(s.entry)} от ${when(s.t)} не исполнился — отменить.`);
      done.add(key(s));
    }
  }
  saveState({ sent: [...sent].slice(-200), done: [...done].slice(-200), checked: when(last.t) });
}

main().catch(e => { console.error(e); process.exit(1); });
