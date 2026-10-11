// Окно настольного приложения «Качество мойки».
// Папка «Документы\Качество мойки»: акты, акты Инкубатория и ЗПП, график ПР/Р и фото/видео.
// Программа читает их при запуске и сама обновляется, когда в папке что-то меняется, — без кнопки «обновить».
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(app.getPath('documents'), 'Качество мойки');
const SUB = { akt: 'Акты приёма мойки', incub: 'Акт Инкубатория', zpp: 'Акт ЗПП', schedule: 'График ПР-Р', media: 'Фото и видео' };
const XLSX_RE = /\.(xlsx|xlsm)$/i, VIDEO_RE = /\.(mp4|mov|avi|webm|m4v)$/i, PHOTO_RE = /\.(jpe?g|png|webp|gif)$/i, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
let win = null;

function ensure(){ for (const s of Object.values(SUB)) { try{ fs.mkdirSync(path.join(ROOT, s), {recursive: true}); }catch(e){} } }
const safeList = d => { try{ return fs.readdirSync(d, {withFileTypes: true}); }catch(e){ return []; } };

ipcMain.handle('folder:paths', () => ({ root: ROOT, sub: Object.fromEntries(Object.entries(SUB).map(([k, v]) => [k, path.join(ROOT, v)])) }));
ipcMain.handle('folder:open', (e, kind) => { ensure(); return shell.openPath(kind && SUB[kind] ? path.join(ROOT, SUB[kind]) : ROOT); });
// файлы Excel одной подпапки: имя, время изменения и содержимое
ipcMain.handle('folder:xlsx', (e, kind) => {
  ensure();
  const dir = path.join(ROOT, SUB[kind] || '');
  return safeList(dir).filter(d => d.isFile() && XLSX_RE.test(d.name) && !d.name.startsWith('~$'))
    .map(d => { const p = path.join(dir, d.name); try{ return {name: d.name, mtime: fs.statSync(p).mtimeMs, data: fs.readFileSync(p)}; }catch(err){ return null; } })
    .filter(Boolean).sort((a, b) => a.mtime - b.mtime);
});
// фото/видео: «Фото и видео\ГГГГ-ММ-ДД\Корпус\файлы» → { 'дата|корпус': [{caption, files:[{kind, filename, url}]}] }
ipcMain.handle('folder:media', () => {
  ensure();
  const root = path.join(ROOT, SUB.media), index = {};
  for (const dd of safeList(root)) {
    if (!dd.isDirectory() || !DATE_RE.test(dd.name)) continue;
    for (const cd of safeList(path.join(root, dd.name))) {
      if (!cd.isDirectory()) continue;
      const dir = path.join(root, dd.name, cd.name);
      const files = safeList(dir).filter(f => f.isFile() && (VIDEO_RE.test(f.name) || PHOTO_RE.test(f.name)))
        .map(f => ({kind: VIDEO_RE.test(f.name) ? 'video' : 'photo', filename: f.name, url: pathToFileURL(path.join(dir, f.name)).href}));
      if (!files.length) continue;
      const groups = {};
      for (const f of files) (groups[f.filename.replace(/\.[^.]+$/, '')] = groups[f.filename.replace(/\.[^.]+$/, '')] || []).push(f);
      index[dd.name + '|' + cd.name] = Object.keys(groups).sort().map(k => ({caption: '', files: groups[k]}));
    }
  }
  return index;
});

function watch(){
  ensure();
  let t = null, kinds = new Set();
  const byDir = Object.fromEntries(Object.entries(SUB).map(([k, v]) => [v, k]));
  try{
    fs.watch(ROOT, {recursive: true}, (ev, file) => {
      const top = String(file || '').split(/[\\/]/)[0];
      if (byDir[top]) kinds.add(byDir[top]);
      clearTimeout(t);
      t = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('folder:changed', [...kinds]); kinds = new Set(); }, 2000);
    });
  }catch(e){}
}

function createWindow(){
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 420,
    title: 'Качество мойки',
    icon: path.join(__dirname, 'www', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
}
app.whenReady().then(() => { ensure(); createWindow(); watch(); });
app.on('window-all-closed', () => app.quit());
