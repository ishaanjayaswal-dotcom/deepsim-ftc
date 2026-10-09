/**
 * Pedro-style follower: closest-point projection onto the chain, a drive vector along
 * the tangent at the profiled speed, translational + centripetal correction, and a
 * heading PD. Outputs *desired velocities* — the physics drivetrain decides how much
 * of that the tiles will actually let it have (that is where slip and overshoot come from).
 */
import { deg2rad, wrapRad } from "./bezier";
import { SAMPLE_DS } from "./compile";
import type { Chain, CompiledPath, PathAction } from "./types";

export type FollowerOutput = {
  vx: number; // in/s, field frame
  vy: number;
  omega: number; // rad/s
  fire: { action: PathAction; extend?: number; waypoint: number } | null;
  phase: "follow" | "settle" | "action" | "done";
  crossTrack: number;
  headingErr: number; // rad
  targetX: number;
  targetY: number;
  chain: number;
  settleTimedOut?: boolean;
};

const K_TRANSLATE = 5.0; // 1/s
const K_HEADING = 7.0; // 1/s
const K_SETTLE = 4.2;
const LOOKAHEAD_IN = 4;
const SETTLE_TOL_IN = 0.8;
const SETTLE_TOL_RAD = deg2rad(2.5);
const SETTLE_TIMEOUT = 1.6;

export class Follower {
  private chainIdx = 0;
  private phase: FollowerOutput["phase"] = "follow";
  private lastIdx = 0;
  private settleT = 0;
  private actionT = 0;
  private actionQueue: Chain["actions"] = [];
  private dwell = 0;

  constructor(private path: CompiledPath, private driveTau = 0.11) {
    if (!path.chains.length) this.phase = "done";
    else if (path.chains[0].turnOnly) this.phase = "settle";
  }

  get done() {
    return this.phase === "done";
  }

  private chain() {
    return this.path.chains[this.chainIdx];
  }

  private endHeading(c: Chain) {
    return deg2rad(this.path.segments[c.segTo].to.heading);
  }

  private hold(x: number, y: number, h: number, tx: number, ty: number, th: number, maxVel: number, decel: number) {
    const ex = tx - x;
    const ey = ty - y;
    const d = Math.hypot(ex, ey);
    const cap = Math.min(maxVel, Math.sqrt(2 * decel * 0.85 * d));
    const v = Math.min(cap, K_SETTLE * d);
    const he = wrapRad(th - h);
    return { vx: d > 1e-6 ? (ex / d) * v : 0, vy: d > 1e-6 ? (ey / d) * v : 0, omega: K_HEADING * 0.8 * he, d, he };
  }

