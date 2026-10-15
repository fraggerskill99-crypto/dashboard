/* Приложение «NOK-дашборд»: недели хранятся на устройстве, «Свод» подтягивается сам.
   Windows-программа следит за папкой «Документы\NOK-дашборд» (или выбранной).
   Chrome/Edge на ПК — за привязанной папкой, проверка раз в минуту.
   Телефон — «Свод» загружается кнопкой, недели всё равно копятся. */
(function(){
'use strict';
const N = window.NOK, $ = id => document.getElementById(id);
const CHECK_MS = 60000;

/* ---------- хранилище (IndexedDB: данных больше, чем вмещает localStorage) ---------- */
let dbp = null;
function db(){
  if(!dbp) dbp = new Promise((ok, no) => {
    const r = indexedDB.open('nok-dashboard', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  return dbp;
}
async function kvGet(k){ try{ const d = await db(); return await new Promise(ok => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); }); }catch(e){ return undefined; } }
async function kvSet(k, v){ try{ const d = await db(); await new Promise(ok => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; }); }catch(e){} }
async function kvDel(k){ try{ const d = await db(); await new Promise(ok => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = ok; t.onerror = ok; }); }catch(e){} }
const RULES = 2; // 2 — пробы «до мойки» не учитываются
function save(){ return kvSet('data', {facilities: N.DATA.facilities, facilitiesRes: N.DATA.facilitiesRes, meta: N.DATA.meta, rules: RULES, forceReplace: !!window.NOK_FORCE_REPLACE, savedAt: Date.now()}); }
/* Убирает из уже сохранённых недель обнаружения «до мойки» (NOK и их место в списке).
   Пробы «до мойки» с результатом OK так не найти — они уйдут из «Всего», когда придёт новый Свод. */
const BEFORE_RE = /до[\s_]*мойки/i;
function stripBefore(map){
  let removed = 0;
  Object.values(map || {}).forEach(weeks => Object.values(weeks || {}).forEach(wk => {
    const uniq = new Set();
    Object.values(wk.categories || {}).forEach(c => {
      (c.indicators || []).forEach(ind => {
        const keep = ind.locations.filter(l => !BEFORE_RE.test(l));
        const gone = ind.locations.length - keep.length;
        if(!gone) return;
        ind.locations.filter(l => BEFORE_RE.test(l)).forEach(l => uniq.add(ind.name + '|' + l));
        ind.locations = keep; ind.count = keep.length;
        c.nok -= gone; c.total -= gone;
      });
      c.indicators = (c.indicators || []).filter(ind => ind.count > 0);
    });
    if(!uniq.size) return;
    removed += uniq.size;
    wk.overall.nok -= uniq.size; wk.overall.total -= uniq.size;
    if(wk.fromWeeks) uniq.forEach(k => { const m = k.match(/нед\. (\d+)\)/); const e = m && wk.fromWeeks[m[1]]; if(e){ e.nok--; e.total--; } });
  }));
  return removed;
}

