// Настольное приложение «Качество мойки — УКПФ»: три дашборда во вкладках
// (Качество мойки, NOK-дашборд, Мойка и МБ) в собственном окне.
// Страницы — www/ (собирает build-www.js), открываются по адресу app://app/ —
// у всех вкладок один адрес, поэтому они видят данные друг друга.
// Папка «Документы\Качество мойки\Данные» (туда скачиваются папки SharePoint) отдаётся
// дашбордам сама — без окна выбора папки.
const { app, BrowserWindow, Menu, shell, session, dialog, protocol, net } = require('electron');
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
const ONEDRIVE_AUTO = [
  // акты выращивания, Инкубатория, ЗПП, Свод МБ
  { name: 'УКПФ (OneDrive)', rel: path.join('Рабочий стол', 'Департамент Ветеринарии - Отчетность Департамента Ветеринарии', 'Служба Ветеринарной Санитарии и БиБ', 'УКПФ') },
  // еженедельные несоответствия: фото/видео и презентации выращивания
  { name: 'Несоответствия (OneDrive)', rel: path.join('Рабочий стол', 'Несоответствие еженедельно') },
];
const foldersFile = () => path.join(app.getPath('userData'), 'folders.json');
function foldersConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(foldersFile(), 'utf8')); } catch (e) { /* ещё нет */ }
  if (!Array.isArray(c.mounts)) c.mounts = [];
  return c;
}
function saveFolders(c) { try { fs.writeFileSync(foldersFile(), JSON.stringify(c, null, 2)); } catch (e) { /* не критично */ } }
function findOneDrive(relPath) {
  const home = app.getPath('home');
  const bases = [process.env.OneDriveCommercial, process.env.OneDrive].filter(Boolean);
  try { fs.readdirSync(home).filter((n) => /^OneDrive/i.test(n)).forEach((n) => bases.push(path.join(home, n))); } catch (e) { /* нет домашней папки */ }
  for (const b of bases) {
    for (const rel of [relPath, relPath.replace('Рабочий стол', 'Desktop')]) {
      const abs = path.join(b, rel);
      try { if (fs.statSync(abs).isDirectory()) return abs; } catch (e) { /* нет такой */ }
    }
  }
  return null;
}
function autoMountOneDrive() {
  const c = foldersConfig();
  if (!Array.isArray(c.autoDone)) c.autoDone = c.ukpfDone ? ['УКПФ (OneDrive)'] : [];
  let changed = false;
  for (const f of ONEDRIVE_AUTO) {
    if (c.autoDone.includes(f.name)) continue;   // уже подключали (или убрали вручную) — не трогаем
    const abs = findOneDrive(f.rel);
    if (!abs) continue;
    if (!c.mounts.some((m) => m.path === abs)) c.mounts.push({ name: f.name, path: abs });
    c.autoDone.push(f.name);
    changed = true;
  }
  if (changed) saveFolders(c);
}
const mounts = () => foldersConfig().mounts.filter((m) => { try { return fs.statSync(m.path).isDirectory(); } catch (e) { return false; } });

// ---------- адрес app://app/ : страницы приложения и папка «Данные» ----------
function inside(root, rel) {
  const abs = path.resolve(root, rel);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}
