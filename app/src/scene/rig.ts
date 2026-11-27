// A cloned, recoloured Quaternius character and the bones we drive by hand.
// Clips are sampled directly at explicit times and blended here (no AnimationMixer: its "unchanged value"
// cache would skip writes after we reset bones), so a pose is a pure function of fight time.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export const MODEL_HEIGHT = 3.13; // units, measured from the converted GLB
export const BASE_SCALE = 1.8 / MODEL_HEIGHT;

const BONE_NAMES = {
  hips: "Hips", abdomen: "Abdomen", torso: "Torso", neck: "Neck", head: "Head",
  shoulderL: "Shoulder.L", upperL: "UpperArm.L", lowerL: "LowerArm.L", fistL: "Fist.L", fistEndL: "Fist.L_end",
  shoulderR: "Shoulder.R", upperR: "UpperArm.R", lowerR: "LowerArm.R", fistR: "Fist.R", fistEndR: "Fist.R_end",
  upperLegL: "UpperLeg.L", lowerLegL: "LowerLeg.L", upperLegR: "UpperLeg.R", lowerLegR: "LowerLeg.R",
  footL: "Foot.L", footR: "Foot.R",
} as const;
export type BoneKey = keyof typeof BONE_NAMES;

export interface Look {
  skin: string;
  /** Material name -> colour overrides, e.g. { Shirt: "#fff", Pants: "#111" }. */
  colors?: Record<string, string>;
  trunks?: string;
  trim?: string;
  gloves?: string;
  boots?: string;
  /** Paint the casual shirt, pants and belt as skin so the torso reads as a bare chest. */
  bare?: boolean;
  /** Width multiplier from stats. */
  bulk?: number;
  scale?: number;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();

export class CharacterRig {
  readonly root = new THREE.Group();
  /** Pivot at hip height for knockdown falls: root -> tilt -> model. */
  readonly tilt = new THREE.Group();
  static readonly PIVOT = 0.5;
  readonly model: THREE.Object3D;
  private clips: Record<string, { duration: number; tracks: { node: THREE.Object3D; prop: "quaternion" | "position"; interp: THREE.Interpolant }[] }> = {};
  readonly bones = {} as Record<BoneKey, THREE.Bone>;
  /** Procedural glove meshes, when this look asked for them. */
  readonly gloves: Partial<Record<"L" | "R", THREE.Mesh>> = {};
  /** Length of upper arm + forearm in world metres (for IK reach). */
  armLength = 0.55;
  /** Bind pose of every bone. Reset each frame so hand-made rotations never accumulate on bones a clip doesn't animate. */
  private rest: { bone: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }[] = [];