/* ---------- сообщения ---------- */
let toastT = null;
function toast(msg){ const t = $('nokToast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 5000); }
function hhmm(d){ d = d || new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function dstr(ms){ const d = new Date(ms); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + hhmm(d); }
function setSync(text, mode){ $('nokSync').textContent = text; $('nokDot').className = 'nok-dot' + (mode ? ' ' + mode : ''); }
const wkLabel = k => 'нед. ' + parseInt(k.split('-W')[1], 10) + '/' + k.split('-W')[0];
function renderWeeks(){
  const parts = [];
  ['УКПФ', 'МПФ'].forEach(f => {
    const ks = Object.keys(N.DATA.facilities[f] || {}).sort();
    if(ks.length) parts.push(`${f}: ${ks.length} нед. (${wkLabel(ks[0])} – ${wkLabel(ks[ks.length - 1])})`);
  });
  const any = parts.length > 0;
  $('nokWeeks').textContent = any ? 'Сохранено на устройстве — ' + parts.join(' · ') + (N.DATA.meta.data_through ? ' · данные по ' + N.DATA.meta.data_through : '') : '';
  $('nokEmpty').style.display = any ? 'none' : '';
}

/* ---------- обработка «Свода» ---------- */
let busy = false, auto = false, pending = null;
window.nokQuiet = (text, pct) => { if(!auto) return false; setSync(`Обрабатываю новый Свод: ${text} ${Math.round(pct || 0)}%`, 'busy'); return true; };
window.nokOnDone = (res, file) => {
  const wasAuto = auto; busy = false; auto = false;
  window.NOK_FORCE_REPLACE = false;
  save().then(() => { if(file && file.nokKey) kvSet('seen', file.nokKey); });
  SEEN = file && file.nokKey ? file.nokKey : SEEN;
  renderWeeks();
  const msg = `Свод обновлён: ${res.rowCount.toLocaleString('ru-RU')} строк, данные по ${res.maxDateStr || '—'}. Недели сохранены.`;
  if(wasAuto){ toast(msg); idle(); runPending(); return true; }
  idle(); runPending();
  if(!res.hasResDate){ alert(msg + '\n\nВ файле нет столбца «Дата выдачи результата» — сторона «по дате обнаружения» останется пустой.'); return true; }
  toast(msg); return true;
};
window.nokOnError = (message, file) => {
  const wasAuto = auto; busy = false; auto = false;
  if(file && file.nokKey){ SEEN = file.nokKey; kvSet('seen', file.nokKey); } // не повторять один и тот же плохой файл
  if(wasAuto){ setSync(`Не удалось обработать «${file.name}»: ${message}`, 'err'); runPending(); return true; }
  idle(); runPending(); return false;
};
function runFile(file, key, isAuto){
  if(busy){ pending = [file, key, isAuto]; return; }
  busy = true; auto = isAuto; file.nokKey = key;
  if(isAuto) setSync(`Найден новый Свод «${file.name}» — обрабатываю…`, 'busy');
  N.handleFile(file);
}
function runPending(){ if(pending && !busy){ const p = pending; pending = null; runFile(p[0], p[1], p[2]); } }
// ручная загрузка через кнопку дашборда тоже сохраняет недели
$('fileInput').addEventListener('change', () => { busy = true; auto = false; }, true);

/* ---------- источники: программа Windows, папка в Chrome/Edge, телефон ---------- */
let SEEN = null, idle = () => setSync('Свод загружается кнопкой «Загрузить Свод». Недели сохраняются на устройстве.');
const keyOf = f => f.name + '|' + f.size + '|' + Math.round(f.mtime || f.lastModified || 0);

// Windows: папка программы
async function desktopCheck(manual){
  if(busy) return;
  let info; try{ info = await window.desktop.info(); }catch(e){ return; }
  if(!info.latest){ setSync(`Положите «Свод» (.xlsx) в папку ${info.dir} — он загрузится сам.`); return; }
  const k = keyOf(info.latest);
  if(k === SEEN){ idle(); if(manual) toast('Нового Свода нет.'); return; }
  // ждём, пока файл допишется (размер и время не меняются 3 секунды)
  await new Promise(r => setTimeout(r, 3000));
  const again = await window.desktop.info();
  if(!again.latest || keyOf(again.latest) !== k){ setTimeout(() => desktopCheck(false), 2000); return; }
  setSync(`Читаю «${info.latest.name}»…`, 'busy');
  const u8 = await window.desktop.read(info.latest.path);
  runFile(new File([u8], info.latest.name, {lastModified: info.latest.mtime}), k, true);
}
async function desktopSetup(){
  const info = await window.desktop.info();
  let DIR = info.dir;
  idle = () => setSync(`⟳ Автообновление: папка ${DIR} · проверено в ${hhmm()}`, 'on');
  ['nokOpenBtn', 'nokChooseBtn', 'nokCheckBtn'].forEach(id => $(id).style.display = '');
  $('nokOpenBtn').onclick = () => window.desktop.open();
  $('nokCheckBtn').onclick = () => desktopCheck(true);
  $('nokChooseBtn').onclick = async () => { const r = await window.desktop.choose(); if(r){ DIR = r.dir; desktopCheck(true); } };
  window.desktop.onChanged(() => desktopCheck(false));
  setInterval(() => desktopCheck(false), CHECK_MS); // сетевые диски не всегда сообщают об изменениях
  desktopCheck(false);
}

// Chrome/Edge на ПК: привязанная папка
let DIR_HANDLE = null;
async function latestInDir(dir){
  let best = null;
  for await (const h of dir.values()){
    if(h.kind !== 'file' || !/\.xlsx$/i.test(h.name) || h.name.startsWith('~$')) continue;
    const f = await h.getFile();
    if(!best || f.lastModified > best.lastModified) best = f;
  }
  return best;
}
async function browserCheck(manual){
  if(busy || !DIR_HANDLE) return;
  if(await DIR_HANDLE.queryPermission({mode: 'read'}) !== 'granted'){
    setSync(`Нужно разрешение на папку «${DIR_HANDLE.name}» — нажмите «Разрешить доступ».`, 'err');
    $('nokAllowBtn').style.display = ''; return;
  }
  $('nokAllowBtn').style.display = 'none';
  let f; try{ f = await latestInDir(DIR_HANDLE); }catch(e){ setSync(`Папка «${DIR_HANDLE.name}» недоступна: ${e.message}`, 'err'); return; }
  if(!f){ setSync(`В папке «${DIR_HANDLE.name}» нет файлов .xlsx — положите туда «Свод».`); return; }
  const k = keyOf(f);
  if(k === SEEN){ idle(); if(manual) toast('Нового Свода нет.'); return; }
  runFile(f, k, true);
}
async function browserSetup(){
  idle = () => DIR_HANDLE
    ? setSync(`⟳ Автообновление: папка «${DIR_HANDLE.name}», проверка раз в минуту · проверено в ${hhmm()}`, 'on')
    : setSync('Привяжите папку, куда сохраняете «Свод», — новые выгрузки будут подтягиваться сами.');
  DIR_HANDLE = await kvGet('dir') || null;
  $('nokPinBtn').style.display = '';
  if(DIR_HANDLE){ $('nokPinBtn').textContent = '📁 Сменить папку'; $('nokCheckBtn').style.display = ''; }
  $('nokPinBtn').onclick = async () => {
    try{ DIR_HANDLE = await window.showDirectoryPicker({id: 'nok-svod', mode: 'read'}); }catch(e){ return; }
    await kvSet('dir', DIR_HANDLE);
    $('nokPinBtn').textContent = '📁 Сменить папку'; $('nokCheckBtn').style.display = '';
    browserCheck(true);
  };
  $('nokAllowBtn').onclick = async () => { if(await DIR_HANDLE.requestPermission({mode: 'read'}) === 'granted') browserCheck(true); };
  $('nokCheckBtn').onclick = () => browserCheck(true);
  setInterval(() => { if(!document.hidden) browserCheck(false); }, CHECK_MS);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) browserCheck(false); });
  idle(); browserCheck(false);
}

