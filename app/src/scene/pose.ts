// Poses both boxers at fight time T. The referee has its own driver.
// Root positions start from the layout, then a punch steps the attacker in (and, if the
// gap is still longer than the arm, pulls the defender) so the glove centre lands on the
// contact point. Same inputs always give the same bones.
import * as THREE from "three";
import type { Punch, Side } from "@llm-boxing-arena/engine";
import { segmentAt, type Timeline } from "../playback/timeline";
import { activityAt, CANVAS_Y, layoutAt, smooth, type ArmActivity, type BoxerPose } from "./choreo";
import {
  arrivalSign,
  contactKind,
  contactOffset,
  flashIntensity,
  hardImpactAt,
  MIN_HEAD_GAP,
  MIN_TORSO_GAP,
  punchingHand,
  reactionFor,
  sweatDrops,
  type ContactKind,
  type Reaction,
} from "./impact";
import { CharacterRig, rotateWorldAxis, solveTwoBone, type BoneKey } from "./rig";

const UP = new THREE.Vector3(0, 1, 0);
const REACH = 0.98;
/** Attacker lunges this far before the defender is pulled in to close the rest. */
const MAX_STEP = 0.9;

export interface Vec3 { x: number; y: number; z: number }

export interface ContactSample {
  side: Side;
  hand: "L" | "R";
  kind: ContactKind;
  outcome: string;
  punch: Punch;
  /** World position the glove centre is aiming at. */
  point: Vec3;
  /** Root-to-root gap from the layout, before this punch's step. */
  gap: number;
}

export interface PoseSample {
  contacts: ContactSample[];
  sweat: { x: number; y: number; z: number; s: number }[];
}

interface Frame { fwd: THREE.Vector3; left: THREE.Vector3 }
export function frameOf(yaw: number): Frame {
  return { fwd: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), left: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)) };
}

export function placeRoot(rig: CharacterRig, p: { pos: { x: number; z: number }; yaw: number }) {
  rig.root.position.set(p.pos.x, CANVAS_Y, p.pos.z);
  rig.root.rotation.set(0, p.yaw, 0);
}

