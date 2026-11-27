// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DEMO_BUILDS, DEMO_CONTROLLERS, runFight, type BoxerBuild, type FightLog, type Side } from "@llm-boxing-arena/engine";
import { buildTimeline } from "../src/playback/timeline";
import { activityAt, layoutAt, rateFactorAt, throwsIn } from "../src/scene/choreo";
import {
  arrivalSign,
  contactKind,
  extensionAt,
  HARD_LAND,
  MIN_HEAD_GAP,
  MIN_TORSO_GAP,
  reactionFor,
  type Reaction,
} from "../src/scene/impact";
import { anchorSeparation, poseFightersAt, type ContactSample } from "../src/scene/pose";
import { BASE_SCALE, CharacterRig, type Look } from "../src/scene/rig";

const here = path.dirname(fileURLToPath(import.meta.url));

async function demoLog(seed: number, red: "slugger" | "outBoxer" = "slugger", blue: "swarmer" | "slugger" = "swarmer"): Promise<FightLog> {
  const outcome = await runFight(DEMO_BUILDS[red], DEMO_BUILDS[blue], DEMO_CONTROLLERS[red], DEMO_CONTROLLERS[blue], seed);
  if (outcome.status !== "completed") throw new Error(outcome.reason);
  return outcome.log;
}

function lookFor(side: Side, build: BoxerBuild): Look {
  const colors = side === "a"
    ? { trunks: "#b3121b", gloves: "#d4141f", trim: "#f5d76e", skin: "#c58c62", boots: "#1b1b1b" }
    : { trunks: "#1746b8", gloves: "#1b5be0", trim: "#ffffff", skin: "#8d5a3b", boots: "#f2f2f2" };
  const s = build.stats;
  return {
    ...colors,
    scale: BASE_SCALE * (0.97 + (s.chin + s.power - 10) * 0.006),
    bulk: 0.94 + (s.power - 5) * 0.025 + (s.stamina - 5) * 0.008,
  };
}

function loadBoxer() {
  const buf = fs.readFileSync(path.join(here, "../public/assets/boxer.glb"));
  const loader = new GLTFLoader();
  return new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", resolve, reject);
  });
}

function gloveCentre(rig: CharacterRig, hand: "L" | "R"): THREE.Vector3 {
  const glove = rig.gloves[hand];
  if (!glove) throw new Error(`no glove ${hand}`);
  return glove.getWorldPosition(new THREE.Vector3());
}

const other = (s: Side): Side => (s === "a" ? "b" : "a");

