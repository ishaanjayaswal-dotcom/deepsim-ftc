import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { IN, fieldToWorld } from "../config/field";
import type { Marker } from "../eval/advocate";
import { deg2rad } from "../path/bezier";
import { poseAtTime } from "../path/compile";
import type { CompiledPath } from "../path/types";
import { useApp } from "../store/app";
import { TRAIL_CAPACITY, bus } from "./bus";
import { ALLIANCE_HEX } from "./fieldTexture";

const LIFT = 0.25; // inches above the floor so lines don't z-fight the tape
const SLOW = new THREE.Color("#22d3ee");
const FAST = new THREE.Color("#f59e0b");

const ACTION_COLOR: Record<string, string> = {
  intake: "#4ade80",
  intake_sample: "#4ade80",
  intake_specimen: "#4ade80",
  score_high: "#f59e0b",
  score_low: "#fbbf24",
  specimen_high: "#f472b6",
  specimen_low: "#f9a8d4",
  park: "#a78bfa",
  wait: "#94a3b8",
};

export function PlannedPath({ path }: { path: CompiledPath }) {
  const { points, colors } = useMemo(() => {
    const pts: [number, number, number][] = [];
    const cols: [number, number, number][] = [];
    const vmax = Math.max(1, path.spec.constraints.maxVel);
    const c = new THREE.Color();
    path.samples.forEach((s, i) => {
      if (i % 2 && i !== path.samples.length - 1) return;
      pts.push(fieldToWorld(s.x, s.y, LIFT));
      c.lerpColors(SLOW, FAST, Math.min(1, s.v / vmax));
      cols.push([c.r, c.g, c.b]);
    });
    return { points: pts, colors: cols };
  }, [path]);
  if (points.length < 2) return null;
  return <Line points={points} vertexColors={colors} lineWidth={3.2} transparent opacity={0.95} />;
}