export interface FallShape {
  /** Hip drop, metres. */
  drop: number;
  /** Tip backward, radians. Starts only after the knees have buckled. */
  back: number;
  /** 0..1 knee bend. */
  knee: number;
  /** 0..1 arms hanging. */
  limp: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Knees buckle, hips drop, then the body tips. Arms go limp with the buckle. */
export function knockdownPose(t: number): FallShape {
  const k = Math.max(0, t);
  return {
    knee: smooth(clamp01(k / 0.28)),
    drop: 0.56 * smooth(clamp01((k - 0.08) / 0.48)),
    back: 1.35 * smooth(clamp01((k - 0.34) / 0.48)),
    limp: smooth(clamp01((k - 0.04) / 0.32)),
  };
}

/** Un-tip, then straighten into the stand-up clip. */
export function risePose(t: number): FallShape {
  const k = Math.max(0, t);
  return {
    back: 1.35 * (1 - smooth(clamp01(k / 0.7))),
    drop: 0.56 * (1 - smooth(clamp01((k - 0.3) / 1.15))),
    knee: 1 - smooth(clamp01((k - 0.45) / 1.15)),
    limp: 1 - smooth(clamp01(k / 0.75)),
  };
}

/** How far the body has dropped and tipped back for a knockdown. */
export function fallPose(pose: BoxerPose): { drop: number; back: number } {
  if (pose.mode === "down") {
    const k = knockdownPose(pose.modeTime);
    return { drop: k.drop, back: k.back };
  }
  if (pose.mode === "rising") {
    const k = risePose(pose.modeTime);
    return { drop: k.drop, back: k.back };
  }
  return { drop: 0, back: 0 };
}

function fallShape(pose: BoxerPose): FallShape {
  if (pose.mode === "down") return knockdownPose(pose.modeTime);
  if (pose.mode === "rising") return risePose(pose.modeTime);
  return { drop: 0, back: 0, knee: 0, limp: 0 };
}

const STEP_PERIOD = 0.62;

/** One step of the plant-step-plant cycle. Opposite feet are half a period apart. */
export function footCycle(T: number, side: Side, foot: "L" | "R"): { swing: number; lifted: boolean } {
  const offset = (foot === "L" ? 0 : 0.5) + (side === "b" ? 0.27 : 0);
  const phase = ((T / STEP_PERIOD + offset) % 1 + 1) % 1;
  const lifted = phase > 0.58;
  return { swing: lifted ? smooth((phase - 0.58) / 0.42) : 0, lifted };
}

function buckle(rig: CharacterRig, yaw: number, shape: FallShape) {
  if (shape.knee < 0.02 && shape.limp < 0.02) return;
  const { left } = frameOf(yaw);
  for (const foot of ["L", "R"] as const) {
    const upper = foot === "L" ? rig.bones.upperLegL : rig.bones.upperLegR;
    const lower = foot === "L" ? rig.bones.lowerLegL : rig.bones.lowerLegR;
    rotateWorldAxis(upper, left, 0.95 * shape.knee);
    rotateWorldAxis(lower, left, -1.55 * shape.knee);
  }
  for (const hand of ["L", "R"] as const) {
    const upper = hand === "L" ? rig.bones.upperL : rig.bones.upperR;
    const lower = hand === "L" ? rig.bones.lowerL : rig.bones.lowerR;
    rotateWorldAxis(upper, left, 1.05 * shape.limp);
    rotateWorldAxis(lower, left, 0.45 * shape.limp);
  }
}

const loop = (t: number, d: number) => ((t % d) + d) % d;

function boxerClips(rig: CharacterRig, pose: BoxerPose, act: ArmActivity, T: number): Record<string, { time: number; weight: number }> {
  const d = (n: string) => rig.clipDuration(n);
  switch (pose.mode) {
    case "walk":
      return { Walk: { time: loop(T * 1.5, d("Walk")), weight: 1 } };
    case "down": {
      // The sit clip arrives after the knees have buckled, then the hip tip takes over.
      const sit = smooth(clamp01((pose.modeTime - 0.22) / 0.5));
      return {
        SitDown: { time: sit * d("SitDown"), weight: sit },
        Idle: { time: 0, weight: 1 - sit },
      };
    }
    case "defeated":
      return { Defeat: { time: Math.min(1, Math.max(0, pose.modeTime) / 2) * d("Defeat"), weight: 1 } };
    case "rising":
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
      return {
        Idle: { time: loop(T * 0.7, d("Idle")), weight: 1 - walkW },
        Walk: { time: loop(T * 1.3, d("Walk")), weight: walkW },
      };
    }
  }
}

function stillStanding(pose: BoxerPose): boolean {
  return pose.mode === "fight" || (pose.mode === "down" && pose.modeTime < 0.25);
}

interface Anchors {
  headBefore: THREE.Vector3;
  headAfter: THREE.Vector3;
  abdomen: THREE.Vector3;
}

function capture(rig: CharacterRig, bone: BoneKey): THREE.Vector3 {
  return rig.root.worldToLocal(rig.world(bone));
}

function applyReaction(rig: CharacterRig, yaw: number, reaction: Reaction) {
  const { fwd, left } = frameOf(yaw);
  const b = rig.bones;
  rotateWorldAxis(b.neck, UP, reaction.headYaw);
  rotateWorldAxis(b.neck, left, -reaction.headPitch);
  rotateWorldAxis(b.neck, fwd, -reaction.headRoll);
  rotateWorldAxis(b.abdomen, left, reaction.torsoFold);
  if (reaction.slip !== 0) rotateWorldAxis(b.abdomen, fwd, -reaction.slip * 2.4);
}

