// Настольное приложение «Качество мойки — УКПФ»: три дашборда во вкладках
// (Качество мойки, NOK-дашборд, Мойка и МБ) в собственном окне.
// Страницы — www/ (собирает build-www.js), открываются по адресу app://app/ —
// у всех вкладок один адрес, поэтому они видят данные друг друга.
// Папка «Документы\Качество мойки\Данные» (туда скачиваются папки SharePoint) отдаётся
// дашбордам сама — без окна выбора папки.
const { app, BrowserWindow, Menu, shell, session, dialog, protocol, net, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const sp = require('./sharepoint');

const TITLE = 'Качество мойки — УКПФ';
// разрешения, без которых не работают привязка папок/актов и копирование картинок
const ALLOWED_PERMISSIONS = new Set(['fileSystem', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
const WWW = path.join(__dirname, 'www');

let win = null;

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}

// ---------- размер и положение окна между запусками ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return { width: 1500, height: 950, maximized: true }; }
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(Object.assign(win.getNormalBounds(), { maximized: win.isMaximized(), zoom: win.webContents.getZoomFactor() })));
  } catch (e) { /* не критично */ }
}

// ---------- папки ----------
// выгрузки (PNG, PowerPoint, Word, отчёты) — отдельно от данных, чтобы дашборд не принял свои отчёты за фотофиксацию
const exportsDir = () => path.join(app.getPath('documents'), 'Качество мойки');
const dataDir = () => path.join(exportsDir(), 'Данные');
const spDir = () => path.join(dataDir(), 'SharePoint');

