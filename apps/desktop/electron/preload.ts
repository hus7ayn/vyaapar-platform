import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true as const,
  getDeviceId: () => ipcRenderer.invoke('desktop:deviceId') as Promise<string>,
  getServerUrl: () => ipcRenderer.invoke('desktop:getServerUrl') as Promise<string | null>,
  setServerUrl: (url: string) => ipcRenderer.invoke('desktop:setServerUrl', url) as Promise<void>,
  retryConnection: () => ipcRenderer.invoke('desktop:retryConnection') as Promise<void>,
});