function reactionOf(act: ArmActivity, yaw: number, oppYaw: number, leadOf: (side: Side) => "L" | "R"): Reaction {
  const zero = reactionFor({ outcome: "miss", punch: "jab", arrival: 1, damage: 0, envelope: 1 });
  let yawN = zero.headYaw;
  let pitch = zero.headPitch;
  let roll = zero.headRoll;
  let fold = zero.torsoFold;
  let drop = zero.handsDrop;
  let slip = zero.slip;
  const add = (r: Reaction) => {
    yawN += r.headYaw;
    pitch += r.headPitch;
    roll += r.headRoll;
    fold += r.torsoFold;
    drop = Math.min(1, drop + r.handsDrop);
    slip += r.slip;
  };
  if (act.hit) {
    const hand = punchingHand(leadOf(act.hit.attacker), act.hit.hand);
    add(reactionFor({
      outcome: "land",
      punch: act.hit.punch,
      arrival: arrivalSign(oppYaw, yaw, hand === "R"),
      damage: act.hit.amount,
      envelope: act.hit.k,
    }));
  }
  if (act.slip) {
    const hand = punchingHand(leadOf(act.slip.attacker), act.slip.hand);
    add(reactionFor({
      outcome: "slip",
      punch: act.slip.punch,
      arrival: arrivalSign(oppYaw, yaw, hand === "R"),
      damage: 0,
      envelope: act.slip.amount,
    }));
  }
  return { headYaw: yawN, headPitch: pitch, headRoll: roll, torsoFold: fold, handsDrop: drop, gloveRecoil: 0, slip };
}

function anchorWorld(rig: CharacterRig, local: THREE.Vector3): THREE.Vector3 {
  return rig.root.localToWorld(local.clone());
}

function contactWorld(rig: CharacterRig, yaw: number, anchors: Anchors, kind: ContactKind, arrival: 1 | -1, target: "head" | "body"): THREE.Vector3 {
  const useBody = kind === "body" || (kind === "air" && target === "body");
  const local = useBody ? anchors.abdomen : kind === "chin" ? anchors.headAfter : anchors.headBefore;
  const origin = anchorWorld(rig, local);
  const { fwd, left } = frameOf(yaw);
  const off = contactOffset(kind, arrival, target);
  return origin.addScaledVector(left, off.x).addScaledVector(UP, off.y).addScaledVector(fwd, off.z);
}

function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number): THREE.Vector3 {
  const u = 1 - t;
  return a.clone().multiplyScalar(u * u).addScaledVector(b, 2 * u * t).addScaledVector(c, t * t);
}

function gloveAlong(rig: CharacterRig, hand: "L" | "R"): number {
  const glove = rig.gloves[hand];
  if (!glove) return 0.07;
  const wrist = rig.world(hand === "L" ? "fistL" : "fistR");
  return glove.getWorldPosition(new THREE.Vector3()).distanceTo(wrist) || 0.07;
}

/** Head-bone and abdomen-bone gaps after the pose has been applied. */
export function anchorSeparation(a: CharacterRig, b: CharacterRig): { head: number; torso: number } {
  return {
    head: a.world("head").distanceTo(b.world("head")),
    torso: a.world("abdomen").distanceTo(b.world("abdomen")),
  };
}

/**
 * Slide the roots apart along the floor until the head bones and the abdomen bones
 * are at least MIN_HEAD_GAP / MIN_TORSO_GAP apart. The arm reaches from there;
 * the bodies do not.
 */
function separateFighters(a: CharacterRig, b: CharacterRig) {
  for (let i = 0; i < 3; i++) {
    a.root.updateMatrixWorld(true);
    b.root.updateMatrixWorld(true);
    const gap = anchorSeparation(a, b);
    const short = Math.max(MIN_HEAD_GAP - gap.head, MIN_TORSO_GAP - gap.torso);
    if (short <= 0.004) return;
    const abdA = a.world("abdomen");
    const abdB = b.world("abdomen");
    const dx = abdB.x - abdA.x;
    const dz = abdB.z - abdA.z;
    const len = Math.hypot(dx, dz) || 1;
    const half = short / 2 + 0.008;
    a.root.position.x -= (dx / len) * half;
    a.root.position.z -= (dz / len) * half;
    b.root.position.x += (dx / len) * half;
    b.root.position.z += (dz / len) * half;
  }
  a.root.updateMatrixWorld(true);
  b.root.updateMatrixWorld(true);
}

