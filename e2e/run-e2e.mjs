// End-to-end proof run. Builds must exist (npm run build). Starts `vite preview` (which mounts the
// local proxy at /proxy), drives the app in headless Chromium and writes screenshots, a short video,
// a fight log and a JSON report to ../proof/.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..', 'app');
const proof = path.join(here, '..', 'proof');
fs.mkdirSync(proof, { recursive: true });
const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const FAKE_KEY = 'sk-fake-e2e-' + 'x'.repeat(24);
const report = { started: new Date().toISOString(), checks: {} };
const check = (name, ok, detail) => { report.checks[name] = { ok: !!ok, detail }; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); };

// --- server
const serverLog = [];
try { await fetch(BASE); console.error(`Port ${PORT} is already in use; stop the other server first.`); process.exit(2); } catch {}
const viteBin = path.join(here, '..', 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], { cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({
  ...(process.env.ARENA_CHROME ? { channel: 'chrome' } : {}),
  args: [
    ...(process.env.ARENA_CHROME ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  ],
});
const shot = (page, name) => page.screenshot({ path: path.join(proof, name) });
const errors = [];
const watchErrors = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} @ ${m.location().url}`); });
  page.on('response', (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
};

async function startDemo(page, seed = '11') {
  await page.fill('[data-testid=seed]', seed);
  await page.selectOption('[data-testid=source-red]', 'demo');
  await page.selectOption('[data-testid=demo-red]', 'slugger');
  await page.selectOption('[data-testid=demo-blue]', 'swarmer');
  await page.click('[data-testid=start-fight]');
  await page.waitForSelector('[data-testid=watch]', { timeout: 60000 });
  await page.waitForSelector('[data-testid=hud]');
}
const getT = (page) => page.evaluate(() => window.__arena.store.T);
async function waitT(page, T, timeout = 180000) {
  await page.waitForFunction((T) => window.__arena && window.__arena.store.T >= T, T, { timeout, polling: 50 });
}

try {
  // ---------------------------------------------------------------- setup + LLM wiring
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watchErrors(page);
  await page.goto(BASE + '/?e2e');
  await page.waitForSelector('[data-testid=start-fight]');
  await shot(page, '01-setup.png');
  check('setup screen renders', await page.isVisible('[data-testid=key-opencode]'));

  // Go warning shows only for the Go plan
  await page.click('[data-testid=plan-go]');
  check('Go plan shows the use-at-own-risk warning', await page.isVisible('[data-testid=go-warning]'), await page.textContent('[data-testid=go-warning]'));
  await page.click('[data-testid=plan-console]').catch(() => {});

  // OpenCode model list loads live in the picker (fake key; listing is public)
  await page.fill('[data-testid=key-opencode]', FAKE_KEY);
  await page.selectOption('[data-testid=source-red]', 'opencode');
  await page.click('[data-testid=picker-red-toggle]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-option]').length > 0, null, { timeout: 30000 });
  const nModels = await page.locator('[data-testid=model-option]').count();
  const srcText = await page.textContent('[data-testid=picker-red-source]');
  await shot(page, '02-opencode-model-picker.png');
  check('OpenCode Console model list loads in the picker', nModels > 10 && /live|opencode/i.test(srcText ?? ''), { models: nModels, source: srcText });

  // A real fight with a fake key goes through the proxy and surfaces OpenCode's 401 readably
  await page.locator('[data-testid=model-option]').first().click();
  await page.click('[data-testid=start-fight]');
  await page.waitForSelector('[data-testid=fight-error]', { timeout: 60000 });
  const errText = await page.textContent('[data-testid=fight-error]');
  await shot(page, '03-fake-key-401-error.png');
  check('fake key through proxy returns a readable OpenCode 401', /401/.test(errText ?? '') && /opencode/i.test(errText ?? ''), errText);
  check('error text does not echo the key', !(errText ?? '').includes(FAKE_KEY));

  // Go plan list loads too (picks are cleared on plan change)
  await page.click('[data-testid=plan-go]');
  await page.click('[data-testid=picker-red-toggle]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-option]').length > 0, null, { timeout: 30000 });
  const nGo = await page.locator('[data-testid=model-option]').count();
  await shot(page, '02b-opencode-go-picker.png');
  check('OpenCode Go model list loads in the picker', nGo > 5, { models: nGo, source: await page.textContent('[data-testid=picker-red-source]') });

  // Reload clears keys
  await page.reload();
  await page.waitForSelector('[data-testid=key-opencode]');
  check('reload clears keys', (await page.inputValue('[data-testid=key-opencode]')) === '');

  // ---------------------------------------------------------------- demo vs demo at 4x to the result
  await startDemo(page);
  await page.click('[data-testid=speed-4]');
  const tl = await page.evaluate(() => ({ dur: window.__arena.tl.duration, kds: window.__arena.tl.knockdowns, res: window.__arena.tl.resultStart }));
  report.timeline = tl;
  await waitT(page, 30);
  await page.click('[data-testid=play-pause]');
  await shot(page, '11-audio-controls.png');
  check('audio controls render muted until a click', /Sound off/i.test(await page.textContent('[data-testid=audio-mute]') ?? '') && await page.isVisible('[data-testid=audio-volume]') && await page.isVisible('[data-testid=audio-commentary]'));
  const legend = await page.locator('[data-testid=bar-head]').first().getAttribute('aria-label');
  await page.locator('[data-testid=bar-head]').first().hover();
  await page.waitForTimeout(300);
  await shot(page, '10-bar-legend.png');
  check('HUD bars have a visible legend and tooltip', /Head/.test(await page.textContent('[data-testid=hud]') ?? '') && /knockdown/i.test(legend ?? ''), legend);
  await page.mouse.move(640, 400);
  await shot(page, '04-round1.png');
  await page.click('[data-testid=play-pause]');
  check('round 1 renders with HUD', await page.isVisible('[data-testid=hud-clock]'), await page.textContent('[data-testid=hud-clock]'));

  const kd = tl.kds[0];
  check('fight has a knockdown', !!kd, kd);
  if (kd) {
    // A full bout at 4x is several minutes of WebGL. Jump to just before the
    // knockdown and play through it, so the count and the replay still run.
    await page.evaluate((T) => { window.__arena.store.T = Math.max(0, T - 12); window.__arena.store.playing = true; }, kd.T);
    await waitT(page, kd.T + 0.6, 90000);
    await page.click('[data-testid=play-pause]');
    await page.waitForTimeout(400);
    await shot(page, '05-knockdown.png');
    check('knockdown commentary shown', /DOWN GOES/i.test(await page.textContent('[data-testid=commentary]')));
    await page.click('[data-testid=play-pause]');
    await page.waitForSelector('[data-testid=replay-banner]', { timeout: 120000 });
    await page.waitForTimeout(1200);
    await shot(page, '06-knockdown-replay.png');
    check('slow-mo knockdown replay plays', true);
  }
  const t0 = Date.now();
  await page.evaluate(() => { window.__arena.store.skipToResult(); });
  await page.waitForSelector('[data-testid=result-card]', { timeout: 90000 });
  await page.waitForTimeout(800);
  await shot(page, '07-final-scorecard.png');
  const resultText = await page.textContent('[data-testid=result-card]');
  check('result card with scorecards', await page.isVisible('[data-testid=scorecards]') || /KO|TKO|decision|wins/i.test(resultText ?? ''), resultText?.slice(0, 160));
  report.resultWaitMs = Date.now() - t0;

  // Fight log download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=download-log-result]')]);
  const logPath = path.join(proof, 'fight-log-seed11.json');
  await dl.saveAs(logPath);
  const saved = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  check('fight log downloads (no keys inside)', saved.app && saved.log && !JSON.stringify(saved).includes(FAKE_KEY), { file: path.basename(logPath), bytes: fs.statSync(logPath).size });

  // Low quality toggle
  await page.click('[data-testid=quality]');
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__arena.store.playing = false; window.__arena.store.T = 40; });
  await page.waitForTimeout(1200);
  await shot(page, '08-low-quality.png');
  check('low-quality toggle', /low/i.test(await page.textContent('[data-testid=quality]')));

  // Upload the log -> replayed through the engine
  await page.getByRole('button', { name: 'New fight' }).first().click();
  await page.setInputFiles('[data-testid=upload-log]', logPath);
  await page.waitForSelector('[data-testid=info-banner]', { timeout: 30000 });
  const info = await page.textContent('[data-testid=info-banner]');
  await page.waitForTimeout(2500);
  await shot(page, '09-uploaded-log-replay.png');
  check('uploaded log replays identically via replayFight', /identical/i.test(info ?? ''), info);
  await ctx.close();

  // ---------------------------------------------------------------- short video (~30 s)
  const vctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: path.join(proof, 'video-tmp'), size: { width: 1280, height: 720 } } });
  const vpage = await vctx.newPage();
  watchErrors(vpage);
  const vStart = Date.now();
  await vpage.goto(BASE + '/?e2e');
  await startDemo(vpage);
  await vpage.click('[data-testid=speed-2]');
  await vpage.waitForTimeout(4000); // intro + early round 1 at 2x
  await vpage.click('[data-testid=speed-4]');
  if (kd) {
    await vpage.evaluate((T) => { window.__arena.store.T = Math.max(0, T - 6); window.__arena.store.playing = true; }, kd.T);
    await vpage.waitForSelector('[data-testid=replay-banner]', { timeout: 30000 });
    await vpage.waitForSelector('[data-testid=replay-banner]', { state: 'detached', timeout: 30000 });
  }
  await vpage.evaluate(() => { window.__arena.store.skipToResult(); });
  await vpage.waitForSelector('[data-testid=result-card]', { timeout: 30000 });
  await vpage.waitForTimeout(1500);
  const video = vpage.video();
  await vctx.close();
  const vSecs = (Date.now() - vStart) / 1000;
  const videoOut = path.join(proof, 'fight-demo.webm');
  fs.renameSync(await video.path(), videoOut);
  fs.rmSync(path.join(proof, 'video-tmp'), { recursive: true, force: true });
  check('video recorded (20–40 s target)', vSecs >= 18 && vSecs <= 45, { file: 'fight-demo.webm', approxSeconds: Math.round(vSecs), bytes: fs.statSync(videoOut).size });
} catch (e) {
  check('e2e run completed without exceptions', false, String(e));
} finally {
  await browser.close();
  await new Promise((r) => setTimeout(r, 500));
  server.kill();
  await new Promise((r) => server.once('exit', r));
  const log = serverLog.join('');
  fs.writeFileSync(path.join(proof, 'preview-server.log'), log);
  check('proxy server log never contains the key', !log.includes(FAKE_KEY), log.split('\n').filter((l) => l.includes('[proxy]')));
  const ignorable = (m) => /favicon\.ico/i.test(m) || /Failed to load resource.*(401|400)|status of 40[01]/i.test(m);
  const realErrors = errors.filter((m) => !ignorable(m));
  check('no page errors', realErrors.length === 0, realErrors.slice(0, 5));
  report.finished = new Date().toISOString();
  report.allPassed = Object.values(report.checks).every((c) => c.ok);
  fs.writeFileSync(path.join(proof, 'e2e-report.json'), JSON.stringify(report, null, 2));
  console.log(report.allPassed ? 'ALL PASSED' : 'SOME CHECKS FAILED');
  process.exit(report.allPassed ? 0 : 1);
}
