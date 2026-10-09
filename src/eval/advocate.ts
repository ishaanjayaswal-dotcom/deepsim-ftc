/**
 * Simulation Advocate — deterministic rule-checking "AI" that grades a compiled path
 * on legality, efficiency, scoring yield and defensive vulnerability.
 * Pure functions: same path + same opponent ⇒ same report.
 */
import {
  FIELD,
  SAMPLE_SPAWNS,
  SPECIMEN_SPAWNS,
  STATIC_OBSTACLES,
  type Rect,
  type Vec2,
} from "../config/field";
import { AUTO_SECONDS, POINTS, type RobotParams } from "../config/robot";
import { deg2rad } from "../path/bezier";
import { poseAtTime, turnTime } from "../path/compile";
import type { CompiledPath, TrajSample } from "../path/types";
import { basketShot, chamberCheck, intakeAccepts, intakeGeometry, parkCheck, type ElementKind } from "../lib/rules";
import { obbCorners, obbObbDistance, obbObbOverlap, obbRectDistance, obbRectOverlap, outOfBounds, robotOBB } from "./geometry";

export type FindingLevel = "pass" | "info" | "warn" | "fail";
export type Finding = { level: FindingLevel; text: string; at?: Vec2; t?: number };
export type MetricId = "legality" | "efficiency" | "yield" | "defense";

export type Metric = {
  id: MetricId;
  label: string;
  score: number; // 0..100
  value: string; // headline number
  headline: string;
  findings: Finding[];
};

export type Marker = { x: number; y: number; kind: "collision" | "oob" | "miss" | "score" | "conflict"; label: string };

export type ScoringEvent = { t: number; label: string; points: number; probability: number; ok: boolean };

export type Evaluation = {
  overall: number;
  grade: string;
  summary: string;
  metrics: Record<MetricId, Metric>;
  markers: Marker[];
  scoring: { expected: number; ceiling: number; events: ScoringEvent[] };
  durations: { total: number; driving: number; actions: number; waits: number };
};

const WEIGHTS: Record<MetricId, number> = { legality: 0.3, efficiency: 0.2, yield: 0.3, defense: 0.2 };
const YIELD_BENCHMARK = 43; // five high-basket samples + park — a world-class auto
const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const fmt = (v: number, d = 1) => v.toFixed(d);

export function gradeFor(score: number) {
  if (score >= 93) return "A+";
  if (score >= 85) return "A";
  if (score >= 77) return "B";
  if (score >= 68) return "C";
  if (score >= 58) return "D";
  return "F";
}

/* ----------------------------- Legality ----------------------------- */

