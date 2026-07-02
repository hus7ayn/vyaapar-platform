import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

interface DesktopSettings {
  deviceId: string;
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop.json');
}

export function getDeviceId(): string {
  const file = settingsPath();
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as DesktopSettings;
      if (data.deviceId) return data.deviceId;
    } catch {
      /* recreate */
    }
  }
  const deviceId = randomUUID();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ deviceId }, null, 2));
  return deviceId;
}
