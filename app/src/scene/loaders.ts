// GLB loading. The tevy.dev models use KTX2 textures and meshopt geometry, so the GLTF loader gets a
// KTX2 loader (Basis transcoder served locally from /basis/, no CDN). Draco is off: nothing uses it.
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import type { WebGLRenderer } from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

let ktx2: KTX2Loader | null = null;
let supportedFor: WebGLRenderer | null = null;

function ktx2For(gl: WebGLRenderer): KTX2Loader {
  if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath("/basis/");
  if (supportedFor !== gl) {
    ktx2.detectSupport(gl);
    supportedFor = gl;
  }
  return ktx2;
}

export function useArenaGLTF(url: string) {
  const gl = useThree((s) => s.gl);
  return useGLTF(url, false, true, (loader) => {
    (loader as unknown as { setKTX2Loader: (l: KTX2Loader) => void }).setKTX2Loader(ktx2For(gl));
  });
}
