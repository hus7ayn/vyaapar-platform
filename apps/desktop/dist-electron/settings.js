"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeviceId = getDeviceId;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
function settingsPath() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'desktop.json');
}
function getDeviceId() {
    const file = settingsPath();
    if (fs_1.default.existsSync(file)) {
        try {
            const data = JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
            if (data.deviceId)
                return data.deviceId;
        }
        catch {
            /* recreate */
        }
    }
    const deviceId = (0, crypto_1.randomUUID)();
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify({ deviceId }, null, 2));
    return deviceId;
}