  constructor(source: THREE.Object3D, clips: THREE.AnimationClip[], look: Look) {
    this.model = cloneSkinned(source);
    const s = look.scale ?? BASE_SCALE;
    const bulk = look.bulk ?? 1;
    this.model.scale.set(s * bulk, s, s * bulk);
    this.tilt.position.y = CharacterRig.PIVOT;
    this.model.position.y = -CharacterRig.PIVOT;
    this.tilt.add(this.model);
    this.root.add(this.tilt);

    this.model.traverse((o) => {
      const node = o as THREE.Object3D & Partial<THREE.Bone>;
      for (const [key, name] of Object.entries(BONE_NAMES)) {
        if (o.name === name || o.name === name.replace(/\./g, "")) this.bones[key as BoneKey] = node as THREE.Bone;
      }
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // skinned bounds don't follow the bones
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
          const src = m as THREE.MeshStandardMaterial;
          const cloth = src.name === "Shirt" || src.name === "Pants" || src.name === "Belt" || src.name === "Hair" || src.name === "Face";
          const skinTone = src.name === "Skin" || (look.bare && cloth);
          const color = skinTone ? look.skin : look.colors?.[src.name];
          const mat = new THREE.MeshStandardMaterial({ name: src.name, color: color ?? src.color, roughness: skinTone ? 0.6 : 0.8, metalness: 0 });
          return mat;
        });
        mesh.material = Array.isArray(mesh.material) ? mats : (mats[0] as THREE.Material);
      }
    });
    // Some exports drop the leaf "_end" joints; add a knuckle point just past each fist.
    for (const side of ["L", "R"] as const) {
      const key = `fistEnd${side}` as const;
      if (this.bones[key]) continue;
      const fist = this.bones[`fist${side}`];
      const end = new THREE.Bone();
      end.position.set(0, fist.position.length() * 0.65, 0);
      fist.add(end);
      this.bones[key] = end;
    }

    const byName = new Map<string, THREE.Object3D>();
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone || !byName.has(o.name)) byName.set(o.name, o);
    });
    for (const clip of clips) {
      const name = clip.name.split("|").pop() as string;
      const tracks: (typeof this.clips)[string]["tracks"] = [];
      for (const track of clip.tracks) {
        const dot = track.name.lastIndexOf(".");
        const node = byName.get(track.name.slice(0, dot));
        const prop = track.name.slice(dot + 1);
        if (!node || (prop !== "quaternion" && prop !== "position")) continue;
        tracks.push({ node, prop, interp: (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant() });
      }
      this.clips[name] = { duration: clip.duration, tracks };
    }

    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.rest.push({ bone: o, q: o.quaternion.clone(), p: o.position.clone() });
    });
    this.root.updateMatrixWorld(true);
    const p = (k: BoneKey) => this.bones[k].getWorldPosition(new THREE.Vector3());
    this.armLength = p("upperL").distanceTo(p("lowerL")) + p("lowerL").distanceTo(p("fistL"));
    this.dressUp(look);
  }

  /** Gloves, trunks and boots, built in world space at the bind pose and then attached to bones. */
  private dressUp(look: Look) {
    const p = (k: BoneKey) => this.bones[k].getWorldPosition(new THREE.Vector3());
    const mat = (c: string, rough = 0.5) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.05 });
    const attach = (bone: BoneKey, mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      this.root.add(mesh);
      mesh.updateMatrixWorld(true);
      this.bones[bone].attach(mesh);
    };
    const along = (mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) => {
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpV.copy(to).sub(from).normalize());
    };
    if (look.gloves) {
      for (const side of ["L", "R"] as const) {
        const fist = p(`fist${side}`);
        const end = p(`fistEnd${side}`);
        const glove = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat(look.gloves, 0.35));
        glove.name = `Glove${side}`;
        glove.scale.set(0.085, 0.11, 0.095);
        along(glove, fist, tmpV2.copy(end).sub(fist).multiplyScalar(0.9).add(fist));
        glove.scale.set(0.088, 0.105, 0.095);
        attach(`fist${side}`, glove);
        this.gloves[side] = glove;
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.07, 14), mat(look.trim ?? "#ffffff", 0.4));
        along(cuff, tmpV.copy(fist).lerp(end, -0.15), tmpV2.copy(fist).lerp(end, 0.12));
        attach(`fist${side}`, cuff);
      }
    }
    if (look.trunks) {
      const hips = p("hips");
      const legL = p("upperLegL");
      const legR = p("upperLegR");
      const waistY = (hips.y + legL.y) / 2 - 0.02;
      const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.18, 0.2, 20), mat(look.trunks, 0.55));
      waist.position.set(hips.x, waistY, hips.z);
      waist.scale.set(1, 1, 0.82);
      attach("hips", waist);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.182, 0.182, 0.045, 20), mat(look.trim ?? "#ffffff", 0.4));
      // attach() rewrites the waist mesh position into bone-local space, so the band keeps the world height.
      band.position.set(hips.x, waistY + 0.1, hips.z);
      band.scale.set(1, 1, 0.82);
      attach("hips", band);
      for (const [leg, knee, key] of [[legL, p("lowerLegL"), "upperLegL"], [legR, p("lowerLegR"), "upperLegR"]] as const) {
        const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.095, 1, 14), mat(look.trunks, 0.55));
        const end = tmpV2.copy(leg).lerp(knee, 0.55);
        along(thigh, tmpV.copy(leg).lerp(knee, -0.12), end);
        thigh.scale.y = leg.distanceTo(knee) * 0.67;
        attach(key, thigh);
      }
    }
    if (look.boots) {
      for (const side of ["L", "R"] as const) {
        const knee = p(`lowerLeg${side}`);
        const foot = p(`foot${side}`);
        const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 1, 12), mat(look.boots, 0.6));
        along(boot, tmpV.copy(knee).lerp(foot, 0.55), tmpV2.copy(knee).lerp(foot, 1.0));
        boot.scale.y = knee.distanceTo(foot) * 0.45;
        attach(`lowerLeg${side}`, boot);
      }
    }
  }

  /** Reset to the bind pose, then blend the given clips at explicit times. Weights should sum to ~1. */
  pose(clips: Record<string, { time: number; weight: number }>) {
    for (const r of this.rest) {
      r.bone.quaternion.copy(r.q);
      r.bone.position.copy(r.p);
    }
    const acc = new Map<THREE.Object3D, { q: THREE.Vector4; qw: number; p: THREE.Vector3; pw: number }>();
    for (const [name, { time, weight }] of Object.entries(clips)) {
      const clip = this.clips[name];
      if (!clip || weight <= 0) continue;
      const t = Math.max(0, Math.min(time, clip.duration - 1e-3));
      for (const tr of clip.tracks) {
        const v = tr.interp.evaluate(t);
        let a = acc.get(tr.node);
        if (!a) acc.set(tr.node, (a = { q: new THREE.Vector4(0, 0, 0, 0), qw: 0, p: new THREE.Vector3(), pw: 0 }));
        if (tr.prop === "quaternion") {
          const d = a.q.x * v[0]! + a.q.y * v[1]! + a.q.z * v[2]! + a.q.w * v[3]!;
          const w = a.qw > 0 && d < 0 ? -weight : weight;
          a.q.x += v[0]! * w;
          a.q.y += v[1]! * w;
          a.q.z += v[2]! * w;
          a.q.w += v[3]! * w;
          a.qw += weight;
        } else {
          a.p.x += v[0]! * weight;
          a.p.y += v[1]! * weight;
          a.p.z += v[2]! * weight;
          a.pw += weight;
        }
      }
    }
    for (const [node, a] of acc) {
      if (a.qw > 0) {
        const q = new THREE.Quaternion(a.q.x, a.q.y, a.q.z, a.q.w).normalize();
        if (a.qw >= 0.999) node.quaternion.copy(q);
        else node.quaternion.slerp(q, a.qw);
      }
      if (a.pw > 0) node.position.lerp(a.p.divideScalar(a.pw), Math.min(1, a.pw));
    }
  }

  /** Knockdown helper: lower the whole body and tip it backwards around the hips (radians). */
  setFall(drop: number, backward: number) {
    this.tilt.position.y = CharacterRig.PIVOT - drop;
    this.tilt.rotation.x = -backward;
  }

  clipDuration(name: string): number {
    return this.clips[name]?.duration ?? 1;
  }

  world(k: BoneKey, out = new THREE.Vector3()): THREE.Vector3 {
    return this.bones[k].getWorldPosition(out);
  }
}

