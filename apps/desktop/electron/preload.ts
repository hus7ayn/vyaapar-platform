import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true as const,
  getDeviceId: () => ipcRenderer.invoke('desktop:deviceId') as Promise<string>,
});
