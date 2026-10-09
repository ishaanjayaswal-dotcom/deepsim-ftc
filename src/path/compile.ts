import { ACTION_TIME } from "../config/robot";
import { arcLengthParam, curvatureOf, deg2rad, makeBezier, wrapRad } from "./bezier";
import type { Chain, CompiledPath, HeadingMode, PathSpec, Segment, TrajSample } from "./types";

export const SAMPLE_DS = 0.5; // inches between trajectory samples

/** Waypoints that force a full stop: actions, dwell, explicit stop, and the final pose. */
const isStop = (spec: PathSpec, i: number) => {
  const w = spec.waypoints[i];
  return i === spec.waypoints.length - 1 || !!w.action || (w.wait ?? 0) > 0 || !!w.stop;
};

export function buildSegments(spec: PathSpec): Segment[] {
  const segs: Segment[] = [];
  for (let i = 1; i < spec.waypoints.length; i++) {
    const from = spec.waypoints[i - 1];
    const to = spec.waypoints[i];
    const type = to.type ?? "line";
    const points = [{ x: from.x, y: from.y }, ...(type === "bezier" ? to.controlPoints ?? [] : []), { x: to.x, y: to.y }];
    const { length } = arcLengthParam(points, 128);
    segs.push({ index: i - 1, type, from, to, points, length, headingMode: to.headingInterpolation ?? "linear" });
  }
  return segs;
}

function headingAt(mode: HeadingMode, fromDeg: number, toDeg: number, frac: number, tangent: number) {
  switch (mode) {
    case "tangent":
      return tangent;
    case "reverseTangent":
      return wrapRad(tangent + Math.PI);
    case "constant":
      return deg2rad(fromDeg);
    case "linear":
    default: {
      // Pedro-style linear interpolation along the shortest angular direction.
      const a = deg2rad(fromDeg);
      const d = wrapRad(deg2rad(toDeg) - a);
      return a + d * frac;
    }
  }
}

/** Sample one segment at uniform arc length. */
function sampleSegment(seg: Segment, sOffset: number): TrajSample[] {
  const curve = makeBezier(seg.points);
  const { length, tAt } = arcLengthParam(seg.points, 512);
  const n = Math.max(1, Math.ceil(length / SAMPLE_DS));
  const out: TrajSample[] = [];
  for (let k = 0; k <= n; k++) {
    const s = (length * k) / n;
    const e = curve(tAt(s));
    const tangent = Math.hypot(e.d1.x, e.d1.y) > 1e-9 ? Math.atan2(e.d1.y, e.d1.x) : deg2rad(seg.to.heading);
    out.push({
      x: e.p.x,
      y: e.p.y,
      tangent,
      curvature: curvatureOf(e),
      heading: headingAt(seg.headingMode, seg.from.heading, seg.to.heading, length > 0 ? s / length : 1, tangent),
      s: sOffset + s,
      v: 0,
      t: 0,
      seg: seg.index,
      limit: "max",
    });
  }
  return out;
}

/**
 * Forward/backward pass velocity profile (trapezoid with curvature + angular clamps),
 * starting and ending at rest. Mutates samples' v / limit.
 */
function profileChain(samples: TrajSample[], spec: PathSpec, segs: Segment[]) {
  const c = spec.constraints;
  const maxAngVel = deg2rad(c.maxAngVel);
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    let v = Math.min(c.maxVel, segs[p.seg].to.maxVel ?? Infinity);
    let limit: TrajSample["limit"] = "max";
    if (Math.abs(p.curvature) > 1e-6) {
      const vk = Math.sqrt(c.lateralAccel / Math.abs(p.curvature));
      if (vk < v) {
        v = vk;
        limit = "curvature";
      }
    }
    // Heading change per inch of travel must be achievable at the angular cap.
    const nb = samples[Math.min(samples.length - 1, i + 1)];
    const pb = samples[Math.max(0, i - 1)];
    const ds = nb.s - pb.s;
    if (ds > 1e-6) {
      const dh = Math.abs(wrapRad(nb.heading - pb.heading)) / ds;
      if (dh > 1e-6 && maxAngVel / dh < v) {
        v = maxAngVel / dh;
        limit = "angular";
      }
    }
    p.v = v;
    p.limit = limit;
  }
  samples[0].v = 0;
  samples[samples.length - 1].v = 0;
  for (let i = 1; i < samples.length; i++) {
    const ds = samples[i].s - samples[i - 1].s;
    const reach = Math.sqrt(samples[i - 1].v ** 2 + 2 * c.maxAccel * ds);
    if (reach < samples[i].v) {
      samples[i].v = reach;
      samples[i].limit = "accel";
    }
  }
  for (let i = samples.length - 2; i >= 0; i--) {
    const ds = samples[i + 1].s - samples[i].s;
    const reach = Math.sqrt(samples[i + 1].v ** 2 + 2 * c.maxDecel * ds);
    if (reach < samples[i].v) {
      samples[i].v = reach;
      samples[i].limit = "decel";
    }
  }
}

