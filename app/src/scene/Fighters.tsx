// Drives both boxers and the referee every frame from the choreography at the current fight time.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useArenaGLTF } from "./loaders";
import * as THREE from "three";
import type { BoxerBuild, Side } from "@llm-boxing-arena/engine";
import type { Timeline } from "../playback/timeline";
import { vitalsAt } from "../playback/timeline";
import type { PlaybackStore } from "../playback/store";
import { activityAt, CANVAS_Y, layoutAt, smooth, type ArmActivity, type BoxerPose, type Layout } from "./choreo";
import { BASE_SCALE, CharacterRig, rotateWorldAxis, solveTwoBone, type Look } from "./rig";

export const BOXER_URL = "/assets/boxer.glb";
export const REFEREE_URL = "/assets/referee.glb";

export const CORNER_COLORS: Record<Side, { trunks: string; gloves: string; trim: string; skin: string; boots: string }> = {
  a: { trunks: "#b3121b", gloves: "#d4141f", trim: "#f5d76e", skin: "#c58c62", boots: "#1b1b1b" },
  b: { trunks: "#1746b8", gloves: "#1b5be0", trim: "#ffffff", skin: "#8d5a3b", boots: "#f2f2f2" },
};

/** Bigger punchers look heavier, durable fighters a touch taller. Purely cosmetic. */
export function bodyFor(build: BoxerBuild): { scale: number; bulk: number } {
  const s = build.stats;
  return { scale: BASE_SCALE * (0.97 + (s.chin + s.power - 10) * 0.006), bulk: 0.94 + (s.power - 5) * 0.025 + (s.stamina - 5) * 0.008 };
}

const UP = new THREE.Vector3(0, 1, 0);
const v = () => new THREE.Vector3();

interface Frame { fwd: THREE.Vector3; left: THREE.Vector3 }
function frameOf(yaw: number): Frame {
  return { fwd: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), left: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)) };
}

function placeRoot(rig: CharacterRig, p: { pos: { x: number; z: number }; yaw: number }) {
  rig.root.position.set(p.pos.x, CANVAS_Y, p.pos.z);
  rig.root.rotation.set(0, p.yaw, 0);
}

/** How far the body has dropped and tipped back for a knockdown. */
export function fallPose(pose: BoxerPose): { drop: number; back: number } {
  const SIT_DROP = 0.42;
  if (pose.mode === "down") {
    const t = pose.modeTime;
    return { drop: SIT_DROP * smooth(t / 0.55), back: 1.35 * smooth((t - 0.3) / 0.6) };
  }
  if (pose.mode === "rising") {
    const t = pose.modeTime;
    return { drop: SIT_DROP * (1 - smooth((t - 0.7) / 1.3)), back: 1.35 * (1 - smooth(t / 0.7)) };
  }
  return { drop: 0, back: 0 };
}

const loop = (t: number, d: number) => ((t % d) + d) % d;

type Clips = Record<string, { time: number; weight: number }>;
function boxerClips(rig: CharacterRig, pose: BoxerPose, act: ArmActivity, T: number): Clips {
  const d = (n: string) => rig.clipDuration(n);
  switch (pose.mode) {
    case "walk":
      return { Walk: { time: loop(T * 1.5, d("Walk")), weight: 1 } };
    case "down":
      // No CC0 fall clip in the pack: buckle into the sit pose while fallPose() tips the body onto its back.
      return { SitDown: { time: smooth(pose.modeTime / 0.55) * d("SitDown"), weight: 1 } };
    case "defeated":
      return { Defeat: { time: Math.min(1, Math.max(0, pose.modeTime) / 2) * d("Defeat"), weight: 1 } };
    case "rising":
      // Sit up (fallPose), then the stand-up clip from the sitting pose.
      return pose.modeTime < 0.7
        ? { SitDown: { time: d("SitDown") - 1e-3, weight: 1 } }
        : { StandUp: { time: smooth((pose.modeTime - 0.7) / 1.3) * d("StandUp"), weight: 1 } };
    case "sit":
      return { SitDown: { time: Math.min(1, pose.modeTime / 1.4) * d("SitDown"), weight: 1 } };
    case "victory":
      return { Victory: { time: loop(Math.max(0, pose.modeTime) * 0.8, d("Victory")), weight: 1 } };
    case "stand":
      return { Idle: { time: loop(T * 0.6, d("Idle")), weight: 1 } };
    default: {
      const walkW = act.moving ? 0.45 : 0;
      const hitW = act.hit && act.hit.amount >= 1.3 ? Math.min(0.6, act.hit.k * 0.6) : 0;
      return {
        Idle: { time: loop(T * 0.7, d("Idle")), weight: 1 - walkW - hitW },
        Walk: { time: loop(T * 1.3, d("Walk")), weight: walkW },
        RecieveHit: { time: (act.hit ? 1 - act.hit.k : 0) * 0.5 * d("RecieveHit"), weight: hitW },
      };
    }
  }
}