export function Waypoints({ path }: { path: CompiledPath }) {
  const alliance = ALLIANCE_HEX[path.spec.alliance];
  return (
    <group>
      {path.spec.waypoints.map((w, i) => {
        const pos = fieldToWorld(w.x, w.y, LIFT + 0.05);
        const h = deg2rad(w.heading);
        const color = w.action ? ACTION_COLOR[w.action] : i === 0 ? alliance : "#e2e8f0";
        const tip = fieldToWorld(w.x + Math.cos(h) * 7, w.y + Math.sin(h) * 7, LIFT + 0.05);
        return (
          <group key={i}>
            <mesh position={pos} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[1.6 * IN, 2.3 * IN, 28]} />
              <meshBasicMaterial color={color} transparent opacity={0.95} side={THREE.DoubleSide} />
            </mesh>
            <Line points={[pos, tip]} color={color} lineWidth={2} />
            {(w.controlPoints ?? []).map((cp, ci) => {
              const prev = path.spec.waypoints[i - 1];
              const cpos = fieldToWorld(cp.x, cp.y, LIFT + 0.05);
              const anchor = ci === 0 && prev ? fieldToWorld(prev.x, prev.y, LIFT) : pos;
              return (
                <group key={ci}>
                  <mesh position={cpos} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
                    <planeGeometry args={[2.2 * IN, 2.2 * IN]} />
                    <meshBasicMaterial color="#a78bfa" side={THREE.DoubleSide} />
                  </mesh>
                  <Line points={[anchor, cpos, ...(ci === (w.controlPoints?.length ?? 1) - 1 ? [pos] : [])]} color="#a78bfa" lineWidth={1} dashed dashSize={0.03} gapSize={0.025} transparent opacity={0.7} />
                </group>
              );
            })}
            <Html position={fieldToWorld(w.x, w.y, 6)} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
              <div className="wp-chip" style={{ borderColor: color }}>
                {i === 0 ? "START" : i}
                {w.action ? <span style={{ color }}> · {w.action.replace("_", " ")}</span> : null}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

export function OpponentPath({ path }: { path: CompiledPath }) {
  const points = useMemo(() => path.samples.filter((_, i) => i % 3 === 0).map((s) => fieldToWorld(s.x, s.y, LIFT)), [path]);
  if (points.length < 2) return null;
  return <Line points={points} color={ALLIANCE_HEX[path.spec.alliance]} lineWidth={1.6} dashed dashSize={0.06} gapSize={0.05} transparent opacity={0.65} />;
}

/** Actual driven path from the ring buffer, re-read at 10 Hz. Turns amber where the wheels slipped. */
export function Trail() {
  const [state, setState] = useState<{ pts: [number, number, number][]; cols: [number, number, number][] } | null>(null);
  const lastVersion = useRef(-1);
  const acc = useRef(0);
  const simKey = useApp((s) => s.simKey);
  useEffect(() => setState(null), [simKey]);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.1) return;
    acc.current = 0;
    const t = bus.trail;
    if (t.version === lastVersion.current) return;
    lastVersion.current = t.version;
    if (t.count < 2) {
      setState(null);
      return;
    }
    const pts: [number, number, number][] = [];
    const cols: [number, number, number][] = [];
    const startIdx = (t.head - t.count + TRAIL_CAPACITY) % TRAIL_CAPACITY;
    for (let k = 0; k < t.count; k++) {
      const i = ((startIdx + k) % TRAIL_CAPACITY) * 3;
      pts.push(fieldToWorld(t.data[i], t.data[i + 1], LIFT + 0.1));
      const slip = Math.min(1, Math.max(0, (t.data[i + 2] - 0.7) / 0.4));
      cols.push([0.95, 0.97 - slip * 0.35, 1 - slip * 0.85]);
    }
    setState({ pts, cols });
  });
  if (!state) return null;
  return <Line points={state.pts} vertexColors={state.cols} lineWidth={2} transparent opacity={0.9} />;
}

/** Where the plan says the robot should be right now — the gap to the real robot is tracking error. */
export function Ghost({ path }: { path: CompiledPath }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    const { runState } = useApp.getState();
    g.current.visible = runState === "running" || runState === "paused";
    const p = poseAtTime(path, bus.simTime);
    const [x, , z] = fieldToWorld(p.x, p.y);
    g.current.position.set(x, 0, z);
    g.current.rotation.y = p.heading;
  });
  return (
    <group ref={g} visible={false}>
      <mesh position={[0, 3 * IN, 0]}>
        <boxGeometry args={[18 * IN, 6 * IN, 18 * IN]} />
        <meshBasicMaterial color="#22d3ee" wireframe transparent opacity={0.35} />
      </mesh>
      <mesh position={[9 * IN, 0.4 * IN, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1.2 * IN, 3]} />
        <meshBasicMaterial color="#22d3ee" />
      </mesh>
    </group>
  );
}

export function FollowerTarget() {
  const m = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!m.current) return;
    const t = bus.telemetry;
    m.current.visible = t.phase === "follow" || t.phase === "settle";
    m.current.position.set(...fieldToWorld(t.targetX, t.targetY, LIFT + 0.2));
  });
  return (
    <mesh ref={m} rotation-x={-Math.PI / 2} visible={false}>
      <ringGeometry args={[0.6 * IN, 1.1 * IN, 20]} />
      <meshBasicMaterial color="#f8fafc" />
    </mesh>
  );
}

const MARKER_COLOR: Record<Marker["kind"], string> = {
  collision: "#ef4444",
  oob: "#ef4444",
  miss: "#f59e0b",
  conflict: "#fb923c",
  score: "#4ade80",
};

export function EvalMarkers({ markers }: { markers: Marker[] }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.18;
    group.current?.children.forEach((c) => {
      const ring = c.children[0];
      if (ring) ring.scale.setScalar(s);
    });
  });
  return (
    <group ref={group}>
      {markers.map((m, i) => (
        <group key={i} position={fieldToWorld(m.x, m.y, LIFT + 0.3)}>
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[3 * IN, 3.8 * IN, 32]} />
            <meshBasicMaterial color={MARKER_COLOR[m.kind]} transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
          {m.kind !== "score" && (
            <Html position={[0, 10 * IN, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
              <div className="marker-chip" style={{ color: MARKER_COLOR[m.kind], borderColor: MARKER_COLOR[m.kind] }}>
                {m.label}
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}