/** Move the attacker so the glove closes `err`, but never through the other fighter. */
function nudgeWithinGap(attacker: CharacterRig, defender: CharacterRig, err: THREE.Vector3) {
  const abdA = attacker.world("abdomen");
  const abdB = defender.world("abdomen");
  const axis = new THREE.Vector3(abdB.x - abdA.x, 0, abdB.z - abdA.z);
  if (axis.lengthSq() < 1e-6) axis.set(0, 0, 1);
  axis.normalize();
  const closing = Math.max(0, err.x * axis.x + err.z * axis.z);
  const gap = anchorSeparation(attacker, defender);
  const slack = Math.min(gap.head - MIN_HEAD_GAP, gap.torso - MIN_TORSO_GAP);
  const used = Math.min(closing, Math.max(0, slack - 0.008));
  attacker.root.position.x += err.x - axis.x * closing + axis.x * used;
  attacker.root.position.y += err.y;
  attacker.root.position.z += err.z - axis.z * closing + axis.z * used;
  attacker.root.updateMatrixWorld(true);
}

/** Slide bodies so `wristTarget` is inside the punching arm's reach. Contact locals stay valid. */
function bringWithinReach(attacker: CharacterRig, defender: CharacterRig, wristTarget: THREE.Vector3, shoulder: BoneKey, defenderCanSlide: boolean) {
  attacker.root.updateMatrixWorld(true);
  const joint = attacker.world(shoulder);
  const dist = joint.distanceTo(wristTarget);
  const reach = attacker.armLength * REACH;
  const short = dist - reach;
  if (short <= 0.01) return;
  const dir = wristTarget.clone().sub(joint).normalize();
  const cap = defenderCanSlide ? MAX_STEP : short;
  const step = Math.min(short, cap);
  attacker.root.position.addScaledVector(dir, step);
  const rest = short - step;
  if (rest > 0.01 && defenderCanSlide) defender.root.position.addScaledVector(dir, -rest);
  attacker.root.updateMatrixWorld(true);
  defender.root.updateMatrixWorld(true);
}

function solveGlove(rig: CharacterRig, hand: "L" | "R", target: THREE.Vector3, pole: THREE.Vector3, weight: number) {
  const glove = rig.gloves[hand];
  if (!glove || weight <= 0) return;
  const upper = rig.bones[hand === "L" ? "upperL" : "upperR"];
  const lower = rig.bones[hand === "L" ? "lowerL" : "lowerR"];
  const fist = rig.bones[hand === "L" ? "fistL" : "fistR"];
  let wrist = target.clone();
  for (let i = 0; i < 3; i++) {
    solveTwoBone(upper, lower, fist, wrist, pole, weight);
    rig.root.updateMatrixWorld(true);
    const got = glove.getWorldPosition(new THREE.Vector3());
    const err = target.clone().sub(got);
    if (err.length() < 0.008) break;
    wrist = wrist.add(err);
  }
}

function paintFlash(rig: CharacterRig, hand: "L" | "R" | null, amount: number) {
  for (const h of ["L", "R"] as const) {
    const glove = rig.gloves[h];
    if (!glove) continue;
    const mat = glove.material as THREE.MeshStandardMaterial;
    mat.emissive.set("#fff1c4");
    mat.emissiveIntensity = h === hand ? amount * 2.4 : 0;
  }
}

interface Body {
  rig: CharacterRig;
  pose: BoxerPose;
  act: ArmActivity;
  lead: "L" | "R";
  anchors: Anchors;
  handsDrop: number;
}

