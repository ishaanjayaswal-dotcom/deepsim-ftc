import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo } from "react";
import { FIELD, IN, WALL_HEIGHT, WALL_THICKNESS } from "../config/field";
import { makeFieldTexture } from "./fieldTexture";

const SIZE = FIELD * IN;
const H = WALL_HEIGHT * IN;
const T = WALL_THICKNESS * IN;

/** Floor + perimeter. One fixed body; meshes kept to a handful of shared materials. */
export function Field() {
  const tex = useMemo(() => makeFieldTexture(), []);
  const walls = useMemo(
    () => [
      { pos: [-(SIZE + T) / 2, H / 2, 0] as const, size: [T, H, SIZE + 2 * T] as const },
      { pos: [(SIZE + T) / 2, H / 2, 0] as const, size: [T, H, SIZE + 2 * T] as const },
      { pos: [0, H / 2, -(SIZE + T) / 2] as const, size: [SIZE, H, T] as const },
      { pos: [0, H / 2, (SIZE + T) / 2] as const, size: [SIZE, H, T] as const },
    ],
    [],
  );

  return (
    <RigidBody type="fixed" colliders={false} userData={{ kind: "field" }} friction={0.8}>
      {/* floor */}
      <CuboidCollider args={[SIZE / 2 + 0.3, 0.05, SIZE / 2 + 0.3]} position={[0, -0.05, 0]} friction={0.8} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[SIZE, SIZE]} />
        <meshStandardMaterial map={tex} roughness={0.92} metalness={0} />
      </mesh>

      {walls.map((w, i) => (
        <group key={i} position={w.pos as unknown as [number, number, number]}>
          <CuboidCollider args={[w.size[0] / 2, w.size[1] / 2, w.size[2] / 2]} friction={0.3} restitution={0.15} />
          {/* polycarbonate panel */}
          <mesh>
            <boxGeometry args={[w.size[0] * 0.4, w.size[1] * 0.86, w.size[2]]} />
            <meshPhysicalMaterial color="#cfe8ff" transparent opacity={0.1} roughness={0.05} metalness={0} depthWrite={false} />
          </mesh>
          {/* aluminium kick plate + top rail */}
          <mesh position={[0, -w.size[1] / 2 + 0.035, 0]} castShadow receiveShadow>
            <boxGeometry args={[w.size[0], 0.07, w.size[2]]} />
            <meshStandardMaterial color="#3a3f47" metalness={0.75} roughness={0.35} />
          </mesh>
          <mesh position={[0, w.size[1] / 2 - 0.012, 0]} castShadow>
            <boxGeometry args={[w.size[0] * 1.15, 0.024, w.size[2]]} />
            <meshStandardMaterial color="#9aa3ad" metalness={0.85} roughness={0.28} />
          </mesh>
        </group>
      ))}
    </RigidBody>
  );
}