/* ---------- перенос недель из старого дашборда / копии ---------- */
function cleanWeeks(map){ const out = {}; Object.keys(map || {}).forEach(f => { out[f] = {}; Object.keys(map[f] || {}).forEach(wk => { const y = +wk.slice(0, 4); if(y >= 2000 && y <= 2100) out[f][wk] = map[f][wk]; }); }); return out; }
function extractData(text){
  const t = text.trim();
  if(t.startsWith('{')) return JSON.parse(t);
  const i = text.indexOf('const DATA = {');
  if(i < 0) throw new Error('в файле нет данных NOK-дашборда');
  const j = text.indexOf('};\n', i);
  return JSON.parse(text.slice(i + 13, j + 1));
}
$('nokImportBtn').onclick = () => $('nokImportInput').click();
$('nokImportInput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  try{
    const d = extractData(await f.text());
    if(!d.facilities) throw new Error('в файле нет недель');
    const before = countWeeks();
    const fac = cleanWeeks(d.facilities), res = cleanWeeks(d.facilitiesRes);
    stripBefore(fac); stripBefore(res);
    N.mergeIntoData(fac, d.meta && d.meta.data_through, res);
    await save(); N.refresh(true); renderWeeks();
    toast(`Перенесено из «${f.name}»: добавлено недель — ${countWeeks() - before}. Всё сохранено.`);
  }catch(err){ alert('Не удалось перенести недели: ' + err.message); }
};
function countWeeks(){ let n = 0; ['facilities', 'facilitiesRes'].forEach(k => Object.values(N.DATA[k] || {}).forEach(w => n += Object.keys(w).length)); return n; }
$('nokBackupBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({facilities: N.DATA.facilities, facilitiesRes: N.DATA.facilitiesRes, meta: N.DATA.meta})], {type: 'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `NOK_все_недели_${(N.DATA.meta.data_through || '').replace(/\./g, '-')}.json`; a.click();
};

/* ---------- запуск ---------- */
(async () => {
  const saved = await kvGet('data');
  let oldRules = false;
  if(saved && saved.facilities){
    if(saved.forceReplace) { window.NOK_FORCE_REPLACE = true; oldRules = true; }
    if((saved.rules || 1) < RULES){
      // правила изменились: чистим сохранённое и при следующем Своде недели заменяются целиком
      oldRules = true;
      const n = stripBefore(saved.facilities) + stripBefore(saved.facilitiesRes);
      window.NOK_FORCE_REPLACE = true;
      if(n) setTimeout(() => toast(`Убраны обнаружения «до мойки»: ${n}. Новый Свод пересчитает недели полностью.`), 800);
    }
    N.mergeIntoData(saved.facilities, saved.meta && saved.meta.data_through, saved.facilitiesRes);
    N.refresh(false);
    if(oldRules) save();
  }
  SEEN = oldRules ? null : (await kvGet('seen') || null);
  renderWeeks();
  if(window.desktop) desktopSetup();
  else if(window.showDirectoryPicker && !/Android|iPhone|iPad/i.test(navigator.userAgent)) browserSetup();
  else idle();
})();
})();