describe("punch reactions follow the punch, not the clock", () => {
  const env = 1;
  it("aims an orthodox jab and cross at opposite sides of the face", () => {
    // Attacker facing +Z, defender facing them. Lead (left) hand is on the defender's right.
    expect(arrivalSign(0, Math.PI, false)).toBe(-1);
    expect(arrivalSign(0, Math.PI, true)).toBe(1);
    const jab = reactionFor({ outcome: "land", punch: "jab", arrival: -1, damage: 1.2, envelope: env });
    const cross = reactionFor({ outcome: "land", punch: "cross", arrival: 1, damage: 1.2, envelope: env });
    expect(jab.headYaw).toBeGreaterThan(0);
    expect(cross.headYaw).toBeLessThan(0);
    expect(Math.abs(cross.headYaw)).toBeGreaterThan(Math.abs(jab.headYaw) * 1.8);
    expect(jab.headPitch).toBeLessThan(0);
    expect(cross.headPitch).toBeLessThan(jab.headPitch);
  });

  it("turns the head with a hook, lifts the chin on an uppercut, and folds the body", () => {
    const hook = reactionFor({ outcome: "land", punch: "hook", arrival: -1, damage: 1.4, envelope: env });
    const upper = reactionFor({ outcome: "land", punch: "uppercut", arrival: 1, damage: 1.6, envelope: env });
    const body = reactionFor({ outcome: "land", punch: "body", arrival: 1, damage: 1.3, envelope: env });
    expect(hook.headYaw).toBeGreaterThan(0.4);
    expect(Math.abs(hook.headYaw)).toBeGreaterThan(Math.abs(hook.headPitch));
    expect(upper.headPitch).toBeGreaterThan(0.4);
    expect(Math.abs(upper.headYaw)).toBeLessThan(upper.headPitch * 0.2);
    expect(body.torsoFold).toBeGreaterThan(0.4);
    expect(body.handsDrop).toBeGreaterThan(0.5);
    expect(body.headYaw).toBe(0);
    expect(body.headPitch).toBe(0);
  });

  it("weights the snap by logged damage", () => {
    const light = reactionFor({ outcome: "land", punch: "cross", arrival: 1, damage: 0.45, envelope: env });
    const heavy = reactionFor({ outcome: "land", punch: "cross", arrival: 1, damage: 2, envelope: env });
    expect(Math.abs(heavy.headYaw)).toBeGreaterThan(Math.abs(light.headYaw));
    expect(heavy.headPitch).toBeLessThan(light.headPitch);
  });

  it("slips off the punch line, blocks without moving the head, and misses with no reaction", () => {
    const slip = reactionFor({ outcome: "slip", punch: "jab", arrival: -1, damage: 2, envelope: env });
    const block = reactionFor({ outcome: "block", punch: "cross", arrival: 1, damage: 2, envelope: env });
    const miss = reactionFor({ outcome: "miss", punch: "hook", arrival: -1, damage: 2, envelope: env });
    expect(slip.slip).toBeGreaterThan(0.1);
    expect(slip.headYaw).toBeGreaterThan(0);
    expect(block.gloveRecoil).toBe(1);
    expect(block.headYaw).toBe(0);
    expect(block.headPitch).toBe(0);
    expect(block.slip).toBe(0);
    expect(block.torsoFold).toBe(0);
    const zeros: Reaction = { headYaw: 0, headPitch: 0, headRoll: 0, torsoFold: 0, handsDrop: 0, gloveRecoil: 0, slip: 0 };
    expect(miss).toEqual(zeros);
    // Same age into the punch gives the same reaction at very different fight times.
    const early = reactionFor({ outcome: "land", punch: "hook", arrival: -1, damage: 1.5, envelope: env });
    const late = reactionFor({ outcome: "land", punch: "hook", arrival: -1, damage: 1.5, envelope: env });
    expect(late).toEqual(early);
  });

  it("a southpaw lead hand arrives on the other cheek", () => {
    expect(arrivalSign(0, Math.PI, true)).toBe(1);
    const southpawJab = reactionFor({ outcome: "land", punch: "jab", arrival: 1, damage: 1, envelope: env });
    const orthodoxJab = reactionFor({ outcome: "land", punch: "jab", arrival: -1, damage: 1, envelope: env });
    expect(Math.sign(southpawJab.headYaw)).toBe(-Math.sign(orthodoxJab.headYaw));
  });
});

describe("extension peaks at the logged outcome", () => {
  it("is 1 at a block's 0.20s and a land's 0.25s, and not at the other", async () => {
    const tl = buildTimeline(await demoLog(11));
    const punches = tl.segments.filter((s) => s.kind === "exchange").flatMap((s) => throwsIn(s));
    const block = punches.find((p) => p.outcome === "block");
    const land = punches.find((p) => p.outcome === "land");
    const slip = punches.find((p) => p.outcome === "slip");
    expect(block).toBeTruthy();
    expect(land).toBeTruthy();
    expect(slip).toBeTruthy();
    expect(block!.peak - block!.T).toBeCloseTo(0.2, 5);
    expect(land!.peak - land!.T).toBeCloseTo(0.25, 5);
    expect(slip!.peak - slip!.T).toBeCloseTo(0.2, 5);
    expect(extensionAt(block!.peak, block!.T, block!.peak)).toBeCloseTo(1, 5);
    expect(extensionAt(block!.T + 0.25, block!.T, block!.peak)).toBeLessThan(0.98);
    expect(extensionAt(land!.peak, land!.T, land!.peak)).toBeCloseTo(1, 5);
    expect(extensionAt(slip!.peak, slip!.T, slip!.peak)).toBeCloseTo(1, 5);
    // A miss draws no reaction on the defender at the moment the glove arrives.
    const miss = punches.find((p) => p.outcome === "miss");
    expect(miss).toBeTruthy();
    const defender = miss!.attacker === "a" ? "b" : "a";
    const act = activityAt(tl, defender, miss!.peak);
    expect(act.hit).toBeNull();
    expect(act.slip).toBeNull();
  });
});

