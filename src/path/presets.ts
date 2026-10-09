import { mirror, mirrorHeading } from "../config/field";
import { formatCompact } from "./parser";
import type { PathSpec } from "./types";

type PresetDef = { id: string; category: string; blurb: string; body: Record<string, unknown> };

export const PRESETS: PresetDef[] = [
  {
    id: "four-sample",
    category: "4 Sample Auto",
    blurb: "Preload + three yellow spike marks into the high basket, park on the low rung.",
    body: {
      name: "4 Sample Auto · Red",
      alliance: "red",
      preload: "sample",
      constraints: { maxVel: 62, maxAccel: 75, maxDecel: 65, maxAngVel: 260, lateralAccel: 90 },
      path: [
        { x: 9, y: 111, heading: 270 },
        { x: 15, y: 128, heading: 315, type: "bezier", controlPoints: [[21, 115]], action: "score_high" },
        { x: 36, y: 121, heading: 0, type: "bezier", controlPoints: [[22, 118]], action: "intake" },
        { x: 14, y: 129, heading: 315, type: "line", action: "score_high" },
        { x: 36, y: 131, heading: 0, type: "line", action: "intake" },
        { x: 14, y: 129, heading: 315, type: "line", action: "score_high" },
        { x: 34, y: 131, heading: 30, type: "line", action: "intake" },
        { x: 14, y: 129, heading: 315, type: "line", action: "score_high" },
        { x: 60, y: 104, heading: 270, type: "bezier", controlPoints: [[56, 132]], action: "park" },
      ],
    },
  },
  {
    id: "specimen-cycle",
    category: "Specimen Cycle",
    blurb: "Preloaded specimen + two human-player cycles on the high chamber, park in observation.",
    body: {
      name: "Specimen Cycle · Red",
      alliance: "red",
      preload: "specimen",
      constraints: { maxVel: 60, maxAccel: 70, maxDecel: 60, maxAngVel: 240, lateralAccel: 85 },
      path: [
        { x: 9, y: 64, heading: 0 },
        { x: 38, y: 66, heading: 0, type: "line", action: "specimen_high" },
        { x: 13, y: 15, heading: 180, type: "bezier", controlPoints: [[30, 30]], action: "intake_specimen" },
        { x: 38, y: 70, heading: 0, type: "bezier", controlPoints: [[22, 52]], action: "specimen_high" },
        { x: 13, y: 21, heading: 180, type: "bezier", controlPoints: [[30, 34]], action: "intake_specimen" },
        { x: 38, y: 74, heading: 0, type: "bezier", controlPoints: [[22, 56]], action: "specimen_high" },
        { x: 11, y: 12, heading: 180, type: "bezier", controlPoints: [[30, 24]], action: "park" },
      ],
    },
  },
  {
    id: "hive-raid",
    category: "Submersible Cycle",
    blurb: "Score the preload, then extend into the Hive twice for colour-sorted samples.",
    body: {
      name: "Hive Raid · Red",
      alliance: "red",
      preload: "sample",
      constraints: { maxVel: 64, maxAccel: 80, maxDecel: 70, maxAngVel: 270, lateralAccel: 95 },
      path: [
        { x: 9, y: 111, heading: 270 },
        { x: 15, y: 128, heading: 315, type: "bezier", controlPoints: [[21, 115]], action: "score_high" },
        { x: 42, y: 81, heading: 0, type: "bezier", controlPoints: [[30, 112], [34, 84]], action: "intake", extend: 16 },
        { x: 14, y: 129, heading: 315, type: "bezier", controlPoints: [[34, 88], [28, 118]], action: "score_high" },
        { x: 42, y: 69, heading: 0, type: "bezier", controlPoints: [[30, 112], [34, 72]], action: "intake", extend: 16 },
        { x: 14, y: 129, heading: 315, type: "bezier", controlPoints: [[34, 76], [28, 118]], action: "score_high" },
        { x: 60, y: 104, heading: 270, type: "bezier", controlPoints: [[56, 132]], action: "park" },
      ],
    },
  },
  {
    id: "stress",
    category: "Bezier Stress Test",
    blurb: "Aggressive decel + tight S-curves. Drop tile μ to watch it slip and overshoot.",
    body: {
      name: "S-Curve Stress Test",
      alliance: "red",
      preload: "none",
      constraints: { maxVel: 72, maxAccel: 240, maxDecel: 340, maxAngVel: 360, lateralAccel: 260 },
      path: [
        { x: 9, y: 40, heading: 0 },
        { x: 44, y: 40, heading: 90, type: "bezier", controlPoints: [[40, 14], [52, 24]], headingInterpolation: "linear" },
        { x: 36, y: 104, heading: 90, type: "bezier", controlPoints: [[20, 60], [56, 84]], headingInterpolation: "tangent", stop: true },
        { x: 36, y: 128, heading: 180, type: "line", headingInterpolation: "linear" },
      ],
    },
  },
];

