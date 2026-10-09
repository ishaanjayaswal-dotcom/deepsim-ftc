import { CapsuleCollider, CuboidCollider, InstancedRigidBodies, useBeforePhysicsStep, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { IN, SAMPLE_DIMS, SAMPLE_SPAWNS, SPECIMEN_DIMS, SPECIMEN_SPAWNS, fieldToWorld, type Alliance, type ElementColor } from "../config/field";
import { bus, type ElementInfo } from "./bus";

export const ELEMENT_HEX: Record<ElementColor, string> = { yellow: "#f5c518", red: "#e5383b", blue: "#2f6fed" };

const HIDDEN_Y = -0.6; // reserved preload bodies wait under the floor until claimed
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const VERTICAL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

function specimenGeometry() {
  const capsule = new THREE.CapsuleGeometry(SPECIMEN_DIMS.radius * IN, SPECIMEN_DIMS.halfLength * 2 * IN, 6, 14);
  capsule.rotateZ(Math.PI / 2);
  const clip = new THREE.BoxGeometry(0.9 * IN, 2.2 * SPECIMEN_DIMS.radius * IN, 2.2 * SPECIMEN_DIMS.radius * IN);
  const tint = (g: THREE.BufferGeometry, v: number) => {
    const n = g.getAttribute("position").count;
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(v), 3));
    if (g.getAttribute("uv")) g.deleteAttribute("uv");
    return g;
  };
  return mergeGeometries([tint(capsule.toNonIndexed(), 1), tint(clip.toNonIndexed(), 0.28)])!;
}

