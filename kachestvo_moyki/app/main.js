// Настольное приложение «Качество мойки — УКПФ»: дашборд в собственном окне.
// Сам дашборд — dashboard.html (копия ../dashboard_kachestvo_moyki.html, кладётся при сборке).
const { app, BrowserWindow, Menu, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const TITLE = 'Качество мойки — УКПФ';
// разрешения, без которых не работают привязка папок/актов и копирование картинок
const ALLOWED_PERMISSIONS = new Set(['fileSystem', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);

let win = null;

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

// ---------- куда сохранять выгрузки (PNG, PowerPoint, Word, отчёты) ----------
const exportsDir = () => path.join(app.getPath('documents'), 'Качество мойки');

function start() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.on('will-download', (e, item) => {
    try { fs.mkdirSync(exportsDir(), { recursive: true }); } catch (err) { /* диалог всё равно откроется */ }
    item.setSaveDialogOptions({ title: 'Сохранить файл', defaultPath: path.join(exportsDir(), item.getFilename()) });
  });

  Menu.setApplicationMenu(buildMenu());
  createWindow();
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
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('close', saveWindowState);

  // ссылки на сайты — в обычном браузере, а не внутри приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (/^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  win.loadFile(path.join(__dirname, 'dashboard.html'));
}

function zoomBy(delta) {
  if (!win) return;
  const z = Math.min(2, Math.max(0.5, win.webContents.getZoomFactor() + delta));
  win.webContents.setZoomFactor(Math.round(z * 10) / 10);
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Файл',
      submenu: [
        { label: 'Обновить дашборд', accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.reload() },
        { label: 'Печать…', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.print() },
        { type: 'separator' },
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
        { label: 'Крупнее', accelerator: 'CmdOrCtrl+=', click: () => zoomBy(0.1) },
        { label: 'Крупнее', accelerator: 'CmdOrCtrl+Plus', visible: false, click: () => zoomBy(0.1) },
        { label: 'Мельче', accelerator: 'CmdOrCtrl+-', click: () => zoomBy(-0.1) },
        { label: 'Обычный размер', accelerator: 'CmdOrCtrl+0', click: () => win && win.webContents.setZoomFactor(1) },
        { type: 'separator' },
        { label: 'Во весь экран', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе', click: () => dialog.showMessageBox(win, {
            type: 'info', title: 'О программе', message: TITLE,
            detail: `Версия ${app.getVersion()}\n\nДанные (баллы, привязанные папки и акты) хранятся в профиле Windows:\n${app.getPath('userData')}\n\nВыгрузки по умолчанию сохраняются в:\n${exportsDir()}`,
          }),
        },
        { type: 'separator' },
        { label: 'Инструменты разработчика', accelerator: 'CmdOrCtrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
      ],
    },
  ]);
}
