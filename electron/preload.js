const { contextBridge, ipcRenderer } = require('electron');

// As funções de abrir pastas só existem na tela inicial (arquivo local), não nas janelas de projeto.
const isWelcome = location.protocol === 'file:';
contextBridge.exposeInMainWorld('lastgravity', !isWelcome ? { desktop: true, platform: process.platform } : {
  desktop: true,
  platform: process.platform,
  recent: () => ipcRenderer.invoke('lg:recent'),
  openFolder: () => ipcRenderer.invoke('lg:open-folder'),
  newProject: () => ipcRenderer.invoke('lg:new-project'),
  open: (p) => ipcRenderer.invoke('lg:open', p),
  removeRecent: (p) => ipcRenderer.invoke('lg:remove-recent', p),
  version: () => ipcRenderer.invoke('lg:version'),
});