export function GameElements({ alliance, preload }: { alliance: Alliance; preload: "sample" | "specimen" | "none" }) {
  const sampleRefs = useRef<(RapierRigidBody | null)[]>(null);
  const specimenRefs = useRef<(RapierRigidBody | null)[]>(null);
  const sampleMesh = useRef<THREE.InstancedMesh>(null);
  const specimenMesh = useRef<THREE.InstancedMesh>(null);

  const sampleGeo = useMemo(() => new RoundedBoxGeometry(SAMPLE_DIMS.l * IN, SAMPLE_DIMS.h * IN, SAMPLE_DIMS.w * IN, 2, 0.18 * IN), []);
  const specimenGeo = useMemo(specimenGeometry, []);

  const sampleDefs = useMemo(
    () => [
      ...SAMPLE_SPAWNS.map((s) => ({ ...s, reserved: false })),
      { x: 72, y: 72, rot: 0, color: "yellow" as ElementColor, zone: "preload", reserved: true },
    ],
    [],
  );
  const specimenDefs = useMemo(
    () => [
      ...SPECIMEN_SPAWNS.map((s) => ({ ...s, color: s.alliance as ElementColor, reserved: false })),
      { x: 72, y: 72, rot: 0, alliance, color: alliance as ElementColor, zone: "preload", reserved: true },
    ],
    [alliance],
  );

  const sampleInstances = useMemo(
    () =>
      sampleDefs.map((s, i) => {
        const [x, y, z] = fieldToWorld(s.x, s.y, SAMPLE_DIMS.h / 2 + 0.02);
        return { key: `s${i}`, userData: { kind: "element" }, position: [x, s.reserved ? HIDDEN_Y : y, z] as [number, number, number], rotation: [0, (s.rot * Math.PI) / 180, 0] as [number, number, number] };
      }),
    [sampleDefs],
  );
  const specimenInstances = useMemo(
    () =>
      specimenDefs.map((s, i) => {
        const [x, y, z] = fieldToWorld(s.x, s.y, SPECIMEN_DIMS.radius + 0.05);
        return { key: `p${i}`, userData: { kind: "element" }, position: [x, s.reserved ? HIDDEN_Y - 0.2 : y, z] as [number, number, number], rotation: [0, (s.rot * Math.PI) / 180, 0] as [number, number, number] };
      }),
    [specimenDefs],
  );

  useLayoutEffect(() => {
    const c = new THREE.Color();
    sampleDefs.forEach((s, i) => sampleMesh.current?.setColorAt(i, c.set(ELEMENT_HEX[s.color])));
    specimenDefs.forEach((s, i) => specimenMesh.current?.setColorAt(i, c.set(ELEMENT_HEX[s.color])));
    if (sampleMesh.current?.instanceColor) sampleMesh.current.instanceColor.needsUpdate = true;
    if (specimenMesh.current?.instanceColor) specimenMesh.current.instanceColor.needsUpdate = true;
  }, [sampleDefs, specimenDefs]);

  // Register bodies with the bus so the robot, sensors and score keeper can find them.
  useEffect(() => {
    const sBodies = (sampleRefs.current ?? []) as RapierRigidBody[];
    const pBodies = (specimenRefs.current ?? []) as RapierRigidBody[];
    const mk = (kind: ElementInfo["kind"], color: ElementColor, id: number, reserved: boolean, x: number, y: number): ElementInfo => ({
      id,
      kind,
      color,
      state: reserved ? "disabled" : "free",
      basket: null,
      clip: null,
      fx: x,
      fy: y,
      reserved: reserved ? "preload" : undefined,
    });
    const samples = sampleDefs.map((s, i) => mk("sample", s.color, i, s.reserved, s.x, s.y));
    const specimens = specimenDefs.map((s, i) => mk("specimen", s.color, i, s.reserved, s.x, s.y));
    bus.elements.samples = samples;
    bus.elements.specimens = specimens;
    bus.elements.sampleBodies = sBodies;
    bus.elements.specimenBodies = pBodies;
    bus.elements.byHandle.clear();
    sBodies.forEach((b, i) => b && bus.elements.byHandle.set(b.handle, samples[i]));
    pBodies.forEach((b, i) => b && bus.elements.byHandle.set(b.handle, specimens[i]));
    // Unused preload slots stay parked and out of the simulation.
    const lastS = sBodies[sBodies.length - 1];
    const lastP = pBodies[pBodies.length - 1];
    if (preload !== "sample") lastS?.setEnabled(false);
    if (preload !== "specimen") lastP?.setEnabled(false);
    return () => {
      bus.elements.byHandle.clear();
    };
  }, [sampleDefs, specimenDefs, preload]);

  // Clipped specimens ride the Hive's rung as it tilts.
  useBeforePhysicsStep(() => {
    const hive = bus.hive;
    const bodies = bus.elements.specimenBodies;
    if (!hive || !bodies) return;
    const t = hive.translation();
    const r = hive.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    bus.elements.specimens.forEach((el, i) => {
      if (el.state !== "clipped" || !el.clip) return;
      const b = bodies[i];
      if (!b) return;
      _v.set(...el.clip.local).applyQuaternion(_q);
      b.setNextKinematicTranslation({ x: t.x + _v.x, y: t.y + _v.y, z: t.z + _v.z });
      const q = _q.clone().multiply(VERTICAL);
      b.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    });
  });

  return (
    <>
      <InstancedRigidBodies
        ref={sampleRefs}
        instances={sampleInstances}
        colliders={false}
        ccd
        linearDamping={0.15}
        angularDamping={0.4}
        colliderNodes={[<CuboidCollider key="c" args={[(SAMPLE_DIMS.l / 2) * IN, (SAMPLE_DIMS.h / 2) * IN, (SAMPLE_DIMS.w / 2) * IN]} density={270} friction={0.7} restitution={0.08} />]}
      >
        <instancedMesh ref={sampleMesh} args={[sampleGeo, undefined, sampleInstances.length]} castShadow receiveShadow frustumCulled={false}>
          <meshStandardMaterial roughness={0.38} metalness={0.02} emissive="#111111" />
        </instancedMesh>
      </InstancedRigidBodies>

      <InstancedRigidBodies
        ref={specimenRefs}
        instances={specimenInstances}
        colliders={false}
        ccd
        linearDamping={0.2}
        angularDamping={0.5}
        colliderNodes={[
          <CapsuleCollider key="c" args={[SPECIMEN_DIMS.halfLength * IN, SPECIMEN_DIMS.radius * IN]} rotation={[0, 0, Math.PI / 2]} density={260} friction={0.6} restitution={0.05} />,
        ]}
      >
        <instancedMesh ref={specimenMesh} args={[specimenGeo, undefined, specimenInstances.length]} castShadow frustumCulled={false}>
          <meshStandardMaterial vertexColors roughness={0.35} metalness={0.05} />
        </instancedMesh>
      </InstancedRigidBodies>
    </>
  );
}