function legality(path: CompiledPath, robot: RobotParams, markers: Marker[]): Metric {
  const findings: Finding[] = [];
  let score = 100;
  type Interval = { kind: "oob" | "obstacle"; label: string; depth: number; at: TrajSample; seg: number };
  const intervals: Interval[] = [];
  const open = new Map<string, Interval>();

  const check = (p: TrajSample) => {
    const obb = robotOBB(p.x, p.y, p.heading, robot.length, robot.width);
    const hits = new Map<string, { label: string; depth: number }>();
    const oob = outOfBounds(obb, FIELD);
    if (oob > 0.25) hits.set("oob", { label: "field perimeter", depth: oob });
    for (const o of STATIC_OBSTACLES) {
      const d = obbRectOverlap(obb, o.rect);
      if (d > 0.25) hits.set(o.id, { label: o.label, depth: d });
    }
    for (const [key, iv] of open) {
      if (!hits.has(key)) {
        intervals.push(iv);
        open.delete(key);
      }
    }
    for (const [key, h] of hits) {
      const cur = open.get(key);
      if (!cur) open.set(key, { kind: key === "oob" ? "oob" : "obstacle", label: h.label, depth: h.depth, at: p, seg: p.seg });
      else if (h.depth > cur.depth) Object.assign(cur, { depth: h.depth, at: p, seg: p.seg });
    }
  };
  path.samples.forEach(check);
  intervals.push(...open.values());

  for (const iv of intervals) {
    const where = `segment ${iv.seg + 1} near (${fmt(iv.at.x, 0)}, ${fmt(iv.at.y, 0)})`;
    if (iv.kind === "oob") {
      score -= Math.min(30, 14 + iv.depth * 2);
      findings.push({ level: "fail", text: `Chassis leaves the field by ${fmt(iv.depth)} in on ${where}.`, at: iv.at });
      markers.push({ x: iv.at.x, y: iv.at.y, kind: "oob", label: `Out of bounds ${fmt(iv.depth)}"` });
    } else {
      score -= Math.min(35, 18 + iv.depth * 2);
      findings.push({ level: "fail", text: `Collides with ${iv.label} (${fmt(iv.depth)} in penetration) on ${where}.`, at: iv.at });
      markers.push({ x: iv.at.x, y: iv.at.y, kind: "collision", label: `${iv.label}` });
    }
  }

  // Starting configuration: robot must touch its alliance wall.
  const start = path.spec.waypoints[0];
  const sObb = robotOBB(start.x, start.y, deg2rad(start.heading), robot.length, robot.width);
  const xs = obbCorners(sObb).map((c) => c.x);
  const wallGap = path.spec.alliance === "red" ? Math.min(...xs) : FIELD - Math.max(...xs);
  if (wallGap > 1) {
    score -= 6;
    findings.push({ level: "warn", text: `Start pose is ${fmt(wallGap)} in off the ${path.spec.alliance} alliance wall — robots must start touching it.` });
  } else {
    findings.push({ level: "pass", text: `Start pose touches the ${path.spec.alliance} alliance wall.` });
  }

  if (path.duration > AUTO_SECONDS) {
    score -= 20;
    findings.push({ level: "fail", text: `Runs ${fmt(path.duration)} s — ${fmt(path.duration - AUTO_SECONDS)} s past the 30 s autonomous period. Late actions score nothing.` });
  } else {
    findings.push({ level: "pass", text: `Finishes in ${fmt(path.duration)} s with ${fmt(AUTO_SECONDS - path.duration)} s of margin.` });
  }

  if (!intervals.length) findings.unshift({ level: "pass", text: "Chassis footprint stays in bounds and clear of all structures for the whole path." });

  const violations = intervals.length;
  return {
    id: "legality",
    label: "Legality Check",
    score: clamp100(score),
    value: violations ? `${violations} issue${violations > 1 ? "s" : ""}` : "Clean",
    headline: violations
      ? `${violations} footprint violation${violations > 1 ? "s" : ""} — the robot would hit structure or leave the field.`
      : path.duration > AUTO_SECONDS
        ? "Geometry is clean, but the routine overruns autonomous."
        : "No structure contact, no perimeter breach, inside 30 s.",
    findings,
  };
}

/* ----------------------------- Efficiency ----------------------------- */

function trapezoidTime(d: number, vmax: number, a: number) {
  if (d <= 0) return 0;
  const dAcc = (vmax * vmax) / a; // accel + decel distance
  return d >= dAcc ? d / vmax + vmax / a : 2 * Math.sqrt(d / a);
}