function driveBoxer(rig: CharacterRig, side: Side, pose: BoxerPose, act: ArmActivity, opp: CharacterRig, oppPose: BoxerPose, hurt: boolean, lead: "L" | "R", T: number) {
  placeRoot(rig, pose);
  const fall = fallPose(pose);
  rig.setFall(fall.drop, fall.back);
  rig.pose(boxerClips(rig, pose, act, T));
  rig.root.updateMatrixWorld(true);
  const { fwd, left } = frameOf(pose.yaw);
  const b = rig.bones;
  const fighting = pose.mode === "fight";

  if (fighting) {
    // Boxing stance: a little hunched, chin down, bobbing.
    rotateWorldAxis(b.abdomen, left, 0.08 + act.bob * 0.03);
    rotateWorldAxis(b.neck, left, 0.1);
    if (act.punch) {
      const p = act.punch;
      const rearHand = (p.hand === "rear") === true;
      const handIsRight = rearHand ? lead === "L" : lead === "R";
      const twist = (p.punch === "hook" ? 0.45 : p.punch === "jab" ? 0.15 : 0.35) * p.ext;
      rotateWorldAxis(b.torso, UP, handIsRight ? twist : -twist);
      rotateWorldAxis(b.abdomen, left, (p.punch === "body" ? 0.35 : 0.12) * p.ext);
    }
    if (act.slip > 0) {
      const dir = Math.floor(T * 1.7) % 2 === 0 ? 1 : -1;
      rotateWorldAxis(b.abdomen, fwd, 0.4 * act.slip * dir);
      rotateWorldAxis(b.abdomen, left, 0.18 * act.slip);
    }
    if (act.hit) {
      const amt = Math.min(1.4, act.hit.amount / 1.3) * act.hit.k;
      if (act.hit.target === "head") {
        rotateWorldAxis(b.neck, left, -0.55 * amt);
        rotateWorldAxis(b.torso, left, -0.18 * amt);
        rotateWorldAxis(b.neck, UP, 0.3 * amt * (Math.floor(T) % 2 ? 1 : -1));
      } else {
        rotateWorldAxis(b.abdomen, left, 0.4 * amt);
      }
    }
    if (hurt) {
      rotateWorldAxis(b.hips, fwd, 0.1 * Math.sin(T * 3.1));
      rotateWorldAxis(b.abdomen, fwd, 0.08 * Math.sin(T * 2.3 + 1));
    }
  }

  // Arms: IK to guard / punch / block / clinch targets.
  const head = rig.world("head");
  const sideVec = (hand: "L" | "R") => left.clone().multiplyScalar(hand === "L" ? 1 : -1);
  const guard = (hand: "L" | "R") => {
    const isLead = hand === lead;
    if (act.block) return head.clone().addScaledVector(fwd, 0.2).addScaledVector(sideVec(hand), 0.075).addScaledVector(UP, 0.02);
    return head
      .clone()
      .addScaledVector(fwd, isLead ? 0.3 : 0.2)
      .addScaledVector(sideVec(hand), isLead ? 0.07 : 0.11)
      .addScaledVector(UP, isLead ? -0.06 : -0.1);
  };
  const oppFrame = frameOf(oppPose.yaw);
  const oppHead = opp.world("head");
  const oppBody = opp.world("abdomen");

  let ikWeight = fighting ? 1 - (act.hit && act.hit.amount >= 1.3 ? act.hit.k * 0.5 : 0) : 0;
  if (pose.mode === "walk") ikWeight = 0.55;
  if (pose.mode === "rising") ikWeight = smooth((pose.modeTime - 1.4) / 0.8);
  if (pose.mode === "stand") ikWeight = pose.raised ? 1 : 0.4;

  for (const hand of ["L", "R"] as const) {
    let target = guard(hand);
    let pole = rig.world(hand === "L" ? "upperL" : "upperR").addScaledVector(UP, -0.6).addScaledVector(sideVec(hand), 0.35).addScaledVector(fwd, -0.1);
    const isLead = hand === lead;
    if (fighting && act.clinch) {
      target = oppBody.clone().addScaledVector(oppFrame.fwd, -0.1).addScaledVector(sideVec(hand), 0.16).addScaledVector(UP, 0.12);
    } else if (fighting && act.punch && (act.punch.hand === "lead") === isLead) {
      const p = act.punch;
      let end: THREE.Vector3;
      if (p.target === "body") end = oppBody.clone().addScaledVector(oppFrame.fwd, 0.12).addScaledVector(UP, 0.02);
      else end = oppHead.clone().addScaledVector(oppFrame.fwd, 0.13).addScaledVector(UP, -0.03);
      if (p.outcome === "block") end = oppHead.clone().addScaledVector(oppFrame.fwd, 0.3).addScaledVector(UP, -0.05);
      if (p.outcome === "slip" || p.outcome === "miss") end.addScaledVector(sideVec(hand), -0.28).addScaledVector(oppFrame.fwd, -0.1);
      const start = target;
      const ctrl = start.clone().lerp(end, 0.5);
      if (p.punch === "hook") {
        ctrl.addScaledVector(sideVec(hand), 0.38).addScaledVector(UP, 0.05);
        pole = rig.world(hand === "L" ? "upperL" : "upperR").addScaledVector(sideVec(hand), 0.6).addScaledVector(UP, 0.1);
      } else if (p.punch === "uppercut") {
        ctrl.addScaledVector(UP, -0.35);
        pole = rig.world(hand === "L" ? "upperL" : "upperR").addScaledVector(UP, -0.7).addScaledVector(fwd, -0.2);
      } else if (p.punch === "body") ctrl.addScaledVector(UP, -0.12).addScaledVector(sideVec(hand), 0.12);
      const k = p.ext;
      target = start.clone().multiplyScalar((1 - k) * (1 - k)).addScaledVector(ctrl, 2 * (1 - k) * k).addScaledVector(end, k * k);
    } else if (pose.raised) {
      // Arm straight up beside the (big) head: aim from the shoulder, beyond reach so the arm locks out.
      target = rig.world(hand === "L" ? "upperL" : "upperR").addScaledVector(UP, 0.9).addScaledVector(sideVec(hand), 0.22).addScaledVector(fwd, 0.04);
      pole = rig.world(hand === "L" ? "upperL" : "upperR").addScaledVector(sideVec(hand), 0.5).addScaledVector(fwd, -0.3);
      if (hand !== (side === "a" ? "L" : "R")) target = guard(hand).addScaledVector(UP, -0.35);
    }
    const upper = hand === "L" ? b.upperL : b.upperR;
    const lower = hand === "L" ? b.lowerL : b.lowerR;
    const fist = hand === "L" ? b.fistL : b.fistR;
    solveTwoBone(upper, lower, fist, target, pole, ikWeight);
  }
}

