// Ring, stools, crowd, floor, lights. All CC0 (tevy.dev ring/stool/crowd).
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useArenaGLTF } from "./loaders";
import * as THREE from "three";
import type { Timeline } from "../playback/timeline";
import { segmentAt } from "../playback/timeline";
import type { PlaybackStore } from "../playback/store";
import { CANVAS_Y, SEAT } from "./choreo";

const RING_URL = "/assets/ring.glb";
const STOOL_URL = "/assets/stool.glb";
const CROWD_URL = "/assets/crowd.glb";

function useClone(url: string, shadows: boolean) {
  const gltf = useArenaGLTF(url);
  return useMemo(() => {
    const obj = gltf.scene.clone(true);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = shadows;
        m.receiveShadow = shadows;
      }
    });
    return obj;
  }, [gltf, shadows]);
}

function Stools({ tl, store, shadows }: { tl: Timeline; store: PlaybackStore; shadows: boolean }) {
  const red = useClone(STOOL_URL, shadows);
  const blue = useClone(STOOL_URL, shadows);
  useFrame(() => {
    const seg = segmentAt(tl, store.T);
    const local = store.T - seg.start;
    const show = seg.kind === "break" && local > 2.5 && local < 10.5;
    red.visible = show;
    blue.visible = show;
  });
  const place = (o: THREE.Object3D, c: { x: number; z: number }) => {
    const back = 0.17; // stool sits just behind the seat point, under the hips of the sitting pose
    o.position.set(c.x + Math.sign(c.x) * back, CANVAS_Y, c.z + Math.sign(c.z) * back);
    o.rotation.y = Math.atan2(-c.x, -c.z);
    return o;
  };
  return (
    <>
      <primitive object={place(red, SEAT.a)} />
      <primitive object={place(blue, SEAT.b)} />
    </>
  );
}

function Crowd({ count, shadows }: { count: 2 | 4; shadows: boolean }) {
  const gltf = useArenaGLTF(CROWD_URL);
  const stands = useMemo(() => {
    const D = 11.5;
    // The +z side is where the broadcast cameras sit, so that stand is pushed back behind them.
    const spots: [number, number, number][] = [
      [0, -D, 0],
      [D, 0, -Math.PI / 2],
      [-D, 0, Math.PI / 2],
      [0, 15.5, Math.PI],
    ];
    return spots.slice(0, count).map(([x, z, ry]) => {
      const o = gltf.scene.clone(true);
      o.position.set(x, 0, z);
      o.rotation.y = ry;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = shadows;
        }
      });
      return o;
    });
  }, [gltf, count, shadows]);
  return (
    <>
      {stands.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
    </>
  );
}

export function Arena({ tl, store, quality }: { tl: Timeline; store: PlaybackStore; quality: "high" | "low" }) {
  const high = quality === "high";
  const ring = useClone(RING_URL, high);
  const spot = useMemo(() => {
    const s = new THREE.SpotLight("#fff6e8", high ? 260 : 200, 30, Math.PI / 5.5, 0.45, 1.4);
    s.position.set(0, 11, 0);
    s.target.position.set(0, CANVAS_Y, 0);
    s.castShadow = high;
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0004;
    s.shadow.camera.near = 4;
    s.shadow.camera.far = 16;
    return s;
  }, [high]);

  return (
    <>
      <color attach="background" args={["#07080c"]} />
      <fog attach="fog" args={["#07080c", 16, 42]} />
      <ambientLight intensity={0.35} />
      <hemisphereLight args={["#8fa4c8", "#1a120c", 0.55]} />
      <primitive object={spot} />
      <primitive object={spot.target} />
      <directionalLight position={[6, 9, 8]} intensity={0.9} color="#ffe2c0" />
      <directionalLight position={[-7, 7, -6]} intensity={0.5} color="#9fb7ff" />
      <primitive object={ring} />
      <Stools tl={tl} store={store} shadows={high} />
      <Crowd count={high ? 4 : 2} shadows={high} />
      {/* arena floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow={high}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#15161b" roughness={0.95} />
      </mesh>
      {/* lighting truss above the ring */}
      <group position={[0, 8.2, 0]}>
        {[-1, 1].map((s) => (
          <mesh key={`x${s}`} position={[0, 0, s * 3.4]}>
            <boxGeometry args={[7.2, 0.18, 0.18]} />
            <meshStandardMaterial color="#222" emissive="#fff3d6" emissiveIntensity={0.25} />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <mesh key={`z${s}`} position={[s * 3.5, 0, 0]}>
            <boxGeometry args={[0.18, 0.18, 7]} />
            <meshStandardMaterial color="#222" emissive="#fff3d6" emissiveIntensity={0.25} />
          </mesh>
        ))}
      </group>
    </>
  );
}