function efficiency(path: CompiledPath, robot: RobotParams) {
  const findings: Finding[] = [];
  const hwSpeed = robot.freeSpeed * 0.92;
  const tractionAccel = robot.mu * 386.1; // in/s^2
  const hwAccel = Math.min(robot.stallAccel, tractionAccel);
  let theory = 0;
  let driving = 0;
  let actions = 0;
  let waits = 0;
  let detourWorst = { ratio: 1, chain: -1 };
  let curvatureDist = 0;
  let decelDist = 0;
  let peak = 0;

  for (const c of path.chains) {
    const a = c.samples[0];
    const b = c.samples[c.samples.length - 1];
    const straight = Math.hypot(b.x - a.x, b.y - a.y);
    const dh = Math.abs(deg2rad(path.segments[c.segTo].to.heading) - deg2rad(path.segments[c.segFrom].from.heading));
    theory += Math.max(trapezoidTime(straight, hwSpeed, hwAccel), turnTime(Math.min(dh, 2 * Math.PI - dh), robot.maxAngularAccel * 0.6, robot.maxAngularAccel));
    driving += c.duration;
    const acts = c.actions.reduce((x, y) => x + y.duration, 0);
    actions += acts;
    const dwell = c.endTime - c.startTime - c.duration - acts;
    waits += Math.max(0, dwell);
    if (straight > 6 && c.length / straight > detourWorst.ratio) detourWorst = { ratio: c.length / straight, chain: c.index };
    for (let i = 1; i < c.samples.length; i++) {
      const ds = c.samples[i].s - c.samples[i - 1].s;
      if (c.samples[i].limit === "curvature" || c.samples[i].limit === "angular") curvatureDist += ds;
      if (c.samples[i].limit === "decel") decelDist += ds;
      peak = Math.max(peak, c.samples[i].v);
    }
    const w = path.spec.waypoints[c.segTo + 1];
    if (!w.action && !(w.wait ?? 0) && w.stop && c.segTo + 1 < path.spec.waypoints.length - 1) {
      findings.push({ level: "info", text: `Waypoint ${c.segTo + 1} forces a full stop with no action — let the chain flow through to save ~${fmt(Math.max(0.3, c.duration * 0.12))} s.` });
    }
  }
  theory += actions + waits;
  const ratio = theory / Math.max(path.duration, 1e-6);
  const score = clamp100((ratio / 0.85) * 100);

  const total = Math.max(path.duration, 1e-6);
  findings.unshift({
    level: ratio > 0.75 ? "pass" : ratio > 0.55 ? "info" : "warn",
    text: `${fmt(path.duration)} s planned vs ${fmt(theory)} s theoretical at ${fmt(hwSpeed, 0)} in/s hardware max — ${fmt(ratio * 100, 0)}% of ideal.`,
  });
  findings.push({
    level: "info",
    text: `Time split: driving ${fmt((driving / total) * 100, 0)}%, mechanisms ${fmt((actions / total) * 100, 0)}%, dwell ${fmt((waits / total) * 100, 0)}%. Peak speed ${fmt(peak, 0)} in/s.`,
  });
  if (path.totalLength > 0 && curvatureDist / path.totalLength > 0.2) {
    findings.push({ level: "warn", text: `${fmt((curvatureDist / path.totalLength) * 100, 0)}% of the distance is speed-capped by curvature or heading rate — open up tight Bezier control points.` });
  }
  if (detourWorst.chain >= 0 && detourWorst.ratio > 1.25) {
    findings.push({ level: "warn", text: `Chain ${detourWorst.chain + 1} travels ${fmt(detourWorst.ratio, 2)}× the straight-line distance.` });
  }
  if (path.totalLength > 0 && decelDist / path.totalLength > 0.35) {
    findings.push({ level: "info", text: `${fmt((decelDist / path.totalLength) * 100, 0)}% of travel is braking — a higher maxDecel helps, if traction allows.` });
  }

  // Physics hazards: profile demands more than the tiles can give.
  const c = path.spec.constraints;
  if (c.maxDecel > tractionAccel * 0.9) {
    findings.push({ level: "warn", text: `maxDecel ${fmt(c.maxDecel, 0)} in/s² exceeds ~${fmt(tractionAccel * 0.9, 0)} in/s² of available traction (μ=${robot.mu}) — expect wheel slip and end-point overshoot.` });
  }
  if (c.lateralAccel > tractionAccel * 0.85) {
    findings.push({ level: "warn", text: `lateralAccel ${fmt(c.lateralAccel, 0)} in/s² is near the friction limit — the robot will slide wide on curves.` });
  }
  if (c.maxVel > hwSpeed) {
    findings.push({ level: "warn", text: `maxVel ${fmt(c.maxVel, 0)} in/s is above the drivetrain's ~${fmt(hwSpeed, 0)} in/s — the follower will lag the profile.` });
  }

  const metric: Metric = {
    id: "efficiency",
    label: "Efficiency Rating",
    score,
    value: `${fmt(ratio * 100, 0)}%`,
    headline: ratio > 0.75 ? "Tight routine — close to what the drivetrain can physically do." : ratio > 0.55 ? "Reasonable pace with room to trim." : "Slow relative to the hardware's limits.",
    findings,
  };
  return { metric, durations: { total: path.duration, driving, actions, waits } };
}

/* ----------------------------- Scoring yield ----------------------------- */

type PoolEl = { kind: ElementKind; x: number; y: number; color: "yellow" | "red" | "blue"; taken: boolean };