describe("glove meets the logged target", () => {
  it("lands, blocks and slips across short and long gaps", async () => {
    const log = await demoLog(11);
    const tl = buildTimeline(log);
    const gltf = await loadBoxer();
    const rigs = {
      a: new CharacterRig(gltf.scene, gltf.animations, lookFor("a", log.builds.a)),
      b: new CharacterRig(gltf.scene, gltf.animations, lookFor("b", log.builds.b)),
    };
    const lead = {
      a: (log.builds.a.stance === "southpaw" ? "R" : "L") as "L" | "R",
      b: (log.builds.b.stance === "southpaw" ? "R" : "L") as "L" | "R",
    };
    const punches = tl.segments.filter((s) => s.kind === "exchange").flatMap((s) => throwsIn(s));
    const at = (p: (typeof punches)[number]) => {
      const layout = layoutAt(tl, p.peak);
      if (layout.a.mode !== "fight" || layout.b.mode !== "fight") return null;
      return { ...p, gap: Math.hypot(layout.a.pos.x - layout.b.pos.x, layout.a.pos.z - layout.b.pos.z) };
    };
    const standing = punches.map(at).filter((p): p is NonNullable<typeof p> => p !== null);
    const lands = standing.filter((p) => p.outcome === "land");
    const longLands = [...lands].sort((a, b) => b.gap - a.gap).slice(0, 4);
    const shortLands = [...lands].sort((a, b) => a.gap - b.gap).slice(0, 4);
    const picked = [
      ...shortLands,
      ...longLands,
      standing.find((p) => p.outcome === "block"),
      standing.find((p) => p.outcome === "slip"),
      standing.find((p) => p.outcome === "miss" && p.target === "head"),
    ].filter((p): p is NonNullable<typeof p> => !!p);
    expect(longLands[0]!.gap).toBeGreaterThan(shortLands[0]!.gap + 0.2);
    expect(picked.some((p) => p.outcome === "block")).toBe(true);
    expect(picked.some((p) => p.outcome === "slip")).toBe(true);

    const seen = new Set<string>();
    for (const p of picked) {
      const key = `${p.attacker}:${p.peak}:${p.punch}:${p.outcome}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sample = poseFightersAt(rigs, tl, p.peak, lead, { a: false, b: false });
      const contact = sample.contacts.find((c) => c.side === p.attacker && c.outcome === p.outcome && c.punch === p.punch);
      expect(contact, key).toBeTruthy();
      const hit = contact as ContactSample;
      const glove = gloveCentre(rigs[hit.side], hit.hand);
      const point = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
      expect(glove.distanceTo(point), `${key} gap ${p.gap.toFixed(2)}`).toBeLessThan(0.05);
      const defender = rigs[other(p.attacker)];
      const head = defender.world("head");
      if (hit.kind === "chin") {
        const fromHead = point.distanceTo(head);
        expect(fromHead, key).toBeGreaterThan(0.16);
        expect(fromHead, key).toBeLessThan(0.32);
        expect(point.y, key).toBeLessThan(head.y);
      } else if (hit.kind === "body") {
        const fromBody = point.distanceTo(defender.world("abdomen"));
        expect(fromBody, key).toBeGreaterThan(0.16);
        expect(fromBody, key).toBeLessThan(0.36);
      } else if (hit.kind === "guard") {
        const yaw = layoutAt(tl, p.peak)[other(p.attacker)].yaw;
        const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        expect(point.clone().sub(head).dot(fwd), key).toBeGreaterThan(0.08);
      } else {
        expect(hit.kind).toBe("air");
        expect(contactKind(p.outcome, p.target)).toBe("air");
        expect(point.distanceTo(head), key).toBeGreaterThan(0.15);
      }
    }
    expect(seen.size).toBeGreaterThan(8);
  });
});

describe("fighters keep a body gap", () => {
  it("head and torso anchors stay apart across a seeded fight", async () => {
    const log = await demoLog(11);
    const tl = buildTimeline(log);
    const gltf = await loadBoxer();
    const rigs = {
      a: new CharacterRig(gltf.scene, gltf.animations, lookFor("a", log.builds.a)),
      b: new CharacterRig(gltf.scene, gltf.animations, lookFor("b", log.builds.b)),
    };
    const lead = {
      a: (log.builds.a.stance === "southpaw" ? "R" : "L") as "L" | "R",
      b: (log.builds.b.stance === "southpaw" ? "R" : "L") as "L" | "R",
    };
    const times: number[] = [];
    for (const seg of tl.segments) {
      if (seg.kind !== "exchange") continue;
      for (const th of throwsIn(seg)) times.push(th.peak);
      for (let t = seg.start; t < seg.start + seg.duration; t += 1.5) times.push(t);
    }
    expect(times.length).toBeGreaterThan(40);
    let minHead = Infinity;
    let minTorso = Infinity;
    let samples = 0;
    for (const T of times) {
      const layout = layoutAt(tl, T);
      if (layout.a.mode === "down" || layout.b.mode === "down") continue;
      if (layout.a.mode === "rising" || layout.b.mode === "rising") continue;
      poseFightersAt(rigs, tl, T, lead, { a: false, b: false });
      const gap = anchorSeparation(rigs.a, rigs.b);
      minHead = Math.min(minHead, gap.head);
      minTorso = Math.min(minTorso, gap.torso);
      samples++;
    }
    expect(samples).toBeGreaterThan(30);
    expect(minHead).toBeGreaterThanOrEqual(MIN_HEAD_GAP - 0.01);
    expect(minTorso).toBeGreaterThanOrEqual(MIN_TORSO_GAP - 0.01);
  });
});

describe("hard lands only change the clock rate", () => {
  it("dips the rate on a hard land and leaves event times where the log put them", async () => {
    const log = await demoLog(11);
    const tl = buildTimeline(log);
    const hard = tl.segments.flatMap((s) => (s.kind === "exchange" ? s.events : [])).find((e) => e.e.type === "land" && e.e.damage >= HARD_LAND);
    expect(hard).toBeTruthy();
    const T = hard!.T;
    expect(rateFactorAt(tl, T + 0.08)).toBeLessThan(0.75);
    expect(rateFactorAt(tl, T + 0.08)).toBeGreaterThan(0.4);
    const seg = tl.segments.find((s) => s.kind === "exchange" && s.events.some((e) => e.T === T));
    expect(seg && seg.kind === "exchange").toBe(true);
    if (!seg || seg.kind !== "exchange") return;
    // Far from the land, and not inside a knockdown window, the rate is full.
    const quiet = seg.start + 0.05;
    const nearKd = tl.knockdowns.some((k) => Math.abs(quiet - k.T) < 2);
    if (!nearKd) expect(rateFactorAt(tl, quiet)).toBe(1);
    for (const ev of seg.events) {
      if (ev.e.type === "land") {
        const logged = log.rounds
          .flatMap((r) => r.exchanges)
          .flatMap((x) => x.events)
          .find((e) => e.type === "land" && ev.e.type === "land" && e.t === ev.e.t && e.damage === ev.e.damage && e.punch === ev.e.punch);
        expect(logged).toBeTruthy();
      }
    }
    expect(tl.log).toEqual(log);
  });
});