function driveReferee(rig: CharacterRig, layout: Layout, boxers: Record<Side, CharacterRig>, T: number) {
  const r = layout.ref;
  placeRoot(rig, r);
  const walking = r.action === "walk";
  rig.pose(walking ? { Walk: { time: loop(T * 1.4, rig.clipDuration("Walk")), weight: 1 } } : { Idle: { time: loop(T * 0.5, rig.clipDuration("Idle")), weight: 1 } });
  rig.root.updateMatrixWorld(true);
  const { fwd, left } = frameOf(r.yaw);
  const b = rig.bones;
  const sh = (hand: "L" | "R") => rig.world(hand === "L" ? "upperL" : "upperR");
  const side = (hand: "L" | "R") => left.clone().multiplyScalar(hand === "L" ? 1 : -1);
  const targets: Partial<Record<"L" | "R", THREE.Vector3>> = {};
  if (r.action === "break") {
    for (const h of ["L", "R"] as const) targets[h] = sh(h).addScaledVector(fwd, 0.55).addScaledVector(side(h), 0.25).addScaledVector(UP, -0.05);
  } else if (r.action === "count") {
    rotateWorldAxis(b.abdomen, left, 0.35);
    const k = smooth(Math.min(1, r.phase / 0.45));
    const top = sh("R").addScaledVector(UP, 0.45).addScaledVector(fwd, 0.15);
    const bottom = sh("R").addScaledVector(UP, -0.25).addScaledVector(fwd, 0.55);
    targets.R = top.lerp(bottom, k);
  } else if (r.action === "wave") {
    const s = Math.sin(r.phase * 9);
    for (const h of ["L", "R"] as const) targets[h] = sh(h).addScaledVector(UP, 0.35).addScaledVector(fwd, 0.25).addScaledVector(side(h), 0.1 + 0.35 * s * (h === "L" ? 1 : -1));
  } else if (r.action === "raise" && r.raise) {
    const lift = smooth(r.phase / 0.8);
    const raiseFor = (s: Side, hand: "L" | "R") => {
      const fist = boxers[s].world(s === "a" ? "fistL" : "fistR");
      targets[hand] = sh(hand).addScaledVector(UP, -0.3).lerp(fist, lift);
    };
    const handToward = (s: Side): "L" | "R" => (left.dot(v().copy(boxers[s].root.position).sub(rig.root.position)) > 0 ? "L" : "R");
    if (r.raise === "both") {
      raiseFor("a", handToward("a"));
      raiseFor("b", handToward("b"));
    } else raiseFor(r.raise, handToward(r.raise));
  }
  for (const h of ["L", "R"] as const) {
    const t = targets[h];
    if (!t) continue;
    const pole = sh(h).addScaledVector(UP, -0.6).addScaledVector(side(h), 0.4).addScaledVector(fwd, -0.2);
    solveTwoBone(h === "L" ? b.upperL : b.upperR, h === "L" ? b.lowerL : b.lowerR, h === "L" ? b.fistL : b.fistR, t, pole, 1);
  }
}