function scoringYield(path: CompiledPath, robot: RobotParams, markers: Marker[]) {
  const findings: Finding[] = [];
  const events: ScoringEvent[] = [];
  const alliance = path.spec.alliance;
  const pool: PoolEl[] = [
    ...SAMPLE_SPAWNS.map((s) => ({ kind: "sample" as const, x: s.x, y: s.y, color: s.color, taken: false })),
    ...SPECIMEN_SPAWNS.map((s) => ({ kind: "specimen" as const, x: s.x, y: s.y, color: s.alliance, taken: false })),
  ];
  let holding: ElementKind | null = path.spec.preload === "none" ? null : path.spec.preload;
  let expected = 0;
  let ceiling = 0;

  for (const c of path.chains) {
    const wpIndex = c.segTo + 1;
    const w = path.spec.waypoints[wpIndex];
    const t = c.startTime + c.duration;
    const pose = { x: w.x, y: w.y, heading: deg2rad(w.heading) };
    const late = t > AUTO_SECONDS;
    for (const a of c.actions) {
      const act = a.action;
      if (act.startsWith("intake")) {
        if (holding) {
          findings.push({ level: "warn", text: `Intake at waypoint ${wpIndex} while already holding a ${holding} — one element at a time.`, t, at: pose });
          continue;
        }
        let best: { el: PoolEl; d: number } | null = null;
        let nearest = Infinity;
        for (const el of pool) {
          if (el.taken || !intakeAccepts(act, el.kind, el.color, alliance)) continue;
          const g = intakeGeometry(pose, el, robot, w.extend);
          nearest = Math.min(nearest, g.dist);
          if (g.ok && (!best || g.dist < best.d)) best = { el, d: g.dist };
        }
        if (best) {
          best.el.taken = true;
          holding = best.el.kind;
          events.push({ t, label: `Intake ${best.el.color} ${best.el.kind}`, points: 0, probability: 0.97, ok: true });
        } else {
          findings.push({ level: "fail", text: `Intake at waypoint ${wpIndex} (${fmt(w.x, 0)}, ${fmt(w.y, 0)}) finds nothing in reach — nearest legal element is ${fmt(nearest, 0)} in from centre.`, t, at: pose });
          markers.push({ x: w.x, y: w.y, kind: "miss", label: "Empty intake" });
        }
      } else if (act === "score_high" || act === "score_low") {
        const level = act === "score_high" ? "high" : "low";
        const pts = level === "high" ? POINTS.highBasket : POINTS.lowBasket;
        if (holding !== "sample") {
          findings.push({ level: "fail", text: `${act} at waypoint ${wpIndex} but the robot holds ${holding ? "a specimen" : "nothing"}.`, t, at: pose });
          markers.push({ x: w.x, y: w.y, kind: "miss", label: "Nothing to score" });
          continue;
        }
        holding = null;
        const shot = basketShot(pose, alliance, level, robot);
        const p = late ? 0 : shot.probability;
        ceiling += late ? 0 : pts;
        expected += pts * p;
        events.push({ t, label: `${level === "high" ? "High" : "Low"} basket`, points: pts, probability: p, ok: p > 0.5 });
        if (!shot.inReach) {
          findings.push({ level: "warn", text: `Basket dump at waypoint ${wpIndex} is ${fmt(shot.distance)} in from the ${level} basket (reliable ≤ ${robot.scoreReach} in) — ${fmt(shot.probability * 100, 0)}% make rate.`, t, at: pose });
          markers.push({ x: w.x, y: w.y, kind: "miss", label: `${fmt(shot.probability * 100, 0)}% shot` });
        } else markers.push({ x: w.x, y: w.y, kind: "score", label: `+${pts}` });
        if (late) findings.push({ level: "fail", text: `${level} basket at ${fmt(t)} s lands after autonomous ends.`, t });
      } else if (act === "specimen_high" || act === "specimen_low") {
        const pts = act === "specimen_high" ? POINTS.highChamber : POINTS.lowChamber;
        if (holding !== "specimen") {
          findings.push({ level: "fail", text: `${act} at waypoint ${wpIndex} without a specimen in the claw.`, t, at: pose });
          markers.push({ x: w.x, y: w.y, kind: "miss", label: "No specimen" });
          continue;
        }
        holding = null;
        const ch = chamberCheck(pose, alliance, robot);
        const p = late ? 0 : ch.ok ? 0.92 : 0.08;
        ceiling += late ? 0 : pts;
        expected += pts * p;
        events.push({ t, label: act === "specimen_high" ? "High chamber" : "Low chamber", points: pts, probability: p, ok: ch.ok });
        if (!ch.ok) {
          const why = !ch.inSpan ? "outside the rung span" : ch.headingErrDeg >= 40 ? `${fmt(ch.headingErrDeg, 0)}° off square` : `${fmt(ch.gap)} in from the rung`;
          findings.push({ level: "fail", text: `Specimen clip at waypoint ${wpIndex} is ${why}.`, t, at: pose });
          markers.push({ x: w.x, y: w.y, kind: "miss", label: "Clip misses" });
        } else markers.push({ x: w.x, y: w.y, kind: "score", label: `+${pts}` });
      }
    }
  }

  const endPose = poseAtTime(path, path.duration);
  const park = parkCheck(endPose, alliance, robot);
  const parkPts = park === "observation" ? POINTS.observationPark : park === "ascent" ? POINTS.ascentLevel1 : 0;
  if (park && path.duration <= AUTO_SECONDS) {
    expected += parkPts * 0.98;
    ceiling += parkPts;
    events.push({ t: path.duration, label: park === "observation" ? "Observation park" : "Level 1 ascent", points: parkPts, probability: 0.98, ok: true });
  } else {
    findings.push({ level: "info", text: "Ends without a park — the observation zone or a low-rung touch is +3." });
  }
  if (holding) findings.push({ level: "info", text: `Finishes still holding a ${holding}.` });

  const ok = events.filter((e) => e.points > 0);
  findings.unshift({
    level: expected >= 25 ? "pass" : expected >= 12 ? "info" : "warn",
    text: `Expected ${fmt(expected)} pts of a ${ceiling} pt ceiling from ${ok.length} scoring trigger${ok.length === 1 ? "" : "s"}.`,
  });
  for (const e of ok) {
    findings.push({ level: e.ok ? "pass" : "warn", text: `${fmt(e.t)} s · ${e.label} · ${e.points} pts × ${fmt(e.probability * 100, 0)}%`, t: e.t });
  }

  const metric: Metric = {
    id: "yield",
    label: "Scoring Yield",
    score: clamp100((expected / YIELD_BENCHMARK) * 100),
    value: `${fmt(expected, 0)} pts`,
    headline: expected >= 30 ? "Competitive autonomous output." : expected >= 15 ? "Solid base — add one more cycle to compete." : "Low point output for an autonomous.",
    findings,
  };
  return { metric, expected, ceiling, events };
}

