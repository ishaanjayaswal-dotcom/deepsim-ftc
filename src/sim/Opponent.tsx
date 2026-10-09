import { CuboidCollider, RigidBody, useBeforePhysicsStep, type RapierRigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import { IN, fieldToWorld } from "../config/field";
import { deg2rad } from "../path/bezier";
import { poseAtTime } from "../path/compile";
import type { CompiledPath } from "../path/types";
import { useApp } from "../store/app";
import { bus } from "./bus";
import { RobotModel, newMech } from "./RobotModel";

/**
 * Deterministic opponent: a kinematic body replaying its planned trajectory against sim time.
 * Kinematic = infinite mass, so it shoves the user's robot exactly like real defence would.
 */
export function Opponent({ path }: { path: CompiledPath }) {
  const body = useRef<RapierRigidBody>(null);
  const mech = useMemo(newMech, []);
  const start = path.spec.waypoints[0];

  useBeforePhysicsStep(() => {
    const b = body.current;
    if (!b) return;
    const t = useApp.getState().runState === "idle" ? 0 : bus.simTime;
    const p = poseAtTime(path, t);
    const [x, , z] = fieldToWorld(p.x, p.y);
    b.setNextKinematicTranslation({ x, y: 0.05 * IN, z });
    b.setNextKinematicRotation({ x: 0, y: Math.sin(p.heading / 2), z: 0, w: Math.cos(p.heading / 2) });
    mech.wheelSpin = p.v / 2;
    mech.led = p.phase === "move" ? "follow" : "idle";
    Object.assign(bus.opponent, { x: p.x, y: p.y, heading: p.heading, active: true });
  });

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      colliders={false}
      position={fieldToWorld(start.x, start.y, 0.05)}
      rotation={[0, deg2rad(start.heading), 0]}
      userData={{ kind: "opponent" }}
    >
      <CuboidCollider args={[9 * IN, 2.8 * IN, 9 * IN]} position={[0, 2.8 * IN, 0]} friction={0.2} />
      <RobotModel alliance={path.spec.alliance} team="OPP" mech={mech} />
    </RigidBody>
  );
}
