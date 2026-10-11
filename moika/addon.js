/* ===== Приложение «Качество мойки»: данные на устройстве и средний балл по месяцам ===== */
const MOIKA_KEY = 'moika:data';
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// Всё, что загружено (акты, сверки, фото, баллы из старого файла), сохраняется на этом устройстве.
function moikaSave(extra) {
  const prev = (() => { try { return JSON.parse(localStorage.getItem(MOIKA_KEY) || 'null') || {}; } catch (e) { return {}; } })();
  const data = Object.assign({}, prev, { records: RECORDS_FULL, pr_r_matches: PR_R_MATCHES, savedAt: new Date().toISOString() }, extra || {});
  try { localStorage.setItem(MOIKA_KEY, JSON.stringify(data)); return true; }
  catch (e) { moikaStatus('Не хватило памяти устройства, чтобы сохранить данные', true); return false; }
}
const _moikaRebuild = rebuildFromAktSources;
rebuildFromAktSources = function () { _moikaRebuild(); moikaSave(); moikaUploadStatus(); };

function moikaStatus(text, isErr) {
  const el = document.getElementById('moikaImportStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'upload-status' + (isErr ? ' err' : ' ok');
}
function moikaUploadStatus() {
  const el = document.getElementById('uploadStatus');
  if (el) el.textContent = RECORDS_FULL.length
    ? `Сохранено: ${RECORDS_FULL.length} записей · ${RECORDS.length} с ${fmtDate(DATA_SINCE)}`
    : 'Данных пока нет';
  const banner = document.getElementById('moikaEmpty');
  if (banner) banner.style.display = RECORDS_FULL.length ? 'none' : 'block';
}

// Перенос данных из старого файла дашборда (.html): акты, сверки ПР/Р, баллы Инкубатория и ЗПП, подписи фото.
async function moikaImportDashboard(file) {
  try {
    const text = await file.text();
    const grab = (re) => { const m = text.match(re); if (!m) return null; try { return JSON.parse(m[1]); } catch (e) { return null; } };
    const emb = grab(/^const EMBEDDED = (\{.*\});\s*$/m);
    if (!emb || !Array.isArray(emb.records)) { moikaStatus(`В файле «${file.name}» нет данных дашборда мойки`, true); return; }
    const media = grab(/^const MEDIA_MANIFEST = (\{.*\});\s*$/m) || {};
    const manualOld = grab(/const EMBEDDED_MANUAL_SCORES = (\{[\s\S]*?\});\s*\n\s*\/\* MANUAL_SCORES_EMBEDDED_END/) || {};
    // записи из файла + уже сохранённые в приложении (сохранённые — новее, они побеждают)
    const merged = new Map();
    emb.records.concat(RECORDS_FULL).forEach((r) => merged.set(r.corpus + '|' + r.date + '|' + (r.tod || ''), r));
    const records = Array.from(merged.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const manual = Object.assign({}, manualOld, EMBEDDED_MANUAL_SCORES);
    const ok = moikaSave({ records, pr_r_matches: emb.pr_r_matches || PR_R_MATCHES, media: Object.assign({}, media, MEDIA_MANIFEST), manual, sourceFile: file.name });
    if (ok) { moikaStatus(`Загружено из «${file.name}»: ${emb.records.length} записей. Открываю…`); setTimeout(() => location.reload(), 600); }
  } catch (e) { moikaStatus('Не удалось прочитать файл: ' + e.message, true); }
}
document.getElementById('moikaImportInput').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) moikaImportDashboard(f);
  e.target.value = '';
});
document.getElementById('moikaClearBtn').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Точно удалить все данные?'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Очистить данные'; }, 4000); return; }
  try { localStorage.removeItem(MOIKA_KEY); } catch (err) {}
  location.reload();
});

// ---------- средний балл по месяцам ----------
function moikaMonthStats() {
  const B = {};
  const bucket = (m) => B[m] || (B[m] = { vyr: [], ink: [], zpp: [], zones: {} });
  RECORDS_FULL.forEach((r) => {
    if (r.score == null || isNaN(r.score) || !r.date) return;
    const b = bucket(r.date.slice(0, 7));
    b.vyr.push(Number(r.score));
    (b.zones[r.zone] || (b.zones[r.zone] = [])).push(Number(r.score));
  });
  const manual = collectManualScores();
  Object.keys(manual).forEach((d) => {
    const v = manual[d];
    if (v['Инкубатор'] != null && !isNaN(v['Инкубатор'])) bucket(d.slice(0, 7)).ink.push(Number(v['Инкубатор']));
    if (v['ЗПП'] != null && !isNaN(v['ЗПП'])) bucket(d.slice(0, 7)).zpp.push(Number(v['ЗПП']));
  });
  const mean = (a) => (a.length ? avg(a) : null);
  const months = Object.keys(B).sort();
  return months.map((m, i) => {
    const b = B[m];
    const prev = i > 0 ? B[months[i - 1]] : null;
    const vyr = mean(b.vyr), pv = prev ? mean(prev.vyr) : null;
    return {
      m, label: monthLabel(m), n: b.vyr.length, vyr, dVyr: vyr != null && pv != null ? vyr - pv : null,
      below8: b.vyr.length ? b.vyr.filter((s) => s < 8).length / b.vyr.length * 100 : null,
      ink: mean(b.ink), nInk: b.ink.length, zpp: mean(b.zpp), nZpp: b.zpp.length,
      zones: Object.fromEntries(Object.entries(b.zones).map(([z, a]) => [z, { v: avg(a), n: a.length }])),
    };
  });
}
const curMonthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const f2 = (v) => (v == null ? '—' : v.toFixed(2).replace('.', ','));
function dTxt(d) {
  if (d == null) return '';
  if (Math.abs(d) < 0.005) return '<span class="md z">0,00</span>';
  return `<span class="md ${d > 0 ? 'up' : 'dn'}">${d > 0 ? '▲ +' : '▼ −'}${Math.abs(d).toFixed(2).replace('.', ',')}</span>`;
}
const vCls = (v, norm) => (v == null ? '' : v >= norm ? 'ok' : 'bad');