/* ----------------------------- Defense ----------------------------- */

const WALLS: Rect[] = [
  { minX: -10, minY: -10, maxX: 0, maxY: FIELD + 10 },
  { minX: FIELD, minY: -10, maxX: FIELD + 10, maxY: FIELD + 10 },
  { minX: -10, minY: -10, maxX: FIELD + 10, maxY: 0 },
  { minX: -10, minY: FIELD, maxX: FIELD + 10, maxY: FIELD + 10 },
];

function defense(path: CompiledPath, opponent: CompiledPath | null, robot: RobotParams, markers: Marker[]): Metric {
  const findings: Finding[] = [];
  if (!opponent) {
    return {
      id: "defense",
      label: "Defense Vulnerability",
      score: 100,
      value: "n/a",
      headline: "No opponent loaded — enable one to stress-test this path.",
      findings: [{ level: "info", text: "Pick an opponent profile in the viewport toolbar to run the head-to-head check." }],
    };
  }
  const horizon = Math.max(path.duration, opponent.duration, AUTO_SECONDS);
  const dt = 0.05;
  let collisions = 0;
  let contested = 0;
  let minClear = Infinity;
  let minClearAt = { t: 0, x: 0, y: 0 };
  let inCollision = false;
  let pinches = 0;
  let lastPinch = -10;

  for (let t = 0; t <= horizon; t += dt) {
    const u = poseAtTime(path, t);
    const o = poseAtTime(opponent, t);
    const ub = robotOBB(u.x, u.y, u.heading, robot.length, robot.width);
    const ob = robotOBB(o.x, o.y, o.heading, robot.length, robot.width);
    const overlap = obbObbOverlap(ub, ob);
    if (overlap > 0) {
      if (!inCollision) {
        collisions++;
        findings.push({ level: "fail", text: `Physical contact with the opponent at ${fmt(t)} s near (${fmt(u.x, 0)}, ${fmt(u.y, 0)}).`, t, at: u });
        markers.push({ x: (u.x + o.x) / 2, y: (u.y + o.y) / 2, kind: "collision", label: `Contact @ ${fmt(t)}s` });
      }
      inCollision = true;
      minClear = 0;
      continue;
    }
    inCollision = false;
    const clear = obbObbDistance(ub, ob);
    if (clear < minClear) {
      minClear = clear;
      minClearAt = { t, x: u.x, y: u.y };
    }
    if (clear < 8) {
      contested += dt;
      // Pinch: opponent close while we're boxed against structure or a wall.
      const structureGap = Math.min(...STATIC_OBSTACLES.map((s) => obbRectDistance(ub, s.rect)), ...WALLS.map((w) => obbRectDistance(ub, w)));
      if (structureGap < 6 && t - lastPinch > 1.5) {
        pinches++;
        lastPinch = t;
        findings.push({ level: "warn", text: `Bottleneck at ${fmt(t)} s: pinned between the opponent (${fmt(clear)} in) and structure (${fmt(structureGap)} in).`, t, at: u });
        markers.push({ x: u.x, y: u.y, kind: "conflict", label: "Bottleneck" });
      }
    }
  }

  // Path crossings: places both robots visit within 2 s of each other.
  let crossings = 0;
  const step = 4;
  const us = path.samples.filter((_, i) => i % step === 0);
  const os = opponent.samples.filter((_, i) => i % step === 0);
  const seen: Vec2[] = [];
  for (const a of us) {
    for (const b of os) {
      if (Math.hypot(a.x - b.x, a.y - b.y) < 14 && Math.abs(a.t - b.t) < 2 && !seen.some((s) => Math.hypot(s.x - a.x, s.y - a.y) < 24)) {
        seen.push(a);
        crossings++;
        if (!findings.some((f) => f.t !== undefined && Math.abs(f.t - a.t) < 1)) {
          findings.push({ level: "warn", text: `Lanes cross near (${fmt(a.x, 0)}, ${fmt(a.y, 0)}) with only ${fmt(Math.abs(a.t - b.t))} s of separation.`, t: a.t, at: a });
          markers.push({ x: a.x, y: a.y, kind: "conflict", label: "Lane crossing" });
        }
      }
    }
  }

  const score = clamp100(100 - collisions * 35 - contested * 7 - pinches * 10 - crossings * 5);
  findings.unshift({
    level: collisions ? "fail" : contested > 0.5 ? "warn" : "pass",
    text: collisions
      ? `${collisions} contact${collisions > 1 ? "s" : ""} with "${opponent.spec.name.replace("Opponent · ", "")}"; ${fmt(contested)} s spent within 8 in.`
      : `Closest approach ${fmt(minClear === Infinity ? 999 : minClear)} in at ${fmt(minClearAt.t)} s; ${fmt(contested)} s contested.`,
  });

  return {
    id: "defense",
    label: "Defense Vulnerability",
    score,
    value: collisions ? `${collisions} hit${collisions > 1 ? "s" : ""}` : `${fmt(minClear === Infinity ? 99 : minClear, 0)}" gap`,
    headline:
      score >= 85 ? "Low exposure — the opponent never gets a clean block." : score >= 60 ? "Some contested ground; a defender could cost a cycle." : "High risk — this route runs straight into opposing traffic.",
    findings,
  };
}