// ---------------------------------------------------------------- bone helpers (world space)

/** Rotate a bone by a world-space rotation, keeping its parent. */
export function rotateWorld(bone: THREE.Object3D, rot: THREE.Quaternion) {
  const parent = bone.parent as THREE.Object3D;
  parent.updateWorldMatrix(true, false);
  const parentQ = parent.getWorldQuaternion(tmpQ);
  const boneQ = tmpQ2.copy(parentQ).multiply(bone.quaternion);
  bone.quaternion.copy(parentQ.invert().multiply(rot).multiply(boneQ));
  bone.updateMatrixWorld(true);
}

export function rotateWorldAxis(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (Math.abs(angle) < 1e-5) return;
  rotateWorld(bone, new THREE.Quaternion().setFromAxisAngle(axis, angle));
}

/** Turn `bone` so the direction to `childPos` points at `target`. */
function aim(bone: THREE.Object3D, childPos: THREE.Vector3, target: THREE.Vector3) {
  const base = bone.getWorldPosition(new THREE.Vector3());
  const from = childPos.clone().sub(base).normalize();
  const to = target.clone().sub(base).normalize();
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
  rotateWorld(bone, new THREE.Quaternion().setFromUnitVectors(from, to));
}

/**
 * Analytic two-bone IK: upper arm + forearm so the wrist reaches `target`, elbow bending toward `pole`.
 * `weight` blends from the current (clip) pose to the IK pose.
 */
export function solveTwoBone(upper: THREE.Bone, lower: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, weight = 1) {
  if (weight <= 0) return;
  const q0u = upper.quaternion.clone();
  const q0l = lower.quaternion.clone();
  upper.updateWorldMatrix(true, true);
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E = lower.getWorldPosition(new THREE.Vector3());
  const W = hand.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E);
  const b = E.distanceTo(W);
  const toT = target.clone().sub(S);
  const c = Math.max(Math.abs(a - b) + 1e-3, Math.min(toT.length(), (a + b) * 0.999));
  const dir = toT.normalize();
  const x = (a * a - b * b + c * c) / (2 * c);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const poleDir = pole.clone().sub(S);
  poleDir.sub(dir.clone().multiplyScalar(poleDir.dot(dir)));
  if (poleDir.lengthSq() < 1e-8) poleDir.set(0, -1, 0);
  poleDir.normalize();
  const elbow = S.clone().add(dir.clone().multiplyScalar(x)).add(poleDir.multiplyScalar(h));
  aim(upper, E, elbow);
  lower.updateWorldMatrix(true, true);
  const W2 = hand.getWorldPosition(new THREE.Vector3());
  aim(lower, W2, S.clone().add(dir.multiplyScalar(c)));
  if (weight < 1) {
    upper.quaternion.copy(q0u.slerp(upper.quaternion, weight));
    lower.quaternion.copy(q0l.slerp(lower.quaternion, weight));
    upper.updateMatrixWorld(true);
  }
}
