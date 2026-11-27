// Three broadcast cameras plus a replay orbit. "auto" cuts on big moments.
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { segmentAt, type Timeline } from "../playback/timeline";
import type { PlaybackStore } from "../playback/store";
import { CANVAS_Y, layoutAt, type Layout } from "./choreo";
import { cameraKick } from "./impact";

export type CameraId = "wide" | "ringside" | "shoulder";
type ShotId = CameraId | "replay" | "corner" | "raise";
export type CameraChoice = CameraId | "auto";

export function autoCamera(tl: Timeline, T: number, layout: Layout, replaying: boolean): ShotId {
  if (replaying) return "replay";
  if (layout.cornerShot) return "corner";
  const seg = segmentAt(tl, T);
  if (seg.kind === "result" && layout.ref.raise) return "raise";
  if (seg.kind === "result" || layout.knockdownSide) return "ringside";
  if (seg.kind !== "exchange") return "wide";
  return (["wide", "shoulder", "wide", "ringside", "shoulder"] as const)[seg.index % 5] as CameraId;
}

function shot(id: ShotId, layout: Layout, T: number): { pos: THREE.Vector3; look: THREE.Vector3 } {
  const f = layout.focus;
  const down = layout.knockdownSide;
  switch (id) {
    case "corner":
      return {
        pos: new THREE.Vector3(f.x * 0.05 + f.z * 0.15, CANVAS_Y + 1.15, f.z * 0.05 - f.x * 0.15),
        look: new THREE.Vector3(f.x, CANVAS_Y + 0.85, f.z),
      };
    case "ringside": {
      const a = layout.a.pos;
      const b = layout.b.pos;
      const axis = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
      let perp = new THREE.Vector2(-axis.y, axis.x);
      if (perp.y < 0) perp = perp.multiplyScalar(-1); // prefer the broadcast (+z) side...
      const dist = down ? 4.4 : 3.8;
      // ...but shoot from the side away from the referee so he doesn't block the view.
      const r = layout.ref.pos;
      const toRef = new THREE.Vector2(r.x - f.x, r.z - f.z);
      if (toRef.dot(perp) > 0.2) perp = perp.multiplyScalar(-1);
      return {
        pos: new THREE.Vector3(f.x + perp.x * dist, CANVAS_Y + (down ? 1.85 : 1.6), f.z + perp.y * dist),
        look: new THREE.Vector3(f.x, CANVAS_Y + (down ? 0.75 : 1.05), f.z),
      };
    }
    case "shoulder": {
      const a = layout.a;
      const fwd = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
      const right = new THREE.Vector3(-Math.cos(a.yaw), 0, Math.sin(a.yaw));
      const pos = new THREE.Vector3(a.pos.x, CANVAS_Y + 3.0, a.pos.z).addScaledVector(fwd, -3.0).addScaledVector(right, 1.8);
      const mid = new THREE.Vector3((a.pos.x + layout.b.pos.x * 2) / 3, CANVAS_Y + 1.05, (a.pos.z + layout.b.pos.z * 2) / 3);
      return { pos, look: mid };
    }
    case "raise": {
      // Face the referee and the winner for the hand raise.
      const r = layout.ref;
      const fwd = new THREE.Vector3(Math.sin(r.yaw), 0, Math.cos(r.yaw));
      const pos = new THREE.Vector3(r.pos.x + 0.3, CANVAS_Y + 2.0, r.pos.z).addScaledVector(fwd, 4.4);
      return { pos, look: new THREE.Vector3(r.pos.x, CANVAS_Y + 1.25, r.pos.z) };
    }
    case "replay": {
      // Elevated slow orbit around both boxers so neither blocks the lens.
      const mx = (layout.a.pos.x + layout.b.pos.x) / 2;
      const mz = (layout.a.pos.z + layout.b.pos.z) / 2;
      const ang = T * 0.3;
      return {
        pos: new THREE.Vector3(mx + Math.sin(ang) * 3.9, CANVAS_Y + 2.6, mz + Math.cos(ang) * 3.9),
        look: new THREE.Vector3(mx, CANVAS_Y + 0.75, mz),
      };
    }
    default:
      return { pos: new THREE.Vector3(f.x * 0.4, 5.6, 9.2), look: new THREE.Vector3(f.x * 0.8, CANVAS_Y + 0.9, f.z * 0.8) };
  }
}

export function CameraRig({ tl, store, choice, onCamera }: { tl: Timeline; store: PlaybackStore; choice: CameraChoice; onCamera?: (id: string) => void }) {
  const camera = useThree((s) => s.camera);
  const last = useRef<string>("");
  const look = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    const arena = (window as unknown as { __arena?: { camLock?: { pos: number[]; look: number[] } } }).__arena;
    const lock = arena?.camLock;
    if (lock) {
      camera.position.set(lock.pos[0] ?? 0, lock.pos[1] ?? 0, lock.pos[2] ?? 0);
      camera.lookAt(lock.look[0] ?? 0, lock.look[1] ?? 0, lock.look[2] ?? 0);
      return;
    }
    const layout = layoutAt(tl, store.T);
    const id: ShotId = choice === "auto" || store.replay ? autoCamera(tl, store.T, layout, !!store.replay) : choice;
    const target = shot(id, layout, store.T);
    const kick = cameraKick(segmentAt(tl, store.T), store.T);
    if (kick) {
      const from = layout[kick.attacker].pos;
      const to = layout[kick.attacker === "a" ? "b" : "a"].pos;
      const ax = to.x - from.x;
      const az = to.z - from.z;
      const len = Math.hypot(ax, az) || 1;
      const fx = ax / len;
      const fz = az / len;
      // Attacker's left of the punch line.
      const lx = fz;
      const lz = -fx;
      target.pos.x += fx * kick.forward + lx * kick.lateral;
      target.pos.y += kick.vertical;
      target.pos.z += fz * kick.forward + lz * kick.lateral;
      target.look.x += fx * kick.forward * 0.35;
      target.look.y += kick.vertical * 0.4;
      target.look.z += fz * kick.forward * 0.35;
    }
    const cut = id !== last.current;
    const k = cut ? 1 : 1 - Math.exp(-dt * (id === "replay" ? 6 : 3));
    camera.position.lerp(target.pos, k);
    look.current.lerp(target.look, cut ? 1 : 1 - Math.exp(-dt * 5));
    camera.lookAt(look.current);
    if (cut) {
      last.current = id;
      onCamera?.(id);
    }
  });
  return null;
}
