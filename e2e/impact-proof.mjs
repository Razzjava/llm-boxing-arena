// Close-ups and a short clip of seed 11 (demo slugger vs swarmer, no LLM).
// Needs `npm run build` first. Writes proof/impact-*.png and proof/impact-demo.webm.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..", "app");
const proof = path.join(here, "..", "proof");
fs.mkdirSync(proof, { recursive: true });
const PORT = 4174;
const BASE = `http://localhost:${PORT}`;

const viteBin = path.join(here, "..", "node_modules", "vite", "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "preview", "--port", String(PORT), "--strictPort"], {
  cwd: appDir,
  stdio: ["ignore", "pipe", "pipe"],
});
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* booting */
  }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: path.join(proof, "impact-tmp"), size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const videoOpened = Date.now();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

function pick(rows, pred) {
  return rows.find(pred) ?? null;
}

try {
  await page.goto(BASE + "/?e2e");
  await page.fill("[data-testid=seed]", "11");
  await page.selectOption("[data-testid=source-red]", "demo");
  await page.selectOption("[data-testid=demo-red]", "slugger");
  await page.selectOption("[data-testid=demo-blue]", "swarmer");
  await page.click("[data-testid=start-fight]");
  await page.waitForSelector("[data-testid=watch]", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__arena.store.playing = false;
    window.__arena.store.autoReplay = false;
  });

  const rows = await page.evaluate(() => {
    const { tl, layoutAt } = window.__arena;
    const out = [];
    for (const seg of tl.segments) {
      if (seg.kind !== "exchange") continue;
      for (const { T, e } of seg.events) {
        if (e.type !== "land" && e.type !== "block" && e.type !== "slip" && e.type !== "miss") continue;
        const layout = layoutAt(tl, T);
        if (layout.a.mode !== "fight" || layout.b.mode !== "fight") continue;
        out.push({
          T,
          type: e.type,
          punch: e.punch,
          damage: "damage" in e ? e.damage : 0,
          target: "target" in e ? e.target : e.punch === "body" ? "body" : "head",
        });
      }
    }
    return out;
  });

  const hard = rows.filter((r) => r.type === "land").sort((a, b) => b.damage - a.damage)[0];
  const jab = pick(rows, (r) => r.type === "land" && r.punch === "jab" && r.target === "head" && r !== hard);
  const cross = pick(rows, (r) => r.type === "land" && r.punch === "cross" && r.target === "head" && r.T !== hard?.T);
  const body = pick(rows, (r) => r.type === "land" && (r.punch === "body" || r.target === "body") && r.T !== hard?.T);
  const block = pick(rows, (r) => r.type === "block");
  const slip = pick(rows, (r) => r.type === "slip");
  const moments = [jab, block, slip, hard].filter(Boolean);
  if (!jab || !block || !slip || !hard) throw new Error("seed 11 is missing a land, block, slip or hard shot");
  fs.writeFileSync(path.join(proof, "impact-moments.json"), JSON.stringify(moments, null, 2));

  async function frameAt(T) {
    await page.evaluate((T) => {
      const arena = window.__arena;
      arena.store.playing = false;
      arena.store.autoReplay = false;
      arena.store.T = T;
      const layout = arena.layoutAt(arena.tl, T);
      const ax = layout.b.pos.x - layout.a.pos.x;
      const az = layout.b.pos.z - layout.a.pos.z;
      const len = Math.hypot(ax, az) || 1;
      const px = -az / len;
      const pz = ax / len;
      const mx = (layout.a.pos.x + layout.b.pos.x) / 2;
      const mz = (layout.a.pos.z + layout.b.pos.z) / 2;
      arena.camLock = {
        pos: [mx + px * 2.15, 2.32, mz + pz * 2.15],
        look: [mx, 2.02, mz],
      };
    }, T);
  }

  const shotOf = {
    land: jab ?? cross ?? body,
    block,
    slip,
    hard,
  };

  const started = Date.now();
  console.log("scrub starts at video+", ((started - videoOpened) / 1000).toFixed(2));
  for (const moment of moments) {
    const from = moment.T - 0.36;
    const to = moment.T + 0.48;
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      await frameAt(from + ((to - from) * i) / steps);
      const atPeak = i === Math.round((steps * (moment.T - from)) / (to - from));
      if (!atPeak) continue;
      await page.waitForTimeout(80);
      const kind = moment === hard ? "hard" : moment.type === "block" ? "block" : moment.type === "slip" ? "slip" : moment === shotOf.land ? "land" : null;
      if (kind && shotOf[kind] === moment) await page.screenshot({ path: path.join(proof, `impact-${kind}.png`) });
    }
  }
  const seconds = (Date.now() - started) / 1000;
  console.log("scrub seconds", seconds.toFixed(1), "moments", moments.map((m) => `${m.type}:${m.punch}@${m.T}`).join(", "));
  if (errors.length) console.log("page errors", errors);

  const video = page.video();
  await context.close();
  const raw = await video.path();
  const out = path.join(proof, "impact-demo.webm");
  fs.renameSync(raw, out);
  fs.rmSync(path.join(proof, "impact-tmp"), { recursive: true, force: true });
  console.log("wrote", out, fs.statSync(out).size);
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