/* ===== Лист «По объектам»: смывы, OK и % по каждому объекту исследования за выбранную неделю ===== */
(function(){
'use strict';
const N = window.NOK, $ = id => document.getElementById(id);
let VIEW = 'table';
try { VIEW = localStorage.getItem('nokView') || 'table'; } catch (e) {}
const box = document.createElement('div'); box.id = 'nokChartView'; box.className = 'oc-wrap'; box.style.display = 'none';
$('splitView').insertAdjacentElement('afterend', box);
const fmt = n => (n || 0).toLocaleString('ru-RU');
const pct = (a, t) => t ? (a / t * 100).toFixed(1).replace('.', ',') + '%' : '0%';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
function rangeOf(wk){ const [y, w] = wk.split('-W').map(Number); const j4 = new Date(Date.UTC(y, 0, 4)); const m = new Date(j4); m.setUTCDate(j4.getUTCDate() - (j4.getUTCDay() + 6) % 7 + (w - 1) * 7);
  const s = new Date(m); s.setUTCDate(m.getUTCDate() + 6); const f = d => String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear(); return f(m) + ' – ' + f(s); }
function panel(basis){
  const st = N.state, data = basis === 'result' ? N.DATA.facilitiesRes : N.DATA.facilities;
  const wk = ((data || {})[st.facility] || {})[st.week];
  const title = basis === 'result' ? 'по дате обнаружения (выдачи результата)' : 'по дате отбора проб';
  const head = `<h2>Смывы по объектам — ${esc(st.facility)}, неделя ${st.week ? parseInt(st.week.split('-W')[1], 10) : '—'}</h2>
    <div class="oc-sub">${st.week ? rangeOf(st.week) : ''} · ${title}</div>`;
  if (!wk) return `<div class="oc-panel">${head}<div class="oc-empty">Нет данных за выбранную неделю${basis === 'result' ? ' по дате обнаружения' : ''}.</div></div>`;
  const cats = Object.entries(wk.categories || {}).filter(([, c]) => c.total > 0);
  const max = Math.max(1, ...cats.map(([, c]) => c.total));
  const row = (name, c, cls) => {
    const pend = c.pending != null ? c.pending : c.total - c.ok - c.nok;
    const w = (x) => c.total ? (x / c.total * 100) : 0;
    const bw = cls ? 100 : c.total / max * 100;            // длина полосы — число смывов
    // подпись на каждом куске: название, количество, процент; узкий кусок всё равно получает место под подпись
    const seg = (x, k, label) => {
      if (!x) return '';
      const t = `${label} ${fmt(x)} · ${pct(x, c.total)}`;
      return `<span class="oc-${k}" style="flex:${w(x).toFixed(2)} 1 0;min-width:${Math.round(t.length * 6.6 + 14)}px" title="${t}">${t}</span>`;
    };
    return `<div class="oc-row ${cls || ''}">
      <div class="oc-name">${esc(name)}<div class="oc-tot">${fmt(c.total)} смывов</div></div>
      <div class="oc-track"><div class="oc-bar" style="width:${bw.toFixed(1)}%">${seg(c.ok, 'ok', 'OK')}${seg(c.nok, 'nok', 'NOK')}${seg(pend, 'pend', 'ждут')}</div></div>
    </div>`;
  };
  const o = wk.overall || {};
  return `<div class="oc-panel">${head}<div class="oc-grid"><div class="oc-left">
    <div class="oc-legend"><span><i class="oc-ok"></i>OK — в норме</span><span><i class="oc-nok"></i>NOK — обнаружено</span><span><i class="oc-pend"></i>ждут результата</span><span style="color:var(--muted)">длина полосы — число смывов</span></div>
    ${cats.length ? cats.map(([n, c]) => row(n, c)).join('') : '<div class="oc-empty">Смывов за неделю нет.</div>'}
    ${row('Итого за неделю', {total: o.total || 0, ok: o.ok || 0, nok: o.nok || 0, pending: o.pending}, 'oc-total')}
    <div class="oc-sub" style="margin:8px 0 0">«Итого» — все пробы недели; один смыв может входить в несколько объектов (например, «Транспорт» и «БП»), поэтому сумма по строкам бывает больше итога. Проценты — от числа смывов за неделю.</div>
    </div><div class="oc-right">${weekSummary(o)}${weekBlock(basis)}${monthBlock(basis)}</div></div>
  </div>`;
}
// ---------- правая колонка: неделя в процентах ----------
function weekSummary(o){
  const t = o.total || 0, ok = o.ok || 0, nok = o.nok || 0, res = ok + nok, pend = t - res;
  const tile = (cls, label, v, sub) => `<div class="oc-tile ${cls}"><div class="oc-tv">${v}</div><div class="oc-tl">${label}</div><div class="oc-ts">${sub}</div></div>`;
  return `<div class="oc-side"><h3>Сводка за неделю, %</h3>
    <div class="oc-tiles">
      ${tile('t-ok', 'OK', pct(ok, t), `${fmt(ok)} из ${fmt(t)} смывов`)}
      ${tile('t-nok', 'NOK', pct(nok, t), `${fmt(nok)} из ${fmt(t)} смывов`)}
      ${tile('t-res', 'В результате', pct(res, t), `результат получен: ${fmt(res)} из ${fmt(t)}`)}
      ${tile('t-pend', 'Ждут результата', pct(pend, t), `${fmt(pend)} смывов`)}
    </div>
    <div class="oc-sub" style="margin:6px 0 0">Среди полученных результатов: OK <b>${pct(ok, res)}</b>, NOK <b>${pct(nok, res)}</b>.</div></div>`;
}
// ---------- сравнение двух периодов по ЧИСЛУ NOK (меньше — лучше) ----------
const rateOf = a => a && (a.ok + a.nok) ? a.nok / (a.ok + a.nok) * 100 : null;
const nokOf = a => a && (a.ok + a.nok) ? a.nok : null;      // null — результатов ещё нет
const f1 = v => v == null ? '—' : v.toFixed(1).replace('.', ',') + '%';
function verdictOf(ra, rb){
  if (ra == null || rb == null) return {d: '', v: '<span class="oc-same">нет данных</span>'};
  const dd = rb - ra, same = dd === 0;
  return {d: (same ? '±0' : (dd > 0 ? '+' : '−') + fmt(Math.abs(dd))) + ' NOK',
    v: same ? '<span class="oc-same">без изменений</span>' : dd < 0 ? '<span class="oc-better">▼ улучшение</span>' : '<span class="oc-worse">▲ ухудшение</span>'};
}
function compareTable(la, lb, byA, byB, totA, totB){
  const line = (name, a, b, cls) => {
    const ra = nokOf(a), rb = nokOf(b), x = verdictOf(ra, rb);
    const cell = (q, r) => q && (q.ok + q.nok) ? `<b>NOK ${fmt(r)}</b><span class="oc-small">из ${fmt(q.ok + q.nok)} результатов · ${f1(rateOf(q))}</span>` : '<span class="oc-small">нет проб</span>';
    return `<tr class="${cls || ''}"><td>${esc(name)}</td><td>${cell(a, ra)}</td><td>${cell(b, rb)}</td><td>${x.d}<div>${x.v}</div></td></tr>`;
  };
  const names = [...new Set(Object.keys(byA).concat(Object.keys(byB)))].filter(n => (byA[n] || {}).total || (byB[n] || {}).total);
  let up = 0, down = 0;
  names.forEach(n => { const ra = nokOf(byA[n]), rb = nokOf(byB[n]); if (ra != null && rb != null && rb !== ra) (rb < ra ? down++ : up++); });
  return `<div class="oc-count"><span class="oc-better">▼ улучшений: ${down}</span><span class="oc-worse">▲ ухудшений: ${up}</span></div>
    <table class="oc-mtab"><thead><tr><th>Объект</th><th>${la}</th><th>${lb}</th><th>Итог</th></tr></thead>
    <tbody>${names.map(n => line(n, byA[n], byB[n])).join('')}${line('Всего', totA, totB, 'oc-mtot')}</tbody></table>`;
}
function catsOf(wk){ const by = {}; Object.entries((wk || {}).categories || {}).forEach(([n, c]) => { by[n] = {total: c.total, ok: c.ok, nok: c.nok}; }); return by; }
function prevWeekKey(weeks, wk){ return Object.keys(weeks).filter(k => k < wk).sort().pop() || null; }
const wNum = k => parseInt(k.split('-W')[1], 10);
// ---------- правая колонка: неделя к прошлой неделе ----------
function weekBlock(basis){
  const st = N.state, data = basis === 'result' ? N.DATA.facilitiesRes : N.DATA.facilities;
  const weeks = (data || {})[st.facility] || {};
  const cur = weeks[st.week], pk = prevWeekKey(weeks, st.week), prev = pk && weeks[pk];
  if (!cur) return '';
  if (!prev) return `<div class="oc-side"><h3>Неделя к прошлой неделе</h3><div class="oc-empty">Нет данных за прошлую неделю — сравнить не с чем.</div></div>`;
  return `<div class="oc-side"><h3>Неделя ${wNum(st.week)} к неделе ${wNum(pk)} — улучшения и ухудшения</h3>
    <div class="oc-sub">По числу NOK: меньше обнаружений — улучшение, больше — ухудшение.</div>
    ${compareTable('нед. ' + wNum(pk), 'нед. ' + wNum(st.week), catsOf(prev), catsOf(cur), prev.overall, cur.overall)}</div>`;
}
// ---------- за месяц: улучшения / ухудшения ----------
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
function monthOfWeek(wk){ const [y, w] = wk.split('-W').map(Number); const j4 = new Date(Date.UTC(y, 0, 4)); const th = new Date(j4);
  th.setUTCDate(j4.getUTCDate() - (j4.getUTCDay() + 6) % 7 + (w - 1) * 7 + 3); return th.getUTCFullYear() * 12 + th.getUTCMonth(); }   // месяц недели — по её четвергу
function monthAgg(weeks, m){
  const by = {}, tot = {total: 0, ok: 0, nok: 0}, used = [];
  Object.keys(weeks).forEach(k => {
    if (monthOfWeek(k) !== m) return; used.push(k);
    const wk = weeks[k];
    Object.entries(wk.categories || {}).forEach(([n, c]) => { const a = by[n] = by[n] || {total: 0, ok: 0, nok: 0}; a.total += c.total; a.ok += c.ok; a.nok += c.nok; });
    const o = wk.overall || {}; tot.total += o.total || 0; tot.ok += o.ok || 0; tot.nok += o.nok || 0;
  });
  return {by, tot, weeks: used.sort()};
}
function monthBlock(basis){
  const st = N.state, data = basis === 'result' ? N.DATA.facilitiesRes : N.DATA.facilities;
  const weeks = (data || {})[st.facility] || {};
  if (!st.week) return '';
  const m = monthOfWeek(st.week), cur = monthAgg(weeks, m), prev = monthAgg(weeks, m - 1);
  const mName = x => MONTHS[((x % 12) + 12) % 12] + ' ' + Math.floor(x / 12);
  if (!prev.weeks.length) return `<div class="oc-side"><h3>За месяц: ${mName(m)} к ${mName(m - 1)}</h3><div class="oc-empty">Нет данных за ${mName(m - 1)} — сравнить не с чем.</div></div>`;
  const wl = ws => ws.length ? `нед. ${wNum(ws[0])}–${wNum(ws[ws.length - 1])}` : '';
  // динамика: число NOK по неделям прошлого и текущего месяца
  const dyn = prev.weeks.concat(cur.weeks);
  let last = null;
  const dynRows = dyn.map(k => {
    const o = weeks[k].overall || {}, r = nokOf(o), x = verdictOf(last, r); last = r;
    return `<tr${k === st.week ? ' class="oc-cur"' : ''}><td>нед. ${wNum(k)}<span class="oc-small">${monthOfWeek(k) === m ? mName(m) : mName(m - 1)}</span></td><td>${fmt(o.total)}</td><td><b>${fmt(o.nok)}</b><span class="oc-small">${f1(rateOf(o))}</span></td><td>${x.d}<div>${x.v}</div></td></tr>`;
  }).join('');
  return `<div class="oc-side"><h3>За месяц: ${mName(m)} к ${mName(m - 1)}</h3>
    <div class="oc-sub">Число NOK за все недели месяца: ${mName(m - 1)} — ${wl(prev.weeks)}, ${mName(m)} — ${wl(cur.weeks)}${cur.weeks.length < prev.weeks.length ? ` <b class="oc-worse">(${mName(m)} ещё неполный: недель ${cur.weeks.length} из ${prev.weeks.length} — NOK будет больше)</b>` : ''}. Меньше NOK — лучше.</div>
    ${compareTable(mName(m - 1), mName(m), prev.by, cur.by, prev.tot, cur.tot)}
    <h3 style="margin-top:12px">Динамика по неделям</h3>
    <table class="oc-mtab"><thead><tr><th>Неделя</th><th>Смывов</th><th>NOK</th><th>К прошлой неделе</th></tr></thead><tbody>${dynRows}</tbody></table></div>`;
}
// ---------- отдельная таблица: результаты подтвердились ----------
// Неделя отбора: сколько проб отобрано, сколько результатов выдано (OK/NOK), сколько ждут; и сверка с журналом
// «по дате обнаружения» — те же пробы недели отбора должны найтись там с тем же числом NOK.
function confirmBlock(){
  const st = N.state, S = ((N.DATA.facilities || {})[st.facility]) || {}, R = ((N.DATA.facilitiesRes || {})[st.facility]) || {};
  if (!st.week) return '';
  const ks = Object.keys(S).filter(k => k <= st.week).sort().slice(-8);
  if (!ks.length) return '';
  const rows = ks.map(k => {
    const o = S[k].overall || {}, w = wNum(k), y = k.split('-W')[0];
    let rt = 0, rn = 0, has = false;
    Object.keys(R).forEach(rk => { const fw = R[rk].fromWeeks; if (!fw || rk < k || !fw[w] || rk.split('-W')[0] < y) return; has = true; rt += fw[w].total; rn += fw[w].nok; });
    const res = (o.ok || 0) + (o.nok || 0), pend = (o.total || 0) - res;
    let status;
    if (!has && res) status = '<span class="oc-same">нет данных по дате выдачи</span>';
    else if (!res) status = '<span class="oc-same">результатов ещё нет</span>';
    else if (rt === res && rn === (o.nok || 0)) status = pend ? '<span class="oc-better">✓ подтверждено</span><span class="oc-small">остальные ждут результата</span>' : '<span class="oc-better">✓ подтверждено полностью</span>';
    else status = `<span class="oc-worse">⚠ расхождение</span><span class="oc-small">в журнале выдачи: ${fmt(rt)} результатов, NOK ${fmt(rn)}</span>`;
    return `<tr${k === st.week ? ' class="oc-cur"' : ''}><td>нед. ${w}<span class="oc-small">${rangeOf(k)}</span></td><td>${fmt(o.total)}</td>
      <td><b>${fmt(res)}</b><span class="oc-small">${pct(res, o.total)}</span></td><td>${fmt(o.ok)}<span class="oc-small">${pct(o.ok, res)}</span></td>
      <td>${fmt(o.nok)}<span class="oc-small">${pct(o.nok, res)}</span></td><td>${fmt(pend)}</td><td>${has ? `${fmt(rt)} · NOK ${fmt(rn)}` : '—'}</td><td>${status}</td></tr>`;
  }).join('');
  return `<div class="oc-panel"><h2>Подтверждение результатов — ${esc(st.facility)}</h2>
    <div class="oc-sub">По неделе отбора проб: сколько результатов уже выдано и подтверждено. «Подтверждено» — пробы этой недели нашлись в журнале по дате выдачи результата с тем же числом OK и NOK.</div>
    <table class="oc-mtab"><thead><tr><th>Неделя отбора</th><th>Отобрано</th><th>Результат выдан</th><th>OK</th><th>NOK</th><th>Ждут</th><th>По дате выдачи</th><th>Подтверждение</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
// ---------- динамика по неделям: графики (SVG, без библиотек — работает и офлайн) ----------
let DYN_N = 12, DYN_HIDE = {};
try { DYN_N = +localStorage.getItem('nokDynN') || 12; } catch (e) {}
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#475569', '#65a30d'];
function dynBlock(){
  const st = N.state, basis = st.basis === 'result' ? 'result' : 'sample';
  const all = ((basis === 'result' ? N.DATA.facilitiesRes : N.DATA.facilities) || {})[st.facility] || {};
  if (!st.week) return '';
  let ks = Object.keys(all).filter(k => k <= st.week).sort();
  if (DYN_N) ks = ks.slice(-DYN_N);
  if (ks.length < 2) return `<div class="oc-panel"><h2>Динамика по неделям</h2><div class="oc-empty">Для динамики нужно хотя бы 2 недели.</div></div>`;
  const W = 1100, H1 = 300, L = 46, R = 46, T = 26, B = 46, iw = W - L - R, ih = H1 - T - B, n = ks.length, step = iw / n, bw = Math.min(46, step * 0.62);
  const X = i => L + step * i + step / 2;
  const ov = ks.map(k => all[k].overall || {total: 0, ok: 0, nok: 0});
  const maxT = Math.max(1, ...ov.map(o => o.total || 0));
  const nice = (raw) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9)))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw); };
  const stp = Math.max(1, nice(maxT / 5)), TK = Math.ceil(maxT / stp), yMax = stp * TK, Y = v => T + ih - v / yMax * ih;
  const rates = ov.map(o => nokOf(o)), rStep = Math.max(1, nice(Math.max(5, ...rates.filter(r => r != null)) / TK)), rMax = rStep * TK, YR = v => T + ih - v / rMax * ih;
  let g = '';
  for (let i = 0; i <= TK; i++) { const v = stp * i, y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="dg-grid"/><text x="${L - 6}" y="${y + 4}" class="dg-ax" text-anchor="end">${fmt(Math.round(v))}</text><text x="${W - R + 6}" y="${y + 4}" class="dg-ax dg-axr">${fmt(rStep * i)}</text>`; }
  let bars = '', pts = [], lab = '';
  ks.forEach((k, i) => {
    const o = ov[i], x = X(i) - bw / 2, pend = (o.total || 0) - (o.ok || 0) - (o.nok || 0);
    let y = Y(0);
    [['ok', o.ok || 0], ['nok', o.nok || 0], ['pend', pend]].forEach(([c, v]) => { if (!v) return; const hh = v / yMax * ih; y -= hh; bars += `<rect x="${x}" y="${y}" width="${bw}" height="${hh}" class="dg-${c}"><title>Нед. ${wNum(k)} · ${c === 'ok' ? 'OK' : c === 'nok' ? 'NOK' : 'ждут'}: ${fmt(v)}</title></rect>`; });
    bars += `<text x="${X(i)}" y="${Y(o.total) - 4}" class="dg-val" text-anchor="middle">${fmt(o.total)}</text>`;
    if (rates[i] != null) pts.push([X(i), YR(rates[i]), rates[i], k]);
    lab += `<text x="${X(i)}" y="${H1 - B + 18}" class="dg-ax${k === st.week ? ' dg-cur' : ''}" text-anchor="middle">нед. ${wNum(k)}</text><rect x="${L + step * i}" y="${T}" width="${step}" height="${ih + 24}" class="dg-hit" data-wk="${k}"><title>Открыть неделю ${wNum(k)}</title></rect>`;
  });
  const line = pts.length ? `<polyline points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}" class="dg-line"/>` + pts.map((p, j) => {
    const prev = j ? pts[j - 1][2] : null, cls = prev == null || p[2] === prev ? '' : p[2] < prev ? ' dg-better' : ' dg-worse';
    return `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" class="dg-dot${cls}"/><text x="${p[0]}" y="${p[1] - 9}" class="dg-pct${cls}" text-anchor="middle">NOK ${fmt(p[2])}</text>`; }).join('') : '';
  const cur = ks.indexOf(st.week), hl = cur >= 0 ? `<rect x="${L + step * cur}" y="${T}" width="${step}" height="${ih}" class="dg-curbg"/>` : '';
  const chart1 = `<svg viewBox="0 0 ${W} ${H1}" class="dg-svg">${hl}${g}${bars}${line}${lab}</svg>`;
  // график 2: число NOK по объектам
  const tot = {}; ks.forEach(k => Object.entries(all[k].categories || {}).forEach(([nm, c]) => { tot[nm] = (tot[nm] || 0) + (c.total || 0); }));
  const objs = Object.keys(tot).filter(nm => tot[nm] > 0).sort((a, b) => tot[b] - tot[a]).slice(0, 10);
  const H2 = 300, ih2 = H2 - T - B;
  let r2 = 4; objs.forEach(nm => ks.forEach(k => { const r = nokOf((all[k].categories || {})[nm]); if (r != null && !DYN_HIDE[nm]) r2 = Math.max(r2, r); }));
  r2 = Math.ceil(r2 / 4) * 4;
  const Y2 = v => T + ih2 - v / r2 * ih2;
  let g2 = '';
  for (let i = 0; i <= 4; i++) { const v = r2 * i / 4, y = Y2(v); g2 += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="dg-grid"/><text x="${L - 6}" y="${y + 4}" class="dg-ax" text-anchor="end">${fmt(v)}</text>`; }
  let lines2 = '';
  objs.forEach((nm, oi) => {
    if (DYN_HIDE[nm]) return;
    const col = PALETTE[oi % PALETTE.length];
    const p = ks.map((k, i) => { const c = (all[k].categories || {})[nm]; const r = nokOf(c); return r == null ? null : [X(i), Y2(r), r, c, k]; });
    let seg = [], d = '';
    p.forEach(q => { if (q) seg.push(q[0] + ',' + q[1]); else { if (seg.length > 1) d += `<polyline points="${seg.join(' ')}" fill="none" stroke="${col}" stroke-width="2.2"/>`; seg = []; } });
    if (seg.length > 1) d += `<polyline points="${seg.join(' ')}" fill="none" stroke="${col}" stroke-width="2.2"/>`;
    lines2 += d + p.filter(Boolean).map(q => `<circle cx="${q[0]}" cy="${q[1]}" r="3.6" fill="${col}"><title>${esc(nm)} · нед. ${wNum(q[4])}: NOK ${fmt(q[2])} из ${fmt(q[3].ok + q[3].nok)} (${f1(rateOf(q[3]))})</title></circle>`).join('');
  });
  const lab2 = ks.map((k, i) => `<text x="${X(i)}" y="${H2 - B + 18}" class="dg-ax${k === st.week ? ' dg-cur' : ''}" text-anchor="middle">нед. ${wNum(k)}</text>`).join('');
  const chart2 = `<svg viewBox="0 0 ${W} ${H2}" class="dg-svg">${hl.replace(`height="${ih}"`, `height="${ih2}"`)}${g2}${lines2}${lab2}</svg>`;
  const legend2 = objs.map((nm, oi) => `<button class="dg-lg${DYN_HIDE[nm] ? ' off' : ''}" data-obj="${esc(nm)}"><i style="background:${PALETTE[oi % PALETTE.length]}"></i>${esc(nm)}</button>`).join('');
  const ranges = [[8, '8 недель'], [12, '12 недель'], [26, 'полгода'], [0, 'все']].map(([v, t]) => `<button class="dg-rg${DYN_N === v ? ' on' : ''}" data-n="${v}">${t}</button>`).join('');
  return `<div class="oc-panel"><h2>Динамика по неделям — ${esc(st.facility)}</h2>
    <div class="oc-sub">${basis === 'result' ? 'по дате обнаружения (выдачи результата)' : 'по дате отбора проб'} · нажмите на неделю, чтобы открыть её</div>
    <div class="dg-bar">${ranges}</div>
    <h3 class="dg-h">Смывы за неделю и число NOK</h3>
    <div class="oc-legend"><span><i class="oc-ok"></i>OK</span><span><i class="oc-nok"></i>NOK</span><span><i class="oc-pend"></i>ждут результата</span><span><i style="background:#1e293b;height:3px;vertical-align:3px"></i>число NOK (правая шкала): <b class="oc-better">зелёная точка</b> — NOK меньше, чем на прошлой неделе, <b class="oc-worse">красная</b> — больше</span></div>
    ${chart1}
    <h3 class="dg-h">Число NOK по объектам</h3>
    <div class="dg-legend">${legend2}</div>
    ${chart2}</div>`;
}
box.addEventListener('click', e => {
  const r = e.target.closest('[data-n]'); if (r) { DYN_N = +r.dataset.n; try { localStorage.setItem('nokDynN', DYN_N); } catch (err) {} draw(); return; }
  const o = e.target.closest('[data-obj]'); if (o) { DYN_HIDE[o.dataset.obj] = !DYN_HIDE[o.dataset.obj]; draw(); return; }
  const w = e.target.closest('[data-wk]'); if (w) { const sel = $('weekSelect'); if ([...sel.options].some(op => op.value === w.dataset.wk)) { sel.value = w.dataset.wk; sel.dispatchEvent(new Event('change')); } }
});
function draw(){
  document.querySelectorAll('#nokTabs .nok-tab').forEach(b => b.classList.toggle('on', b.dataset.view === VIEW));
  const chart = VIEW === 'chart';
  document.body.classList.toggle('oc-mode', chart);
  box.style.display = chart ? '' : 'none';
  if (chart){
    $('singleView').style.display = 'none'; $('splitView').style.display = 'none';
    const b = N.state.basis;
    box.innerHTML = dynBlock() + (b === 'both' ? panel('sample') + panel('result') : panel(b)) + confirmBlock();
  } else {
    const split = N.state.basis === 'both';
    $('singleView').style.display = split ? 'none' : ''; $('splitView').style.display = split ? '' : 'none';
  }
}
$('nokTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  VIEW = b.dataset.view; try { localStorage.setItem('nokView', VIEW); } catch (err) {}
  draw();
});
// перерисовываем при каждой смене недели, площадки, основы и после загрузки Свода
new MutationObserver(() => { if (VIEW === 'chart') draw(); }).observe($('metaLine'), {childList: true, characterData: true, subtree: true});
draw();
})();