function renderMoikaMonthly() {
  const S = moikaMonthStats();
  const kpi = document.getElementById('moikaMonthKpis'), tbl = document.getElementById('moikaMonthTable'), ztbl = document.getElementById('moikaZoneMonthTable');
  if (!kpi) return;
  if (!S.length) { kpi.innerHTML = ''; tbl.innerHTML = '<p class="note">Нет оценок. Загрузите акты приёма мойки или старый файл дашборда.</p>'; ztbl.innerHTML = ''; return; }
  const cur = curMonthKey();
  const last = S[S.length - 1], lastFull = S.filter((x) => x.m < cur).pop();
  const tile = (v, l, s, cls) => `<div class="kpi"><div class="v ${cls || ''}">${v}</div><div class="l">${l}</div>${s ? `<div class="l">${s}</div>` : ''}</div>`;
  kpi.innerHTML =
    tile(f2(last.vyr), `Выращивание · ${last.label}${last.m === cur ? ' (идёт)' : ''}`, `${last.n} оценок ${dTxt(last.dVyr)}`, last.vyr >= 8 ? '' : 'red') +
    (lastFull && lastFull !== last ? tile(f2(lastFull.vyr), `Выращивание · ${lastFull.label}`, `${lastFull.n} оценок ${dTxt(lastFull.dVyr)}`, lastFull.vyr >= 8 ? '' : 'red') : '') +
    tile(f2(last.ink), `Инкубаторий · ${last.label}`, last.nInk ? `${last.nInk} дн.` : 'нет баллов', last.ink == null || last.ink >= 8 ? '' : 'red') +
    tile(f2(last.zpp), `ЗПП · ${last.label}`, last.nZpp ? `${last.nZpp} дн. · шкала 0–5` : 'нет баллов');
  const rows = S.slice().reverse();
  tbl.innerHTML = `<table class="mtab"><thead><tr><th>Месяц</th><th>Выращивание</th><th>к пред. месяцу</th><th>Оценок</th><th>Ниже 8</th><th>Инкубаторий</th><th>ЗПП (0–5)</th></tr></thead><tbody>` +
    rows.map((x) => `<tr${x.m === cur ? ' class="cur"' : ''}><td><b>${x.label}</b>${x.m === cur ? ' <span class="tag">идёт</span>' : ''}</td>` +
      `<td class="n ${vCls(x.vyr, 8)}">${f2(x.vyr)}</td><td class="n">${dTxt(x.dVyr)}</td><td class="n">${x.n || '—'}</td>` +
      `<td class="n">${x.below8 == null ? '—' : Math.round(x.below8) + '%'}</td>` +
      `<td class="n ${vCls(x.ink, 8)}">${f2(x.ink)}${x.nInk ? `<small>${x.nInk} дн.</small>` : ''}</td>` +
      `<td class="n ${vCls(x.zpp, 3)}">${f2(x.zpp)}${x.nZpp ? `<small>${x.nZpp} дн.</small>` : ''}</td></tr>`).join('') + '</tbody></table>';
  // по зонам: последние 12 месяцев
  const zm = S.slice(-12);
  const zones = Array.from(new Set(zm.flatMap((x) => Object.keys(x.zones)))).sort((a, b) => (ZONE_ORDER[a] ?? 99) - (ZONE_ORDER[b] ?? 99));
  ztbl.innerHTML = `<table class="mtab zt"><thead><tr><th>Зона</th>${zm.map((x) => `<th>${MONTHS_SHORT[+x.m.slice(5, 7) - 1]} ${x.m.slice(2, 4)}</th>`).join('')}</tr></thead><tbody>` +
    zones.map((z) => `<tr><td><b>${z}</b></td>${zm.map((x) => { const c = x.zones[z]; return `<td class="n ${c ? vCls(c.v, 8) : ''}" title="${c ? c.n + ' оценок' : ''}">${c ? f2(c.v) : '—'}</td>`; }).join('')}</tr>`).join('') +
    `<tr class="tot"><td><b>Все зоны</b></td>${zm.map((x) => `<td class="n ${vCls(x.vyr, 8)}"><b>${f2(x.vyr)}</b></td>`).join('')}</tr></tbody></table>`;
}
function moikaMonthCsv() {
  const S = moikaMonthStats();
  const num = (v) => (v == null ? '' : v.toFixed(2).replace('.', ','));
  const lines = ['Месяц;Выращивание;Оценок;Ниже 8, %;Инкубаторий;ЗПП (0-5)']
    .concat(S.map((x) => [x.label, num(x.vyr), x.n, x.below8 == null ? '' : Math.round(x.below8), num(x.ink), num(x.zpp)].join(';')));
  downloadBlob('﻿' + lines.join('\r\n'), 'sredniy_ball_po_mesyacam.csv', 'text/csv;charset=utf-8');
}
document.getElementById('moikaMonthCsv').addEventListener('click', moikaMonthCsv);

// средний балл месяца — первым на «Обзоре»
const _moikaOverview = TAB_RENDERERS.overview;
TAB_RENDERERS.overview = () => { renderMoikaMonthly(); _moikaOverview(); };
moikaUploadStatus();
const _moikaShowTab = showTab;
showTab = function (tab) { _moikaShowTab(tab); if (tab === 'overview') renderMoikaMonthly(); };