// ---------- папки на компьютере (в т.ч. OneDrive) — видны в «Данных» как подпапки ----------
// Папки отдела в OneDrive подключаются сами, если они есть на этом компьютере.
// У каждой папки — своя роль, как их дал отдел:
//   acts  — акты (выращивание, Инкубаторий, ЗПП): только отсюда, самый свежий файл каждого вида;
//   media — фото/видео и презентации несоответствий: только отсюда (и из скачанных папок SharePoint);
//   svod  — Свод МБ для NOK-дашборда и «Мойки и МБ»: самый свежий .xlsx в самой папке (не в подпапках).
const ONEDRIVE_AUTO = [
  { name: 'УКПФ (OneDrive)', role: 'acts', rel: path.join('Рабочий стол', 'Департамент Ветеринарии - Отчетность Департамента Ветеринарии', 'Служба Ветеринарной Санитарии и БиБ', 'УКПФ') },
  // еженедельные несоответствия по площадкам — только для вкладки «Несоответствие по площадкам» (не для фото качества мойки)
  { name: 'Несоответствия (OneDrive)', role: 'nc', rel: path.join('Рабочий стол', 'Несоответствие еженедельно') },
  { name: 'СВОД МБ (OneDrive)', role: 'svod', rel: path.join('Рабочий стол', 'BI_Business-Local Labs - СВОД') },
];
const ROLE_TITLE = { acts: 'акты', media: 'фото/видео и презентации', svod: 'Свод МБ', nc: 'несоответствие по площадкам' };
// роль папки: из настроек; у подключённых раньше — по имени
function roleOf(m) {
  if (m.role) return m.role;
  if (m.svod || /(^|[^а-яё])свод(?![а-яё])/i.test(m.name)) return 'svod';
  if (/^УКПФ/i.test(m.name)) return 'acts';
  return 'media';
}
// настройки — JSON в папке приложения: чтение устойчиво к повреждённому файлу, запись — через временный файл
function readJson(file) {
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; } catch (e) { return {}; }
}
function writeJson(file, c) {
  try { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(c, null, 2)); fs.renameSync(tmp, file); } catch (e) { /* не критично */ }
}
const foldersFile = () => path.join(app.getPath('userData'), 'folders.json');
function foldersConfig() {
  const c = readJson(foldersFile());
  c.mounts = (Array.isArray(c.mounts) ? c.mounts : []).filter((m) => m && typeof m.name === 'string' && typeof m.path === 'string');
  return c;
}
function saveFolders(c) { writeJson(foldersFile(), c); }
function oneDriveBases() {
  const home = app.getPath('home');
  const bases = [process.env.OneDriveCommercial, process.env.OneDrive].filter(Boolean);
  try { fs.readdirSync(home).filter((n) => /^OneDrive/i.test(n)).forEach((n) => bases.push(path.join(home, n))); } catch (e) { /* нет домашней папки */ }
  return [...new Set(bases)];
}
const RESERVED_MOUNT = (n) => n === 'SharePoint' || n === '__src';
const sameName = (a, b) => a.toLowerCase().replace(/ё/g, 'е').trim() === b.toLowerCase().replace(/ё/g, 'е').trim();
function findOneDrive(relPath) {
  const bases = oneDriveBases();
  for (const b of bases) {
    for (const rel of [relPath, relPath.replace('Рабочий стол', 'Desktop')]) {
      const abs = path.join(b, rel);
      try { if (fs.statSync(abs).isDirectory()) return abs; } catch (e) { /* нет такой */ }
    }
  }
  // не нашлась по точному пути — ищем папку с тем же именем (и тем же родителем) глубже в OneDrive
  const segs = relPath.split(path.sep), name = segs[segs.length - 1], parent = segs.length > 1 ? segs[segs.length - 2] : null;
  let seen = 0;
  for (const b of bases) {
    const queue = [[b, 0]];
    while (queue.length && seen < 4000) {
      const [dir, depth] = queue.shift();
      let items = [];
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const d of items) {
        if (!d.isDirectory() || d.name.startsWith('.')) continue;
        seen++;
        const abs = path.join(dir, d.name);
        if (sameName(d.name, name) && (!parent || segs.length < 3 || sameName(path.basename(dir), parent))) return abs;
        if (depth < 5) queue.push([abs, depth + 1]);
      }
    }
  }
  return null;
}
function autoMountOneDrive() {
  const c = foldersConfig();
  if (!Array.isArray(c.autoDone)) c.autoDone = c.ukpfDone ? ['УКПФ (OneDrive)'] : [];
  let changed = false;
  // раньше «Несоответствие еженедельно» была папкой фото мойки — теперь она для «Несоответствия по площадкам» (один раз)
  if (!c.ncMoved) {
    c.mounts.forEach((m) => { if (m.name === 'Несоответствия (OneDrive)' && (!m.role || m.role === 'media')) m.role = 'nc'; });
    c.ncMoved = true; changed = true;
  }
  for (const f of ONEDRIVE_AUTO) {
    if (c.autoDone.includes(f.name)) continue;   // уже подключали (или убрали вручную) — не трогаем
    const abs = findOneDrive(f.rel);
    if (!abs) continue;
    if (!c.mounts.some((m) => m.path === abs)) c.mounts.push({ name: f.name, path: abs, role: f.role });
    c.autoDone.push(f.name);
    changed = true;
  }
  if (changed) saveFolders(c);
}
// папку отдела не нашли сами — один раз спрашиваем, где она
async function askMissingOneDrive() {
  const c = foldersConfig();
  if (!Array.isArray(c.autoDone)) c.autoDone = [];
  if (!Array.isArray(c.asked)) c.asked = [];
  for (const f of ONEDRIVE_AUTO) {
    if (c.autoDone.includes(f.name) || c.asked.includes(f.name)) continue;
    c.asked.push(f.name);
    saveFolders(c);
    const what = { acts: 'акты выращивания, Инкубатория и ЗПП', media: 'презентации качества мойки (фото/видео)', nc: 'презентации еженедельных несоответствий по площадкам', svod: 'Свод микробиологии для NOK-дашборда и «Мойки и МБ»' }[f.role];
    const r = await dialog.showMessageBox(win, {
      type: 'question', title: 'Папка не найдена', noLink: true, buttons: ['Выбрать папку…', 'Позже'], defaultId: 0, cancelId: 1,
      message: `Не нашёл папку «${f.rel.split(path.sep).pop()}» в OneDrive`,
      detail: `Отсюда берутся ${what}.\nИскал: OneDrive\\${f.rel}\n\nУкажите эту папку один раз — дальше данные будут подтягиваться сами. Позже — меню «Файл → Папки на компьютере…».`,
    });
    if (r.response !== 0) continue;
    const pick = await dialog.showOpenDialog(win, { title: f.name, defaultPath: oneDriveBases()[0], properties: ['openDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) continue;
    const cc = foldersConfig();
    if (!cc.mounts.some((m) => m.path === pick.filePaths[0])) cc.mounts.push({ name: f.name, path: pick.filePaths[0], role: f.role });
    cc.autoDone = (cc.autoDone || []).concat(f.name);
    saveFolders(cc);
    watchData();
    dataChanged();
  }
}
const mounts = () => foldersConfig().mounts.filter((m) => { try { return fs.statSync(m.path).isDirectory(); } catch (e) { return false; } });

// ---------- адрес app://app/ : страницы приложения и папка «Данные» ----------
function inside(root, rel) {
  root = path.resolve(root);
  const abs = path.resolve(root, rel);
  const base = root.endsWith(path.sep) ? root : root + path.sep;   // корень диска (D:\\) уже с разделителем
  if (!(abs === root || abs.startsWith(base))) return null;
  // ярлык/символическая ссылка внутри папки не должна выводить за её пределы
  try {
    const realRoot = fs.realpathSync(root), real = fs.realpathSync(abs);
    const rb = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
    if (!(real === realRoot || real.startsWith(rb))) return null;
  } catch (e) { /* файла ещё нет — проверки по пути достаточно */ }
  return abs;
}
// путь внутри «Данных»: первая папка может быть подключённой папкой компьютера
// ---------- файлы, выбранные в «Настройках» (важнее автопоиска) ----------
const SRC_KINDS = { akt: 'Акт приёма мойки (выращивание)', incub: 'Акт Инкубатория', zpp: 'Акт ЗПП', schedule: 'График ПР/Р', svod: 'Свод МБ (NOK, Мойка и МБ)' };
const sourcesFile = () => path.join(app.getPath('userData'), 'sources.json');
function sourcesConfig() {
  const c = readJson(sourcesFile());
  if (!c.files || typeof c.files !== 'object' || Array.isArray(c.files)) c.files = {};
  Object.keys(c.files).forEach((k) => { if (typeof c.files[k] !== 'string') delete c.files[k]; });
  return c;
}
function saveSources(c) { writeJson(sourcesFile(), c); }
function fileInfo(abs) {
  try { const st = fs.statSync(abs); return st.isFile() ? { path: abs, name: path.basename(abs), mtime: Math.round(st.mtimeMs), size: st.size } : null; } catch (e) { return null; }
}
// выбранный файл вида kind — для вкладок он лежит по адресу «__src/<kind>/<имя файла>»
function srcFile(kind) { const p = sourcesConfig().files[kind]; return p ? fileInfo(p) : null; }

function dataPath(rel) {
  const segs = rel.split('/').filter(Boolean);
  if (segs[0] === '__src' && SRC_KINDS[segs[1]]) {
    const f = srcFile(segs[1]);
    return f && segs[2] === f.name && segs.length === 3 ? f.path : null;
  }
  const m = segs.length && mounts().find((x) => x.name === segs[0]);
  if (m) return inside(path.resolve(m.path), segs.slice(1).join('/'));
  return inside(dataDir(), segs.join('/'));
}
const SKIP_RE = /^~\$|\.part$|^desktop\.ini$|^thumbs\.db$|^\./i;
function listDir(abs) {
  return fs.readdirSync(abs, { withFileTypes: true }).filter((d) => !SKIP_RE.test(d.name) && (d.isDirectory() || d.isFile())).map((d) => {
    const st = fs.statSync(path.join(abs, d.name));
    return { name: d.name, kind: d.isDirectory() ? 'directory' : 'file', size: st.size, mtime: Math.round(st.mtimeMs) };
  });
}
// «Свод» для NOK-дашборда: самый свежий .xlsx со словом «свод», иначе «МБ/микроб/NOK»
function xlsxIn(abs, rel) {
  let items = [];
  try { items = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return []; }
  return items.filter((d) => d.isFile() && !SKIP_RE.test(d.name) && !PPR_RE.test(d.name) && /\.xlsx$/i.test(d.name)).map((d) => {
    const st = fs.statSync(path.join(abs, d.name));
    return { name: d.name, path: rel + '/' + d.name, mtime: Math.round(st.mtimeMs), size: st.size };
  });
}
// Свод для NOK-дашборда — как в веб-дашборде: самый свежий .xlsx в самой папке Свода (подпапки — архив, не берём)
function latestSvod() {
  const pick = srcFile('svod');
  if (pick) return { name: pick.name, path: '__src/svod/' + pick.name, mtime: pick.mtime, size: pick.size };
  const found = [];
  mounts().filter((m) => roleOf(m) === 'svod').forEach((m) => found.push(...xlsxIn(m.path, m.name)));
  return found.sort((x, y) => y.mtime - x.mtime)[0] || null;
}
// какие папки на что: для вкладок
function rolesInfo() {
  const r = { acts: [], media: [], svod: [], nc: [] };
  mounts().forEach((m) => (r[roleOf(m)] || r.media).push(m.name));
  try { if (fs.readdirSync(spDir()).length) r.media.push('SharePoint'); } catch (e) { /* SharePoint не подключали */ }
  return r;
}
// Защита страниц приложения (CSP): скрипты — только встроенные в приложение; в интернет страницы
// ничего отправить и ничего подгрузить не могут (кроме шрифтов Google) — даже если в Excel/презентации
// окажется вредоносный текст. Данные — только с app:// (папки, выбранные в «Настройках»).
const CSP = [
  "default-src 'self' app: data: blob:",
  "script-src 'self' app: 'unsafe-inline' 'unsafe-eval' blob:",
  "worker-src 'self' app: blob:",
  "style-src 'self' app: 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' app: data: https://fonts.gstatic.com",
  "img-src 'self' app: data: blob:",
  "media-src 'self' app: data: blob:",
  "connect-src 'self' app: data: blob:",
  "frame-src 'self' app:",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');
async function page(abs) {
  const r = await net.fetch(pathToFileURL(abs).toString());
  if (!/\.html?$/i.test(abs)) return r;
  const h = new Headers(r.headers);
  h.set('Content-Security-Policy', CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(r.body, { status: r.status, headers: h });
}
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function handleApp(req) {
  try {
    const u = new URL(req.url);
    const p = decodeURIComponent(u.pathname);
    if (p === '/data-roles') return json(rolesInfo());
    if (p.startsWith('/cfg/')) return json(await handleCfg(p.slice(5), u.searchParams));
    if (p === '/data-info') {
      fs.mkdirSync(dataDir(), { recursive: true });
      return json({ dir: dataDir(), latest: latestSvod() });
    }
    if (p === '/cmd/open-data') {
      fs.mkdirSync(dataDir(), { recursive: true });
      shell.openPath(dataDir());
      return json({ ok: true });
    }
    if (p === '/data-list' || p.startsWith('/data-list/')) {
      const rel = p.slice('/data-list/'.length);
      const abs = dataPath(rel);
      let items = abs && fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? listDir(abs) : [];
      // в корне «Данных» — ещё и подключённые папки компьютера
      if (!rel.split('/').filter(Boolean).length) {
        items = items.filter((it) => !mounts().some((m) => m.name === it.name))
          .concat(mounts().map((m) => ({ name: m.name, kind: 'directory', size: 0, mtime: Math.round(fs.statSync(m.path).mtimeMs) })));
      }
      return json(items, abs ? 200 : 403);
    }
    if (p.startsWith('/data/')) {
      const abs = dataPath(p.slice('/data/'.length));
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response('нет файла', { status: 404 });
      // файлы из папок — только данные: html/svg из папки не выполняются как страница приложения
      const r = await net.fetch(pathToFileURL(abs).toString());
      const h = new Headers(r.headers);
      h.set('Content-Security-Policy', "sandbox; default-src 'none'");
      h.set('X-Content-Type-Options', 'nosniff');
      if (/\.(html?|xhtml|svg|xml|js|mjs)$/i.test(abs)) h.set('Content-Type', 'application/octet-stream');
      return new Response(r.body, { status: r.status, headers: h });
    }
    const abs = inside(WWW, p.replace(/^\/+/, '') || 'index.html');
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response('нет страницы', { status: 404 });
    return page(abs);
  } catch (e) {
    return new Response(String(e && e.message || e), { status: /URI/.test(String(e && e.name)) ? 400 : 500 });
  }
}

// ---------- связь с оболочкой (www/index.html) ----------
function shellJs(code) {
  if (!win || win.isDestroyed()) return Promise.resolve(null);
  return win.webContents.executeJavaScript(code).catch(() => null);
}
function toast(text, kind) { shellJs(`window.APP && APP.toast(${JSON.stringify(text)}, ${JSON.stringify(kind || '')})`); }
function dataChanged() { shellJs('window.APP && APP.dataChanged()'); }

// новые файлы, положенные в «Данные» руками, — тоже подхватываются (через 4 с после последнего изменения)
let watchTimer = null;

// ---------- «⚙ Настройки» внизу окна: что откуда брать + «Обновить сейчас» ----------
function autoActs() {
  const out = {};
  mounts().filter((m) => roleOf(m) === 'acts').forEach((m) => {
    const top = xlsxIn(m.path, m.name);
    [['akt', 'акт приёма мойки (выращивание)'], ['incub', 'акт Инкубатория'], ['zpp', 'акт ЗПП'], ['schedule', 'график ПР/Р']].forEach(([k, label]) => {
      const f = top.filter((x) => actKind(x.name) === label).sort((a, b) => b.mtime - a.mtime)[0];
      if (f && !out[k]) out[k] = f;
    });
  });
  return out;
}
function sourcesState() {
  const sc = sourcesConfig(), auto = autoActs();
  const files = {};
  Object.keys(SRC_KINDS).forEach((k) => {
    const chosen = sc.files[k] ? fileInfo(sc.files[k]) : null;
    const a = k === 'svod' ? (() => { const f = sc.files.svod ? null : latestSvod(); return f; })() : auto[k] || null;
    files[k] = { title: SRC_KINDS[k], chosen, chosenMissing: !!sc.files[k] && !chosen, chosenPath: sc.files[k] || null, auto: a ? { name: a.name, where: a.path.split('/')[0], mtime: a.mtime } : null };
  });
  return {
    files,
    folders: foldersConfig().mounts.map((m) => ({ name: m.name, path: m.path, role: roleOf(m), roleTitle: ROLE_TITLE[roleOf(m)], ok: fs.existsSync(m.path) })),
    sharepoint: spConfig().links.map((l) => ({ name: spName(l), link: l.link, lastSync: l.lastSync || null, account: l.account || null, access: l.access || null, error: l.error || null })),
    lastRefresh,
  };
}
let lastRefresh = null;
async function handleCfg(cmd, q) {
  const kind = q.get('kind');
  if (cmd === 'state') return sourcesState();
  if (cmd === 'pick-file' && SRC_KINDS[kind]) {
    const r = await dialog.showOpenDialog(win, { title: SRC_KINDS[kind], properties: ['openFile'], defaultPath: oneDriveBases()[0],
      filters: [{ name: 'Excel', extensions: kind === 'svod' ? ['xlsx', 'csv'] : ['xlsx', 'xlsm'] }] });
    if (!r.canceled && r.filePaths[0]) {
      const c = sourcesConfig(); c.files[kind] = r.filePaths[0]; saveSources(c);
      watchSources(); shellJs('window.APP && APP.dataChanged(true)');
    }
    return sourcesState();
  }
  if (cmd === 'clear-file' && SRC_KINDS[kind]) {
    const c = sourcesConfig(); delete c.files[kind]; saveSources(c);
    shellJs('window.APP && APP.dataChanged(true)');   // снова искать самому — перечитать всё
    return sourcesState();
  }
  if (cmd === 'add-folder') {
    const role = ['acts', 'media', 'svod', 'nc'].includes(q.get('role')) ? q.get('role') : 'media';
    const r = await dialog.showOpenDialog(win, { title: 'Папка: ' + ROLE_TITLE[role], properties: ['openDirectory'], defaultPath: oneDriveBases()[0] });
    if (!r.canceled && r.filePaths[0]) {
      const c = foldersConfig(), abs = r.filePaths[0];
      let name = path.basename(abs) || 'Папка';
      while (c.mounts.some((m) => m.name === name) || name === 'SharePoint' || name === '__src') name += ' 2';
      if (role === 'svod') { const sc = sourcesConfig(); delete sc.files.svod; saveSources(sc); }   // папка Свода вместо файла
      if (!c.mounts.some((m) => m.path === abs)) c.mounts.push({ name, path: abs, role });
      saveFolders(c); watchData(); dataChanged();
    }
    return sourcesState();
  }
  if (cmd === 'remove-folder') {
    const c = foldersConfig();
    c.mounts = c.mounts.filter((m) => m.name !== q.get('name'));
    saveFolders(c); watchData(); dataChanged();
    return sourcesState();
  }
  if (cmd === 'sharepoint') { syncSharePoint({ interactive: true, askLink: true }); return sourcesState(); }
  if (cmd === 'sp-login') {
    // вход рабочей учётной записью Microsoft: окно входа (если нужен), затем — под кем вошли и можно ли скачивать
    const c = spConfig();
    if (!c.links.length) c.links.push({ link: DEFAULT_SP_LINK });
    for (const l of c.links) {
      try {
        Object.assign(l, await sp.resolveLink(l.link, win));
        l.account = await sp.currentUser(l.site).catch(() => null);
        l.access = await sp.checkAccess(l.site, l.folderPath);
        delete l.error;
      } catch (e) { l.error = e && e.message ? e.message : String(e); }
    }
    saveSpConfig(c);
    if (c.links.some((l) => l.access && l.access.download)) syncSharePoint({ interactive: true });
    return sourcesState();
  }
  if (cmd === 'sp-logout') {
    await spLogout();
    const c = spConfig(); c.links.forEach((l) => { delete l.account; delete l.access; }); saveSpConfig(c);
    return sourcesState();
  }
  if (cmd === 'refresh') {
    // «Обновить сейчас»: докачать SharePoint, затем перечитать всё во вкладках (даже если файлы не менялись)
    if (spConfig().links.length) await syncSharePoint({ interactive: true });
    lastRefresh = new Date().toISOString();
    await shellJs('window.APP && APP.dataChanged(true)');
    return sourcesState();
  }
  return { error: 'неизвестная команда' };
}
// выбранные файлы тоже подхватываются сами, когда их пересохранили
const srcWatch = {};
function watchSources() {
  const want = Object.values(sourcesConfig().files).filter(Boolean);
  Object.keys(srcWatch).forEach((f) => { if (!want.includes(f)) { fs.unwatchFile(f); delete srcWatch[f]; } });
  want.forEach((f) => {
    if (srcWatch[f]) return;
    srcWatch[f] = true;
    fs.watchFile(f, { interval: 5000 }, (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size) { clearTimeout(watchTimer); watchTimer = setTimeout(dataChanged, 3000); } });
  });
}
const watchers = {};
// OneDrive/SharePoint сами «трогают» файлы: докачивают при чтении, меняют атрибуты, пишут desktop.ini.
// Чтобы это не запускало перечитывание по кругу, вкладки обновляются, только если у файлов
// с данными (акты, Свод, презентации, фото/видео) изменились имя, размер или дата.
const DATA_FILE_RE = /\.(xlsx|xlsm|xlsb|xls|pptx|pptm|ppsx|ppsm|potx|ppt|pps|jpe?g|png|heic|heif|webp|gif|bmp|mp4|mov|m4v|avi|3gp|mkv|webm)$/i;
const isNoise = (name) => {
  const base = path.basename(String(name || ''));
  return /\.part$|^~\$|^\.|^desktop\.ini$|^thumbs\.db$|\.tmp$/i.test(base) || !DATA_FILE_RE.test(base) && /\.[a-z0-9]{1,5}$/i.test(base);
};
async function dataSig(roots) {
  const parts = [];
  let n = 0;
  async function walk(dir, depth) {
    let list;
    try { list = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { parts.push(dir + '!'); return; }
    for (const d of list) {
      if (++n > 100000) return;
      if (d.name.startsWith('.') || d.name.startsWith('~$')) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { if (depth < 10) await walk(p, depth + 1); }
      else if (DATA_FILE_RE.test(d.name)) {
        try { const st = await fs.promises.stat(p); parts.push(p + '|' + st.size + '|' + Math.round(st.mtimeMs)); } catch (e) { /* файл убрали */ }
      }
    }
  }
  for (const r of roots) await walk(r, 0);
  return parts.sort().join('\n');
}
let lastSig = null, sigBusy = false, sigAgain = false;
async function dataChangedIfReal() {
  if (sigBusy) { sigAgain = true; return; }
  sigBusy = true;
  try {
    const sig = await dataSig(watchRoots());
    if (sig !== lastSig) { const first = lastSig === null; lastSig = sig; if (!first) dataChanged(); }
  } catch (e) { console.warn('dataSig', e); }
  finally { sigBusy = false; if (sigAgain) { sigAgain = false; clearTimeout(watchTimer); watchTimer = setTimeout(dataChangedIfReal, 4000); } }
}
const watchRoots = () => [dataDir()].concat(mounts().map((m) => m.path));
function watchData() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const roots = watchRoots();
  lastSig = null; dataChangedIfReal();   // запомнить, что сейчас лежит в папках
  Object.keys(watchers).forEach((r) => { if (!roots.includes(r)) { watchers[r].close(); delete watchers[r]; } });
  roots.forEach((r) => {
    if (watchers[r]) return;
    try {
      watchers[r] = fs.watch(r, { recursive: true }, (ev, name) => {
        if (spBusy || (name && isNoise(name))) return;
        clearTimeout(watchTimer);
        watchTimer = setTimeout(dataChangedIfReal, 4000);
      });
    } catch (e) { console.warn('watch', r, e); }
  });
}

async function manageFolders() {
  const c = foldersConfig();
  const shown = c.mounts.slice(0, 5);
  const r = await dialog.showMessageBox(win, {
    type: 'info', title: 'Папки на компьютере', message: 'Папки на компьютере, из которых берутся данные',
    detail: (c.mounts.length ? c.mounts.map((m, i) => `${i + 1}. ${m.name} — ${ROLE_TITLE[roleOf(m)]}\n${m.path}`).join('\n\n') : 'Пока ни одной.') +
      '\n\nИз них, как и из «Данных», берутся акты (приёмка мойки, Инкубаторий, ЗПП, график ПР/Р — по имени файла), Свод МБ, фото/видео и презентации. Изменения подхватываются сами.',
    buttons: ['Добавить папку…'].concat(shown.map((m) => 'Убрать «' + m.name + '»'), ['Закрыть']), cancelId: shown.length + 1, defaultId: 0, noLink: true,
  });
  if (r.response === 0) {
    const pick = await dialog.showOpenDialog(win, { title: 'Папка с актами, сводами, фото/видео', properties: ['openDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return;
    const abs = pick.filePaths[0];
    let name = path.basename(abs) || 'Папка';
    while (c.mounts.some((m) => m.name === name) || RESERVED_MOUNT(name)) name += ' 2';
    const rr = await dialog.showMessageBox(win, { type: 'question', title: 'Что в этой папке?', message: `Что брать из папки «${name}»?`, noLink: true,
      buttons: ['Акты (выращивание, Инкубаторий, ЗПП)', 'Фото/видео и презентации', 'Свод МБ'], defaultId: 1, cancelId: 1 });
    const role = ['acts', 'media', 'svod'][rr.response];
    if (!c.mounts.some((m) => m.path === abs)) c.mounts.push({ name, path: abs, role });
    saveFolders(c);
  } else if (r.response <= shown.length) {
    c.mounts.splice(r.response - 1, 1);
    saveFolders(c);
  } else return;
  watchData();
  dataChanged();
  toast('Папки на компьютере обновлены — вкладки перечитывают данные.', 'ok');
}

// ---------- папки SharePoint/Teams по ссылкам ----------
// KM_SP_LINK — только для проверки на имитации SharePoint
const DEFAULT_SP_LINK = process.env.KM_SP_LINK || 'https://aitas.sharepoint.com/:f:/s/msteams_6c8e7e/IgBxx0E9LMr9QpHMqCGzYBKbAXsCANKq5GX98Fp4JyBAJvI?e=xV9eIL';
const SP_SYNC_EVERY = 30 * 60 * 1000;
const spFile = () => path.join(app.getPath('userData'), 'sharepoint.json');
function spConfig() {
  const c = readJson(spFile());
  if (!Array.isArray(c.links)) c.links = c.link ? [{ link: c.link, site: c.site, folderPath: c.folderPath }] : [];
  // только ссылки SharePoint (https://….sharepoint.com/…)
  c.links = c.links.filter((l) => l && sp.isSpLink(l.link));
  delete c.link; delete c.site; delete c.folderPath; delete c.localDir;
  return c;
}
function saveSpConfig(c) { writeJson(spFile(), c); }
const spName = (l) => decodeURIComponent((l.folderPath || '').split('/').pop() || '') || 'Папка';
let spBusy = false;
let spLoginDeclined = false;   // окно входа закрыли — до перезапуска сами его не открываем
const mb = (n) => (n / 1048576).toFixed(n > 104857600 ? 0 : 1) + ' МБ';

function askSpLink(current) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      parent: win, modal: true, width: 620, height: 330, resizable: false, minimizable: false, maximizable: false,
      title: 'Папка SharePoint', autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    let answered = false;
    w.webContents.on('page-title-updated', (e, t) => {
      if (t === 'SP-CANCEL') { answered = true; resolve(null); w.close(); }
      else if (t.startsWith('SP-LINK:')) { answered = true; resolve(t.slice(8)); w.close(); }
    });
    w.on('closed', () => { if (!answered) resolve(null); });
    w.loadFile(path.join(__dirname, 'sp-link.html'), { hash: encodeURIComponent(current || '') });
  });
}

async function syncOne(l, interactive) {
  if (!l.site || !l.folderPath) {
    toast('SharePoint: открываю ссылку… Если появится окно входа Microsoft — войдите рабочей учётной записью.');
    Object.assign(l, await sp.resolveLink(l.link, win));
  }
  const localDir = path.join(spDir(), spName(l).replace(/[<>:"/\\|?*]+/g, '_'));
  const run = () => sp.syncFolder({
    site: l.site, folderPath: l.folderPath, localDir,
    onProgress: (p) => {
      if (p.phase === 'list') toast(`SharePoint «${spName(l)}»: смотрю, что нового…`);
      else if (p.phase === 'download') {
        toast(`SharePoint «${spName(l)}»: скачиваю ${p.done + 1} из ${p.total} — ${p.file} (${mb(p.bytes)} из ${mb(p.totalBytes)})`);
        if (win && p.totalBytes) win.setProgressBar(Math.min(1, p.bytes / p.totalBytes));
      }
    },
  });
  try { return await run(); } catch (e) {
    if (!(e instanceof sp.AuthError)) throw e;
    // вход истёк — открываем вход Microsoft сами (если учётная запись запомнена, окно даже не появится)
    if (!interactive && spLoginDeclined) throw new Error('нужно войти — меню SharePoint → «Обновить из SharePoint» (F5)');
    toast('SharePoint: нужен вход в рабочую учётную запись Microsoft — войдите в открывшемся окне.');
    try { Object.assign(l, await sp.resolveLink(l.link, win)); } catch (err) {
      if (/закрыто/.test(err.message)) spLoginDeclined = true;
      throw err;
    }
    return run();
  }
}

async function syncSharePoint({ interactive, askLink } = {}) {
  if (spBusy) { if (interactive) toast('SharePoint: синхронизация уже идёт…'); return; }
  if (interactive) spLoginDeclined = false;
  const cfg = spConfig();
  // первый запуск: папка УКПФ подключается сама — остаётся только войти в рабочую учётную запись
  if (!cfg.links.length && !cfg.autoAdded && !askLink) {
    cfg.links.push({ link: DEFAULT_SP_LINK });
    cfg.autoAdded = true;
    saveSpConfig(cfg);
    interactive = true;
    toast('SharePoint: подключаю папку УКПФ. Войдите рабочей учётной записью Microsoft — дальше данные будут подтягиваться сами.');
  }
  spBusy = true;   // сразу: пока открыт диалог ссылки, таймер не запустит вторую синхронизацию
  if (askLink || !cfg.links.length) {
    if (!interactive) { spBusy = false; return; }
    const link = await askSpLink(cfg.links.length ? '' : DEFAULT_SP_LINK);
    if (!link || !sp.isSpLink(link)) { spBusy = false; if (link) toast('Это не ссылка SharePoint (нужно https://….sharepoint.com/…).', 'err'); return; }
    if (!cfg.links.some((l) => l.link === link)) cfg.links.push({ link });
    saveSpConfig(cfg);
  }
  let files = 0, bytes = 0;
  const errors = [];
  try {
    for (const l of cfg.links) {
      try {
        const r = await syncOne(l, interactive);
        files += r.downloaded; bytes += r.bytes;
        l.lastSync = new Date().toISOString();
        if (!l.account) l.account = await sp.currentUser(l.site).catch(() => null);
        l.access = { download: true };
        delete l.error;
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        l.error = msg;
        if (e instanceof sp.BlockedError) l.access = { download: false };
        errors.push(`«${spName(l)}»: ${/окно входа закрыто/.test(msg) ? 'вход не выполнен — F5, чтобы войти' : msg}`);
      }
      saveSpConfig(cfg);
    }
  } finally {
    spBusy = false;
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  }
  if (files || interactive) { dataChanged(); lastSig = null; dataChangedIfReal(); }
  if (errors.length) toast('SharePoint: ' + errors.join('; '), 'err');
  else toast(files ? `SharePoint: скачано новых/изменённых файлов — ${files} (${mb(bytes)}), вкладки обновлены.` : 'SharePoint: новых файлов нет.', 'ok');
}

async function manageSpLinks() {
  const cfg = spConfig();
  if (!cfg.links.length) { syncSharePoint({ interactive: true, askLink: true }); return; }
  const shown = cfg.links.slice(0, 6);
  const r = await dialog.showMessageBox(win, {
    type: 'info', title: 'Папки SharePoint', message: 'Подключённые папки SharePoint',
    detail: cfg.links.map((l, i) => `${i + 1}. ${spName(l)}${l.lastSync ? ' — обновлено ' + new Date(l.lastSync).toLocaleString('ru-RU') : ''}\n${l.link}`).join('\n\n') +
      '\n\nСкачанные файлы лежат в «Документы\\Качество мойки\\Данные\\SharePoint». Убранная папка перестаёт обновляться, скачанные файлы остаются.',
    buttons: shown.map((l) => 'Убрать «' + spName(l) + '»').concat(['Закрыть']), cancelId: shown.length, defaultId: shown.length, noLink: true,
  });
  if (r.response < shown.length) {
    cfg.links.splice(r.response, 1);
    saveSpConfig(cfg);
    toast('SharePoint: папка убрана из обновления.', 'ok');
  }
}

async function spLogout() {
  // вход Microsoft хранится отдельно от страниц приложения — стираем это хранилище целиком
  await sp.spSession().clearStorageData().catch(() => {});
  const cfg = spConfig();
  cfg.links.forEach((l) => { delete l.site; delete l.folderPath; });
  saveSpConfig(cfg);
  toast('SharePoint: вы вышли из учётной записи. Следующее обновление попросит войти.', 'ok');
}


// ---------- «Справка → Проверка данных»: что лежит в папках и что загрузилось во вкладки ----------
function frameJs(page, code) {
  const f = win && !win.isDestroyed() && win.webContents.mainFrame.framesInSubtree.find((x) => x.url.endsWith('/' + page));
  return f ? f.executeJavaScript(code).catch((e) => 'ошибка: ' + e.message) : Promise.resolve('вкладка ещё не открывалась');
}
// так же, как «Качество мойки» разбирает акты по имени файла
// файлы и папки ППР (планово-предупредительный ремонт) — не наши данные: не берём нигде
const PPR_RE = /(^|[^а-яёa-z])ппр([^а-яёa-z]|$)/i;
function actKind(name) {
  const n = name.toLowerCase().replace(/ё/g, 'е');
  if (PPR_RE.test(n)) return null;
  if (/(^|[^а-я])свод(?![а-я])|журнал|микроб|(^|[^а-я])мб([^а-я]|$)|nok/.test(n)) return 'Свод/журнал МБ';
  if (/инкуб/.test(n)) return 'акт Инкубатория';
  if (/зпп/.test(n)) return 'акт ЗПП';
  if (/график|пр[\s._-]*р|санразрыв/.test(n)) return 'график ПР/Р';
  if (/акт|мойк|при[её]м/.test(n)) return 'акт приёма мойки (выращивание)';
  return null;
}
function scanForReport(root) {
  const r = { xlsx: {}, other: [], pptx: [], media: 0, dateDirs: 0, files: 0 };
  (function walk(dir, rel, depth) {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of items) {
      if (r.files > 30000 || SKIP_RE.test(d.name)) continue;
      const relp = rel ? rel + '\\' + d.name : d.name;
      if (d.isDirectory()) { if (/^\d{4}-\d{2}-\d{2}$/.test(d.name)) r.dateDirs++; if (depth < 8) walk(path.join(dir, d.name), relp, depth + 1); continue; }
      r.files++;
      if (/\.(xlsx|xlsm|csv)$/i.test(d.name)) { const k = actKind(d.name); if (k) (r.xlsx[k] = r.xlsx[k] || []).push(relp); else r.other.push(relp); }
      else if (/\.(pptx|pptm|ppsx)$/i.test(d.name)) r.pptx.push(relp);
      else if (/\.(jpe?g|png|webp|gif|mp4|mov|avi|webm|m4v)$/i.test(d.name)) r.media++;
    }
  })(root, '', 0);
  return r;
}
async function dataReport() {
  toast('Проверяю папки и вкладки…');
  const L = [];
  const fc = foldersConfig(), spc = spConfig();
  L.push(`Качество мойки — версия ${app.getVersion()} · ${new Date().toLocaleString('ru-RU')}`, '');
  L.push('ПАПКИ');
  L.push(`  OneDrive на компьютере: ${oneDriveBases().join(' | ') || 'не найден'}`);
  L.push(`  Данные: ${dataDir()}`);
  fc.mounts.forEach((m) => L.push(`  ${m.name} [${ROLE_TITLE[roleOf(m)]}]: ${m.path} — ${fs.existsSync(m.path) ? 'есть' : 'НЕ НАЙДЕНА'}`));
  ONEDRIVE_AUTO.filter((f) => !fc.mounts.some((m) => m.name === f.name)).forEach((f) => L.push(`  ${f.name}: НЕ ПОДКЛЮЧЕНА (искал OneDrive\\${f.rel})`));
  spc.links.forEach((l) => L.push(`  SharePoint «${spName(l)}»: ${l.lastSync ? 'обновлено ' + new Date(l.lastSync).toLocaleString('ru-RU') : 'ещё не скачивалась'}`));
  L.push('');
  // что возьмётся: акты — по одному свежему каждого вида из самой папки актов; Свод — свежий .xlsx из самой папки Свода
  const sv = latestSvod();
  L.push('ЧТО БЕРЁТСЯ', `  Свод МБ (NOK, Мойка и МБ): ${sv ? sv.path + ' (' + new Date(sv.mtime).toLocaleString('ru-RU') + ')' : 'НЕ НАЙДЕН — в папке Свода нет .xlsx'}`);
  mounts().filter((m) => roleOf(m) === 'acts').forEach((m) => {
    const top = xlsxIn(m.path, m.name);
    ['акт приёма мойки (выращивание)', 'акт Инкубатория', 'акт ЗПП', 'график ПР/Р'].forEach((k) => {
      const f = top.filter((x) => actKind(x.name) === k).sort((a, b) => b.mtime - a.mtime)[0];
      L.push(`  ${k}: ${f ? f.path + ' (' + new Date(f.mtime).toLocaleString('ru-RU') + ')' : 'в самой папке нет — ищется в подпапках'}`);
    });
  });
  L.push(`  Фото/видео и презентации — из: ${rolesInfo().media.join(', ') || 'НЕТ ПАПОК'}`, '');
  for (const [name, root] of [['Данные', dataDir()]].concat(mounts().map((m) => [m.name + ' [' + ROLE_TITLE[roleOf(m)] + ']', m.path]))) {
    const r = scanForReport(root);
    L.push(`ФАЙЛЫ — ${name}: всего ${r.files}, фото/видео ${r.media}, папок-дат (ГГГГ-ММ-ДД) ${r.dateDirs}, презентаций ${r.pptx.length}`);
    Object.entries(r.xlsx).forEach(([k, list]) => L.push(`  ${k}: ${list.length}` + list.slice(0, 12).map((x) => '\n     ' + x).join('')));
    if (r.other.length) L.push(`  Excel без признаков акта/свода (не читаются): ${r.other.length}` + r.other.slice(0, 15).map((x) => '\n     ' + x).join(''));
    if (r.pptx.length) L.push('  Презентации:' + r.pptx.slice(0, 10).map((x) => '\n     ' + x).join('') + (r.pptx.length > 10 ? '\n     …' : ''));
    L.push('');
  }
  const moika = await frameJs('moika.html', `JSON.stringify({
    акты: AKT_SOURCES.map((s) => s.name + ' — ' + s.records.length + ' записей'), записей_всего: RECORDS_FULL.length,
    акт_инкубатория: INCUB_FILE_NAME, акт_ЗПП: (typeof ZPP_FILE_NAME !== 'undefined' ? ZPP_FILE_NAME : null),
    папка_фото: MEDIA_DIR_HANDLE && MEDIA_DIR_HANDLE.name, корпусо_дней_из_папок: Object.keys(DYNAMIC_MEDIA_INDEX).length,
    корпусо_дней_из_презентаций: Object.keys(PPTX_INDEX).length, зало_дней_инкубатория: Object.keys(INCUB_MEDIA_INDEX).length,
    статус_актов: document.getElementById('uploadStatus').textContent, статус_инкубатория: document.getElementById('incubUploadStatus').textContent,
    статус_ЗПП: document.getElementById('zppUploadStatus').textContent, статус_фото: document.getElementById('mediaUploadStatus').textContent,
    презентации_с_замечаниями: PPTX_REPORT.filter((r) => r.err || !r.n || r.noDate || r.noCorpus).slice(0, 15).map((r) => r.path + ': ' + (r.err || ('фото ' + r.n + ', без даты ' + (r.noDate || 0) + ', без корпуса ' + (r.noCorpus || 0)))),
  }, null, 2)`);
  const mbr = await frameJs('mb.html', `(document.getElementById('dirStatus') || {}).innerText || ''`);
  const nok = await frameJs('nok.html', `(document.getElementById('nokSync') || {}).innerText || ''`);
  L.push('ВКЛАДКА «КАЧЕСТВО МОЙКИ»', String(moika), '', 'ВКЛАДКА «МОЙКА И МБ»', String(mbr), '', 'ВКЛАДКА «NOK-ДАШБОРД»', String(nok));
  const text = L.join('\n');
  const file = path.join(exportsDir(), 'Проверка данных.txt');
  fs.mkdirSync(exportsDir(), { recursive: true });
  fs.writeFileSync(file, '﻿' + text.replace(/\n/g, '\r\n'), 'utf8');
  clipboard.writeText(text);
  shell.openPath(file);
  toast('Отчёт «Проверка данных» открыт и скопирован — его можно вставить в сообщение (Ctrl+V).', 'ok');
}

function start() {
  protocol.handle('app', handleApp);
  const ses = session.defaultSession;
  // разрешения — только страницам самого приложения (app://app), не чужим сайтам
  const fromApp = (u) => /^app:\/\/app(\/|$)/i.test(String(u || ''));
  ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(ALLOWED_PERMISSIONS.has(permission) && fromApp((details && details.requestingUrl) || (wc && wc.getURL()))));
  ses.setPermissionCheckHandler((wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && fromApp(origin));
  // хранилище входа SharePoint: никаких разрешений
  sp.spSession().setPermissionRequestHandler((wc, permission, callback) => callback(false));
  sp.spSession().setPermissionCheckHandler(() => false);
  ses.on('will-download', (e, item) => {
    try { fs.mkdirSync(exportsDir(), { recursive: true }); } catch (err) { /* диалог всё равно откроется */ }
    item.setSaveDialogOptions({ title: 'Сохранить файл', defaultPath: path.join(exportsDir(), item.getFilename()) });
  });

  autoMountOneDrive();
  Menu.setApplicationMenu(buildMenu());
  createWindow();
  watchData();
  watchSources();
}

function createWindow() {
  const st = loadWindowState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1500, height: st.height || 950,
    minWidth: 900, minHeight: 600,
    title: TITLE,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f4f6fa',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false, devTools: !app.isPackaged },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => { if (st.zoom) win.webContents.setZoomFactor(st.zoom); });
  // папки SharePoint: докачать новое после запуска и затем каждые 30 минут
  win.webContents.once('did-finish-load', () => {
    setTimeout(askMissingOneDrive, 3000);
    setTimeout(() => syncSharePoint({ interactive: false }), 8000);
    setInterval(() => syncSharePoint({ interactive: false }), SP_SYNC_EVERY);
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('close', saveWindowState);

  // ссылки на сайты — в обычном браузере, а не внутри приложения
  // чужой сайт не открывается внутри приложения; во внешнем браузере — сразу только SharePoint/Microsoft/GitHub, остальное — по подтверждению
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  win.webContents.on('will-frame-navigate', (e) => {
    if (/^app:\/\/app\//i.test(e.url) || /^(about:|blob:|data:)/i.test(e.url)) return;
    e.preventDefault();
    openOutside(e.url);
  });

  win.loadURL('app://app/index.html');
}

const TRUSTED_EXT = /(^|\.)(sharepoint\.com|microsoft\.com|office\.com|github\.com|aitas\.kz)$/i;
async function openOutside(url) {
  let u;
  try { u = new URL(url); } catch (e) { return; }
  if (!/^https?:$/.test(u.protocol)) return;
  if (!TRUSTED_EXT.test(u.hostname)) {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Открыть', 'Отмена'], defaultId: 1, cancelId: 1, noLink: true,
      title: 'Внешняя ссылка', message: 'Открыть сайт в браузере?', detail: u.origin + u.pathname });
    if (r.response !== 0) return;
  }
  shell.openExternal(u.toString());
}
function zoomBy(delta) {
  if (!win) return;
  const z = Math.min(2, Math.max(0.5, win.webContents.getZoomFactor() + delta));
  win.webContents.setZoomFactor(Math.round(z * 10) / 10);
}
const showTab = (t) => shellJs(`window.APP && APP.show(${JSON.stringify(t)})`);

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Файл',
      submenu: [
        { label: 'Обновить дашборды', accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.reload() },
        { label: 'Печать…', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.print() },
        { type: 'separator' },
        {
          label: 'Открыть папку «Данные»', click: () => {
            fs.mkdirSync(dataDir(), { recursive: true });
            shell.openPath(dataDir());
          },
        },
        { label: 'Папки на компьютере…', click: manageFolders },
        {
          label: 'Открыть папку с выгрузками', click: () => {
            fs.mkdirSync(exportsDir(), { recursive: true });
            shell.openPath(exportsDir());
          },
        },
        { type: 'separator' },
        { label: 'Выход', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', role: 'undo' },
        { label: 'Повторить', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' },
        { label: 'Выделить всё', role: 'selectAll' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Качество мойки', accelerator: 'CmdOrCtrl+1', click: () => showTab('moika') },
        { label: 'NOK-дашборд', accelerator: 'CmdOrCtrl+2', click: () => showTab('nok') },
        { label: 'Мойка и МБ', accelerator: 'CmdOrCtrl+3', click: () => showTab('mb') },
        { label: 'Качество мойки видео отчёт', accelerator: 'CmdOrCtrl+4', click: () => showTab('week') },
        { label: 'Несоответствие по площадкам', accelerator: 'CmdOrCtrl+5', click: () => showTab('nc') },
        { type: 'separator' },
        { label: 'Крупнее', accelerator: 'CmdOrCtrl+=', click: () => zoomBy(0.1) },
        { label: 'Крупнее', accelerator: 'CmdOrCtrl+Plus', visible: false, click: () => zoomBy(0.1) },
        { label: 'Мельче', accelerator: 'CmdOrCtrl+-', click: () => zoomBy(-0.1) },
        { label: 'Обычный размер', accelerator: 'CmdOrCtrl+0', click: () => win && win.webContents.setZoomFactor(1) },
        { type: 'separator' },
        { label: 'Во весь экран', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
      ],
    },
    {
      label: 'SharePoint',
      submenu: [
        { label: 'Подключить папку по ссылке…', click: () => syncSharePoint({ interactive: true, askLink: true }) },
        { label: 'Обновить из SharePoint', accelerator: 'F5', click: () => syncSharePoint({ interactive: true }) },
        { label: 'Подключённые папки…', click: manageSpLinks },
        {
          label: 'Открыть скачанные папки', click: () => {
            fs.mkdirSync(spDir(), { recursive: true });
            shell.openPath(spDir());
          },
        },
        { type: 'separator' },
        { label: 'Выйти из учётной записи SharePoint', click: spLogout },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе', click: () => dialog.showMessageBox(win, {
            type: 'info', title: 'О программе', message: TITLE,
            detail: `Версия ${app.getVersion()}\n\nВкладки: Качество мойки, NOK-дашборд, Мойка и МБ.\n\nПапка «Данные» (акты, своды МБ, фото/видео, презентации; сюда же скачиваются папки SharePoint) — подключается ко всем вкладкам сама:\n${dataDir()}\n\nВыгрузки по умолчанию сохраняются в:\n${exportsDir()}\n\nНастройки и баллы хранятся в профиле Windows:\n${app.getPath('userData')}`,
          }),
        },
        { label: 'Проверка данных (что найдено в папках)…', accelerator: 'F1', click: dataReport },
        { type: 'separator' },
        ...(app.isPackaged ? [] : [{ label: 'Инструменты разработчика', accelerator: 'CmdOrCtrl+Shift+I', click: () => win && win.webContents.toggleDevTools() }]),
      ],
    },
  ]);
}
