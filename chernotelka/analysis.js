/* Мониторинг чернотелки — разбор журнала Excel и расчёты.
   Работает и в браузере (window.CH), и в node (module.exports) — для проверки на настоящем журнале. */
(function (root) {
'use strict';

/* ===== даты: только календарные дни, строки ГГГГ-ММ-ДД ===== */
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dayNum = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
const fromNum = n => { const d = new Date(n * 864e5); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };

/* ===== названия ===== */
const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/* птичник: «А-6» и «А6» — один; площадка — «БП12», «Г», «Е» */
function houseKey(h) {
  const s = clean(h).toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, '');
  return s.replace(/^([А-ЯA-Z]+)-(\d+)$/, '$1$2');
}
function siteOf(h) {
  const s = clean(h).toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, '');
  const m = s.match(/^БП-?(\d+)/) || null;
  if (m) return 'БП' + m[1];
  const l = s.match(/^[А-ЯA-Z]+/);
  return l ? l[0] : s;
}

/* препарат: сводит написания к справочнику; смесь «CY10,Дракер» — один препарат «CY 10 + Дракер» */
function makeDrugNamer(refList) {
  const ref = [];
  for (const r of refList || []) { const n = clean(r); if (n && !ref.some(x => x.k === norm(n))) ref.push({ k: norm(n), name: n }); }
  const cache = {};
  function one(part) {
    const k = norm(part);
    if (!k) return null;
    const exact = ref.find(x => x.k === k);
    if (exact) return exact.name;
    if (k.length >= 4) {
      const pre = ref.filter(x => x.k.startsWith(k) || k.startsWith(x.k) && x.k.length >= 4);
      if (pre.length === 1) return pre[0].name;
    }
    const c = clean(part);
    return c.charAt(0).toUpperCase() + c.slice(1);
  }
  return function (raw) {
    const s = clean(raw);
    if (!s) return '';
    if (s in cache) return cache[s];
    const parts = s.split(/\s*[,;+\/]\s*|\s+и\s+/i).map(one).filter(Boolean);
    const uniq = [...new Set(parts)];
    return (cache[s] = uniq.join(' + '));
  };
}

/* ===== разбор книги ===== */
const COLS = {
  date: /^дата$/i, house: /^птичник|^корпус|^объект/i, tour: /^тур/i, set: /^расстав/i, removed: /^снят/i,
  slaughter: /^убой/i, drug: /^препарат/i, method: /^метод/i, total: /^итого/i, level: /^уровень/i, note: /^примеч/i,
  conc: /концентрац|дозиров|^доза/i, count: /обработок|кол.*обраб|кратност/i, area: /участок|зона обработ/i
};

