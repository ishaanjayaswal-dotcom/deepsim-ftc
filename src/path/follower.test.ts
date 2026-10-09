import { describe, expect, it } from "vitest";
import { DEFAULT_ROBOT, type RobotParams } from "../config/robot";
import { angularAccel, driveAccel } from "../sim/drivetrain";
import { compilePath } from "./compile";
import { Follower } from "./follower";
import { parsePath } from "./parser";
import { PRESETS, presetSource } from "./presets";

/** Point-mass rollout with the same drivetrain model the Rapier robot uses. */
function rollout(id: string, robot: RobotParams = DEFAULT_ROBOT) {
  const spec = parsePath(presetSource(id)).spec!;
  const path = compilePath(spec);
  const f = new Follower(path, robot.driveTau);
  const w0 = spec.waypoints[0];
  let x = w0.x;
  let y = w0.y;
  let h = (w0.heading * Math.PI) / 180;
  let vx = 0;
  let vy = 0;
  let om = 0;
  let slipping = false;
  let maxCross = 0;
  let slipSteps = 0;
  const fired: string[] = [];
  const dt = 1 / 120;
  let t = 0;
  for (; t < 40 && !f.done; t += dt) {
    const out = f.update(x, y, h, Math.hypot(vx, vy), dt);
    if (out.fire) fired.push(out.fire.action);
    maxCross = Math.max(maxCross, Math.abs(out.crossTrack));
    const d = driveAccel(out.vx, out.vy, vx, vy, h, robot, slipping);
    slipping = d.slipping;
    if (slipping) slipSteps++;
    vx += d.ax * dt;
    vy += d.ay * dt;
    om += angularAccel(out.omega, om, robot) * dt;
    x += vx * dt;
    y += vy * dt;
    h += om * dt;
  }
  const end = spec.waypoints[spec.waypoints.length - 1];
  return { t, planned: path.duration, fired, maxCross, slipSteps, endErr: Math.hypot(x - end.x, y - end.y), done: f.done };
}

describe("follower", () => {
  for (const p of PRESETS) {
    it(`tracks ${p.id}`, () => {
      const r = rollout(p.id);
      console.log(p.id, `t=${r.t.toFixed(1)}s planned=${r.planned.toFixed(1)}s cross=${r.maxCross.toFixed(2)}in end=${r.endErr.toFixed(2)}in slip=${r.slipSteps}`, r.fired.join(","));
      expect(r.done).toBe(true);
      expect(r.endErr).toBeLessThan(1.5);
    });
  }
  it("slips more on low-friction tiles", () => {
    const grippy = rollout("stress", { ...DEFAULT_ROBOT, mu: 1.0 });
    const icy = rollout("stress", { ...DEFAULT_ROBOT, mu: 0.4 });
    expect(icy.slipSteps).toBeGreaterThan(grippy.slipSteps);
  });
});
