import { MotorModel } from "@dimforge/rapier3d-compat";
import {
  CuboidCollider,
  RigidBody,
  interactionGroups,
  useBeforePhysicsStep,
  useRevoluteJoint,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { HIVE, IN } from "../config/field";
import { bus } from "./bus";
import { ALLIANCE_HEX } from "./fieldTexture";

type Part = {
  pos: [number, number, number]; // inches, hive-local (x: alliance axis, y: up, z: -field y)
  size: [number, number, number];
  mat: "frame" | "red" | "blue" | "rung" | "barrier";
  mass: number;
  /** Collider bottom is lifted so the floating Hive never scrapes the floor while tilting. */
  colliderFloor?: number;
  round?: boolean;
};

const TILT_LIMIT = 0.045; // rad (~2.6°)
const HINGE_STIFFNESS = 1400; // N·m/rad
const HINGE_DAMPING = 70; // N·m·s/rad
const NO_COLLIDE = interactionGroups(15, []);

function buildParts(): Part[] {
  const d = HIVE.depth;
  const L = HIVE.length;
  const top = HIVE.topHeight;
  const parts: Part[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({ pos: [sx * (d / 2 - 1), top / 2, sz * (L / 2 - 1)], size: [2, top, 2], mat: "frame", mass: 6, colliderFloor: 1 });
    }
    // long top beam + chamber rungs on this alliance face
    parts.push({ pos: [sx * (d / 2 - 1), top - 1, 0], size: [2, 2, L - 4], mat: "frame", mass: 1.5 });
    const alliance = sx < 0 ? "red" : "blue";
    parts.push({ pos: [sx * (d / 2 + 0.2), HIVE.highChamber, 0], size: [1.2, 1.2, L - 4], mat: alliance, mass: 0.6, round: true });
    parts.push({ pos: [sx * (d / 2 + 0.2), HIVE.lowChamber, 0], size: [1.2, 1.2, L - 4], mat: alliance, mass: 0.6, round: true });
    // barrier on the long sides
    parts.push({ pos: [sx * (d / 2 - 0.25), HIVE.barrierHeight / 2, 0], size: [0.5, HIVE.barrierHeight, L - 4], mat: "barrier", mass: 1, colliderFloor: 1 });
  }
  for (const sz of [-1, 1]) {
    parts.push({ pos: [0, top - 1, sz * (L / 2 - 1)], size: [d - 4, 2, 2], mat: "frame", mass: 1.2 });
    parts.push({ pos: [0, HIVE.lowRung, sz * (L / 2 + 0.2)], size: [d - 4, 1.3, 1.3], mat: "rung", mass: 0.6, round: true });
    parts.push({ pos: [0, HIVE.barrierHeight / 2, sz * (L / 2 - 0.25)], size: [d - 4, HIVE.barrierHeight, 0.5], mat: "barrier", mass: 1, colliderFloor: 1 });
  }
  return parts;
}

export function Hive() {
  const anchor = useRef<RapierRigidBody>(null);
  const gimbal = useRef<RapierRigidBody>(null);
  const hive = useRef<RapierRigidBody>(null);
  const parts = useMemo(buildParts, []);

  const pitch = useRevoluteJoint(anchor as RefObject<RapierRigidBody>, gimbal as RefObject<RapierRigidBody>, [
    [0, 0, 0],
    [0, 0, 0],
    [1, 0, 0],
    [-TILT_LIMIT, TILT_LIMIT],
  ]);
  const roll = useRevoluteJoint(gimbal as RefObject<RapierRigidBody>, hive as RefObject<RapierRigidBody>, [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 1],
    [-TILT_LIMIT, TILT_LIMIT],
  ]);

  // Spring-loaded hinges: the Hive rocks on impact and settles back to level.
  const configured = useRef(false);
  useBeforePhysicsStep(() => {
    if (configured.current || !pitch.current || !roll.current) return;
    // Force-based so the spring has to fight the Hive's real mass (it is an inverted pendulum
    // about its floor pivot: m·g·h ≈ 170 N·m/rad, so k must clear that to self-right).
    for (const j of [pitch.current, roll.current]) {
      j.configureMotorModel(MotorModel.ForceBased);
      j.configureMotorPosition(0, HINGE_STIFFNESS, HINGE_DAMPING);
    }
    configured.current = true;
  });

  useEffect(() => {
    bus.hive = hive.current;
    return () => {
      bus.hive = null;
    };
  }, []);

  return (
    <>
      <RigidBody ref={anchor} type="fixed" colliders={false} position={[0, 0, 0]} />
      <RigidBody ref={gimbal} colliders={false} position={[0, 0, 0]} canSleep={false}>
        <CuboidCollider args={[0.05, 0.05, 0.05]} mass={3} collisionGroups={NO_COLLIDE} />
      </RigidBody>
      <RigidBody ref={hive} colliders={false} position={[0, 0, 0]} angularDamping={0.6} additionalSolverIterations={4} userData={{ kind: "hive" }} canSleep={false}>
        {parts.map((p, i) => {
          const floor = p.colliderFloor ?? 0;
          const bottom = p.pos[1] - p.size[1] / 2;
          const cBottom = Math.max(bottom, floor);
          const cTop = p.pos[1] + p.size[1] / 2;
          return (
            <group key={i}>
              <CuboidCollider
                args={[(p.size[0] / 2) * IN, ((cTop - cBottom) / 2) * IN, (p.size[2] / 2) * IN]}
                position={[p.pos[0] * IN, ((cTop + cBottom) / 2) * IN, p.pos[2] * IN]}
                mass={p.mass}
                friction={0.5}
                restitution={0.1}
              />
              <HivePart part={p} />
            </group>
          );
        })}
      </RigidBody>
    </>
  );
}

function HivePart({ part }: { part: Part }) {
  const [sx, sy, sz] = part.size.map((v) => v * IN) as [number, number, number];
  const position = part.pos.map((v) => v * IN) as [number, number, number];
  const material = (() => {
    switch (part.mat) {
      case "red":
      case "blue":
        return <meshStandardMaterial color={ALLIANCE_HEX[part.mat]} emissive={ALLIANCE_HEX[part.mat]} emissiveIntensity={0.25} metalness={0.3} roughness={0.4} />;
      case "rung":
        return <meshStandardMaterial color="#f5c518" metalness={0.35} roughness={0.4} />;
      case "barrier":
        return <meshStandardMaterial color="#1f2a36" metalness={0.2} roughness={0.6} transparent opacity={0.85} />;
      default:
        return <meshStandardMaterial color="#9aa5b1" metalness={0.85} roughness={0.32} />;
    }
  })();
  if (part.round) {
    // Rungs are tubes: cylinder along the longest axis.
    const alongX = part.size[0] > part.size[2];
    const len = alongX ? sx : sz;
    return (
      <mesh position={position} rotation={alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[sy / 2, sy / 2, len, 14]} />
        {material}
      </mesh>
    );
  }
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={[sx, sy, sz]} />
      {material}
    </mesh>
  );
}
