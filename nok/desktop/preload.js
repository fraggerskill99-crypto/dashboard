// Мост между окном и папкой со «Сводом»
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('nok:info'),
  read: p => ipcRenderer.invoke('nok:read', p),
  open: () => ipcRenderer.invoke('nok:open'),
  choose: () => ipcRenderer.invoke('nok:choose'),
  onChanged: cb => ipcRenderer.on('nok:changed', () => cb())
});
