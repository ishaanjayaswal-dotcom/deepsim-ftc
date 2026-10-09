import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { fieldToWorld } from "../config/field";
import { useApp, type CameraMode } from "../store/app";
import { bus } from "./bus";

const PRESETS: Record<Exclude<CameraMode, "follow">, { pos: [number, number, number]; target: [number, number, number] }> = {
  broadcast: { pos: [-0.35, 4.1, 4.55], target: [0, -0.15, 0.3] },
  top: { pos: [0, 6.4, 0.001], target: [0, 0, 0] },
  driver: { pos: [-3.25, 1.3, 0], target: [0.35, 0, 0] },
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const _dir = new THREE.Vector3();
const _goal = new THREE.Vector3();

export function CameraRig() {
  const camera = useThree((s) => s.camera);
  const controls = useRef<OrbitControlsImpl>(null);
  const mode = useApp((s) => s.camera);
  const anim = useRef<{ fromP: THREE.Vector3; toP: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number } | null>(null);

  useEffect(() => {
    if (mode === "follow" || !controls.current) return;
    const p = PRESETS[mode];
    anim.current = {
      fromP: camera.position.clone(),
      toP: new THREE.Vector3(...p.pos),
      fromT: controls.current.target.clone(),
      toT: new THREE.Vector3(...p.target),
      t: 0,
    };
  }, [mode, camera]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt / 0.9);
      const k = ease(a.t);
      camera.position.lerpVectors(a.fromP, a.toP, k);
      c.target.lerpVectors(a.fromT, a.toT, k);
      if (a.t >= 1) anim.current = null;
    } else if (mode === "follow") {
      const t = bus.telemetry;
      const [x, , z] = fieldToWorld(t.x, t.y);
      const back = 1.45;
      _goal.set(x - Math.cos(t.heading) * back, 1.35, z + Math.sin(t.heading) * back);
      const k = 1 - Math.exp(-dt * 3.5);
      camera.position.lerp(_goal, k);
      c.target.lerp(_dir.set(x + Math.cos(t.heading) * 0.35, 0.05, z - Math.sin(t.heading) * 0.35), Math.min(1, k * 1.6));
    }
    c.update();
    camera.getWorldDirection(_dir);
    bus.cameraYaw = Math.atan2(-_dir.z, _dir.x);
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI / 2 - 0.05}
      minDistance={0.5}
      maxDistance={9}
      target={PRESETS.broadcast.target}
    />
  );
}