export const presetSource = (id: string) => {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return formatCompact(p.body);
};

export const DEFAULT_SOURCE = presetSource("four-sample");

/* ------------------------------------------------------------------ */
/* Deterministic opponent profiles (blue alliance)                     */
/* ------------------------------------------------------------------ */

export type OpponentId = "off" | "raider" | "blocker" | "mirror";

export const OPPONENTS: { id: OpponentId; label: string; blurb: string }[] = [
  { id: "raider", label: "Submersible Raider", blurb: "Blue bot scores, then raids the Hive's north rung — contests the ascent park." },
  { id: "blocker", label: "Corridor Blocker", blurb: "Blue bot crosses into the north corridor and sits in front of the yellow spikes." },
  { id: "mirror", label: "Mirror Match", blurb: "Blue runs your exact path, rotated 180° — tests centre-line conflicts." },
  { id: "off", label: "No opponent", blurb: "Solo field." },
];

const RAIDER: PathSpec = {
  name: "Opponent · Submersible Raider",
  alliance: "blue",
  preload: "sample",
  constraints: { maxVel: 58, maxAccel: 70, maxDecel: 60, maxAngVel: 240, lateralAccel: 85 },
  waypoints: [
    { x: 135, y: 33, heading: 90 },
    { x: 130, y: 15, heading: 135, type: "line", action: "score_high" },
    { x: 86, y: 106, heading: 270, type: "bezier", controlPoints: [{ x: 112, y: 46 }, { x: 104, y: 112 }], action: "intake", extend: 12, wait: 1.5 },
    { x: 130, y: 15, heading: 135, type: "bezier", controlPoints: [{ x: 108, y: 100 }, { x: 112, y: 40 }], action: "score_high" },
    { x: 84, y: 40, heading: 90, type: "bezier", controlPoints: [{ x: 96, y: 18 }], action: "park" },
  ],
};

const BLOCKER: PathSpec = {
  name: "Opponent · Corridor Blocker",
  alliance: "blue",
  preload: "none",
  constraints: { maxVel: 66, maxAccel: 80, maxDecel: 70, maxAngVel: 260, lateralAccel: 95 },
  waypoints: [
    { x: 135, y: 111, heading: 180 },
    { x: 92, y: 120, heading: 180, type: "line" },
    { x: 62, y: 122, heading: 180, type: "bezier", controlPoints: [{ x: 78, y: 134 }], wait: 4 },
    { x: 66, y: 110, heading: 225, type: "line", wait: 6 },
    { x: 120, y: 118, heading: 0, type: "bezier", controlPoints: [{ x: 92, y: 134 }], action: "park" },
  ],
};

export function mirrorSpec(spec: PathSpec): PathSpec {
  return {
    ...spec,
    name: `Opponent · Mirror of ${spec.name}`,
    alliance: spec.alliance === "red" ? "blue" : "red",
    waypoints: spec.waypoints.map((w) => ({
      ...w,
      ...mirror(w),
      heading: mirrorHeading(w.heading),
      controlPoints: w.controlPoints?.map(mirror),
    })),
  };
}

export function opponentSpec(id: OpponentId, user: PathSpec | null): PathSpec | null {
  if (id === "raider") return RAIDER;
  if (id === "blocker") return BLOCKER;
  if (id === "mirror" && user) return mirrorSpec(user);
  return null;
}