export function poseFightersAt(
  rigs: Record<Side, CharacterRig>,
  tl: Timeline,
  T: number,
  lead: Record<Side, "L" | "R">,
  hurt: Record<Side, boolean>,
): PoseSample {
  const layout = layoutAt(tl, T);
  const gap = Math.hypot(layout.a.pos.x - layout.b.pos.x, layout.a.pos.z - layout.b.pos.z);
  const act = { a: activityAt(tl, "a", T), b: activityAt(tl, "b", T) };
  const bodies = {} as Record<Side, Body>;

  for (const side of ["a", "b"] as const) {
    const rig = rigs[side];
    const pose = layout[side];
    placeRoot(rig, pose);
    const fall = fallPose(pose);
    rig.setFall(fall.drop, fall.back);
    rig.pose(boxerClips(rig, pose, act[side], T));
    buckle(rig, pose.yaw, fallShape(pose));
    rig.root.updateMatrixWorld(true);
    const { fwd, left } = frameOf(pose.yaw);
    const b = rig.bones;
    const fighting = pose.mode === "fight";
    const otherSide: Side = side === "a" ? "b" : "a";
    let handsDrop = 0;
    if (fighting || stillStanding(pose)) {
      if (fighting) {
        rotateWorldAxis(b.abdomen, left, 0.08 + act[side].bob * 0.03);
        rotateWorldAxis(b.neck, left, 0.1);
        const punch = act[side].punch;
        if (punch) {
          const bone = punchingHand(lead[side], punch.hand);
          const twist = (punch.punch === "hook" ? 0.45 : punch.punch === "jab" ? 0.15 : 0.35) * punch.ext;
          rotateWorldAxis(b.torso, UP, bone === "R" ? twist : -twist);
          rotateWorldAxis(b.abdomen, left, (punch.target === "body" ? 0.28 : 0.1) * punch.ext);
        }
        if (act[side].clinch) {
          rotateWorldAxis(b.abdomen, left, 0.28);
          rotateWorldAxis(b.torso, left, 0.12);
        }
        if (hurt[side]) {
          rotateWorldAxis(b.hips, fwd, 0.1 * Math.sin(T * 3.1));
          rotateWorldAxis(b.abdomen, fwd, 0.08 * Math.sin(T * 2.3 + 1));
        }
      }
      const headBefore = capture(rig, "head");
      const reaction = reactionOf(act[side], pose.yaw, layout[otherSide].yaw, (s) => lead[s]);
      applyReaction(rig, pose.yaw, reaction);
      handsDrop = reaction.handsDrop;
      rig.root.updateMatrixWorld(true);
      bodies[side] = {
        rig,
        pose,
        act: act[side],
        lead: lead[side],
        anchors: { headBefore, headAfter: capture(rig, "head"), abdomen: capture(rig, "abdomen") },
        handsDrop,
      };
    } else {
      bodies[side] = {
        rig,
        pose,
        act: act[side],
        lead: lead[side],
        anchors: { headBefore: capture(rig, "head"), headAfter: capture(rig, "head"), abdomen: capture(rig, "abdomen") },
        handsDrop: 0,
      };
    }
  }

  const contacts: ContactSample[] = [];
  const punchOf = (side: Side) => {
    const body = bodies[side];
    const punch = body.act.punch;
    if (!punch || punch.ext <= 0 || body.act.clinch || !stillStanding(body.pose)) return null;
    return punch;
  };

  const aimFor = (side: Side) => {
    const punch = punchOf(side);
    if (!punch) return null;
    const attacker = bodies[side];
    const defenderSide: Side = side === "a" ? "b" : "a";
    const defender = bodies[defenderSide];
    const bone = punchingHand(attacker.lead, punch.hand);
    const kind = contactKind(punch.outcome, punch.target);
    const arrival = arrivalSign(attacker.pose.yaw, defender.pose.yaw, bone === "R");
    const contact = contactWorld(defender.rig, defender.pose.yaw, defender.anchors, kind, arrival, punch.target);
    const { fwd, left } = frameOf(attacker.pose.yaw);
    const sideVec = left.clone().multiplyScalar(bone === "L" ? 1 : -1);
    const head = anchorWorld(attacker.rig, attacker.anchors.headAfter);
    const start = head.clone().addScaledVector(fwd, bone === attacker.lead ? 0.28 : 0.18).addScaledVector(sideVec, 0.08);
    const ctrl = start.clone().lerp(contact, 0.5);
    if (punch.punch === "hook") ctrl.addScaledVector(sideVec, 0.38).addScaledVector(UP, 0.05);
    else if (punch.punch === "uppercut") ctrl.addScaledVector(UP, -0.35);
    else if (punch.punch === "body") ctrl.addScaledVector(UP, -0.12).addScaledVector(sideVec, 0.12);
    const aim = punch.ext >= 0.999 ? contact.clone() : bezier(start, ctrl, contact, punch.ext);
    const shoulder: BoneKey = bone === "L" ? "upperL" : "upperR";
    return { punch, attacker, defender, bone, kind, arrival, sideVec, aim, shoulder };
  };

  const wristFor = (side: Side, aim: THREE.Vector3, bone: "L" | "R", shoulder: BoneKey) => {
    const joint = bodies[side].rig.world(shoulder);
    const dir = aim.clone().sub(joint);
    const dist = dir.length() || 1;
    dir.multiplyScalar(1 / dist);
    return aim.clone().addScaledVector(dir, -Math.min(gloveAlong(bodies[side].rig, bone), dist * 0.45));
  };

  // Close the gap before either glove is solved, so one fighter's lunge doesn't pull the other's target away.
  for (let pass = 0; pass < 3; pass++) {
    for (const side of ["a", "b"] as const) {
      const aimed = aimFor(side);
      if (!aimed) continue;
      bringWithinReach(aimed.attacker.rig, aimed.defender.rig, wristFor(side, aimed.aim, aimed.bone, aimed.shoulder), aimed.shoulder, stillStanding(aimed.defender.pose));
    }
  }
  for (const side of ["a", "b"] as const) {
    const aimed = aimFor(side);
    if (!aimed) continue;
    const wrist = wristFor(side, aimed.aim, aimed.bone, aimed.shoulder);
    bringWithinReach(aimed.attacker.rig, aimed.defender.rig, wrist, aimed.shoulder, false);
  }
  // The lunge, and the lean into a clinch, can leave the chests overlapping. Put the gap back, then let the arms cover it.
  separateFighters(bodies.a.rig, bodies.b.rig);
  for (let pass = 0; pass < 2; pass++) {
    for (const side of ["a", "b"] as const) {
      const settled = aimFor(side);
      if (!settled) continue;
      const pole = settled.attacker.rig.world(settled.shoulder).addScaledVector(settled.punch.punch === "hook" ? settled.sideVec : UP, settled.punch.punch === "hook" ? 0.55 : -0.65);
      solveGlove(settled.attacker.rig, settled.bone, settled.aim, pole, 1);
      const glove = settled.attacker.rig.gloves[settled.bone];
      if (!glove) continue;
      const err = settled.aim.clone().sub(glove.getWorldPosition(new THREE.Vector3()));
      if (err.length() < 0.012 || err.length() > 0.2) continue;
      nudgeWithinGap(settled.attacker.rig, settled.defender.rig, err);
    }
  }
  for (const side of ["a", "b"] as const) {
    const settled = aimFor(side);
    if (!settled) continue;
    contacts.push({
      side,
      hand: settled.bone,
      kind: settled.kind,
      outcome: settled.punch.outcome,
      punch: settled.punch.punch,
      point: { x: settled.aim.x, y: settled.aim.y, z: settled.aim.z },
      gap,
    });
  }

  // Guards, the blocking glove and clinch arms, after the feet have stopped moving.
  for (const side of ["a", "b"] as const) {
    const body = bodies[side];
    const rig = body.rig;
    const pose = body.pose;
    const a = body.act;
    const fighting = pose.mode === "fight";
    const { fwd, left } = frameOf(pose.yaw);
    const otherSide: Side = side === "a" ? "b" : "a";
    const opp = bodies[otherSide];
    const oppFrame = frameOf(opp.pose.yaw);
    const head = anchorWorld(rig, body.anchors.headAfter);
    const sideVec = (hand: "L" | "R") => left.clone().multiplyScalar(hand === "L" ? 1 : -1);
    let ikWeight = fighting ? 1 : 0;
    if (pose.mode === "walk") ikWeight = 0.55;
    if (pose.mode === "rising") ikWeight = smooth((pose.modeTime - 1.4) / 0.8) * (1 - fallShape(pose).limp);
    if (pose.mode === "down") ikWeight = 0;
    if (pose.mode === "stand") ikWeight = pose.raised ? 1 : 0.4;

    const punching = punchOf(side) ? punchingHand(body.lead, punchOf(side)!.hand) : null;
    const blockArrival = a.recoil
      ? arrivalSign(opp.pose.yaw, pose.yaw, punchingHand(opp.lead, a.recoil.hand) === "R")
      : null;
    const blockHand = blockArrival === null ? null : blockArrival === 1 ? "L" : "R";

    for (const hand of ["L", "R"] as const) {
      if (hand === punching) continue; // already solved onto the punch
      const isLead = hand === body.lead;
      let target = head.clone()
        .addScaledVector(fwd, isLead ? 0.3 : 0.2)
        .addScaledVector(sideVec(hand), isLead ? 0.07 : 0.11)
        .addScaledVector(UP, (isLead ? -0.06 : -0.1) - 0.32 * body.handsDrop);
      if (a.guarding) {
        target = head.clone().addScaledVector(fwd, 0.2).addScaledVector(sideVec(hand), 0.075).addScaledVector(UP, 0.02);
      }
      let pole = rig.world(hand === "L" ? "upperL" : "upperR").addScaledVector(UP, -0.6).addScaledVector(sideVec(hand), 0.35).addScaledVector(fwd, -0.1);
      if (fighting && a.clinch) {
        const oppBody = anchorWorld(opp.rig, opp.anchors.abdomen);
        target = oppBody.clone().addScaledVector(oppFrame.fwd, -0.1).addScaledVector(sideVec(hand), 0.16).addScaledVector(UP, 0.12);
      } else if (fighting && blockHand === hand) {
        const arrival = blockArrival ?? 1;
        const point = contactWorld(rig, pose.yaw, body.anchors, "guard", arrival, "head");
        const kick = (a.recoil?.amount ?? 0) * 0.07;
        const guardPoint = point.addScaledVector(fwd, -kick);
        solveGlove(rig, hand, guardPoint, pole, ikWeight);
        continue;
      } else if (pose.raised) {
        target = rig.world(hand === "L" ? "upperL" : "upperR").addScaledVector(UP, 0.9).addScaledVector(sideVec(hand), 0.22).addScaledVector(fwd, 0.04);
        pole = rig.world(hand === "L" ? "upperL" : "upperR").addScaledVector(sideVec(hand), 0.5).addScaledVector(fwd, -0.3);
        if (hand !== (side === "a" ? "L" : "R")) target = head.clone().addScaledVector(UP, -0.35);
      }
      const upper = hand === "L" ? rig.bones.upperL : rig.bones.upperR;
      const lower = hand === "L" ? rig.bones.lowerL : rig.bones.lowerR;
      const fist = hand === "L" ? rig.bones.fistL : rig.bones.fistR;
      solveTwoBone(upper, lower, fist, target, pole, ikWeight);
    }
  }

  const seg = segmentAt(tl, T);
  const impact = hardImpactAt(seg, T);
  for (const side of ["a", "b"] as const) {
    const mine = impact && impact.attacker === side ? impact : null;
    const hand = mine && act[side].punch ? punchingHand(lead[side], act[side].punch!.hand) : null;
    paintFlash(rigs[side], hand, mine ? flashIntensity(mine.age, mine.damage) : 0);
  }

  const sweat: PoseSample["sweat"] = [];
  if (impact) {
    const defender: Side = impact.attacker === "a" ? "b" : "a";
    const body = bodies[defender];
    const origin = impact.target === "body" ? anchorWorld(body.rig, body.anchors.abdomen) : anchorWorld(body.rig, body.anchors.headAfter);
    const { fwd, left } = frameOf(body.pose.yaw);
    for (const drop of sweatDrops(impact.age, impact.damage)) {
      const p = origin.clone().addScaledVector(left, drop.x).addScaledVector(UP, drop.y).addScaledVector(fwd, drop.z);
      sweat.push({ x: p.x, y: p.y, z: p.z, s: drop.s });
    }
  }

  return { contacts, sweat };
}