function readBook(XLSX, wb) {
  const out = { rows: [], drugsRef: [], concRef: {}, sheet: '', warnings: [] };
  const sheetNames = wb.SheetNames;
  // справочник препаратов (и концентраций, если столбец есть)
  for (const name of sheetNames) {
    const ws = wb.Sheets[name]; if (!ws || !ws['!ref']) continue;
    const R = XLSX.utils.decode_range(ws['!ref']);
    const txt = (r, c) => { const x = ws[XLSX.utils.encode_cell({ r, c })]; return x && x.v != null ? clean(x.v) : ''; };
    for (let r = R.s.r; r <= Math.min(R.e.r, 5); r++) for (let c = R.s.c; c <= R.e.c; c++) {
      if (!/^препараты$/i.test(txt(r, c))) continue;
      let cc = -1;
      for (let c2 = c + 1; c2 <= Math.min(R.e.c, c + 3); c2++) if (COLS.conc.test(txt(r, c2))) { cc = c2; break; }
      for (let r2 = r + 1; r2 <= R.e.r; r2++) {
        const d = txt(r2, c); if (!d) continue;
        out.drugsRef.push(d);
        if (cc >= 0 && txt(r2, cc)) out.concRef[norm(d)] = txt(r2, cc);
      }
    }
  }
  // журнал: лист с заголовками «Птичник», «Тур» и трубами/итогом
  let best = null;
  for (const name of sheetNames) {
    const ws = wb.Sheets[name]; if (!ws || !ws['!ref']) continue;
    const R = XLSX.utils.decode_range(ws['!ref']);
    const txt = (r, c) => { const x = ws[XLSX.utils.encode_cell({ r, c })]; return x && x.v != null ? clean(x.v) : ''; };
    for (let r = R.s.r; r <= Math.min(R.e.r, 15); r++) {
      const map = {}, pipes = [];
      for (let c = R.s.c; c <= R.e.c; c++) {
        const t = txt(r, c); if (!t) continue;
        if (/^труба|^ловушк/i.test(t)) { pipes.push(c); continue; }
        for (const [k, re] of Object.entries(COLS)) if (!(k in map) && re.test(t)) { map[k] = c; break; }
      }
      if ('house' in map && 'tour' in map && (pipes.length || 'total' in map)) {
        const score = (/журнал/i.test(name) ? 10 : 0) + pipes.length;
        if (!best || score > best.score) best = { name, ws, R, r, map, pipes, score };
        break;
      }
    }
  }
  if (!best) { out.warnings.push('Не найден лист журнала: нужны столбцы «Птичник», «Тур» и «Труба 1…4» или «Итого».'); return out; }
  out.sheet = best.name;
  const { ws, R, map, pipes } = best;
  // объединённые ячейки (дата на несколько строк) — значение верхней ячейки на весь диапазон
  const merged = {};
  for (const m of ws['!merges'] || []) {
    const top = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) merged[r + ',' + c] = top;
  }
  const cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })] || merged[r + ',' + c];
  const val = (r, c) => { if (c == null) return null; const x = cell(r, c); return x && x.v != null && String(x.v).trim() !== '' ? x.v : null; };
  const date = (r, c) => {
    const x = c == null ? null : cell(r, c); if (!x) return null;
    if (x.t === 'n' && x.v > 20000 && x.v < 80000) { const p = XLSX.SSF.parse_date_code(x.v); return p ? iso(p.y, p.m, p.d) : null; }
    if (x.t === 'd' && x.v instanceof Date) return iso(x.v.getFullYear(), x.v.getMonth() + 1, x.v.getDate());
    if (typeof x.v === 'string') { const m = x.v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); if (m) return iso(+m[3], +m[2], +m[1]); }
    return null;
  };
  const num = v => { if (v == null) return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  for (let r = best.r + 1; r <= R.e.r; r++) {
    const house = clean(val(r, map.house)); if (!house) continue;
    const tour = num(val(r, map.tour));
    const pv = pipes.map(c => num(val(r, c)));
    const hasPipes = pv.some(v => v != null);
    const total = hasPipes ? pv.reduce((a, b) => a + (b || 0), 0) : num(val(r, map.total));
    const row = {
      line: r + 1, house, key: houseKey(house), site: siteOf(house), tour: tour == null ? null : Math.round(tour),
      date: date(r, map.date), set: date(r, map.set), removed: date(r, map.removed), slaughter: date(r, map.slaughter),
      drugRaw: clean(val(r, map.drug)), method: clean(val(r, map.method)), pipes: pv, catch: total,
      note: clean(val(r, map.note)), conc: clean(val(r, map.conc)), count: num(val(r, map.count)), area: clean(val(r, map.area))
    };
    // ошибки в годе (убой 02.02.2025 у тура 2026 года) — дата дальше 60 дней от учёта не берётся
    const base = row.set || row.date;
    for (const k of ['date', 'set', 'removed', 'slaughter']) if (row[k] && base && Math.abs(dayNum(row[k]) - dayNum(base)) > 60) {
      out.warnings.push(`Строка ${row.line} (${house}, тур ${row.tour}): дата «${k === 'slaughter' ? 'Убой' : k === 'removed' ? 'Снятие' : k === 'set' ? 'Расставление' : 'Дата'}» ${row[k]} не похожа на правду — не учитывается.`);
      row[k] = null;
    }
    if (!row.date) row.date = row.set || row.removed;
    out.rows.push(row);
  }
  return out;
}

/* ===== события обработки =====
   Обработка лежит между двумя учётами одного птичника: «до» — улов тура k, «после» — улов следующего тура.
   mode 'next': препарат, записанный в строке тура k, применён после его снятия/убоя → действует на тур k+1.
   mode 'this': препарат в строке тура k применён перед этим туром → «до» — тур k-1, «после» — тур k. */
