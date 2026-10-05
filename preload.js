const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  resolveXmlSelection: (paths) => ipcRenderer.invoke('resolve-xml-selection', paths),
  saveXmlSelection: (paths) => ipcRenderer.invoke('save-xml-selection', paths),
  getSavedXml: () => ipcRenderer.invoke('get-saved-xml'),
  findPort: () => ipcRenderer.invoke('find-port'),
  startProcess: (data) => ipcRenderer.invoke('start-process', data),
  executeXml: (data) => ipcRenderer.invoke('execute-xml', data),
  rebootDevice: (mode) => ipcRenderer.invoke('reboot-device', mode),
  readGPT: (data) => ipcRenderer.invoke('read-gpt', data),
  readFileContent: (filePath) => ipcRenderer.invoke('read-file-content', filePath),
  getDefaultFiles: () => ipcRenderer.invoke('get-default-files'),
  saveFileSelection: (selection) => ipcRenderer.invoke('save-file-selection', selection),
  onLog: (callback) => ipcRenderer.on('log', (event, value) => callback(value)),
  onLogProgress: (callback) => ipcRenderer.on('log-progress', (event, value) => callback(value)),
  onPortUpdate: (callback) => ipcRenderer.on('port-update', (event, value) => callback(value)),
  onProgress: (callback) => ipcRenderer.on('progress', (event, value) => callback(value)),
  saveTempXml: (content) => ipcRenderer.invoke('save-temp-xml', content),
  exitApp: () => ipcRenderer.invoke('exit-app')
});
