// Dev helper: screenshot the seed-11 demo fight at given fight times and camera.
// Usage: node shots.mjs 30,1299.5 auto   (needs `npm run dev` on :5173). Writes /tmp/shots/{cam}-T{T}.png
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('/tmp/shots', { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://localhost:5173/');
await p.fill('[data-testid=seed]', '11');
await p.selectOption('[data-testid=demo-blue]', 'swarmer');
await p.click('[data-testid=start-fight]');
await p.waitForSelector('[data-testid=watch]', { timeout: 30000 });
await p.waitForTimeout(4000);
await p.evaluate(() => { window.__arena.store.playing = false; });
const cam = process.argv[3] || 'auto';
await p.click(`[data-testid=cam-${cam}]`);
for (const T of (process.argv[2] || '').split(',').filter(Boolean).map(Number)) {
  await p.evaluate((T) => { window.__arena.store.T = T; }, T);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `/tmp/shots/${cam}-T${T}.png` });
}
await b.close();
