/*
 * Движок анализа золота: Smart Money Concepts + SNR (Malaysian SNR).
 *
 * Свечи: {t, o, h, l, c}, t — время открытия в секундах UTC.
 * Всё считается без заглядывания в будущее: свинг известен только после
 * подтверждения (right баров справа), свеча старшего ТФ — только после закрытия.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoldEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    swingLtf: 3,          // фрактал младшего ТФ: баров слева/справа
    swingHtf: 2,          // фрактал старшего ТФ
    rr: 2,                // тейк = RR × риск
    entryMode: 'ob50',    // ob50 | obEdge | fvg
    slBufferAtr: 0.1,     // запас за стопом в долях ATR
    pendingBars: 32,      // сколько баров ждём заполнения лимитки
    maxHoldBars: 96,      // максимум баров в сделке, потом выход по рынку
    sweepLookback: 30,    // слом структуры должен случиться не позже N баров после снятия ликвидности
    strictBias: true,     // только по тренду старшего ТФ
    useKillzones: true,
    minScore: 8,          // порог сигнала A+
    eqTolAtr: 0.15,       // допуск «равных» максимумов/минимумов
    minRiskAtr: 0.3,
    maxRiskAtr: 4,
  };

  // Лондон и Нью-Йорк, часы UTC (для золота основная ликвидность здесь)
  const KILLZONES = [
    { name: 'Лондон', from: 7, to: 10 },
    { name: 'Нью-Йорк', from: 12, to: 15 },
  ];

  const SCORE_MAX = 12;

  function atr(c, n = 14) {
    const out = new Array(c.length);
    let v = 0;
    for (let i = 0; i < c.length; i++) {
      const tr = i === 0 ? c[i].h - c[i].l
        : Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
      v = i < n ? (v * i + tr) / (i + 1) : (v * (n - 1) + tr) / n;
      out[i] = v;
    }
    return out;
  }

  function resample(c, tfSec) {
    const out = [];
    let cur = null;
    for (const k of c) {
      const t = Math.floor(k.t / tfSec) * tfSec;
      if (!cur || cur.t !== t) {
        cur = { t, o: k.o, h: k.h, l: k.l, c: k.c };
        out.push(cur);
      } else {
        if (k.h > cur.h) cur.h = k.h;
        if (k.l < cur.l) cur.l = k.l;
        cur.c = k.c;
      }
    }
    return out;
  }

  function swings(c, left, right) {
    const highs = [], lows = [];
    for (let j = left; j < c.length - right; j++) {
      let isH = true, isL = true;
      for (let k = j - left; k <= j + right && (isH || isL); k++) {
        if (k === j) continue;
        if (k < j) {
          if (c[k].h >= c[j].h) isH = false;
          if (c[k].l <= c[j].l) isL = false;
        } else {
          if (c[k].h > c[j].h) isH = false;
          if (c[k].l < c[j].l) isL = false;
        }
      }
      if (isH) highs.push({ i: j, price: c[j].h, conf: j + right, kind: 'high' });
      if (isL) lows.push({ i: j, price: c[j].l, conf: j + right, kind: 'low' });
    }
    return { highs, lows };
  }

  // BOS / CHoCH по закрытию за последним подтверждённым свингом.
  function structure(c, sw) {
    const all = sw.highs.concat(sw.lows).sort((a, b) => a.conf - b.conf || a.i - b.i);
    const events = [];
    const trend = new Int8Array(c.length);
    const lastHigh = new Array(c.length), lastLow = new Array(c.length);
    let p = 0, t = 0, H = null, L = null, hBroken = false, lBroken = false;
    for (let i = 0; i < c.length; i++) {
      while (p < all.length && all[p].conf <= i) {
        const s = all[p++];
        if (s.kind === 'high') { H = s; hBroken = false; } else { L = s; lBroken = false; }
      }
      if (H && !hBroken && c[i].c > H.price) {
        events.push({ i, dir: 1, type: t === -1 ? 'CHoCH' : 'BOS', level: H.price, from: H.i });
        t = 1; hBroken = true;
      } else if (L && !lBroken && c[i].c < L.price) {
        events.push({ i, dir: -1, type: t === 1 ? 'CHoCH' : 'BOS', level: L.price, from: L.i });
        t = -1; lBroken = true;
      }
      trend[i] = t; lastHigh[i] = H; lastLow[i] = L;
    }
    return { events, trend, lastHigh, lastLow };
  }

  // Ордер-блок: последняя противоположная свеча перед импульсом, сломавшим структуру.
  function orderBlockFor(c, ev) {
    let m = ev.from;
    for (let k = ev.from; k <= ev.i; k++) {
      if (ev.dir === 1 ? c[k].l < c[m].l : c[k].h > c[m].h) m = k;
    }
    let k = m;
    for (let s = 0; s < 10 && k >= 0; s++, k--) {
      if (ev.dir === 1 ? c[k].c < c[k].o : c[k].c > c[k].o) break;
    }
    if (k < 0 || m - k >= 10) k = m;
    return { i: k, created: ev.i, dir: ev.dir, top: c[k].h, bottom: c[k].l, mitigated: null, broken: null };
  }

  function trackZones(c, zones) {
    for (const z of zones) {
      for (let j = z.created + 1; j < c.length; j++) {
        if (z.mitigated === null && (z.dir === 1 ? c[j].l <= z.top : c[j].h >= z.bottom)) z.mitigated = j;
        if (z.dir === 1 ? c[j].c < z.bottom : c[j].c > z.top) { z.broken = j; break; }
      }
    }
    return zones;
  }

  function fvgs(c, a, sec) {
    const out = [];
    for (let i = 2; i < c.length; i++) {
      // разрыв между сессиями (выходные) — не имбаланс
      if (sec && c[i].t - c[i - 2].t > 2 * sec) continue;
      const min = 0.05 * a[i];
      if (c[i].l - c[i - 2].h > min) out.push({ i: i - 1, created: i, dir: 1, top: c[i].l, bottom: c[i - 2].h, mitigated: null, broken: null });
      if (c[i - 2].l - c[i].h > min) out.push({ i: i - 1, created: i, dir: -1, top: c[i - 2].l, bottom: c[i].h, mitigated: null, broken: null });
    }
    // «Заполнен» = цена прошла зону насквозь
    for (const z of out) {
      for (let j = z.created + 1; j < c.length; j++) {
        if (z.mitigated === null && (z.dir === 1 ? c[j].l <= z.top : c[j].h >= z.bottom)) z.mitigated = j;
        if (z.dir === 1 ? c[j].l <= z.bottom : c[j].h >= z.top) { z.broken = j; break; }
      }
    }
    return out;
  }

  // Malaysian SNR: уровни по графику-линии (закрытия).
  // A-уровень — пик закрытий (сопротивление), V-уровень — впадина (поддержка).
  // Свежий — после формирования его не касалась ни одна тень.
  function snrLevels(c, span = 2) {
    const levels = [];
    for (let j = span; j < c.length - span; j++) {
      let isA = true, isV = true;
      for (let k = j - span; k <= j + span; k++) {
        if (k === j) continue;
        if (k < j ? c[k].c >= c[j].c : c[k].c > c[j].c) isA = false;
        if (k < j ? c[k].c <= c[j].c : c[k].c < c[j].c) isV = false;
      }
      if (isA) levels.push({ i: j, conf: j + span, type: 'A', price: c[j].c });
      if (isV) levels.push({ i: j, conf: j + span, type: 'V', price: c[j].c });
    }
    for (const lv of levels) {
      lv.touch = null; lv.brk = null; lv.retest = null;
      for (let j = lv.i + 2; j < c.length; j++) {
        const touched = lv.type === 'A' ? c[j].h >= lv.price : c[j].l <= lv.price;
        if (lv.brk === null) {
          if (touched && lv.touch === null) lv.touch = j;
          if (lv.type === 'A' ? c[j].c > lv.price : c[j].c < lv.price) lv.brk = j;
        } else {
          // после пробоя уровень меняет роль; ретест — первое касание с другой стороны
          if (lv.type === 'A' ? c[j].l <= lv.price : c[j].h >= lv.price) { lv.retest = j; break; }
        }
      }
    }
    return levels;
  }

  // Роль уровня на момент бара k старшего ТФ: 'support' | 'resistance' | null (использован)
  function snrRole(lv, k) {
    if (lv.conf > k) return null;
    const broken = lv.brk !== null && lv.brk <= k;
    if (!broken) {
      if (lv.touch !== null && lv.touch <= k) return null;
      return lv.type === 'A' ? 'resistance' : 'support';
    }
    if (lv.retest !== null && lv.retest <= k) return null;
    return lv.type === 'A' ? 'support' : 'resistance';
  }

  function inKillzone(t) {
    const h = new Date(t * 1000).getUTCHours();
    return KILLZONES.find(z => h >= z.from && h < z.to) || null;
  }

  // Индекс последней закрытой свечи старшего ТФ к моменту закрытия свечи младшего.
  function htfIndexMap(ltf, ltfSec, htf, htfSec) {
    const map = new Int32Array(ltf.length);
    let k = -1;
    for (let i = 0; i < ltf.length; i++) {
      const tClose = ltf[i].t + ltfSec;
      while (k + 1 < htf.length && htf[k + 1].t + htfSec <= tClose) k++;
      map[i] = k;
    }
    return map;
  }

  // Пулы ликвидности и их снятие: свинги, равные максимумы/минимумы, PDH/PDL, азиатская сессия.
  function sweeps(c, sw, a, opts) {
    const events = [];
    const pools = []; // {price, side:1 (buy-side, над ценой) / -1, strength, label, from}
    const addSwingPools = (list, side) => {
      for (let n = 0; n < list.length; n++) {
        const s = list[n];
        let eq = false;
        for (let m = n - 1; m >= 0 && n - m <= 4; m--) {
          if (Math.abs(list[m].price - s.price) <= opts.eqTolAtr * a[s.conf]) { eq = true; break; }
        }
        pools.push({ price: s.price, side, strength: eq ? 2 : 1, label: eq ? (side === 1 ? 'Равные максимумы' : 'Равные минимумы') : 'Свинг', from: s.conf, i: s.i });
      }
    };
    addSwingPools(sw.highs, 1);
    addSwingPools(sw.lows, -1);

    // Дневные уровни и азиатская сессия
    let day = null, dh = -Infinity, dl = Infinity, ah = -Infinity, al = Infinity, dayStart = 0;
    for (let i = 0; i < c.length; i++) {
      const d = Math.floor(c[i].t / 86400);
      if (d !== day) {
        if (day !== null) {
          pools.push({ price: dh, side: 1, strength: 2, label: 'PDH', from: i, i: dayStart });
          pools.push({ price: dl, side: -1, strength: 2, label: 'PDL', from: i, i: dayStart });
        }
        day = d; dh = -Infinity; dl = Infinity; ah = -Infinity; al = Infinity; dayStart = i;
      }
      dh = Math.max(dh, c[i].h); dl = Math.min(dl, c[i].l);
      const hr = new Date(c[i].t * 1000).getUTCHours();
      if (hr < 6) { ah = Math.max(ah, c[i].h); al = Math.min(al, c[i].l); }
      const next = c[i + 1];
      if (hr < 6 && isFinite(ah) && (!next || new Date(next.t * 1000).getUTCHours() >= 6 || Math.floor(next.t / 86400) !== d)) {
        pools.push({ price: ah, side: 1, strength: 2, label: 'Азия high', from: i + 1, i: dayStart });
        pools.push({ price: al, side: -1, strength: 2, label: 'Азия low', from: i + 1, i: dayStart });
      }
    }
    pools.sort((x, y) => x.from - y.from);

    const active = [];
    const pending = []; // пробитые тенью, ждём возврата закрытием
    let p = 0;
    for (let i = 0; i < c.length; i++) {
      while (p < pools.length && pools[p].from <= i) active.push(pools[p++]);
      for (let n = active.length - 1; n >= 0; n--) {
        const pl = active[n];
        if (i - pl.from > 300) { active.splice(n, 1); continue; }
        const taken = pl.side === 1 ? c[i].h > pl.price : c[i].l < pl.price;
        if (taken) {
          active.splice(n, 1);
          pl.takenAt = i;
          pending.push({ pool: pl, start: i, extreme: pl.side === 1 ? c[i].h : c[i].l });
        }
      }
      for (let n = pending.length - 1; n >= 0; n--) {
        const q = pending[n];
        if (q.pool.side === 1) q.extreme = Math.max(q.extreme, c[i].h); else q.extreme = Math.min(q.extreme, c[i].l);
        const back = q.pool.side === 1 ? c[i].c < q.pool.price : c[i].c > q.pool.price;
        if (back) {
          events.push({ i, start: q.start, side: q.pool.side, dir: -q.pool.side, price: q.pool.price, extreme: q.extreme, strength: q.pool.strength, label: q.pool.label });
          pending.splice(n, 1);
        } else if (i - q.start >= 2) {
          pending.splice(n, 1); // ушли за уровень всерьёз — это пробой, не снятие
        }
      }
    }
    // одинаковые снятия одним баром — оставляем самое сильное
    const byBar = new Map();
    for (const e of events) {
      const key = e.i + ':' + e.side;
      const prev = byBar.get(key);
      if (!prev || e.strength > prev.strength || (e.strength === prev.strength && (e.side === 1 ? e.price > prev.price : e.price < prev.price))) byBar.set(key, e);
    }
    return { events: [...byBar.values()].sort((x, y) => x.i - y.i), pools };
  }

  /*
   * Модель входа A+:
   *  1) снятие ликвидности против направления сделки;
   *  2) слом структуры (CHoCH/BOS) в сторону сделки не позже sweepLookback баров;
   *  3) лимитный вход в ордер-блок/FVG импульса, стоп за экстремум снятия;
   *  4) оценка конфлюэнса: тренд старшего ТФ, премиум/дискаунт, свежий SNR, killzone...
   */
  function analyze(ltf, htf, ltfSec, htfSec, userOpts) {
    const opts = Object.assign({}, DEFAULTS, userOpts || {});
    const a = atr(ltf);
    const sw = swings(ltf, opts.swingLtf, opts.swingLtf);
    const st = structure(ltf, sw);
    const obs = trackZones(ltf, st.events.map(ev => orderBlockFor(ltf, ev)));
    const gaps = fvgs(ltf, a, ltfSec);
    const liq = sweeps(ltf, sw, a, opts);

    const hsw = swings(htf, opts.swingHtf, opts.swingHtf);
    const hst = structure(htf, hsw);
    const levels = snrLevels(htf, 2);
    const hmap = htfIndexMap(ltf, ltfSec, htf, htfSec);

    const setups = [];
    let sp = 0;
    const recentSweeps = [];
    for (let e = 0; e < st.events.length; e++) {
      const ev = st.events[e];
      while (sp < liq.events.length && liq.events[sp].i <= ev.i) recentSweeps.push(liq.events[sp++]);
      // снятие против направления сделки, случившееся до слома
      let sweep = null;
      for (let n = recentSweeps.length - 1; n >= 0; n--) {
        const s = recentSweeps[n];
        if (ev.i - s.i > opts.sweepLookback) break;
        if (s.dir === ev.dir && s.start >= ev.from - opts.sweepLookback) {
          if (!sweep || s.strength > sweep.strength) sweep = s;
        }
      }
      if (!sweep) continue;
      // экстремум всего движения от снятия до слома
      let ext = sweep.extreme;
      for (let k = sweep.start; k <= ev.i; k++) ext = ev.dir === 1 ? Math.min(ext, ltf[k].l) : Math.max(ext, ltf[k].h);

      const ob = obs[e];
      const legGaps = gaps.filter(g => g.dir === ev.dir && g.created > sweep.start && g.created <= ev.i && (g.broken === null || g.broken > ev.i));
      const fvg = legGaps.length ? legGaps[legGaps.length - 1] : null;

      let entry;
      if (opts.entryMode === 'fvg' && fvg) entry = ev.dir === 1 ? fvg.top : fvg.bottom;
      else if (opts.entryMode === 'obEdge') entry = ev.dir === 1 ? ob.top : ob.bottom;
      else entry = (ob.top + ob.bottom) / 2;

      const atrNow = a[ev.i];
      const sl = ev.dir === 1 ? ext - opts.slBufferAtr * atrNow : ext + opts.slBufferAtr * atrNow;
      // вход должен быть по эту сторону текущей цены
      if (ev.dir === 1 ? entry >= ltf[ev.i].c : entry <= ltf[ev.i].c) entry = ev.dir === 1 ? Math.min(entry, ltf[ev.i].c - 0.05 * atrNow) : Math.max(entry, ltf[ev.i].c + 0.05 * atrNow);
      const risk = (entry - sl) * ev.dir;
      if (!(risk > opts.minRiskAtr * atrNow) || risk > opts.maxRiskAtr * atrNow) continue;
      const tp = entry + ev.dir * opts.rr * risk;

      // --- конфлюэнс
      const k = hmap[ev.i];
      const checks = [];
      const hTrend = k >= 0 ? hst.trend[k] : 0;
      const biasOk = hTrend === ev.dir;
      if (opts.strictBias && !biasOk) continue;
      checks.push({ key: 'bias', label: 'Тренд старшего ТФ по сделке', ok: biasOk, pts: biasOk ? 3 : 0, max: 3 });
      checks.push({ key: 'sweep', label: 'Снята ликвидность: ' + sweep.label, ok: true, pts: sweep.strength, max: 2 });
      checks.push({ key: 'choch', label: 'Смена характера (CHoCH), а не продолжение', ok: ev.type === 'CHoCH', pts: ev.type === 'CHoCH' ? 1 : 0, max: 1 });
      checks.push({ key: 'fvg', label: 'Импульс оставил FVG', ok: !!fvg, pts: fvg ? 1 : 0, max: 1 });

      let pd = null, pdOk = false;
      if (k >= 0 && hst.lastHigh[k] && hst.lastLow[k]) {
        const hi = hst.lastHigh[k].price, lo = hst.lastLow[k].price;
        if (hi > lo) {
          pd = (entry - lo) / (hi - lo);
          pdOk = ev.dir === 1 ? pd < 0.5 : pd > 0.5;
        }
      }
      checks.push({ key: 'pd', label: ev.dir === 1 ? 'Вход в дискаунте (ниже 50% диапазона)' : 'Вход в премиуме (выше 50% диапазона)', ok: pdOk, pts: pdOk ? 2 : 0, max: 2 });

      // SNR: свежий уровень старшего ТФ между стопом и чуть выше входа
      const kBefore = hmap[Math.max(0, sweep.start - 1)];
      let snr = null;
      const zoneLo = ev.dir === 1 ? sl : entry - 0.5 * atrNow;
      const zoneHi = ev.dir === 1 ? entry + 0.5 * atrNow : sl;
      for (const lv of levels) {
        if (lv.price < zoneLo || lv.price > zoneHi) continue;
        const role = snrRole(lv, kBefore);
        if (role === (ev.dir === 1 ? 'support' : 'resistance')) { snr = lv; break; }
      }
      checks.push({ key: 'snr', label: 'Свежий SNR-уровень старшего ТФ в зоне входа', ok: !!snr, pts: snr ? 2 : 0, max: 2 });

      const kz = inKillzone(ltf[sweep.start].t) || inKillzone(ltf[ev.i].t);
      const kzOk = !!kz || !opts.useKillzones;
      checks.push({ key: 'kz', label: kz ? 'Killzone: ' + kz.name : 'Сессия Лондон / Нью-Йорк', ok: !!kz, pts: kzOk ? 1 : 0, max: 1 });

      const score = checks.reduce((s, x) => s + x.pts, 0);
      setups.push({
        dir: ev.dir, created: ev.i, t: ltf[ev.i].t, event: ev, sweep, ob, fvg, snr, pd,
        entry, sl, tp, risk, rr: opts.rr, score, checks,
        state: 'pending', fill: null, exit: null, result: null, R: null,
      });
    }

    for (const s of setups) if (s.score < opts.minScore) s.state = 'filtered';
    const trades = simulate(ltf, setups.filter(s => s.score >= opts.minScore), opts);

    return {
      opts, atr: a, swings: sw, structure: st, obs, fvgs: gaps, liquidity: liq,
      htf: { swings: hsw, structure: hst, levels, map: hmap },
      setups, trades, stats: statsFor(trades),
    };
  }

  // Прогон сетапов по истории. Одна позиция за раз; при одновременном
  // касании стопа и тейка в одной свече считаем убыток.
  function simulate(c, setups, opts) {
    const trades = [];
    let busyUntil = -1;
    for (const s of setups) {
      // пока открыта сделка, новые ордера не выставляем
      if (s.created <= busyUntil) { s.state = 'skipped'; continue; }
      let filled = null;
      for (let j = s.created + 1; j < c.length && j <= s.created + opts.pendingBars; j++) {
        const b = c[j];
        if (s.dir === 1) {
          if (b.l <= s.entry) { filled = j; break; }
          if (b.h >= s.tp) { s.state = 'missed'; break; }
        } else {
          if (b.h >= s.entry) { filled = j; break; }
          if (b.l <= s.tp) { s.state = 'missed'; break; }
        }
      }
      if (filled === null) {
        if (s.state !== 'missed') s.state = s.created + opts.pendingBars < c.length ? 'expired' : 'pending';
        continue;
      }
      s.fill = filled;
      let exit = null;
      for (let j = filled; j < c.length; j++) {
        const b = c[j];
        const hitSl = s.dir === 1 ? b.l <= s.sl : b.h >= s.sl;
        const hitTp = j > filled && (s.dir === 1 ? b.h >= s.tp : b.l <= s.tp);
        if (hitSl) { exit = { j, result: 'loss', R: -1 }; break; }
        if (hitTp) { exit = { j, result: 'win', R: s.rr }; break; }
        if (j - filled >= opts.maxHoldBars) { exit = { j, result: 'time', R: (b.c - s.entry) * s.dir / s.risk }; break; }
      }
      if (!exit) { s.state = 'open'; busyUntil = Infinity; continue; }
      s.state = 'closed'; s.exit = exit.j; s.result = exit.result; s.R = exit.R;
      busyUntil = exit.j;
      trades.push(s);
    }
    return trades;
  }

  function statsFor(list) {
    let wins = 0, losses = 0, net = 0, gw = 0, gl = 0, peak = 0, eq = 0, dd = 0;
    for (const t of list) {
      net += t.R; eq += t.R;
      if (t.R > 0) { wins++; gw += t.R; } else { losses++; gl -= t.R; }
      peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
    }
    const n = list.length;
    return { n, wins, losses, winrate: n ? wins / n : 0, net, avgR: n ? net / n : 0, pf: gl ? gw / gl : (gw ? Infinity : 0), maxDD: dd };
  }

  // Статистика для каждого порога оценки — по ней выбирают порог A+.
  // Для каждого порога сделки перепрогоняются: отсечённые сигналы освобождают слоты.
  function backtest(ltf, htf, ltfSec, htfSec, opts) {
    const base = analyze(ltf, htf, ltfSec, htfSec, Object.assign({}, opts, { minScore: 0 }));
    const rows = [];
    for (let s = 0; s <= SCORE_MAX; s++) {
      const setups = base.setups.filter(x => x.score >= s).map(x => Object.assign({}, x, { state: 'pending', fill: null, exit: null, result: null, R: null }));
      const tr = simulate(ltf, setups, base.opts);
      rows.push(Object.assign({ min: s, trades: tr }, statsFor(tr)));
    }
    return rows;
  }

  // Сводка текущего состояния рынка для экрана «Анализ».
  function snapshot(res, ltf, htf) {
    const i = ltf.length - 1, price = ltf[i].c;
    const k = res.htf.map[i];
    const liveOb = res.obs.filter(z => z.broken === null && z.created <= i);
    const liveFvg = res.fvgs.filter(z => z.broken === null && z.mitigated === null).slice(-12);
    const nearest = (list, above) => list.filter(z => above ? z.bottom > price : z.top < price)
      .sort((x, y) => above ? x.bottom - y.bottom : y.top - x.top)[0] || null;
    const lv = res.htf.levels.map(l => ({ l, role: snrRole(l, k) })).filter(x => x.role);
    const snrAbove = lv.filter(x => x.l.price > price).sort((x, y) => x.l.price - y.l.price)[0] || null;
    const snrBelow = lv.filter(x => x.l.price < price).sort((x, y) => y.l.price - x.l.price)[0] || null;
    const pools = res.liquidity.pools.filter(p => p.from <= i && (p.takenAt === undefined) && i - p.from <= 300);
    const liqAbove = pools.filter(p => p.side === 1 && p.price > price).sort((x, y) => y.strength - x.strength || x.price - y.price)[0] || null;
    const liqBelow = pools.filter(p => p.side === -1 && p.price < price).sort((x, y) => y.strength - x.strength || y.price - x.price)[0] || null;
    let pd = null;
    if (k >= 0 && res.htf.structure.lastHigh[k] && res.htf.structure.lastLow[k]) {
      const hi = res.htf.structure.lastHigh[k].price, lo = res.htf.structure.lastLow[k].price;
      if (hi > lo) pd = { hi, lo, pos: (price - lo) / (hi - lo) };
    }
    const live = res.setups.filter(s => (s.state === 'pending' || s.state === 'open') && s.score >= res.opts.minScore);
    return {
      price, time: ltf[i].t,
      htfTrend: k >= 0 ? res.htf.structure.trend[k] : 0,
      ltfTrend: res.structure.trend[i],
      lastEvent: res.structure.events[res.structure.events.length - 1] || null,
      obAbove: nearest(liveOb.filter(z => z.dir === -1), true), obBelow: nearest(liveOb.filter(z => z.dir === 1), false),
      fvgAbove: nearest(liveFvg.filter(z => z.dir === -1), true), fvgBelow: nearest(liveFvg.filter(z => z.dir === 1), false),
      snrAbove, snrBelow, liqAbove, liqBelow, pd,
      killzone: inKillzone(Math.floor(Date.now() / 1000)),
      live: live.slice(-3),
      atr: res.atr[i],
    };
  }

  return { DEFAULTS, KILLZONES, SCORE_MAX, atr, resample, swings, structure, fvgs, snrLevels, snrRole, sweeps, analyze, simulate, backtest, statsFor, snapshot, inKillzone };
});
