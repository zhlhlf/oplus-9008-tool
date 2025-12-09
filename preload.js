const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  findPort: () => ipcRenderer.invoke('find-port'),
  startProcess: (data) => ipcRenderer.invoke('start-process', data),
  executeXml: (data) => ipcRenderer.invoke('execute-xml', data),
  rebootDevice: (mode) => ipcRenderer.invoke('reboot-device', mode),
  readGPT: (data) => ipcRenderer.invoke('read-gpt', data),
  readFileContent: (filePath) => ipcRenderer.invoke('read-file-content', filePath),
  getDefaultFiles: () => ipcRenderer.invoke('get-default-files'),
  getBackgroundImage: () => ipcRenderer.invoke('get-background-image'),
  onLog: (callback) => ipcRenderer.on('log', (event, value) => callback(value)),
  onPortUpdate: (callback) => ipcRenderer.on('port-update', (event, value) => callback(value)),
  onProgress: (callback) => ipcRenderer.on('progress', (event, value) => callback(value)),
  saveTempXml: (content) => ipcRenderer.invoke('save-temp-xml', content)
});
