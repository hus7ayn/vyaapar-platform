"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const settings_1 = require("./settings");
const WEB_URL = process.env.DESKTOP_WEB_URL || 'http://localhost:3000';
const LOAD_TIMEOUT_MS = 120_000;
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        title: 'Vyaapar',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.loadURL(WEB_URL);
    if (process.env.DESKTOP_DEVTOOLS === '1') {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
async function waitForWeb(url) {
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url, { method: 'HEAD' });
            if (res.ok || res.status === 404)
                return;
        }
        catch {
            /* retry */
        }
        await new Promise((r) => setTimeout(r, 1500));
    }
    console.warn(`Web app not reachable at ${url} — opening window anyway`);
}
electron_1.app.whenReady().then(async () => {
    electron_1.ipcMain.handle('desktop:deviceId', () => (0, settings_1.getDeviceId)());
    await waitForWeb(WEB_URL);
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
