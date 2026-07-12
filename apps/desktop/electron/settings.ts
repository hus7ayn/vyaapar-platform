import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

interface DesktopSettings {
  deviceId: string;
  serverUrl?: string;
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop.json');
}

function readSettings(): Partial<DesktopSettings> {
  const file = settingsPath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as DesktopSettings;
  } catch {
    return {};
  }
}

function writeSettings(data: Partial<DesktopSettings>) {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...readSettings(), ...data }, null, 2));
}

export function getDeviceId(): string {
  const existing = readSettings().deviceId;
  if (existing) return existing;
  const deviceId = randomUUID();
  writeSettings({ deviceId });
  return deviceId;
}

// The shop's central server URL — one instance shared by every shop PC (see
// deploy/gcp, deploy/oracle), not a per-PC local server. `DESKTOP_SERVER_URL`
// lets a single-tenant build bake this in silently; otherwise it's collected
// once via the first-run setup screen and persisted here.
export function getServerUrl(): string | null {
  return process.env.DESKTOP_SERVER_URL || readSettings().serverUrl || null;
}

export function setServerUrl(url: string): void {
  writeSettings({ serverUrl: url });
}
