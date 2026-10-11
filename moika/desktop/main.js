// Окно настольного приложения «Качество мойки». Данные хранятся в профиле программы (localStorage),
// «Привязать файлы» работает как в Chrome — акты перечитываются при каждом запуске.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow(){
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 420,
    title: 'Качество мойки',
    icon: path.join(__dirname, 'www', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