/* ----------------------------- Entry ----------------------------- */

export function evaluatePath(path: CompiledPath, robot: RobotParams, opponent: CompiledPath | null): Evaluation {
  const markers: Marker[] = [];
  const leg = legality(path, robot, markers);
  const eff = efficiency(path, robot);
  const yld = scoringYield(path, robot, markers);
  const def = defense(path, opponent, robot, markers);
  const metrics = { legality: leg, efficiency: eff.metric, yield: yld.metric, defense: def };
  const overall = clamp100(
    (Object.keys(WEIGHTS) as MetricId[]).reduce((acc, k) => acc + metrics[k].score * WEIGHTS[k], 0),
  );

  const worst = (Object.values(metrics) as Metric[]).slice().sort((a, b) => a.score - b.score)[0];
  const summary = [
    `${leg.score >= 90 ? "Legal" : "Has legality issues"}, ${fmt(path.duration)} s, ~${fmt(yld.expected, 0)} expected pts.`,
    worst.score < 80 ? `Biggest lever: ${worst.label.toLowerCase()} — ${worst.headline.charAt(0).toLowerCase()}${worst.headline.slice(1)}` : "No weak dimension — ship it.",
  ].join(" ");

  return {
    overall,
    grade: gradeFor(overall),
    summary,
    metrics,
    markers,
    scoring: { expected: yld.expected, ceiling: yld.ceiling, events: yld.events },
    durations: eff.durations,
  };
}
