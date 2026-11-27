// Drives both boxers and the referee every frame from the choreography at the current fight time.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useArenaGLTF } from "./loaders";
import * as THREE from "three";
import type { BoxerBuild, Side } from "@llm-boxing-arena/engine";
import type { Timeline } from "../playback/timeline";
import { vitalsAt } from "../playback/timeline";
import type { PlaybackStore } from "../playback/store";
import { layoutAt, smooth, type Layout } from "./choreo";
import { SWEAT_COUNT } from "./impact";
import { frameOf, placeRoot, poseFightersAt } from "./pose";
import { BASE_SCALE, CharacterRig, rotateWorldAxis, solveTwoBone, type Look } from "./rig";

export const BOXER_URL = "/assets/boxer.glb";
export const BOXER_B_URL = "/assets/boxer-b.glb";
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
const loop = (t: number, d: number) => ((t % d) + d) % d;

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
  const boxerB = useArenaGLTF(BOXER_B_URL);
  const referee = useArenaGLTF(REFEREE_URL);
  const { a: buildA, b: buildB } = tl.log.builds;

  const rigs = useMemo(() => {
    const look = (side: Side, build: BoxerBuild): Look => ({ ...CORNER_COLORS[side], ...bodyFor(build) });
    return {
      a: new CharacterRig(boxer.scene, boxer.animations, look("a", buildA)),
      b: new CharacterRig(boxerB.scene, boxerB.animations, {
        ...look("b", buildB),
        colors: { Shirt: "#102a66", Pants: CORNER_COLORS.b.trunks, Belt: "#0a0a0a", Face: CORNER_COLORS.b.skin, Hair: "#1b120c" },
      }),
      ref: new CharacterRig(referee.scene, referee.animations, {
        skin: "#d9a982",
        colors: { Shirt: "#e9eef5", Pants: "#15161a", Belt: "#0a0a0a", Hair: "#2b2118" },
        boots: "#0d0d0d",
        scale: BASE_SCALE * 0.97,
      }),
    };
  }, [boxer, boxerB, referee, buildA, buildB]);

  const sweat = useMemo(() => {
    const group = new THREE.Group();
    const geo = new THREE.SphereGeometry(1, 6, 5);
    for (let i = 0; i < SWEAT_COUNT; i++) {
      const drop = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#d5e6f5", transparent: true, opacity: 0.72, roughness: 0.25 }));
      drop.castShadow = false;
      drop.visible = false;
      group.add(drop);
    }
    return group;
  }, []);

  useEffect(() => {
    for (const r of [rigs.a, rigs.b, rigs.ref]) r.root.traverse((o) => ((o as THREE.Mesh).castShadow = quality === "high"));
  }, [rigs, quality]);

  useFrame(() => {
    const T = store.T;
    const layout = layoutAt(tl, T);
    const vit = vitalsAt(tl, T);
    const lead = (build: BoxerBuild): "L" | "R" => (build.stance === "southpaw" ? "R" : "L");
    const posed = poseFightersAt(rigs, tl, T, { a: lead(buildA), b: lead(buildB) }, { a: vit.a.hurt, b: vit.b.hurt });
    driveReferee(rigs.ref, layout, { a: rigs.a, b: rigs.b }, T);
    sweat.children.forEach((child, i) => {
      const drop = posed.sweat[i];
      const mesh = child as THREE.Mesh;
      mesh.visible = !!drop && drop.s > 0.004;
      if (!drop) return;
      mesh.position.set(drop.x, drop.y, drop.z);
      mesh.scale.setScalar(drop.s);
    });
  });

  return (
    <>
      <primitive object={rigs.a.root} />
      <primitive object={rigs.b.root} />
      <primitive object={rigs.ref.root} />
      <primitive object={sweat} />
    </>
  );
}