function build(book, opt) {
  opt = Object.assign({ mode: 'next', bg: 4 }, opt || {});
  const name = makeDrugNamer(book.drugsRef);
  const byHouse = {};
  for (const r of book.rows) {
    r.drug = name(r.drugRaw);
    (byHouse[r.key] = byHouse[r.key] || []).push(r);
  }
  const houses = {};
  const events = [];
  for (const [key, list] of Object.entries(byHouse)) {
    list.sort((a, b) => (a.tour ?? 1e9) - (b.tour ?? 1e9) || String(a.date).localeCompare(String(b.date)) || a.line - b.line);
    houses[key] = { key, name: list[0].house, site: list[0].site, rows: list };
    const obs = list.filter(r => r.catch != null);
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row.drug) continue;
      let before, after;
      if (opt.mode === 'next') { before = row.catch != null ? row : null; after = list.slice(i + 1).find(x => x.catch != null) || null; }
      else { after = row.catch != null ? row : null; before = list.slice(0, i).reverse().find(x => x.catch != null) || null; }
      if (!before && !after) continue;
      const treat = opt.mode === 'next'
        ? (row.slaughter || row.removed || row.date)
        : ((before && (before.slaughter || before.removed)) || row.set || row.date);
      const ev = {
        id: key + '#' + row.line, house: row.house, key, site: row.site, drug: row.drug, drugRaw: row.drugRaw,
        method: row.method, conc: row.conc || book.concRef[norm(row.drug)] || '', area: row.area || row.house,
        count: row.count || 1, tour: row.tour, row, before, after, date: treat,
        B: before ? before.catch : null, A: after ? after.catch : null
      };
      ev.delta = ev.B != null && ev.A != null ? ev.A - ev.B : null;
      ev.pct = ev.delta != null && ev.B > 0 ? ev.delta / ev.B * 100 : null;
      ev.bg = ev.B != null && ev.B <= opt.bg;                    // фоновый улов: % ничего не говорит
      // продолжительность эффекта: от обработки до учёта, где улов вернулся к уровню «до»
      ev.dur = null; ev.durOpen = false; ev.durTours = null;
      if (ev.B != null && ev.A != null && treat) {
        if (ev.A >= ev.B) { ev.dur = 0; ev.durTours = 0; }
        else {
          const from = obs.indexOf(after); let n = 0, back = null;
          for (let j = from; j < obs.length; j++) { if (obs[j].catch >= ev.B) { back = obs[j]; break; } n++; }
          const endRow = back || obs[obs.length - 1];
          const end = back ? (back.set || back.date) : (endRow.removed || endRow.set || endRow.date);
          if (end) { ev.dur = Math.max(0, dayNum(end) - dayNum(treat)); ev.durOpen = !back; ev.durTours = n; }
        }
      }
      events.push(ev);
    }
  }
  events.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.house.localeCompare(b.house, 'ru'));
  // повторная обработка: тот же препарат подряд в том же птичнике
  const last = {};
  for (const e of events) { const p = last[e.key]; e.repeat = !!(p && p.drug === e.drug); last[e.key] = e; }
  // порядок препаратов — по числу применений (цвет закреплён за препаратом)
  const freq = {};
  for (const e of events) freq[e.drug] = (freq[e.drug] || 0) + 1;
  const drugs = Object.keys(freq).sort((a, b) => freq[b] - freq[a] || a.localeCompare(b, 'ru'));
  return { houses, events, drugs, freq, opt };
}

/* ===== сводка по набору событий ===== */
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function summarize(evs, opt) {
  opt = opt || {};
  const done = evs.filter(e => e.B != null && e.A != null);
  const valid = opt.withBg ? done : done.filter(e => !e.bg);
  const sB = valid.reduce((a, e) => a + e.B, 0), sA = valid.reduce((a, e) => a + e.A, 0);
  const durs = valid.filter(e => e.dur != null && e.A < e.B);
  const dates = evs.map(e => e.date).filter(Boolean).sort();
  return {
    n: evs.length, done: done.length, valid: valid.length, bgOnly: done.length - valid.length,
    treatments: evs.reduce((a, e) => a + (e.count || 1), 0),
    repeats: evs.filter(e => e.repeat).length,
    houses: new Set(evs.map(e => e.key)).size,
    B: valid.length ? sB / valid.length : null, A: valid.length ? sA / valid.length : null,
    sumB: sB, sumA: sA,
    pct: sB > 0 ? (sA - sB) / sB * 100 : null,
    medPct: median(valid.filter(e => e.pct != null).map(e => e.pct)),
    down: valid.filter(e => e.A < e.B).length, up: valid.filter(e => e.A > e.B).length,
    dur: durs.length ? durs.reduce((a, e) => a + e.dur, 0) / durs.length : null,
    durMed: median(durs.map(e => e.dur)), durOpen: durs.some(e => e.durOpen),
    first: dates[0] || null, last: dates[dates.length - 1] || null,
    methods: [...new Set(evs.map(e => e.method).filter(Boolean))],
    concs: [...new Set(evs.map(e => e.conc).filter(Boolean))]
  };
}

/* период: месяц / неделя (ISO) / тур */
function periodOf(d, by) {
  if (!d) return null;
  if (by === 'month') return d.slice(0, 7);
  const n = dayNum(d), wd = (new Date(n * 864e5).getUTCDay() + 6) % 7; // пн = 0
  return fromNum(n - wd);
}

const api = { iso, dayNum, fromNum, norm, clean, houseKey, siteOf, makeDrugNamer, readBook, build, summarize, median, periodOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CH = api;
})(typeof window !== 'undefined' ? window : globalThis);
