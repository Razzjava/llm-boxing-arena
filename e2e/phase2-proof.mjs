// Side-on stills and a short clip of seed 11: a step-in, a knockdown, and the second body.
// Needs `npm run build` first. Writes proof/phase2-*.png and proof/phase2-demo.webm.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..", "app");
const proof = path.join(here, "..", "proof");
fs.mkdirSync(proof, { recursive: true });
const PORT = 4175;
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
  recordVideo: { dir: path.join(proof, "phase2-tmp"), size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(BASE + "/?e2e");
  await page.fill("[data-testid=seed]", "11");
  await page.selectOption("[data-testid=source-red]", "demo");
  await page.selectOption("[data-testid=demo-red]", "slugger");
  await page.selectOption("[data-testid=demo-blue]", "swarmer");
  await page.click("[data-testid=start-fight]");
  await page.waitForSelector("[data-testid=watch]", { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: ".hud-top,.commentary,.controls{visibility:hidden !important}" });
  await page.evaluate(() => {
    window.__arena.store.playing = false;
    window.__arena.store.autoReplay = false;
  });

  const marks = await page.evaluate(() => {
    const { tl, layoutAt } = window.__arena;
    let step = null;
    for (const seg of tl.segments) {
      if (seg.kind !== "exchange") continue;
      for (const { T, e } of seg.events) {
        if (e.type !== "land") continue;
        const layout = layoutAt(tl, T);
        if (layout.a.mode !== "fight" || layout.b.mode !== "fight") continue;
        if (!step || e.damage > step.damage) step = { T, damage: e.damage, punch: e.punch };
      }
    }
    const first = tl.segments.find((s) => s.kind === "exchange");
    const kd = tl.knockdowns[0];
    return {
      step,
      body: first ? first.start + 1.2 : 8,
      knockdown: kd ? kd.T + 0.42 : null,
    };
  });
  if (!marks.step || marks.knockdown == null) throw new Error("seed 11 is missing a standing land or a knockdown");
  fs.writeFileSync(path.join(proof, "phase2-moments.json"), JSON.stringify(marks, null, 2));

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
      let px = -az / len;
      let pz = ax / len;
      const mx = (layout.a.pos.x + layout.b.pos.x) / 2;
      const mz = (layout.a.pos.z + layout.b.pos.z) / 2;
      const ref = layout.ref.pos;
      if (px * (ref.x - mx) + pz * (ref.z - mz) > 0) {
        px = -px;
        pz = -pz;
      }
      const downSide = layout.knockdownSide || (layout.a.mode === "down" ? "a" : layout.b.mode === "down" ? "b" : null);
      const focus = downSide ? { x: (layout[downSide].pos.x * 0.65 + mx * 0.35), z: (layout[downSide].pos.z * 0.65 + mz * 0.35) } : { x: mx, z: mz };
      let dist = downSide ? 3.15 : 2.75;
      let camX = focus.x + px * dist;
      let camZ = focus.z + pz * dist;
      while ((Math.abs(camX) > 2.4 || Math.abs(camZ) > 2.4) && dist > 1.9) {
        dist -= 0.1;
        camX = focus.x + px * dist;
        camZ = focus.z + pz * dist;
      }
      arena.camLock = {
        pos: [camX, downSide ? 1.82 : 1.64, camZ],
        look: [focus.x, downSide ? 1.28 : 1.95, focus.z],
      };
    }, T);
  }

  const beats = [
    { name: "body", T: marks.body, span: 1.2 },
    { name: "step", T: marks.step.T, span: 0.7 },
    { name: "knockdown", T: marks.knockdown, span: 1.1 },
  ];
  const started = Date.now();
  for (const beat of beats) {
    const from = beat.T - beat.span * 0.45;
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      await frameAt(from + (beat.span * i) / steps);
      await page.waitForTimeout(70);
      if (i === Math.round(steps * 0.45)) await page.screenshot({ path: path.join(proof, `phase2-${beat.name}.png`) });
    }
    await page.waitForTimeout(200);
  }
  const seconds = (Date.now() - started) / 1000;
  console.log("scrub seconds", seconds.toFixed(1), "marks", JSON.stringify(marks));
  if (errors.length) console.log("page errors", errors);
  if (seconds > 24) throw new Error(`scrub ran ${seconds.toFixed(1)}s, over the 25s clip budget`);

  const video = page.video();
  await page.close();
  const raw = await video.path();
  const out = path.join(proof, "phase2-demo.webm");
  // The recording includes the fight setup. Keep the scrub, which is the last `seconds` of the file.
  execFileSync("ffmpeg", ["-y", "-sseof", `-${(seconds + 0.4).toFixed(2)}`, "-i", raw, "-c", "copy", out], { stdio: "inherit" });
  fs.rmSync(path.join(proof, "phase2-tmp"), { recursive: true, force: true });
  const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" }).trim();
  console.log("wrote", out, fs.statSync(out).size, "duration", dur);
  if (Number(dur) > 25) throw new Error(`clip is ${dur}s`);
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  server.kill();
}
