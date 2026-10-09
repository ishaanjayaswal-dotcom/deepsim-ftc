/**
 * Mecanum drivetrain force model (field frame, inches). Turns a velocity command into the
 * acceleration the wheels can actually deliver:
 *   1. first-order velocity loop  a = (v_cmd - v) / tau
 *   2. motor torque–speed curve   (accelerating only; braking is traction-limited)
 *   3. strafe efficiency          (lateral authority of mecanum rollers)
 *   4. traction circle            |a| <= mu * g, dropping to kinetic friction once slipping
 */
import type { RobotParams } from "../config/robot";

export const G_IN = 386.09; // in/s^2

export type DriveResult = { ax: number; ay: number; slip: number; slipping: boolean };

export function driveAccel(
  cmdVx: number,
  cmdVy: number,
  vx: number,
  vy: number,
  heading: number,
  robot: RobotParams,
  wasSlipping = false,
): DriveResult {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  // Robot-frame velocities and requests.
  const vf = vx * c + vy * s;
  const vl = -vx * s + vy * c;
  let af = ((cmdVx - vx) * c + (cmdVy - vy) * s) / robot.driveTau;
  let al = (-(cmdVx - vx) * s + (cmdVy - vy) * c) / robot.driveTau;

  const motorCap = (a: number, v: number, eff: number) => {
    const free = robot.freeSpeed * eff;
    const accelerating = Math.sign(a) === Math.sign(v) || Math.abs(v) < 1e-3;
    if (!accelerating) return Infinity; // back-EMF braking; traction is the limit
    return robot.stallAccel * eff * Math.max(0, 1 - Math.abs(v) / free);
  };
  const capF = motorCap(af, vf, 1);
  const capL = motorCap(al, vl, robot.strafeEfficiency);
  if (Math.abs(af) > capF) af = Math.sign(af) * capF;
  if (Math.abs(al) > capL) al = Math.sign(al) * capL;

  const traction = robot.mu * G_IN;
  const req = Math.hypot(af, al);
  const slip = req / traction;
  const slipping = slip > (wasSlipping ? 0.85 : 1);
  if (slipping) {
    // Sliding: kinetic friction is ~80% of static.
    const k = (traction * 0.8) / req;
    af *= k;
    al *= k;
  }
  return { ax: af * c - al * s, ay: af * s + al * c, slip, slipping };
}

export function angularAccel(cmdOmega: number, omega: number, robot: RobotParams, tau = 0.07) {
  const a = (cmdOmega - omega) / tau;
  return Math.max(-robot.maxAngularAccel, Math.min(robot.maxAngularAccel, a));
}