  update(x: number, y: number, h: number, speed: number, dt: number): FollowerOutput {
    const c = this.chain();
    const cons = this.path.spec.constraints;
    const maxOmega = deg2rad(cons.maxAngVel);
    const base = { fire: null, crossTrack: 0, headingErr: 0, chain: this.chainIdx } as const;

    if (this.phase === "done" || !c) {
      const lc = this.path.chains[this.path.chains.length - 1];
      if (!lc) return { ...base, vx: 0, vy: 0, omega: 0, phase: "done", targetX: x, targetY: y };
      const last = lc.samples[lc.samples.length - 1];
      const hold = this.hold(x, y, h, last.x, last.y, this.endHeading(lc), cons.maxVel, cons.maxDecel);
      return { ...base, vx: hold.vx, vy: hold.vy, omega: clampAbs(hold.omega, maxOmega), phase: "done", targetX: last.x, targetY: last.y, headingErr: hold.he };
    }

    const samples = c.samples;
    const last = samples[samples.length - 1];

    if (this.phase === "follow") {
      let best = this.lastIdx;
      let bestD = Infinity;
      const hi = Math.min(samples.length - 1, this.lastIdx + 80);
      for (let i = this.lastIdx; i <= hi; i++) {
        const d = (samples[i].x - x) ** 2 + (samples[i].y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      this.lastIdx = best;
      const p = samples[best];
      const remaining = c.length - p.s;
      if (remaining < LOOKAHEAD_IN + 2 || best >= samples.length - 2) {
        this.phase = "settle";
        this.settleT = 0;
      } else {
        const tx = Math.cos(p.tangent);
        const ty = Math.sin(p.tangent);
        const nx = -ty;
        const ny = tx;
        const ex = p.x - x;
        const ey = p.y - y;
        const cross = ex * nx + ey * ny;
        const la = samples[Math.min(samples.length - 1, best + Math.round(LOOKAHEAD_IN / SAMPLE_DS))];
        const vRef = remaining > 6 ? Math.max(la.v, 8) : la.v;
        // Centripetal lead: velocity loop lag would otherwise drift outward on curves.
        const lead = vRef * vRef * p.curvature * this.driveTau;
        let vx = tx * vRef + ex * K_TRANSLATE + nx * lead;
        let vy = ty * vRef + ey * K_TRANSLATE + ny * lead;
        const mag = Math.hypot(vx, vy);
        const cap = cons.maxVel * 1.15;
        if (mag > cap) {
          vx *= cap / mag;
          vy *= cap / mag;
        }
        const he = wrapRad(p.heading - h);
        const next = samples[Math.min(samples.length - 1, best + 1)];
        const dsh = next.s - p.s;
        const ff = dsh > 1e-6 ? (wrapRad(next.heading - p.heading) / dsh) * Math.max(speed, vRef * 0.5) : 0;
        return {
          ...base,
          vx,
          vy,
          omega: clampAbs(K_HEADING * he + ff, maxOmega),
          phase: "follow",
          crossTrack: cross,
          headingErr: he,
          targetX: la.x,
          targetY: la.y,
        };
      }
    }

    if (this.phase === "settle") {
      this.settleT += dt;
      const th = this.endHeading(c);
      const hold = this.hold(x, y, h, last.x, last.y, th, cons.maxVel, cons.maxDecel);
      const settled = hold.d < SETTLE_TOL_IN && Math.abs(hold.he) < SETTLE_TOL_RAD && speed < 3;
      const timedOut = this.settleT > SETTLE_TIMEOUT + (c.turnOnly ? c.duration : 0);
      if (settled || timedOut) {
        const w = this.path.spec.waypoints[c.segTo + 1];
        this.actionQueue = [...c.actions];
        this.dwell = w.wait ?? 0;
        this.phase = "action";
        this.actionT = 0;
        const fire = this.nextAction(w.extend);
        return { ...base, vx: hold.vx, vy: hold.vy, omega: clampAbs(hold.omega, maxOmega), fire, phase: "action", targetX: last.x, targetY: last.y, headingErr: hold.he, settleTimedOut: timedOut && !settled };
      }
      return { ...base, vx: hold.vx, vy: hold.vy, omega: clampAbs(hold.omega, maxOmega), phase: "settle", targetX: last.x, targetY: last.y, headingErr: hold.he };
    }

    // action / dwell: hold the pose while mechanisms run.
    const th = this.endHeading(c);
    const hold = this.hold(x, y, h, last.x, last.y, th, cons.maxVel, cons.maxDecel);
    this.actionT -= dt;
    let fire: FollowerOutput["fire"] = null;
    if (this.actionT <= 0) {
      const w = this.path.spec.waypoints[c.segTo + 1];
      if (this.actionQueue.length) fire = this.nextAction(w.extend);
      else if (this.dwell > 0) {
        this.actionT = this.dwell;
        this.dwell = 0;
      } else {
        this.chainIdx++;
        this.lastIdx = 0;
        const nc = this.chain();
        if (!nc) this.phase = "done";
        else this.phase = nc.turnOnly ? "settle" : "follow";
        this.settleT = 0;
      }
    }
    return { ...base, vx: hold.vx, vy: hold.vy, omega: clampAbs(hold.omega, maxOmega), fire, phase: this.phase, targetX: last.x, targetY: last.y, headingErr: hold.he };
  }

  private nextAction(extend?: number): FollowerOutput["fire"] {
    const a = this.actionQueue.shift();
    if (!a) return null;
    this.actionT = a.duration;
    return { action: a.action, extend, waypoint: a.waypoint };
  }
}

const clampAbs = (v: number, m: number) => Math.max(-m, Math.min(m, v));
