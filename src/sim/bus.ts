/**
 * Per-frame mutable simulation state. The physics loop writes here at 120 Hz;
 * React reads it through throttled polling (useBus) so the UI never re-renders per step.
 */
import type { RapierRigidBody } from "@react-three/rapier";
import type { Alliance, ElementColor } from "../config/field";
import type { ElementKind, ParkResult } from "../lib/rules";

export type ElementState = "free" | "held" | "flying" | "clipped" | "disabled";

export type ElementInfo = {
  id: number;
  kind: ElementKind;
  color: ElementColor;
  state: ElementState;
  /** Basket the element currently sits in (sensor-driven). */
  basket: { alliance: Alliance; level: "high" | "low" } | null;
  /** Chamber the specimen is clipped to: hive-local anchor so it rides the tilting Hive. */
  clip: { alliance: Alliance; level: "high" | "low"; local: [number, number, number] } | null;
  /** Field position, refreshed by the score keeper. */
  fx: number;
  fy: number;
  reserved?: "preload";
};

export type Telemetry = {
  x: number;
  y: number;
  heading: number; // rad
  vx: number; // in/s field
  vy: number;
  speed: number;
  omega: number; // deg/s
  cmdSpeed: number;
  /** Decaying max of recent speed — collision events arrive after the impact already stopped us. */
  peakSpeed: number;
  slip: number; // requested force / available traction
  crossTrack: number;
  headingErr: number; // deg
  chain: number;
  phase: "idle" | "follow" | "settle" | "action" | "done" | "manual";
  action: string | null;
  targetX: number;
  targetY: number;
  holding: { kind: ElementKind; color: ElementColor } | null;
};

const TRAIL = 1500;

export const bus = {
  simTime: 0,
  /** Field-frame heading of the camera's view direction, for camera-relative driving. */
  cameraYaw: 0,
  keys: new Set<string>(),
  /** Edge-triggered manual mechanism requests, consumed by the robot controller. */
  manualRequests: [] as Array<"intake" | "score_high" | "score_low" | "specimen_high" | "specimen_low" | "drop">,
  telemetry: {
    x: 0,
    y: 0,
    heading: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    omega: 0,
    cmdSpeed: 0,
    peakSpeed: 0,
    slip: 0,
    crossTrack: 0,
    headingErr: 0,
    chain: -1,
    phase: "idle",
    action: null,
    targetX: 0,
    targetY: 0,
    holding: null,
  } as Telemetry,
  opponent: { x: 0, y: 0, heading: 0, active: false },
  /** Controller internals for debugging (inertia, last commands). */
  debug: { inertia: 0, mass: 0, omegaCmd: 0, alpha: 0, torque: 0, cmdVx: 0, cmdVy: 0, ax: 0, ay: 0, vx: 0, vy: 0 },
  trail: { data: new Float32Array(TRAIL * 3), head: 0, count: 0, version: 0 },
  elements: {
    samples: [] as ElementInfo[],
    specimens: [] as ElementInfo[],
    sampleBodies: null as RapierRigidBody[] | null,
    specimenBodies: null as RapierRigidBody[] | null,
    byHandle: new Map<number, ElementInfo>(),
  },
  hive: null as RapierRigidBody | null,
  park: null as ParkResult,
  /** Last contact time per partner, to debounce collision events. */
  lastContact: new Map<string, number>(),
};

export function resetBus() {
  bus.simTime = 0;
  bus.manualRequests.length = 0;
  bus.trail.head = 0;
  bus.trail.count = 0;
  bus.trail.version++;
  bus.elements.samples = [];
  bus.elements.specimens = [];
  bus.elements.sampleBodies = null;
  bus.elements.specimenBodies = null;
  bus.elements.byHandle.clear();
  bus.hive = null;
  bus.park = null;
  bus.lastContact.clear();
  bus.opponent.active = false;
  Object.assign(bus.telemetry, { phase: "idle", action: null, chain: -1, holding: null, slip: 0, crossTrack: 0, headingErr: 0, speed: 0 });
}

export function pushTrail(x: number, y: number, slip: number) {
  const t = bus.trail;
  const i = t.head * 3;
  t.data[i] = x;
  t.data[i + 1] = y;
  t.data[i + 2] = slip;
  t.head = (t.head + 1) % TRAIL;
  t.count = Math.min(TRAIL, t.count + 1);
  t.version++;
}

export const TRAIL_CAPACITY = TRAIL;