// путь внутри «Данных»: первая папка может быть подключённой папкой компьютера
function dataPath(rel) {
  const segs = rel.split('/').filter(Boolean);
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
function latestSvod() {
  const found = [];
  (function walk(abs, rel, depth) {
    let items = [];
    try { items = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
    for (const d of items) {
      if (SKIP_RE.test(d.name)) continue;
      if (d.isDirectory()) { if (depth < 6) walk(path.join(abs, d.name), rel ? rel + '/' + d.name : d.name, depth + 1); continue; }
      if (!/\.xlsx$/i.test(d.name)) continue;
      const st = fs.statSync(path.join(abs, d.name));
      found.push({ name: d.name, path: rel ? rel + '/' + d.name : d.name, mtime: Math.round(st.mtimeMs), size: st.size });
    }
  })(dataDir(), '', 0);
  mounts().forEach((m) => walkRoot(m.path, m.name));
  function walkRoot(abs, rel) {
    (function walk(a, r, depth) {
      let items = [];
      try { items = fs.readdirSync(a, { withFileTypes: true }); } catch (e) { return; }
      for (const d of items) {
        if (SKIP_RE.test(d.name)) continue;
        if (d.isDirectory()) { if (depth < 6) walk(path.join(a, d.name), r + '/' + d.name, depth + 1); continue; }
        if (!/\.xlsx$/i.test(d.name)) continue;
        const st = fs.statSync(path.join(a, d.name));
        found.push({ name: d.name, path: r + '/' + d.name, mtime: Math.round(st.mtimeMs), size: st.size });
      }
    })(abs, rel, 0);
  }
  const newest = (a) => a.sort((x, y) => y.mtime - x.mtime)[0] || null;
  return newest(found.filter((f) => /свод/i.test(f.name))) || newest(found.filter((f) => /мб|микроб|nok/i.test(f.name)));
}
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function handleApp(req) {
  const u = new URL(req.url);
  const p = decodeURIComponent(u.pathname);
  try {
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
      return net.fetch(pathToFileURL(abs).toString());
    }
    const abs = inside(WWW, p.replace(/^\/+/, '') || 'index.html');
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response('нет страницы', { status: 404 });
    return net.fetch(pathToFileURL(abs).toString());
  } catch (e) {
    return new Response(String(e && e.message || e), { status: 500 });
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
const watchers = {};
function watchData() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const roots = [dataDir()].concat(mounts().map((m) => m.path));
  Object.keys(watchers).forEach((r) => { if (!roots.includes(r)) { watchers[r].close(); delete watchers[r]; } });
  roots.forEach((r) => {
    if (watchers[r]) return;
    try {
      watchers[r] = fs.watch(r, { recursive: true }, (ev, name) => {
        if (spBusy || (name && /\.part$|~\$/i.test(name))) return;
        clearTimeout(watchTimer);
        watchTimer = setTimeout(dataChanged, 4000);
      });
    } catch (e) { console.warn('watch', r, e); }
  });
}

async function manageFolders() {
  const c = foldersConfig();
  const shown = c.mounts.slice(0, 5);
  const r = await dialog.showMessageBox(win, {
    type: 'info', title: 'Папки на компьютере', message: 'Папки на компьютере, из которых берутся данные',
    detail: (c.mounts.length ? c.mounts.map((m, i) => `${i + 1}. ${m.name}\n${m.path}`).join('\n\n') : 'Пока ни одной.') +
      '\n\nИз них, как и из «Данных», берутся акты (приёмка мойки, Инкубаторий, ЗПП, график ПР/Р — по имени файла), Свод МБ, фото/видео и презентации. Изменения подхватываются сами.',
    buttons: ['Добавить папку…'].concat(shown.map((m) => 'Убрать «' + m.name + '»'), ['Закрыть']), cancelId: shown.length + 1, defaultId: 0, noLink: true,
  });
  if (r.response === 0) {
    const pick = await dialog.showOpenDialog(win, { title: 'Папка с актами, сводами, фото/видео', properties: ['openDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return;
    const abs = pick.filePaths[0];
    let name = path.basename(abs) || 'Папка';
    while (c.mounts.some((m) => m.name === name) || name === 'SharePoint') name += ' 2';
    if (!c.mounts.some((m) => m.path === abs)) c.mounts.push({ name, path: abs });
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
  let c = {};
  try { c = JSON.parse(fs.readFileSync(spFile(), 'utf8')); } catch (e) { /* ещё нет */ }
  if (!Array.isArray(c.links)) c.links = c.link ? [{ link: c.link, site: c.site, folderPath: c.folderPath }] : [];
  delete c.link; delete c.site; delete c.folderPath; delete c.localDir;
  return c;
}
function saveSpConfig(c) { try { fs.writeFileSync(spFile(), JSON.stringify(c, null, 2)); } catch (e) { /* не критично */ } }
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
  if (askLink || !cfg.links.length) {
    if (!interactive) return;
    const link = await askSpLink(cfg.links.length ? '' : DEFAULT_SP_LINK);
    if (!link) return;
    if (!cfg.links.some((l) => l.link === link)) cfg.links.push({ link });
    saveSpConfig(cfg);
  }
  spBusy = true;
  let files = 0, bytes = 0;
  const errors = [];
  try {
    for (const l of cfg.links) {
      try {
        const r = await syncOne(l, interactive);
        files += r.downloaded; bytes += r.bytes;
        l.lastSync = new Date().toISOString();
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        errors.push(`«${spName(l)}»: ${/окно входа закрыто/.test(msg) ? 'вход не выполнен — F5, чтобы войти' : msg}`);
      }
      saveSpConfig(cfg);
    }
  } finally {
    spBusy = false;
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  }
  if (files || interactive) dataChanged();
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
  const ses = session.defaultSession;
  for (const c of await ses.cookies.get({})) {
    if (/sharepoint\.com|microsoftonline\.com|live\.com|microsoft\.com/i.test(c.domain)) {
      const url = (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + c.path;
      await ses.cookies.remove(url, c.name).catch(() => {});
    }
  }
  const cfg = spConfig();
  cfg.links.forEach((l) => { delete l.site; delete l.folderPath; });
  saveSpConfig(cfg);
  toast('SharePoint: вы вышли из учётной записи. Следующее обновление попросит войти.', 'ok');
}

function start() {
  protocol.handle('app', handleApp);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.on('will-download', (e, item) => {
    try { fs.mkdirSync(exportsDir(), { recursive: true }); } catch (err) { /* диалог всё равно откроется */ }
    item.setSaveDialogOptions({ title: 'Сохранить файл', defaultPath: path.join(exportsDir(), item.getFilename()) });
  });

  autoMountOneDrive();
  Menu.setApplicationMenu(buildMenu());
  createWindow();
  watchData();
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
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => { if (st.zoom) win.webContents.setZoomFactor(st.zoom); });
  // папки SharePoint: докачать новое после запуска и затем каждые 30 минут
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => syncSharePoint({ interactive: false }), 8000);
    setInterval(() => syncSharePoint({ interactive: false }), SP_SYNC_EVERY);
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('close', saveWindowState);

  // ссылки на сайты — в обычном браузере, а не внутри приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-frame-navigate', (e) => {
    if (/^https?:/i.test(e.url)) { e.preventDefault(); shell.openExternal(e.url); }
  });

  win.loadURL('app://app/index.html');
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
        { label: 'Фотофиксация по неделям', accelerator: 'CmdOrCtrl+4', click: () => showTab('week') },
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
        { type: 'separator' },
        { label: 'Инструменты разработчика', accelerator: 'CmdOrCtrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
      ],
    },
  ]);
}
