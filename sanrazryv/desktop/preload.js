// Мост между окном и диском: папка с графиками и файл сохранённых данных
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  folder: () => ipcRenderer.invoke('graphs:folder'),
  listGraphs: () => ipcRenderer.invoke('graphs:list'),
  openFolder: () => ipcRenderer.invoke('graphs:open'),
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: text => ipcRenderer.invoke('data:save', text),
  onGraphsChanged: cb => ipcRenderer.on('graphs:changed', () => cb())
});