export function Fighters({ tl, store, quality }: { tl: Timeline; store: PlaybackStore; quality: "high" | "low" }) {
  const boxer = useArenaGLTF(BOXER_URL);
  const referee = useArenaGLTF(REFEREE_URL);
  const { a: buildA, b: buildB } = tl.log.builds;

  const rigs = useMemo(() => {
    const look = (side: Side, build: BoxerBuild): Look => ({ ...CORNER_COLORS[side], ...bodyFor(build) });
    return {
      a: new CharacterRig(boxer.scene, boxer.animations, look("a", buildA)),
      b: new CharacterRig(boxer.scene, boxer.animations, look("b", buildB)),
      ref: new CharacterRig(referee.scene, referee.animations, {
        skin: "#d9a982",
        colors: { Shirt: "#e9eef5", Pants: "#15161a", Belt: "#0a0a0a", Hair: "#2b2118" },
        boots: "#0d0d0d",
        scale: BASE_SCALE * 0.97,
      }),
    };
  }, [boxer, referee, buildA, buildB]);

  useEffect(() => {
    for (const r of [rigs.a, rigs.b, rigs.ref]) r.root.traverse((o) => ((o as THREE.Mesh).castShadow = quality === "high"));
  }, [rigs, quality]);

  useFrame(() => {
    const T = store.T;
    const layout = layoutAt(tl, T);
    const vit = vitalsAt(tl, T);
    const actA = activityAt(tl, "a", T);
    const actB = activityAt(tl, "b", T);
    const leadA = buildA.stance === "southpaw" ? "R" : "L";
    const leadB = buildB.stance === "southpaw" ? "R" : "L";
    // Place both first so each can aim at the other's head.
    placeRoot(rigs.a, layout.a);
    placeRoot(rigs.b, layout.b);
    rigs.b.setFall(fallPose(layout.b).drop, fallPose(layout.b).back);
    rigs.b.pose(boxerClips(rigs.b, layout.b, actB, T));
    rigs.b.root.updateMatrixWorld(true);
    driveBoxer(rigs.a, "a", layout.a, actA, rigs.b, layout.b, vit.a.hurt, leadA, T);
    driveBoxer(rigs.b, "b", layout.b, actB, rigs.a, layout.a, vit.b.hurt, leadB, T);
    driveReferee(rigs.ref, layout, { a: rigs.a, b: rigs.b }, T);
  });

  return (
    <>
      <primitive object={rigs.a.root} />
      <primitive object={rigs.b.root} />
      <primitive object={rigs.ref.root} />
    </>
  );
}

