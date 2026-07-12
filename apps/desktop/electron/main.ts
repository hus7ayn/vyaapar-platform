import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { getDeviceId, getServerUrl, setServerUrl } from './settings';

// Fail fast to the offline screen instead of blocking startup for minutes —
// the offline page has its own manual Retry button.
const REACHABILITY_TIMEOUT_MS = 8_000;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Vyaapar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

async function isReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return res.ok || res.status === 404;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// Every shop PC is a thin client to ONE centrally-hosted server (see
// deploy/gcp, deploy/oracle) — not a local server per PC. This decides, on
// every (re)load, whether to show first-run setup, the real app, or an
// offline screen with a manual retry.
async function loadApp(win: BrowserWindow) {
  const serverUrl = getServerUrl();
  if (!serverUrl) {
    win.loadFile(path.join(__dirname, 'pages/setup.html'));
    return;
  }
  const reachable = await isReachable(serverUrl);
  if (reachable) {
    win.loadURL(serverUrl);
  } else {
    win.loadFile(path.join(__dirname, 'pages/offline.html'), { query: { url: serverUrl } });
  }
}

app.whenReady().then(async () => {
  ipcMain.handle('desktop:deviceId', () => getDeviceId());
  ipcMain.handle('desktop:getServerUrl', () => getServerUrl());
  ipcMain.handle('desktop:setServerUrl', async (_event, url: string) => {
    setServerUrl(url);
    if (mainWindow) await loadApp(mainWindow);
  });
  ipcMain.handle('desktop:retryConnection', async () => {
    if (mainWindow) await loadApp(mainWindow);
  });

  const win = createWindow();
  if (process.env.DESKTOP_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  await loadApp(win);

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await loadApp(createWindow());
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
