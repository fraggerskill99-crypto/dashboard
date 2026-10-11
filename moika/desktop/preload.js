// Мост между окном и папкой «Документы\Качество мойки»
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  paths: () => ipcRenderer.invoke('folder:paths'),
  openFolder: kind => ipcRenderer.invoke('folder:open', kind),
  readXlsx: kind => ipcRenderer.invoke('folder:xlsx', kind),
  mediaIndex: () => ipcRenderer.invoke('folder:media'),
  onChanged: cb => ipcRenderer.on('folder:changed', (e, kinds) => cb(kinds))
});
