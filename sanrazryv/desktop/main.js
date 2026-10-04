// Окно настольного приложения «Санитарный разрыв».
// Графики берутся из папки «Документы\График санитарного разрыва» при каждом запуске и при изменениях в ней;
// загруженное вручную сохраняется в файл в папке данных программы, чтобы не пропадало после перезапуска.
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const FOLDER = path.join(app.getPath('documents'), 'График санитарного разрыва');
const DATA = () => path.join(app.getPath('userData'), 'sanrazryv-data.json');
let win = null;

function ensureFolder(){ try{ fs.mkdirSync(FOLDER, {recursive: true}); }catch(e){} }

ipcMain.handle('graphs:folder', () => FOLDER);
ipcMain.handle('graphs:list', () => {
  ensureFolder();
  return fs.readdirSync(FOLDER)
    .filter(n => /\.(xlsx|xlsm|xls)$/i.test(n) && !n.startsWith('~$'))
    .map(n => { try{ return {name: n, mtime: fs.statSync(path.join(FOLDER, n)).mtimeMs, data: fs.readFileSync(path.join(FOLDER, n))}; }catch(e){ return null; } })
    .filter(Boolean)
    .sort((a, b) => a.mtime - b.mtime);
});
ipcMain.handle('graphs:open', () => { ensureFolder(); return shell.openPath(FOLDER); });
ipcMain.handle('data:load', () => { try{ return fs.readFileSync(DATA(), 'utf8'); }catch(e){ return null; } });
ipcMain.handle('data:save', (e, text) => { try{ fs.writeFileSync(DATA(), text, 'utf8'); return true; }catch(err){ return false; } });

function watchFolder(){
  ensureFolder();
  let t = null;
  try{
    fs.watch(FOLDER, () => { clearTimeout(t); t = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('graphs:changed'); }, 1500); });
  }catch(e){}
}

function createWindow(){
  win = new BrowserWindow({
    width: 1280, height: 900, minWidth: 420,
    title: 'Санитарный разрыв',
    icon: path.join(__dirname, 'www', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
}
app.whenReady().then(() => { ensureFolder(); createWindow(); watchFolder(); });
app.on('window-all-closed', () => app.quit());
