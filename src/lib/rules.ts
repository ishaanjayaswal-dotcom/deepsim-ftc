/**
 * Game-rule predicates shared by the live physics runtime and the static evaluator,
 * so "what counts as in reach" means the same thing in both places.
 */
import {
  HIVE_RECT,
  basketFor,
  chamberLine,
  observationZone,
  pointInRect,
  type Alliance,
  type ElementColor,
  type Vec2,
} from "../config/field";
import type { RobotParams } from "../config/robot";
import { wrapRad } from "../path/bezier";
import type { PathAction } from "../path/types";
import { obbRectDistance, obbRectOverlap, robotOBB } from "../eval/geometry";

export type Pose = { x: number; y: number; heading: number /* rad */ };

export function intakeGeometry(pose: Pose, el: Vec2, robot: RobotParams, extend?: number) {
  const dx = el.x - pose.x;
  const dy = el.y - pose.y;
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const forward = dx * c + dy * s;
  const lateral = -dx * s + dy * c;
  const front = robot.length / 2;
  const reach = extend ?? robot.intakeReach;
  const ok = forward >= front - 2.5 && forward <= front + reach + 2 && Math.abs(lateral) <= 7;
  return { ok, forward, lateral, dist: Math.hypot(dx, dy), beyondFront: forward - front };
}

export type ElementKind = "sample" | "specimen";

/** Colour-sorted intake: never grab the opposing alliance's elements. */
export function intakeAccepts(action: PathAction | "manual", kind: ElementKind, color: ElementColor, alliance: Alliance) {
  if (action === "intake_sample" && kind !== "sample") return false;
  if (action === "intake_specimen" && kind !== "specimen") return false;
  if (kind === "sample") return color === "yellow" || color === alliance;
  return color === alliance;
}

export function basketShot(pose: Vec2, alliance: Alliance, level: "high" | "low", robot: RobotParams) {
  const b = basketFor(alliance, level);
  const d = Math.hypot(b.x - pose.x, b.y - pose.y);
  const reach = robot.scoreReach;
  let p: number;
  if (d <= reach) p = 0.95;
  else if (d <= reach + 12) p = 0.95 - ((d - reach) / 12) * 0.75;
  else p = 0.05;
  return { basket: b, distance: d, probability: p, inReach: d <= reach };
}

export function chamberCheck(pose: Pose, alliance: Alliance, robot: RobotParams) {
  const line = chamberLine(alliance);
  const frontX = pose.x + Math.cos(pose.heading) * (robot.length / 2);
  const frontY = pose.y + Math.sin(pose.heading) * (robot.length / 2);
  const gap = alliance === "red" ? line.x - frontX : frontX - line.x;
  const inSpan = frontY >= line.minY && frontY <= line.maxY;
  const headingErr = Math.abs(wrapRad(pose.heading - (line.facing * Math.PI) / 180));
  const ok = gap >= -1.5 && gap <= 13 && inSpan && headingErr < (40 * Math.PI) / 180;
  return { ok, gap, inSpan, headingErrDeg: (headingErr * 180) / Math.PI, clipY: Math.min(line.maxY, Math.max(line.minY, frontY)), lineX: line.x };
}

export type ParkResult = "observation" | "ascent" | null;

export function parkCheck(pose: Pose, alliance: Alliance, robot: RobotParams): ParkResult {
  if (pointInRect(pose, observationZone(alliance), 1)) return "observation";
  const obb = robotOBB(pose.x, pose.y, pose.heading, robot.length, robot.width);
  if (obbRectOverlap(obb, HIVE_RECT) > 0) return null;
  const nearShortSide = (pose.y < HIVE_RECT.minY || pose.y > HIVE_RECT.maxY) && pose.x > HIVE_RECT.minX - 9 && pose.x < HIVE_RECT.maxX + 9;
  if (nearShortSide && obbRectDistance(obb, HIVE_RECT) <= 3) return "ascent";
  return null;
}
