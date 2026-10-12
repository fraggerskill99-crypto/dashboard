// Окно настольного приложения «NOK-дашборд».
// Следит за папкой «Документы\NOK-дашборд» (или выбранной, например сетевой): как только там появляется
// новый «Свод» .xlsx, окно само его обрабатывает — без кнопки «обновить». Недели хранятся в программе.
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_DIR = path.join(app.getPath('documents'), 'NOK-дашборд');
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
let win = null, dir = DEFAULT_DIR, watcher = null;

function loadSettings(){ try{ const s = JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')); if (s.dir && fs.existsSync(s.dir)) dir = s.dir; }catch(e){} }
function saveSettings(){ try{ fs.writeFileSync(SETTINGS(), JSON.stringify({ dir })); }catch(e){} }
function ensure(){ if (dir === DEFAULT_DIR) { try{ fs.mkdirSync(dir, { recursive: true }); }catch(e){} } }

function latest(){
  let best = null;
  let list = [];
  try{ list = fs.readdirSync(dir, { withFileTypes: true }); }catch(e){ return null; }
  for (const d of list) {
    if (!d.isFile() || !/\.xlsx$/i.test(d.name) || d.name.startsWith('~$')) continue;
    const p = path.join(dir, d.name);
    try{ const st = fs.statSync(p); if (!best || st.mtimeMs > best.mtime) best = { name: d.name, path: p, size: st.size, mtime: st.mtimeMs }; }catch(e){}
  }
  return best;
}

function watch(){
  if (watcher) { try{ watcher.close(); }catch(e){} watcher = null; }
  ensure();
  let t = null;
  try{
    watcher = fs.watch(dir, () => {
      clearTimeout(t);
      t = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('nok:changed'); }, 2000);
    });
  }catch(e){}
}

ipcMain.handle('nok:info', () => { ensure(); return { dir, latest: latest() }; });
ipcMain.handle('nok:read', (e, p) => {
  if (path.dirname(path.resolve(p)) !== path.resolve(dir)) throw new Error('файл вне папки');
  return fs.readFileSync(p);
});
ipcMain.handle('nok:open', () => { ensure(); return shell.openPath(dir); });
ipcMain.handle('nok:choose', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Папка, куда сохраняется «Свод»', defaultPath: dir, properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  dir = r.filePaths[0]; saveSettings(); watch();
  return { dir };
});

function createWindow(){
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 420,
    title: 'NOK-дашборд',
    icon: path.join(__dirname, 'www', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
}
app.whenReady().then(() => { loadSettings(); ensure(); createWindow(); watch(); });
app.on('window-all-closed', () => app.quit());
