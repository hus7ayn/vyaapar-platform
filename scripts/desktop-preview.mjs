import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const base = 'http://127.0.0.1:5173';
const outDir = path.join(process.cwd(), 'apps/desktop/preview');
fs.mkdirSync(outDir, { recursive: true });

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: 'networkidle' });
await shot(page, '01-pos');

await page.getByRole('button', { name: 'Reports' }).click();
await page.waitForTimeout(400);
await shot(page, '02-reports');

await page.getByRole('button', { name: 'Cloud' }).click();
await page.waitForTimeout(400);
await shot(page, '03-cloud-settings');

await browser.close();
console.log('Saved previews to', outDir);