/** Time to rotate in place by `rad` with a trapezoidal angular profile. */
export function turnTime(rad: number, maxAngVel: number, angAccel = 12) {
  const a = Math.abs(rad);
  if (a < 1e-4) return 0;
  const tAcc = maxAngVel / angAccel;
  const dAcc = 0.5 * angAccel * tAcc * tAcc;
  return 2 * dAcc >= a ? 2 * Math.sqrt(a / angAccel) : 2 * tAcc + (a - 2 * dAcc) / maxAngVel;
}

export function compilePath(spec: PathSpec): CompiledPath {
  const segments = buildSegments(spec);
  const chains: Chain[] = [];
  const all: TrajSample[] = [];
  let time = 0;
  let segStart = 0;

  for (let si = 0; si < segments.length; si++) {
    const wpIndex = si + 1;
    if (!isStop(spec, wpIndex)) continue;

    const chainSegs = segments.slice(segStart, si + 1);
    const samples: TrajSample[] = [];
    let s = 0;
    for (const seg of chainSegs) {
      const part = sampleSegment(seg, s);
      if (samples.length) part.shift(); // shared joint sample
      samples.push(...part);
      s += seg.length;
    }
    const length = s;
    const turnOnly = length < 0.75;
    let duration: number;
    if (turnOnly) {
      const first = chainSegs[0];
      const last = chainSegs[chainSegs.length - 1];
      const dh = wrapRad(deg2rad(last.to.heading) - deg2rad(first.from.heading));
      duration = turnTime(dh, deg2rad(spec.constraints.maxAngVel));
      samples.forEach((p) => {
        p.v = 0;
        p.t = time;
      });
      samples[samples.length - 1].t = time + duration;
    } else {
      profileChain(samples, spec, segments);
      samples[0].t = time;
      for (let i = 1; i < samples.length; i++) {
        const ds = samples[i].s - samples[i - 1].s;
        const vAvg = (samples[i].v + samples[i - 1].v) / 2;
        const dt = vAvg > 1e-3 ? ds / vAvg : Math.sqrt((2 * ds) / spec.constraints.maxAccel);
        samples[i].t = samples[i - 1].t + dt;
      }
      duration = samples[samples.length - 1].t - time;
      // Residual end-of-chain heading error needs an in-place correction.
      const endH = deg2rad(segments[si].to.heading);
      const residual = Math.abs(wrapRad(endH - samples[samples.length - 1].heading));
      if (residual > 0.05) duration += turnTime(residual, deg2rad(spec.constraints.maxAngVel));
    }

    const w = spec.waypoints[wpIndex];
    const actions: Chain["actions"] = [];
    if (w.action) actions.push({ action: w.action, duration: ACTION_TIME[w.action] ?? 0.5, waypoint: wpIndex });
    const actionTime = actions.reduce((a, b) => a + b.duration, 0) + (w.wait ?? 0);

    const chain: Chain = {
      index: chains.length,
      segFrom: segStart,
      segTo: si,
      samples,
      length,
      startTime: time,
      duration,
      turnOnly,
      actions,
      endTime: time + duration + actionTime,
    };
    chains.push(chain);
    all.push(...samples);
    time = chain.endTime;
    segStart = si + 1;
  }

  return {
    spec,
    segments,
    chains,
    totalLength: segments.reduce((a, b) => a + b.length, 0),
    duration: time,
    samples: all,
  };
}

/** Pose along the planned trajectory at absolute time t (used for ghost + opponent). */
export function poseAtTime(path: CompiledPath, t: number) {
  const chains = path.chains;
  if (!chains.length) {
    const w = path.spec.waypoints[0];
    return { x: w.x, y: w.y, heading: deg2rad(w.heading), v: 0, chain: -1, phase: "done" as const };
  }
  for (const c of chains) {
    if (t > c.endTime) continue;
    const moveEnd = c.startTime + c.duration;
    const last = c.samples[c.samples.length - 1];
    if (t >= moveEnd || c.turnOnly) {
      const endHeading = deg2rad(path.segments[c.segTo].to.heading);
      if (c.turnOnly && t < moveEnd) {
        const f = c.duration > 0 ? (t - c.startTime) / c.duration : 1;
        const h0 = c.samples[0].heading;
        return { x: last.x, y: last.y, heading: h0 + wrapRad(endHeading - h0) * f, v: 0, chain: c.index, phase: "move" as const };
      }
      return { x: last.x, y: last.y, heading: endHeading, v: 0, chain: c.index, phase: "action" as const };
    }
    const ss = c.samples;
    let lo = 0;
    let hi = ss.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid].t < t) lo = mid;
      else hi = mid;
    }
    const a = ss[lo];
    const b = ss[hi];
    const f = b.t - a.t > 1e-9 ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      heading: a.heading + wrapRad(b.heading - a.heading) * f,
      v: a.v + (b.v - a.v) * f,
      chain: c.index,
      phase: "move" as const,
    };
  }
  const lc = chains[chains.length - 1];
  const last = lc.samples[lc.samples.length - 1];
  return { x: last.x, y: last.y, heading: deg2rad(path.segments[lc.segTo].to.heading), v: 0, chain: lc.index, phase: "done" as const };
}
