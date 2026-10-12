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
function save(){ return kvSet('data', {facilities: N.DATA.facilities, facilitiesRes: N.DATA.facilitiesRes, meta: N.DATA.meta, savedAt: Date.now()}); }

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
    N.mergeIntoData(cleanWeeks(d.facilities), d.meta && d.meta.data_through, cleanWeeks(d.facilitiesRes));
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
  if(saved && saved.facilities){
    N.mergeIntoData(saved.facilities, saved.meta && saved.meta.data_through, saved.facilitiesRes);
    N.refresh(false);
  }
  SEEN = await kvGet('seen') || null;
  renderWeeks();
  if(window.desktop) desktopSetup();
  else if(window.showDirectoryPicker && !/Android|iPhone|iPad/i.test(navigator.userAgent)) browserSetup();
  else idle();
})();
})();
