// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DEMO_BUILDS, DEMO_CONTROLLERS, runFight, type Side } from "@llm-boxing-arena/engine";
import { buildTimeline, segmentAt } from "../src/playback/timeline";
import { activityAt, circleAngle, layoutAt, trailerShift } from "../src/scene/choreo";
import { closeupAt, replayTight } from "../src/scene/impact";
import { footCycle, knockdownPose, poseFightersAt, risePose } from "../src/scene/pose";
import { CharacterRig } from "../src/scene/rig";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadGlb(name: string) {
  const buf = fs.readFileSync(path.join(here, "../public/assets", name));
  return new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", resolve, reject);
  });
}

describe("footwork, knockdown and the second body", () => {
  it("buckles the knees before the body tips, then stands back up", () => {
    const early = knockdownPose(0.12);
    expect(early.knee).toBeGreaterThan(0.3);
    expect(early.knee).toBeGreaterThan(early.back);
    expect(early.back).toBe(0);
    const late = knockdownPose(0.75);
    expect(late.knee).toBe(1);
    expect(late.drop).toBeGreaterThan(0.4);
    expect(late.back).toBeGreaterThan(1);
    expect(late.limp).toBe(1);
    const down = knockdownPose(0);
    const up = risePose(1.4);
    expect(up.back).toBeLessThan(down.back + late.back);
    expect(up.limp).toBeLessThan(0.05);
    expect(up.knee).toBeLessThan(0.2);
    expect(risePose(0).limp).toBeGreaterThan(risePose(0.8).limp);
  });

  it("plants one foot while the other steps, and the cycle is a function of fight time", () => {
    let oneUp = false;
    for (let i = 0; i < 40; i++) {
      const T = i * 0.04;
      const left = footCycle(T, "a", "L");
      const right = footCycle(T, "a", "R");
      expect(left.lifted && right.lifted).toBe(false);
      if (left.lifted !== right.lifted) oneUp = true;
      expect(footCycle(T, "a", "L")).toEqual(left);
    }
    expect(oneUp).toBe(true);
  });

  it("circles while both box and walks the trailer toward the ropes", async () => {
    const outcome = await runFight(DEMO_BUILDS.slugger, DEMO_BUILDS.swarmer, DEMO_CONTROLLERS.slugger, DEMO_CONTROLLERS.swarmer, 11);
    if (outcome.status !== "completed") throw new Error(outcome.reason);
    const tl = buildTimeline(outcome.log);
    let circled = false;
    let trailed = false;
    for (const seg of tl.segments) {
      if (seg.kind !== "exchange") continue;
      for (let T = seg.start; T < seg.start + seg.duration; T += 0.25) {
        const a = activityAt(tl, "a", T);
        const b = activityAt(tl, "b", T);
        if (a.punch && b.punch) {
          expect(circleAngle(tl, T + 0.4)).toBeGreaterThanOrEqual(circleAngle(tl, T) - 1e-9);
          if (circleAngle(tl, T + 0.4) > circleAngle(tl, T) + 0.01) circled = true;
        }
        if (a.moving && b.punch && trailerShift(tl, T) < -0.25) {
          const spots = layoutAt(tl, T);
          const ra = Math.hypot(spots.a.pos.x, spots.a.pos.z);
          const rb = Math.hypot(spots.b.pos.x, spots.b.pos.z);
          expect(ra).toBeGreaterThan(rb);
          trailed = true;
        }
        if (b.moving && a.punch && trailerShift(tl, T) > 0.25) {
          const spots = layoutAt(tl, T);
          const ra = Math.hypot(spots.a.pos.x, spots.a.pos.z);
          const rb = Math.hypot(spots.b.pos.x, spots.b.pos.z);
          expect(rb).toBeGreaterThan(ra);
          trailed = true;
        }
      }
    }
    expect(circled).toBe(true);
    expect(trailed).toBe(true);
    const quiet = tl.segments.find((s) => s.kind === "break");
    expect(quiet).toBeTruthy();
    expect(trailerShift(tl, quiet!.start + 1)).toBe(0);
  });

  it("cuts to the same close-up for a hard land and tightens the knockdown replay", async () => {
    const outcome = await runFight(DEMO_BUILDS.slugger, DEMO_BUILDS.swarmer, DEMO_CONTROLLERS.slugger, DEMO_CONTROLLERS.swarmer, 11);
    if (outcome.status !== "completed") throw new Error(outcome.reason);
    const tl = buildTimeline(outcome.log);
    let seen: "ringside" | "shoulder" | null = null;
    for (const seg of tl.segments) {
      if (seg.kind !== "exchange") continue;
      for (const { T, e } of seg.events) {
        if (e.type === "land" && e.damage >= 1.4) {
          const shot = closeupAt(seg, T + 0.1);
          expect(shot).toBe(closeupAt(seg, T + 0.1));
          expect(shot === "ringside" || shot === "shoulder").toBe(true);
          seen = shot;
        }
      }
    }
    expect(seen).not.toBeNull();
    const kd = tl.knockdowns[0];
    expect(kd).toBeTruthy();
    expect(replayTight(tl.knockdowns, kd!.T)).toBe(true);
    expect(replayTight(tl.knockdowns, kd!.T + 3)).toBe(false);
    expect(closeupAt(segmentAt(tl, 1), 1)).toBeNull();
  });

  it("gives the blue corner the bald body on the same skeleton", async () => {
    const [base, bald] = await Promise.all([loadGlb("boxer.glb"), loadGlb("boxer-b.glb")]);
    const red = new CharacterRig(base.scene, base.animations, { skin: "#c58c62", gloves: "#d4141f", trunks: "#b3121b" });
    const blue = new CharacterRig(bald.scene, bald.animations, {
      skin: "#8d5a3b",
      gloves: "#1b5be0",
      trunks: "#1746b8",
      colors: { Shirt: "#102a66", Face: "#8d5a3b" },
    });
    for (const key of ["hips", "abdomen", "torso", "head", "upperL", "fistL", "upperLegL", "footL", "upperLegR", "footR"] as const) {
      expect(red.bones[key], key).toBeTruthy();
      expect(blue.bones[key], key).toBeTruthy();
    }
    for (const clip of ["Idle", "Walk", "SitDown", "StandUp", "RecieveHit"]) {
      expect(blue.clipDuration(clip)).toBeGreaterThan(0.2);
    }
    const outcome = await runFight(DEMO_BUILDS.slugger, DEMO_BUILDS.swarmer, DEMO_CONTROLLERS.slugger, DEMO_CONTROLLERS.swarmer, 11);
    if (outcome.status !== "completed") throw new Error(outcome.reason);
    const tl = buildTimeline(outcome.log);
    const rigs = { a: red, b: blue };
    const lead = { a: "L" as const, b: "L" as const };
    const sample = poseFightersAt(rigs, tl, tl.segments.find((s) => s.kind === "exchange")!.start + 2, lead, { a: false, b: false });
    expect(sample.contacts).toBeDefined();
    const headA = red.world("head");
    const headB = blue.world("head");
    expect(headA.distanceTo(headB)).toBeGreaterThan(0.38);
    for (const side of ["a", "b"] as Side[]) {
      const foot = rigs[side].world("footL");
      expect(foot.y).toBeGreaterThan(0.9);
      expect(foot.y).toBeLessThan(1.35);
    }
  });
});
