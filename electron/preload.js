const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lunarcord', {
  getCaptureSources: () => ipcRenderer.invoke('capture-sources'),
  selectCaptureSource: id => ipcRenderer.send('select-capture-source', id)
});
