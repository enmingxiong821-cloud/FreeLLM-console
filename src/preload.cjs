const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('freeLLM', {
  getState: () => ipcRenderer.invoke('app:state'),
  refreshSystem: () => ipcRenderer.invoke('app:refresh-system'),
  startAll: () => ipcRenderer.invoke('app:start-all'),
  stopAll: () => ipcRenderer.invoke('app:stop-all'),
  service: (name, action) => ipcRenderer.invoke('app:service', name, action),
  testRoute: (payload) => ipcRenderer.invoke('app:test-route', payload),
  speedTest: (payload) => ipcRenderer.invoke('app:speed-test', payload),
  usage: () => ipcRenderer.invoke('app:usage'),
  quotas: () => ipcRenderer.invoke('app:quotas'),
  syncCatalog: () => ipcRenderer.invoke('app:sync-catalog'),
  addModule: (input) => ipcRenderer.invoke('app:add-module', input),
  removeModule: (id) => ipcRenderer.invoke('app:remove-module', id),
  pullModel: (model) => ipcRenderer.invoke('app:pull-model', model),
  warmModel: (model) => ipcRenderer.invoke('app:warm-model', model),
  repairOllama: () => ipcRenderer.invoke('app:repair-ollama'),
  setModel: (payload) => ipcRenderer.invoke('app:set-model', payload),
  backups: () => ipcRenderer.invoke('app:backups'),
  restoreBackup: (payload) => ipcRenderer.invoke('app:restore-backup', payload),
  restoreLatest: (targetId) => ipcRenderer.invoke('app:restore-latest', targetId),
  stopAndRestore: () => ipcRenderer.invoke('app:stop-and-restore'),
  writeIntegrations: (targets) => ipcRenderer.invoke('app:write-integrations', targets),
  snippet: (id) => ipcRenderer.invoke('app:snippet', id),
  copy: (text) => ipcRenderer.invoke('app:copy', text),
  reveal: (type) => ipcRenderer.invoke('app:reveal', type),
  regenerateFriend: () => ipcRenderer.invoke('app:regenerate-friend'),
  setOwner: (value) => ipcRenderer.invoke('app:set-owner', value),
  tunnel: (action) => ipcRenderer.invoke('app:tunnel', action),
  shareInfo: () => ipcRenderer.invoke('app:share-info'),
  setShareEnabled: (enabled) => ipcRenderer.invoke('app:share-enable', enabled),
  setShareLan: (enabled) => ipcRenderer.invoke('app:share-lan', enabled),
  openShare: () => ipcRenderer.invoke('app:share-open'),
  sharePackage: () => ipcRenderer.invoke('app:share-package'),
  saveSettings: (patch) => ipcRenderer.invoke('app:save-settings', patch),
  chooseCore: () => ipcRenderer.invoke('app:choose-core'),
  launch: (id) => ipcRenderer.invoke('app:launch', id),
  openIntegrationUi: (id) => ipcRenderer.invoke('app:open-integration-ui', id),
  workbenchInfo: () => ipcRenderer.invoke('app:workbench-info'),
  launchWorkbench: (project) => ipcRenderer.invoke('app:workbench-launch', project),
  chooseWorkbenchProject: () => ipcRenderer.invoke('app:workbench-choose'),
  openPiConfig: () => ipcRenderer.invoke('app:open-pi-config'),
  installApp: (id) => ipcRenderer.invoke('app:install-app', id),
  installMany: (ids) => ipcRenderer.invoke('app:install-many', ids),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openMailto: (url) => ipcRenderer.invoke('app:open-mailto', url),
  openPath: (target) => ipcRenderer.invoke('app:open-path', target),
  logs: (name, lines) => ipcRenderer.invoke('app:logs', name, lines),
  reportError: (payload) => ipcRenderer.invoke('app:renderer-error', payload),
  onboarding: (payload) => ipcRenderer.invoke('app:onboarding', payload),
  onState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('app:state', listener);
    return () => ipcRenderer.removeListener('app:state', listener);
  },
  onInstallStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('app:install-status', listener);
    return () => ipcRenderer.removeListener('app:install-status', listener);
  },
});
