import type { Alliance, Vec2 } from "../config/field";

export type SegmentType = "line" | "bezier";
export type HeadingMode = "linear" | "tangent" | "reverseTangent" | "constant";
export type PathAction =
  | "intake"
  | "intake_sample"
  | "intake_specimen"
  | "score_high"
  | "score_low"
  | "specimen_high"
  | "specimen_low"
  | "park"
  | "wait";

export const PATH_ACTIONS: PathAction[] = [
  "intake",
  "intake_sample",
  "intake_specimen",
  "score_high",
  "score_low",
  "specimen_high",
  "specimen_low",
  "park",
  "wait",
];

/** One waypoint as written by the user. The first waypoint is the start pose. */
export type Waypoint = {
  x: number;
  y: number;
  heading: number; // degrees
  type?: SegmentType;
  controlPoints?: Vec2[];
  headingInterpolation?: HeadingMode;
  maxVel?: number; // in/s clamp for the segment ending here
  action?: PathAction;
  wait?: number; // seconds to dwell after arriving
  stop?: boolean; // force a full stop here even with no action
  extend?: number; // intake/arm extension for this action, inches
};

export type Constraints = {
  maxVel: number; // in/s
  maxAccel: number; // in/s^2
  maxDecel: number; // in/s^2
  maxAngVel: number; // deg/s
  lateralAccel: number; // in/s^2 — curvature velocity clamp
};

export const DEFAULT_CONSTRAINTS: Constraints = {
  maxVel: 60,
  maxAccel: 70,
  maxDecel: 60,
  maxAngVel: 240,
  lateralAccel: 85,
};

export type Preload = "sample" | "specimen" | "none";

export type PathSpec = {
  name: string;
  alliance: Alliance;
  preload: Preload;
  constraints: Constraints;
  waypoints: Waypoint[];
};

export type ParseIssue = {
  severity: "error" | "warning";
  message: string;
  /** JSON pointer-ish location, e.g. path[2].controlPoints */
  where?: string;
  line?: number;
};

/** One arc-length sample of the compiled trajectory. */
export type TrajSample = {
  x: number;
  y: number;
  /** Target heading, radians (unwrapped within a segment). */
  heading: number;
  /** Path tangent direction, radians. */
  tangent: number;
  curvature: number;
  /** Arc length within the chain, inches. */
  s: number;
  /** Profiled velocity, in/s. */
  v: number;
  /** Time since the start of the whole trajectory, seconds. */
  t: number;
  seg: number;
  /** Which constraint bound the velocity here. */
  limit: "max" | "curvature" | "angular" | "accel" | "decel";
};

/** A chain = continuous run of segments between two full stops (Pedro "PathChain"). */
export type Chain = {
  index: number;
  segFrom: number;
  segTo: number;
  samples: TrajSample[];
  length: number;
  startTime: number;
  duration: number;
  /** In-place turn time when the chain has (near) zero length. */
  turnOnly: boolean;
  /** Actions executed at the end of this chain, in order. */
  actions: { action: PathAction; duration: number; waypoint: number }[];
  endTime: number; // includes actions + dwell
};

export type Segment = {
  index: number;
  type: SegmentType;
  from: Waypoint;
  to: Waypoint;
  points: Vec2[]; // full Bezier control polygon incl. endpoints
  length: number;
  headingMode: HeadingMode;
};

export type CompiledPath = {
  spec: PathSpec;
  segments: Segment[];
  chains: Chain[];
  totalLength: number;
  duration: number;
  /** Flattened samples for drawing / evaluation. */
  samples: TrajSample[];
};
