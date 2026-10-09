import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { IN, type Alliance } from "../config/field";
import { ALLIANCE_HEX, makePlateTexture } from "./fieldTexture";

/** Mechanism state shared between the physics controller and the visuals (inches). */
export type Mech = { extend: number; lift: number; claw: number; wheelSpin: number; led: "idle" | "follow" | "hold" | "slip" };

export const newMech = (): Mech => ({ extend: 0, lift: 0, claw: 0, wheelSpin: 0, led: "idle" });

/** Claw position in the robot frame: forward and up, inches. */
export const clawLocal = (m: Mech, length = 18) => ({ forward: length / 2 + m.extend + 0.4, up: 4.8 + m.lift });

const LED: Record<Mech["led"], string> = { idle: "#e2e8f0", follow: "#22d3ee", hold: "#4ade80", slip: "#f59e0b" };

/**
 * Stylised FTC robot built in inches (forward = +x). ~20 meshes sharing a few materials.
 * Mecanum chassis, front lift with a horizontal extension and a claw.
 */
export function RobotModel({ alliance, team, mech, ghost = false }: { alliance: Alliance; team: string; mech: Mech; ghost?: boolean }) {
  const wheels = useRef<THREE.Group[]>([]);
  const liftL = useRef<THREE.Mesh>(null);
  const liftR = useRef<THREE.Mesh>(null);
  const carriage = useRef<THREE.Group>(null);
  const ext = useRef<THREE.Group>(null);
  const fingerA = useRef<THREE.Mesh>(null);
  const fingerB = useRef<THREE.Mesh>(null);
  const led = useRef<THREE.MeshStandardMaterial>(null);

  const mats = useMemo(() => {
    const color = ALLIANCE_HEX[alliance];
    const opacity = ghost ? 0.55 : 1;
    const t = ghost;
    return {
      plate: new THREE.MeshStandardMaterial({ color: "#15181d", metalness: 0.55, roughness: 0.45, transparent: t, opacity }),
      alu: new THREE.MeshStandardMaterial({ color: "#b8c0ca", metalness: 0.9, roughness: 0.28, transparent: t, opacity }),
      dark: new THREE.MeshStandardMaterial({ color: "#2b313b", metalness: 0.6, roughness: 0.4, transparent: t, opacity }),
      rubber: new THREE.MeshStandardMaterial({ color: "#0d0e10", roughness: 0.9, transparent: t, opacity }),
      hub: new THREE.MeshStandardMaterial({ color: "#f97316", metalness: 0.2, roughness: 0.5, transparent: t, opacity }),
      claw: new THREE.MeshStandardMaterial({ color: "#e5e7eb", metalness: 0.1, roughness: 0.5, transparent: t, opacity }),
      side: new THREE.MeshStandardMaterial({ map: makePlateTexture(team, color), roughness: 0.55, metalness: 0.1, transparent: t, opacity }),
      accent: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4, transparent: t, opacity }),
    };
  }, [alliance, team, ghost]);

  useFrame((_, dt) => {
    for (const w of wheels.current) if (w) w.rotation.z -= mech.wheelSpin * dt;
    const liftH = 6 + mech.lift;
    if (liftL.current && liftR.current) {
      for (const m of [liftL.current, liftR.current]) {
        m.scale.y = liftH;
        m.position.y = 3 + liftH / 2;
      }
    }
    if (carriage.current) carriage.current.position.y = 5 + mech.lift;
    if (ext.current) ext.current.position.x = mech.extend;
    const open = 1.3 - mech.claw * 0.75;
    if (fingerA.current) fingerA.current.position.z = open;
    if (fingerB.current) fingerB.current.position.z = -open;
    if (led.current) {
      led.current.color.set(LED[mech.led]);
      led.current.emissive.set(LED[mech.led]);
    }
  });

  const wheelPos: [number, number, number][] = [
    [6, 2, 7.7],
    [6, 2, -7.7],
    [-6, 2, 7.7],
    [-6, 2, -7.7],
  ];

  return (
    <group scale={IN}>
      {/* chassis */}
      <mesh material={mats.plate} position={[0, 2.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[17, 0.8, 14]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={mats.alu} position={[0, 2.6, s * 6.6]} castShadow>
          <boxGeometry args={[17.6, 1.6, 1.1]} />
        </mesh>
      ))}
      {/* team plates on the sides */}
      {[-1, 1].map((s) => (
        <mesh key={`p${s}`} material={mats.side} position={[-1.5, 4.4, s * 8.95]} rotation-y={s > 0 ? 0 : Math.PI} castShadow>
          <planeGeometry args={[11, 3.6]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} material={mats.accent} position={[0, 2.6, s * 8.85]}>
          <boxGeometry args={[18, 0.5, 0.25]} />
        </mesh>
      ))}
      {/* mecanum wheels */}
      {wheelPos.map((p, i) => (
        <group key={i} position={p} ref={(g) => void (g && (wheels.current[i] = g))}>
          <mesh material={mats.rubber} rotation-x={Math.PI / 2} castShadow>
            <cylinderGeometry args={[2, 2, 1.4, 18]} />
          </mesh>
          <mesh material={mats.dark} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.9, 0.9, 1.5, 10]} />
          </mesh>
        </group>
      ))}
      {/* electronics */}
      <mesh material={mats.hub} position={[-4.5, 3.4, 0]} castShadow>
        <boxGeometry args={[4.4, 1.2, 3.4]} />
      </mesh>
      <mesh material={mats.dark} position={[-4.5, 3.6, 4.5]} castShadow>
        <boxGeometry args={[5, 1.6, 2.6]} />
      </mesh>
      {/* status LED */}
      <mesh position={[-7.8, 3.6, 0]}>
        <boxGeometry args={[0.6, 0.6, 6]} />
        <meshStandardMaterial ref={led} color="#e2e8f0" emissive="#e2e8f0" emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      {/* lift towers (scaled on y each frame) */}
      <mesh ref={liftL} material={mats.alu} position={[4.5, 6, 4.2]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh ref={liftR} material={mats.alu} position={[4.5, 6, -4.2]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      {/* carriage + horizontal extension + claw */}
      <group ref={carriage} position={[0, 5, 0]}>
        <mesh material={mats.dark} position={[4.5, 0, 0]} castShadow>
          <boxGeometry args={[1.4, 1.4, 9.6]} />
        </mesh>
        <group ref={ext}>
          {[-1, 1].map((s) => (
            <mesh key={s} material={mats.alu} position={[6.8, 0, s * 2.6]} castShadow>
              <boxGeometry args={[4.6, 0.7, 0.7]} />
            </mesh>
          ))}
          <mesh material={mats.accent} position={[8.6, 0, 0]} castShadow>
            <boxGeometry args={[0.6, 1.4, 6]} />
          </mesh>
          <mesh ref={fingerA} material={mats.claw} position={[9.4, -0.2, 1.3]} castShadow>
            <boxGeometry args={[1.8, 0.9, 0.35]} />
          </mesh>
          <mesh ref={fingerB} material={mats.claw} position={[9.4, -0.2, -1.3]} castShadow>
            <boxGeometry args={[1.8, 0.9, 0.35]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
