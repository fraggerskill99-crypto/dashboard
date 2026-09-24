/* Aurum SMC — интерфейс: данные, график, сигнал, бэктест, настройки. */
(function () {
  'use strict';
  const E = window.GoldEngine;
  const $ = s => document.querySelector(s);

  const TF = {
    '5m': { sec: 300, bn: '5m', td: '5min', tv: '5', label: 'M5' },
    '15m': { sec: 900, bn: '15m', td: '15min', tv: '15', label: 'M15' },
    '30m': { sec: 1800, bn: '30m', td: '30min', tv: '30', label: 'M30' },
    '1h': { sec: 3600, bn: '1h', td: '1h', tv: '60', label: 'H1' },
    '4h': { sec: 14400, bn: '4h', td: '4h', tv: '240', label: 'H4' },
    '1d': { sec: 86400, bn: '1d', td: '1day', tv: 'D', label: 'D1' },
  };
  const LTFS = ['5m', '15m', '30m', '1h'];
  const HTFS = ['1h', '4h', '1d'];
  const LTF_BARS = 6000, HTF_BARS = 1000; // больше истории — честнее бэктест

  const LAYERS = [
    { key: 'ob', label: 'Ордер-блоки', color: 'var(--gold)' },
    { key: 'fvg', label: 'FVG', color: '#7c8cff' },
    { key: 'snr', label: 'SNR', color: 'var(--text)' },
    { key: 'struct', label: 'BOS / CHoCH', color: 'var(--muted)' },
    { key: 'liq', label: 'Ликвидность', color: 'var(--warn)' },
    { key: 'signals', label: 'Сигналы', color: 'var(--bull)' },
  ];

  const DEFAULT_SETTINGS = {
    source: 'binance', tdKey: '', ltf: '15m', htf: '4h',
    rr: 2, entryMode: 'ob50', strictBias: true, useKillzones: true, minScore: 8,
    refresh: 60, notify: false,
    layers: { ob: true, fvg: true, snr: true, struct: true, liq: true, signals: true },
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem('aurum.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('aurum.' + k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
  };
  const S = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
  S.layers = Object.assign({}, DEFAULT_SETTINGS.layers, S.layers);
  const save = () => store.set('settings', S);

  const state = { ltf: [], htf: [], closed: [], res: null, bt: null, csv: null, loading: false, timer: null, tvLoaded: false };

  // ---------- форматирование
  const fmt = p => (p == null || !isFinite(p)) ? '—' : p.toFixed(2);
  const tz = -new Date().getTimezoneOffset() * 60;
  const dt = t => new Date(t * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const dirWord = d => d === 1 ? 'бычий' : d === -1 ? 'медвежий' : 'нет';
  const pill = d => `<span class="pill ${d === 1 ? 'bull' : d === -1 ? 'bear' : 'flat'}">${dirWord(d)}</span>`;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // ---------- данные
  // PAXG торгуется 24/7, а спот-золото — нет: выходные выбрасываем, чтобы свечи совпадали с XAUUSD
  function dropWeekend(c, tf) {
    return c.filter(k => {
      const d = new Date(k.t * 1000), wd = d.getUTCDay(), h = d.getUTCHours();
      if (tf === '1d') return wd !== 0 && wd !== 6;
      return !(wd === 6 || (wd === 0 && h < 22) || (wd === 5 && h >= 21));
    });
  }

  async function fetchBinance(tf, total) {
    const hosts = ['https://data-api.binance.vision', 'https://api.binance.com'];
    let lastErr;
    for (const host of hosts) {
      try {
        let out = [], end = null;
        while (out.length < total) {
          const lim = Math.min(1000, total - out.length);
          const url = `${host}/api/v3/klines?symbol=PAXGUSDT&interval=${TF[tf].bn}&limit=${lim}` + (end ? `&endTime=${end}` : '');
          const r = await fetch(url);
          if (!r.ok) throw new Error('Binance ответил ' + r.status);
          const rows = await r.json();
          if (!rows.length) break;
          out = rows.map(x => ({ t: x[0] / 1000, o: +x[1], h: +x[2], l: +x[3], c: +x[4] })).concat(out);
          end = rows[0][0] - 1;
          if (rows.length < lim) break;
        }
        return dropWeekend(out, tf);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Нет ответа от Binance');
  }

  async function fetchTwelve(tf, total) {
    if (!S.tdKey) throw new Error('Для XAU/USD укажите ключ Twelve Data в настройках');
    const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${TF[tf].td}&outputsize=${Math.min(total, 5000)}&timezone=UTC&order=ASC&apikey=${encodeURIComponent(S.tdKey)}`;
    const r = await fetch(url);
    const j = await r.json();
    if (j.status === 'error' || !j.values) throw new Error('Twelve Data: ' + (j.message || 'ошибка запроса'));
    return j.values.map(v => ({ t: Date.parse(v.datetime.replace(' ', 'T') + (v.datetime.length > 10 ? 'Z' : 'T00:00:00Z')) / 1000, o: +v.open, h: +v.high, l: +v.low, c: +v.close }));
  }

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
    const head = lines[0].toLowerCase().split(sep).map(s => s.trim().replace(/"/g, ''));
    const idx = n => head.findIndex(h => h === n || h.startsWith(n));
    const it = idx('time') >= 0 ? idx('time') : idx('date'), io = idx('open'), ih = idx('high'), il = idx('low'), ic = idx('close');
    if ([it, io, ih, il, ic].some(i => i < 0)) throw new Error('В CSV нужны столбцы time, open, high, low, close');
    const out = [];
    for (let n = 1; n < lines.length; n++) {
      const p = lines[n].split(sep).map(s => s.trim().replace(/"/g, ''));
      const raw = p[it];
      let t = /^\d+(\.\d+)?$/.test(raw) ? +raw : Date.parse(raw.includes('T') || raw.length <= 10 ? raw : raw.replace(' ', 'T') + 'Z') / 1000;
      if (t > 1e12) t /= 1000;
      const k = { t: Math.round(t), o: +p[io], h: +p[ih], l: +p[il], c: +p[ic] };
      if (isFinite(k.t) && isFinite(k.c)) out.push(k);
    }
    out.sort((a, b) => a.t - b.t);
    if (out.length < 200) throw new Error('Слишком мало свечей в файле: ' + out.length);
    const diffs = out.slice(1, 200).map((k, i) => k.t - out[i].t).sort((a, b) => a - b);
    const sec = diffs[Math.floor(diffs.length / 2)];
    const tf = Object.keys(TF).find(k => TF[k].sec === sec);
    if (!tf) throw new Error('Не распознан таймфрейм файла (шаг ' + sec + ' с)');
    return { candles: out, tf };
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    setStatus('load');
    try {
      let ltf, htf;
      if (S.source === 'csv') {
        if (!state.csv) throw new Error('Загрузите CSV в настройках');
        S.ltf = state.csv.tf;
        if (TF[S.htf].sec <= TF[S.ltf].sec) S.htf = HTFS.find(h => TF[h].sec > TF[S.ltf].sec) || '1d';
        ltf = state.csv.candles;
        htf = E.resample(ltf, TF[S.htf].sec);
      } else {
        const f = S.source === 'twelve' ? fetchTwelve : fetchBinance;
        [ltf, htf] = await Promise.all([f(S.ltf, LTF_BARS), f(S.htf, HTF_BARS)]);
      }
      if (ltf.length < 300) throw new Error('Мало данных: ' + ltf.length + ' свечей');
      state.ltf = ltf; state.htf = htf;
      state.updated = Date.now();
      run();
      setStatus('ok');
    } catch (e) {
      console.error(e);
      setStatus('err', e.message);
      if (!state.ltf.length) $('#chartMsg').textContent = e.message + '. Проверьте интернет или смените источник в «Настройках».';
      toast(e.message);
    } finally {
      state.loading = false;
    }
  }

  function setStatus(kind, msg) {
    const dot = $('#statusDot'), txt = $('#statusText');
    dot.className = 'dot' + (kind === 'ok' ? ' live' : kind === 'err' ? ' err' : '');
    txt.textContent = kind === 'load' ? 'Загрузка…' : kind === 'err' ? 'Повторить' : 'Обновить';
    if (kind === 'err') txt.title = msg || '';
  }

  function schedule() {
    clearInterval(state.timer);
    if (S.source === 'csv') return;
    const sec = Math.max(S.source === 'twelve' ? 300 : 30, +S.refresh || 60);
    state.timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, sec * 1000);
  }

  // ---------- анализ
  function engineOpts(extra) {
    return Object.assign({ rr: +S.rr, entryMode: S.entryMode, strictBias: S.strictBias, useKillzones: S.useKillzones, minScore: +S.minScore }, extra);
  }

  function run() {
    const now = Date.now() / 1000, sec = TF[S.ltf].sec;
    // формирующаяся свеча не участвует в анализе — иначе сигналы «перерисовываются»
    state.closed = S.source === 'csv' ? state.ltf : state.ltf.filter(k => k.t + sec <= now);
    state.res = E.analyze(state.closed, state.htf, sec, TF[S.htf].sec, engineOpts());
    state.bt = null;
    renderPrice();
    renderChart();
    renderSignal();
    renderAnalysis();
    if (!$('[data-panel="backtest"]').hidden) renderBacktest();
    notifyNew();
  }

  // ---------- шапка
  function renderPrice() {
    const c = state.ltf, last = c[c.length - 1];
    const dayAgo = c.findLast ? c.findLast(k => k.t <= last.t - 86400) : [...c].reverse().find(k => k.t <= last.t - 86400);
    $('#lastPrice').textContent = fmt(last.c);
    const ch = $('#lastChange');
    if (dayAgo) {
      const d = last.c - dayAgo.c, p = d / dayAgo.c * 100;
      ch.innerHTML = `<span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${fmt(d)} (${p.toFixed(2)}%)</span> · ${new Date(state.updated).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    } else ch.textContent = dt(last.t);
    $('#srcLabel').textContent = S.source === 'twelve' ? 'Twelve Data · спот' : S.source === 'csv' ? 'из файла CSV' : 'PAXG · Binance';
    document.title = fmt(last.c) + ' · Aurum SMC';
  }

  // ---------- график
  let chart, series, priceLines = [];
  function chartColors() {
    return { bg: css('--surface'), text: css('--muted'), line: css('--line'), bull: css('--bull'), bear: css('--bear'), gold: css('--gold') };
  }
  function initChart() {
    const k = chartColors();
    chart = LightweightCharts.createChart($('#chart'), {
      autoSize: true,
      layout: { background: { type: 'solid', color: k.bg }, textColor: k.text, fontFamily: css('--mono') || 'monospace', fontSize: 11 },
      grid: { vertLines: { color: k.line + '66' }, horzLines: { color: k.line + '66' } },
      rightPriceScale: { borderColor: k.line },
      timeScale: { borderColor: k.line, timeVisible: true, secondsVisible: false, rightOffset: 10 },
      crosshair: { mode: 0 },
    });
    series = chart.addCandlestickSeries({
      upColor: k.bull, downColor: k.bear, wickUpColor: k.bull, wickDownColor: k.bear, borderVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(queueDraw);
    const wrap = $('.chart-wrap');
    ['pointermove', 'wheel', 'touchmove', 'pointerup'].forEach(ev => wrap.addEventListener(ev, queueDraw, { passive: true }));
    new ResizeObserver(() => { sizeOverlay(); queueDraw(); }).observe(wrap);
    sizeOverlay();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const c = chartColors();
      chart.applyOptions({ layout: { background: { type: 'solid', color: c.bg }, textColor: c.text }, grid: { vertLines: { color: c.line + '66' }, horzLines: { color: c.line + '66' } } });
      series.applyOptions({ upColor: c.bull, downColor: c.bear, wickUpColor: c.bull, wickDownColor: c.bear });
      queueDraw();
    });
  }
  function sizeOverlay() {
    const cv = $('#overlay'), r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  }

  let lastLen = 0, lastKey = '';
  function renderChart() {
    const key = S.source + S.ltf + S.htf;
    const data = state.ltf.map(k => ({ time: k.t + tz, open: k.o, high: k.h, low: k.l, close: k.c }));
    if (key !== lastKey || Math.abs(data.length - lastLen) > 5) {
      series.setData(data);
      chart.timeScale().setVisibleLogicalRange({ from: data.length - 160, to: data.length + 10 });
    } else {
      series.setData(data);
    }
    lastKey = key; lastLen = data.length;
    $('#chartMsg').hidden = true;

    // маркеры: слом структуры, снятия ликвидности, сигналы
    const res = state.res, c = state.closed, markers = [];
    const from = c.length - 600;
    if (S.layers.liq) for (const s of res.liquidity.events) if (s.i > from && s.strength >= 2) {
      markers.push({ time: c[s.i].t + tz, position: s.side === 1 ? 'aboveBar' : 'belowBar', color: css('--warn'), shape: 'circle', size: 0.6, text: '$' });
    }
    if (S.layers.signals) for (const s of res.setups) if (s.created > from && s.score >= S.minScore) {
      const col = s.result === 'win' ? css('--bull') : s.result === 'loss' ? css('--bear') : css('--gold');
      markers.push({ time: c[s.created].t + tz, position: s.dir === 1 ? 'belowBar' : 'aboveBar', color: col, shape: s.dir === 1 ? 'arrowUp' : 'arrowDown',
        text: (s.dir === 1 ? 'BUY ' : 'SELL ') + s.score + (s.result === 'win' ? ' ✓' : s.result === 'loss' ? ' ✕' : '') });
    }
    markers.sort((a, b) => a.time - b.time);
    series.setMarkers(markers);

    for (const pl of priceLines) series.removePriceLine(pl);
    priceLines = [];
    const snap = state.snap = E.snapshot(res, c, state.htf);
    if (S.layers.signals) for (const s of snap.live) {
      const add = (price, color, title, style) => priceLines.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
      add(s.entry, css('--gold'), 'Вход', 0);
      add(s.sl, css('--bear'), 'Стоп', 2);
      add(s.tp, css('--bull'), 'Тейк', 2);
    }
    queueDraw();
  }

  let drawQueued = false;
  function queueDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(draw); } }

  function draw() {
    drawQueued = false;
    const cv = $('#overlay'), ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const res = state.res; if (!res || !chart) return;
    const ts = chart.timeScale(), W = ts.width(), c = state.closed, n = c.length - 1;
    const X = i => ts.logicalToCoordinate(i);
    const Y = p => series.priceToCoordinate(p);
    const range = ts.getVisibleLogicalRange(); if (!range) return;
    const vis = i => i >= range.from - 400;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, cv.height / dpr); ctx.clip();
    ctx.font = '10.5px ' + (css('--mono') || 'monospace');
    ctx.textBaseline = 'middle';
    const col = { bull: css('--bull'), bear: css('--bear'), gold: css('--gold'), text: css('--text'), muted: css('--muted'), warn: css('--warn'), fvg: '#7c8cff' };

    const box = (x1, x2, top, bot, fill, stroke, label) => {
      const y1 = Y(top), y2 = Y(bot); if (x1 == null || y1 == null || y2 == null) return;
      const xe = x2 == null ? W : x2;
      ctx.globalAlpha = 0.16; ctx.fillStyle = fill; ctx.fillRect(x1, y1, xe - x1, y2 - y1);
      ctx.globalAlpha = 0.6; ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x1 + .5, y1 + .5, xe - x1, y2 - y1);
      if (label) { ctx.globalAlpha = 0.9; ctx.fillStyle = stroke; ctx.fillText(label, Math.max(x1, 0) + 4, (y1 + y2) / 2); }
      ctx.globalAlpha = 1;
    };

    if (S.layers.ob) {
      const list = res.obs.filter(z => z.broken === null && (z.mitigated === null || n - z.mitigated < 20) && Math.abs((z.top + z.bottom) / 2 - c[n].c) < 12 * res.atr[n]).slice(-5);
      for (const z of list) box(X(z.i), null, z.top, z.bottom, z.dir === 1 ? col.bull : col.bear, z.dir === 1 ? col.bull : col.bear, 'OB');
    }
    if (S.layers.fvg) {
      const list = res.fvgs.filter(z => z.broken === null && z.mitigated === null && vis(z.created)).slice(-6);
      for (const z of list) box(X(z.i), null, z.top, z.bottom, col.fvg, col.fvg, 'FVG');
    }
    if (S.layers.struct) {
      const ev = res.structure.events.filter(e => vis(e.i)).slice(-8);
      for (const e of ev) {
        const x1 = X(e.from), x2 = X(e.i), y = Y(e.level); if (x1 == null || x2 == null || y == null) continue;
        ctx.strokeStyle = e.type === 'CHoCH' ? col.gold : col.muted; ctx.setLineDash(e.type === 'CHoCH' ? [] : [4, 3]);
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'center';
        ctx.fillText(e.type, (x1 + x2) / 2, y + (e.dir === 1 ? -8 : 8)); ctx.textAlign = 'left';
      }
    }
    const price = c[n].c;
    if (S.layers.snr) {
      const k = res.htf.map[n];
      const lv = res.htf.levels.map(l => ({ l, role: E.snrRole(l, k) })).filter(x => x.role)
        .sort((a, b) => Math.abs(a.l.price - price) - Math.abs(b.l.price - price)).slice(0, 4);
      for (const { l, role } of lv) {
        const y = Y(l.price); if (y == null) continue;
        const t0 = state.htf[l.i].t;
        let i0 = c.findIndex(q => q.t >= t0); if (i0 < 0) i0 = n;
        const x1 = Math.max(0, X(i0) ?? 0);
        const flip = (l.type === 'A') !== (role === 'resistance');
        ctx.strokeStyle = role === 'support' ? col.bull : col.bear; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.5;
        ctx.setLineDash(flip ? [6, 4] : []);
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
        ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'right';
        ctx.fillText(`${flip ? 'флип ' : ''}${l.type}-SNR ${fmt(l.price)}`, W - 6, y - 7); ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      }
    }
    if (S.layers.liq) {
      const pools = res.liquidity.pools.filter(p => p.from <= n && p.takenAt === undefined && n - p.from < 300 && p.strength >= 2)
        .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price)).slice(0, 4);
      for (const p of pools) {
        const y = Y(p.price), x1 = X(p.i); if (y == null) continue;
        ctx.strokeStyle = col.warn; ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(Math.max(0, x1 ?? 0), y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col.warn; ctx.fillText(p.label + ' ' + fmt(p.price), Math.max(0, x1 ?? 0) + 4, y + (p.side === 1 ? -7 : 7)); ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  // ---------- сигнал
  function renderSignal() {
    const el = $('#signal'), snap = state.snap, res = state.res, c = state.closed;
    const live = snap.live[snap.live.length - 1];
    if (live) {
      const long = live.dir === 1;
      const barsLeft = res.opts.pendingBars - (c.length - 1 - live.created);
      el.className = 'signal ' + (long ? 'long' : 'short');
      el.innerHTML = `
        <div class="sig-head">
          <h2 class="${long ? 'up' : 'down'}">${long ? 'Покупка' : 'Продажа'}</h2>
          <span class="sig-state">${live.state === 'open' ? 'сделка открыта с ' + dt(c[live.fill].t) : 'лимитный ордер · ждём ещё ' + barsLeft + ' св. ' + TF[S.ltf].label}</span>
          <span class="score" title="Оценка конфлюэнса">${live.score} / ${E.SCORE_MAX}</span>
        </div>
        <div class="levels">
          <div><span>Вход</span><b>${fmt(live.entry)}</b></div>
          <div><span>Стоп</span><b class="down">${fmt(live.sl)}</b></div>
          <div><span>Тейк 1:${live.rr}</span><b class="up">${fmt(live.tp)}</b></div>
        </div>
        <ul class="checks">${live.checks.map(x => `<li class="${x.ok ? 'ok' : ''}">${esc(x.label)}<em>+${x.pts}</em></li>`).join('')}</ul>
        <p class="note">Сигнал от ${dt(live.t)}. Стоп за экстремумом снятия ликвидности (${fmt(live.sweep.extreme)}). Риск на сделку — не больше 1% депозита.</p>`;
      return;
    }
    el.className = 'signal';
    const cand = res.setups.filter(s => s.state === 'filtered' && s.created > c.length - 1 - res.opts.pendingBars).pop();
    el.innerHTML = `
      <div class="sig-head">
        <h2>Ждём сетап A+</h2>
        <span class="sig-state">порог ${S.minScore} / ${E.SCORE_MAX}</span>
      </div>
      <p class="plan">${planText(snap)}</p>
      ${cand ? `<p class="plan-muted">Был кандидат ${cand.dir === 1 ? 'в покупку' : 'в продажу'} (${dt(cand.t)}) с оценкой ${cand.score} — не дотянул до порога: ${cand.checks.filter(x => !x.ok).map(x => x.label).join('; ')}.</p>` : ''}`;
  }

  function planText(s) {
    const L = TF[S.ltf].label, H = TF[S.htf].label;
    const lvl = (p, fallback) => p ? `${p.label || (p.l ? p.l.type + '-SNR' : '')} ${fmt(p.price ?? p.l.price)}` : fallback;
    if (s.htfTrend === 0) return `На ${H} нет подтверждённого направления — лучшая сделка здесь — пропуск. Ждём BOS на ${H}.`;
    const long = s.htfTrend === 1;
    const eq = s.pd ? (s.pd.hi + s.pd.lo) / 2 : null;
    let t = long
      ? `${H} бычий — ищем только покупки. Сценарий: цена снимает ликвидность снизу (${lvl(s.liqBelow, 'ближайший минимум')})` + (s.snrBelow && s.snrBelow.role === 'support' ? `, лучше у поддержки ${lvl(s.snrBelow)}` : '') + `, затем CHoCH вверх на ${L}. Вход с отката в ордер-блок, цель — ${lvl(s.liqAbove, 'ликвидность сверху')}.`
      : `${H} медвежий — ищем только продажи. Сценарий: цена снимает ликвидность сверху (${lvl(s.liqAbove, 'ближайший максимум')})` + (s.snrAbove && s.snrAbove.role === 'resistance' ? `, лучше у сопротивления ${lvl(s.snrAbove)}` : '') + `, затем CHoCH вниз на ${L}. Вход с отката в ордер-блок, цель — ${lvl(s.liqBelow, 'ликвидность снизу')}.`;
    if (s.pd && eq) {
      const where = s.pd.pos > 1 ? 'выше диапазона' : s.pd.pos < 0 ? 'ниже диапазона' : Math.round(s.pd.pos * 100) + '% диапазона';
      if (long && s.pd.pos > 0.5) t += ` Сейчас цена в премиуме (${where}) — покупать дорого, ждём отката ниже ${fmt(eq)}.`;
      if (!long && s.pd.pos < 0.5) t += ` Сейчас цена в дискаунте (${where}) — продавать дёшево, ждём отката выше ${fmt(eq)}.`;
    }
    return t;
  }

  // ---------- анализ
  function renderAnalysis() {
    const s = state.snap, L = TF[S.ltf].label, H = TF[S.htf].label;
    const ev = s.lastEvent;
    const zone = z => z ? `${fmt(z.bottom)} – ${fmt(z.top)}` : '—';
    const pool = p => p ? `${p.label} ${fmt(p.price)}` : '—';
    const snr = x => x ? `${x.l.type}-SNR ${fmt(x.l.price)} · ${(x.l.type === 'A') === (x.role === 'support') ? 'флип → ' : ''}${x.role === 'support' ? 'поддержка' : 'сопротивление'}` : '—';
    const kz = s.killzone;
    const nextKz = (() => {
      const now = new Date(), h = now.getUTCHours();
      const z = E.KILLZONES.find(z => z.from > h) || E.KILLZONES[0];
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (z.from > h ? 0 : 1), z.from));
      return `${z.name} с ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    })();
    $('#analysis').innerHTML = `
      <dl class="kv">
        <dt>Тренд ${H}</dt><dd>${pill(s.htfTrend)}</dd>
        <dt>Тренд ${L}</dt><dd>${pill(s.ltfTrend)}</dd>
        <dt>Последний слом ${L}</dt><dd class="num">${ev ? `${ev.type} ${ev.dir === 1 ? '↑' : '↓'} ${fmt(ev.level)}` : '—'}</dd>
        <dt>Сессия</dt><dd>${kz ? `<span class="pill bull">${kz.name} — активна</span>` : `вне killzone · ${nextKz}`}</dd>
        <dt>ATR ${L}</dt><dd class="num">${fmt(s.atr)}</dd>
      </dl>
      ${s.pd ? `<div><h3>Премиум / дискаунт ${H}</h3>
        <div class="pdbar"><i style="left:${Math.max(0, Math.min(100, s.pd.pos * 100))}%"></i></div>
        <p class="note num" style="display:flex;justify-content:space-between;margin-top:4px"><span>${fmt(s.pd.lo)}</span><span>равновесие ${fmt((s.pd.hi + s.pd.lo) / 2)}</span><span>${fmt(s.pd.hi)}</span></p></div>` : ''}
      <h3>Над ценой</h3>
      <dl class="kv">
        <dt>Ликвидность</dt><dd class="num">${pool(s.liqAbove)}</dd>
        <dt>SNR ${H}</dt><dd class="num">${snr(s.snrAbove)}</dd>
        <dt>Медвежий OB</dt><dd class="num">${zone(s.obAbove)}</dd>
        <dt>FVG</dt><dd class="num">${zone(s.fvgAbove)}</dd>
      </dl>
      <h3>Под ценой</h3>
      <dl class="kv">
        <dt>Ликвидность</dt><dd class="num">${pool(s.liqBelow)}</dd>
        <dt>SNR ${H}</dt><dd class="num">${snr(s.snrBelow)}</dd>
        <dt>Бычий OB</dt><dd class="num">${zone(s.obBelow)}</dd>
        <dt>FVG</dt><dd class="num">${zone(s.fvgBelow)}</dd>
      </dl>
      <p class="note">SNR — уровни Malaysian SNR по закрытиям ${H}: A — пик, V — впадина. Показаны только свежие (тень их ещё не касалась) и флип-уровни после пробоя.</p>`;
  }

  // ---------- бэктест
  function renderBacktest() {
    const el = $('#backtest');
    if (!state.res) { el.innerHTML = '<p class="note">Нет данных.</p>'; return; }
    const c = state.closed, sec = TF[S.ltf].sec, hsec = TF[S.htf].sec;
    if (!state.bt) {
      const rows = E.backtest(c, state.htf, sec, hsec, engineOpts());
      const rrs = [1, 1.5, 2, 2.5, 3].map(rr => ({ rr, st: E.analyze(c, state.htf, sec, hsec, engineOpts({ rr })).stats }));
      state.bt = { rows, rrs };
    }
    const { rows, rrs } = state.bt;
    const cur = rows[S.minScore];
    const minN = 8;
    const best = rows.filter(r => r.n >= minN).sort((a, b) => b.winrate - a.winrate || b.net - a.net)[0];
    const days = Math.round((c[c.length - 1].t - c[0].t) / 86400);
    const pct = x => (x * 100).toFixed(0) + '%';
    const be = 1 / (1 + +S.rr);
    el.innerHTML = `
      <p class="note">История: ${dt(c[0].t)} — ${dt(c[c.length - 1].t)} (${days} дн., ${c.length} свечей ${TF[S.ltf].label}). Одна позиция за раз; стоп и тейк в одной свече — считается убытком.</p>
      <div class="stats">
        <div class="stat"><span>Винрейт</span><b class="${cur.winrate >= be ? 'up' : 'down'}">${cur.n ? pct(cur.winrate) : '—'}</b></div>
        <div class="stat"><span>Сделок</span><b>${cur.n}</b></div>
        <div class="stat"><span>Итог</span><b class="${cur.net >= 0 ? 'up' : 'down'}">${cur.net >= 0 ? '+' : ''}${cur.net.toFixed(1)}R</b></div>
        <div class="stat"><span>PF</span><b>${isFinite(cur.pf) ? cur.pf.toFixed(2) : '∞'}</b></div>
        <div class="stat"><span>Просадка</span><b>${cur.maxDD.toFixed(1)}R</b></div>
      </div>
      <canvas id="equity" aria-label="Кривая доходности в R"></canvas>
      <p class="note">При RR 1:${S.rr} система в плюсе от винрейта ${pct(be)}. ${best ? `Лучший винрейт при ≥${minN} сделках — порог <b>${best.min}</b>: ${pct(best.winrate)} на ${best.n} сделках.` : `Для выбора порога мало сделок — увеличьте историю (младший ТФ M5/M15) или ослабьте фильтры.`}</p>
      ${best && best.min !== +S.minScore ? `<div class="bar"><button class="btn primary" id="applyBest" type="button">Поставить порог ${best.min}</button></div>` : ''}
      <h3>Порог оценки</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>≥ оценка</th><th>Сделок</th><th>Винрейт</th><th>Итог</th><th>PF</th></tr></thead>
        <tbody>${rows.filter(r => r.n > 0).map(r => `<tr class="pick${r.min === +S.minScore ? ' cur' : ''}" data-min="${r.min}">
          <td>${r.min}</td><td>${r.n}</td><td><span class="wr" style="width:${Math.round(r.winrate * 40)}px"></span>${pct(r.winrate)}</td>
          <td class="${r.net >= 0 ? 'up' : 'down'}">${r.net >= 0 ? '+' : ''}${r.net.toFixed(1)}R</td><td>${isFinite(r.pf) ? r.pf.toFixed(2) : '∞'}</td></tr>`).join('')}</tbody>
      </table></div>
      <h3>Соотношение риск / прибыль</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>RR</th><th>Сделок</th><th>Винрейт</th><th>Итог</th></tr></thead>
        <tbody>${rrs.map(x => `<tr class="${x.rr === +S.rr ? 'cur' : ''}"><td>1:${x.rr}</td><td>${x.st.n}</td><td>${x.st.n ? pct(x.st.winrate) : '—'}</td><td class="${x.st.net >= 0 ? 'up' : 'down'}">${x.st.net >= 0 ? '+' : ''}${x.st.net.toFixed(1)}R</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="note">Короткий тейк поднимает винрейт, но не всегда итог. Смотрите на «Итог» и PF, а не только на процент.</p>
      <h3>Последние сделки</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Дата</th><th>Сторона</th><th>Оценка</th><th>Вход</th><th>Итог</th></tr></thead>
        <tbody>${cur.trades.slice(-15).reverse().map(t => `<tr><td>${dt(t.t)}</td><td class="${t.dir === 1 ? 'up' : 'down'}">${t.dir === 1 ? 'BUY' : 'SELL'}</td><td>${t.score}</td><td>${fmt(t.entry)}</td>
          <td class="${t.R > 0 ? 'up' : 'down'}">${t.R > 0 ? '+' : ''}${t.R.toFixed(1)}R</td></tr>`).join('') || '<tr><td colspan="5">Сделок нет</td></tr>'}</tbody>
      </table></div>
      <p class="note">Порог подобран на той же истории, поэтому вперёд винрейт обычно ниже. Перепроверяйте на другом источнике или периоде и торгуйте малым риском.</p>`;
    el.querySelectorAll('tr.pick').forEach(tr => tr.addEventListener('click', () => setMinScore(+tr.dataset.min)));
    const ab = $('#applyBest'); if (ab) ab.addEventListener('click', () => setMinScore(best.min));
    drawEquity(cur.trades);
  }

  function setMinScore(v) {
    S.minScore = v; save();
    const r = $('#minScore'); if (r) { r.value = v; $('#minScoreOut').textContent = v; }
    const keep = state.bt; run(); state.bt = keep; renderBacktest();
    toast('Порог сигнала: ' + v + ' / ' + E.SCORE_MAX);
  }

  function drawEquity(trades) {
    const cv = $('#equity'); if (!cv) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const W = r.width, Hh = r.height, pad = 10;
    const pts = [0]; for (const t of trades) pts.push(pts[pts.length - 1] + t.R);
    const mn = Math.min(0, ...pts), mx = Math.max(0, ...pts), span = (mx - mn) || 1;
    const x = i => pad + (W - 2 * pad) * (pts.length > 1 ? i / (pts.length - 1) : 0);
    const y = v => Hh - pad - (Hh - 2 * pad) * (v - mn) / span;
    ctx.strokeStyle = css('--line'); ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(pad, y(0)); ctx.lineTo(W - pad, y(0)); ctx.stroke(); ctx.setLineDash([]);
    const up = pts[pts.length - 1] >= 0, color = up ? css('--bull') : css('--bear');
    ctx.beginPath(); pts.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(x(pts.length - 1), y(0)); ctx.lineTo(x(0), y(0)); ctx.closePath();
    ctx.globalAlpha = 0.12; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x(pts.length - 1), y(pts[pts.length - 1]), 3.5, 0, 7); ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = css('--muted'); ctx.font = '11px ' + css('--mono');
    ctx.fillText((pts[pts.length - 1] >= 0 ? '+' : '') + pts[pts.length - 1].toFixed(1) + 'R', pad, 14);
  }

  // ---------- TradingView
  function mountTv() {
    const go = () => {
      $('#tv').innerHTML = '<div id="tvInner" style="height:100%"></div>';
      /* global TradingView */
      new TradingView.widget({
        container_id: 'tvInner', autosize: true, symbol: 'OANDA:XAUUSD', interval: TF[S.ltf].tv,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
        theme: matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
        style: '1', locale: 'ru', allow_symbol_change: true, hide_side_toolbar: false, withdateranges: true,
      });
    };
    if (window.TradingView) return go();
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/tv.js';
    s.onload = go;
    s.onerror = () => { $('#tv').innerHTML = '<p class="chart-msg">Не удалось загрузить TradingView. <a href="https://www.tradingview.com/chart/?symbol=OANDA:XAUUSD" target="_blank" rel="noopener">Открыть XAUUSD на сайте</a></p>'; };
    document.head.appendChild(s);
  }

  async function mountPine() {
    const el = $('#pineCode');
    if (el.dataset.ready) return;
    try {
      const txt = window.PINE_SOURCE || await (await fetch('smc_snr.pine')).text();
      el.textContent = txt; el.dataset.ready = '1';
    } catch (e) { el.textContent = 'Не удалось загрузить код индикатора: файл smc_snr.pine лежит рядом с приложением.'; }
  }

  // ---------- настройки
  function renderSettings() {
    const f = $('#settings');
    const opt = (v, t, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${t}</option>`;
    f.innerHTML = `
      <div class="field"><label for="source">Источник котировок</label>
        <select id="source">
          ${opt('binance', 'PAXG/USDT · Binance — бесплатно, без ключа', S.source)}
          ${opt('twelve', 'XAU/USD спот · Twelve Data — бесплатный ключ', S.source)}
          ${opt('csv', 'Файл CSV (экспорт из TradingView)', S.source)}
        </select>
        <small>PAXG — токен, обеспеченный физическим золотом; идёт вровень с XAU/USD, разница обычно несколько долларов.</small></div>
      <div class="field" id="tdKeyField" ${S.source === 'twelve' ? '' : 'hidden'}><label for="tdKey">Ключ Twelve Data</label>
        <input type="password" id="tdKey" value="${esc(S.tdKey)}" placeholder="вставьте ключ">
        <small>Бесплатно на twelvedata.com → API Keys. Хранится только в этом браузере. Бесплатный тариф — обновление раз в 5 минут.</small></div>
      <div class="field" id="csvField" ${S.source === 'csv' ? '' : 'hidden'}><label for="csvFile">Файл CSV</label>
        <input type="file" id="csvFile" accept=".csv,text/csv">
        <small>В TradingView: меню графика → «Экспорт данных графика». Нужны столбцы time, open, high, low, close.</small></div>
      <div class="field"><label for="minScore">Порог сигнала A+: <b id="minScoreOut">${S.minScore}</b> из ${E.SCORE_MAX}</label>
        <input type="range" id="minScore" min="0" max="${E.SCORE_MAX}" step="1" value="${S.minScore}">
        <small>Выше порог — меньше сигналов и выше их качество. Подберите во вкладке «Бэктест».</small></div>
      <div class="field"><label for="rr">Тейк-профит (риск : прибыль)</label>
        <select id="rr">${[1, 1.5, 2, 2.5, 3, 4].map(v => opt(v, '1 : ' + v, S.rr)).join('')}</select></div>
      <div class="field"><label for="entryMode">Точка входа</label>
        <select id="entryMode">
          ${opt('ob50', 'Середина ордер-блока — баланс', S.entryMode)}
          ${opt('obEdge', 'Край ордер-блока — больше входов', S.entryMode)}
          ${opt('fvg', 'Край FVG — ранний вход', S.entryMode)}
        </select></div>
      <div class="field row"><label for="strictBias">Только по тренду старшего ТФ</label><input type="checkbox" id="strictBias" ${S.strictBias ? 'checked' : ''}></div>
      <div class="field row"><label for="useKillzones">Учитывать killzone (Лондон, Нью-Йорк)</label><input type="checkbox" id="useKillzones" ${S.useKillzones ? 'checked' : ''}></div>
      <div class="field"><label for="refresh">Автообновление</label>
        <select id="refresh">${[30, 60, 120, 300, 900].map(v => opt(v, v < 60 ? v + ' с' : v / 60 + ' мин', S.refresh)).join('')}</select></div>
      <div class="field row"><label for="notify">Уведомлять о новых сигналах</label><input type="checkbox" id="notify" ${S.notify ? 'checked' : ''}></div>
      <small class="note">Здесь уведомления приходят, пока приложение открыто или свёрнуто. Чтобы сигналы приходили всегда — даже при выключенном экране, — подключите Telegram-бота (инструкция в gold/README.md) или оповещение индикатора в TradingView.</small>
      <div class="bar"><button class="btn" type="button" id="resetSettings">Сбросить настройки</button></div>`;

    const on = (id, ev, fn) => $('#' + id).addEventListener(ev, fn);
    on('source', 'change', e => { S.source = e.target.value; save(); renderSettings(); if (S.source !== 'csv' || state.csv) { load(); schedule(); } renderTfChips(); });
    on('tdKey', 'change', e => { S.tdKey = e.target.value.trim(); save(); if (S.source === 'twelve') load(); });
    on('csvFile', 'change', async e => {
      const file = e.target.files[0]; if (!file) return;
      try { state.csv = parseCsv(await file.text()); toast(`Загружено ${state.csv.candles.length} свечей ${TF[state.csv.tf].label}`); renderTfChips(); load(); }
      catch (err) { toast(err.message); }
    });
    on('minScore', 'input', e => { $('#minScoreOut').textContent = e.target.value; });
    on('minScore', 'change', e => setMinScore(+e.target.value));
    on('rr', 'change', e => { S.rr = +e.target.value; save(); run(); });
    on('entryMode', 'change', e => { S.entryMode = e.target.value; save(); run(); });
    on('strictBias', 'change', e => { S.strictBias = e.target.checked; save(); run(); });
    on('useKillzones', 'change', e => { S.useKillzones = e.target.checked; save(); run(); });
    on('refresh', 'change', e => { S.refresh = +e.target.value; save(); schedule(); });
    on('notify', 'change', async e => {
      S.notify = e.target.checked;
      if (S.notify && 'Notification' in window && Notification.permission !== 'granted') {
        const p = await Notification.requestPermission();
        if (p !== 'granted') { S.notify = false; e.target.checked = false; toast('Уведомления запрещены в браузере'); }
      }
      save();
    });
    on('resetSettings', 'click', () => { Object.assign(S, JSON.parse(JSON.stringify(DEFAULT_SETTINGS))); save(); renderSettings(); renderTfChips(); renderLayers(); load(); schedule(); });
  }

  function renderTfChips() {
    const mk = (id, list, key) => {
      $(id).innerHTML = list.map(tf => `<button type="button" data-tf="${tf}" aria-pressed="${S[key] === tf}"${S.source === 'csv' && key === 'ltf' && tf !== S.ltf ? ' disabled' : ''}>${TF[tf].label}</button>`).join('');
      $(id).querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.tf;
        if (key === 'ltf' && TF[S.htf].sec <= TF[v].sec) S.htf = HTFS.find(h => TF[h].sec > TF[v].sec);
        if (key === 'htf' && TF[v].sec <= TF[S.ltf].sec) return toast('Старший ТФ должен быть больше ТФ входа');
        S[key] = v; save(); renderTfChips(); load();
        if (state.tvLoaded) mountTv();
      }));
    };
    mk('#ltfChips', LTFS, 'ltf');
    mk('#htfChips', HTFS, 'htf');
  }

  function renderLayers() {
    $('#layers').innerHTML = LAYERS.map(l => `<button type="button" class="layer" data-k="${l.key}" aria-pressed="${!!S.layers[l.key]}"><i style="background:${l.color}"></i>${l.label}</button>`).join('');
    $('#layers').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      S.layers[b.dataset.k] = !S.layers[b.dataset.k]; save();
      b.setAttribute('aria-pressed', S.layers[b.dataset.k]);
      if (state.res) renderChart();
    }));
  }

  function initTabs() {
    const tabs = document.querySelectorAll('#tabs button');
    const show = name => {
      tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
      document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
      if (name === 'backtest') renderBacktest();
      if (name === 'tv' && !state.tvLoaded) { state.tvLoaded = true; mountTv(); }
      if (name === 'pine') mountPine();
      store.set('tab', name);
    };
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    const saved = store.get('tab', 'analysis');
    if (saved !== 'analysis' && document.querySelector(`[data-tab="${saved}"]`)) show(saved);
    $('#copyPine').addEventListener('click', async () => {
      const txt = $('#pineCode').textContent;
      try { await navigator.clipboard.writeText(txt); toast('Код скопирован — вставьте в Pine Editor'); }
      catch (e) { const r = document.createRange(); r.selectNodeContents($('#pineCode')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Выделено — скопируйте вручную'); }
    });
  }

  // ---------- уведомления о новых сигналах
  function notifyNew() {
    const live = state.snap.live;
    if (!live.length) { state.firstRunDone = true; return; }
    const seen = store.get('seen', []);
    const fresh = live.filter(s => s.state === 'pending' && !seen.includes(s.t + ':' + s.dir));
    if (!fresh.length) return;
    store.set('seen', seen.concat(fresh.map(s => s.t + ':' + s.dir)).slice(-50));
    // при первом запуске сигнал уже на экране — звенеть не нужно
    if (!state.firstRunDone) { state.firstRunDone = true; return; }
    const s = fresh[fresh.length - 1];
    const title = `${s.dir === 1 ? 'BUY' : 'SELL'} XAU/USD · ${s.score}/${E.SCORE_MAX}`;
    const body = `Вход ${fmt(s.entry)} · стоп ${fmt(s.sl)} · тейк ${fmt(s.tp)}`;
    toast(title + ' — ' + body);
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    if (S.notify && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.getRegistration().then(reg => reg ? reg.showNotification(title, { body, icon: 'icon-192.png', tag: 'aurum' }) : new Notification(title, { body }))
        .catch(() => { try { new Notification(title, { body }); } catch (e) { /* нет поддержки */ } });
    }
  }

  // ---------- старт
  function start() {
    if (!window.LightweightCharts) { $('#chartMsg').textContent = 'Не загрузилась библиотека графиков — нужен интернет.'; return; }
    initChart();
    renderTfChips();
    renderLayers();
    renderSettings();
    initTabs();
    $('#refreshBtn').addEventListener('click', load);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - (state.updated || 0) > 60000) load(); });
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (S.source === 'csv') { S.source = 'binance'; save(); renderSettings(); } // файл не хранится между запусками
    load();
    schedule();
  }
  start();
})();
