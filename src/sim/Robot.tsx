import { RigidBodyType } from "@dimforge/rapier3d-compat";
import {
  CoefficientCombineRule,
  CuboidCollider,
  RigidBody,
  interactionGroups,
  useBeforePhysicsStep,
  type CollisionEnterPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useMemo, useRef } from "react";
import { HIVE, IN, fieldToWorld, type Alliance } from "../config/field";
import { AUTO_SECONDS } from "../config/robot";
import { outOfBounds, robotOBB } from "../eval/geometry";
import { basketShot, chamberCheck, intakeAccepts, intakeGeometry, type Pose } from "../lib/rules";
import { deg2rad } from "../path/bezier";
import { Follower } from "../path/follower";
import type { PathAction } from "../path/types";
import { useApp } from "../store/app";
import { bus, pushTrail, type ElementInfo } from "./bus";
import { G_IN, angularAccel, driveAccel } from "./drivetrain";
import { RobotModel, clawLocal, newMech } from "./RobotModel";

const CHASSIS_HALF_H = 2.8; // inches
/** A carried element touches nothing (not even sensors) until it is released. */
const HELD_GROUPS = interactionGroups(15, []);
const ALL_GROUPS = 0xffffffff;
const CHASSIS_CENTER_Y = 3.3;

/** Deterministic pseudo-noise in [-1, 1] — same inputs, same miss. */
const noise = (a: number, b: number) => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

const fmt = (v: number, d = 1) => v.toFixed(d);

type Pending = { kind: "shot"; level: "high" | "low"; t: number } | { kind: "clip"; level: "high" | "low"; t: number };

export function Robot() {
  const body = useRef<RapierRigidBody>(null);
  const snap = useMemo(() => {
    const s = useApp.getState();
    return { compiled: s.compiled, mode: s.mode, team: s.active.teamNumber ? String(s.active.teamNumber) : "DEEP", mass: s.robot.massKg };
  }, []);
  const alliance: Alliance = snap.compiled?.spec.alliance ?? "red";
  const start = snap.compiled?.spec.waypoints[0] ?? { x: 9, y: 64, heading: 0 };
  const startPos = fieldToWorld(start.x, start.y, 0.05);
  const follower = useMemo(() => (snap.mode === "auto" && snap.compiled ? new Follower(snap.compiled, useApp.getState().robot.driveTau) : null), [snap]);
  const mech = useMemo(newMech, []);

  const st = useRef({
    slipping: false,
    holding: null as ElementInfo | null,
    preloaded: false,
    step: 0,
    finished: false,
    autoEnded: false,
    lastSlipEvent: -10,
    inertia: 0,
    extendTarget: 0,
    extendHold: 0,
    liftTarget: 0,
    liftHold: 0,
    pending: null as Pending | null,
  });

  const app = useApp.getState;
  const event = (kind: Parameters<ReturnType<typeof app>["pushEvent"]>[0]["kind"], text: string, points?: number) =>
    app().pushEvent({ t: bus.simTime, kind, text, points });

  const elBody = (el: ElementInfo) => (el.kind === "sample" ? bus.elements.sampleBodies : bus.elements.specimenBodies)?.[el.id] ?? null;

  const getPose = (): Pose => {
    const b = body.current!;
    const t = b.translation();
    const r = b.rotation();
    return { x: t.x / IN + 72, y: 72 - t.z / IN, heading: 2 * Math.atan2(r.y, r.w) };
  };

  const clawWorld = (pose: Pose) => {
    const c = clawLocal(mech);
    const fx = pose.x + Math.cos(pose.heading) * c.forward;
    const fy = pose.y + Math.sin(pose.heading) * c.forward;
    return { field: { x: fx, y: fy, h: c.up }, world: fieldToWorld(fx, fy, c.up) };
  };

  const grab = (el: ElementInfo) => {
    const b = elBody(el);
    if (!b) return;
    b.setEnabled(true);
    b.setBodyType(RigidBodyType.KinematicPositionBased, true);
    const c = b.collider(0);
    c?.setSensor(true);
    c?.setCollisionGroups(HELD_GROUPS);
    el.state = "held";
    el.basket = null;
    st.current.holding = el;
    bus.telemetry.holding = { kind: el.kind, color: el.color };
  };

  const release = (el: ElementInfo, v: { x: number; y: number; z: number }, from?: [number, number, number]) => {
    const b = elBody(el);
    if (!b) return;
    if (from) b.setTranslation({ x: from[0], y: from[1], z: from[2] }, true);
    b.setBodyType(RigidBodyType.Dynamic, true);
    const c = b.collider(0);
    c?.setSensor(false);
    c?.setCollisionGroups(ALL_GROUPS);
    b.setLinvel(v, true);
    b.setAngvel({ x: noise(el.id, 3) * 4, y: noise(el.id, 5) * 4, z: noise(el.id, 9) * 4 }, true);
    el.state = "flying";
    st.current.holding = null;
    bus.telemetry.holding = null;
  };

  /* ---------------------------- mechanisms ---------------------------- */

  const intake = (action: PathAction | "manual", extend?: number) => {
    const robot = app().robot;
    if (st.current.holding) {
      event("miss", `Intake skipped — already holding a ${st.current.holding.kind}`);
      return;
    }
    const pose = getPose();
    let best: { el: ElementInfo; d: number } | null = null;
    for (const el of [...bus.elements.samples, ...bus.elements.specimens]) {
      if (el.state !== "free" || !intakeAccepts(action === "manual" ? "intake" : action, el.kind, el.color, alliance)) continue;
      const b = elBody(el);
      if (!b) continue;
      const t = b.translation();
      if (t.y > 6 * IN) continue; // only off the floor
      const p = { x: t.x / IN + 72, y: 72 - t.z / IN };
      const g = intakeGeometry(pose, p, robot, extend);
      if (g.ok && (!best || g.dist < best.d)) best = { el, d: g.dist };
    }
    const reach = extend ?? robot.intakeReach;
    st.current.extendTarget = reach;
    st.current.extendHold = 0.35;
    if (best) {
      grab(best.el);
      mech.claw = 1;
      event("intake", `Intook ${best.el.color} ${best.el.kind}`);
    } else {
      mech.claw = 0;
      event("miss", `Intake whiffed — nothing in reach at (${fmt(pose.x, 0)}, ${fmt(pose.y, 0)})`);
      app().showToast("Intake missed", "bad");
    }
  };

  const queueShot = (level: "high" | "low") => {
    const el = st.current.holding;
    if (!el || el.kind !== "sample") {
      event("miss", `No sample to score in the ${level} basket`);
      return;
    }
    st.current.liftTarget = level === "high" ? 18 : 10;
    st.current.liftHold = 0.75;
    st.current.pending = { kind: "shot", level, t: 0.32 };
  };

  const fireShot = (level: "high" | "low") => {
    const el = st.current.holding;
    if (!el || el.kind !== "sample") return;
    const robot = app().robot;
    const pose = getPose();
    const claw = clawWorld(pose);
    const shot = basketShot(pose, alliance, level, robot);
    const b = shot.basket;
    const L = claw.field;
    const targetH = b.rim - 2.5;
    const apex = Math.max(L.h, targetH) + 7;
    const vz = Math.sqrt(2 * G_IN * (apex - L.h));
    const T = vz / G_IN + Math.sqrt((2 * (apex - targetH)) / G_IN);
    let hx = (b.x - L.x) / T;
    let hy = (b.y - L.y) / T;
    const over = Math.max(0, shot.distance - robot.scoreReach);
    const ang = deg2rad(noise(el.id, bus.simTime) * (0.6 + over * 0.9));
    const spd = 1 + noise(el.id + 7, bus.simTime) * (0.015 + over * 0.012);
    [hx, hy] = [(hx * Math.cos(ang) - hy * Math.sin(ang)) * spd, (hx * Math.sin(ang) + hy * Math.cos(ang)) * spd];
    let scale = 1;
    const exit = Math.hypot(hx, hy, vz) * IN;
    if (exit > robot.launchSpeedCap) {
      scale = robot.launchSpeedCap / exit;
      event("miss", `Basket out of launcher range (${fmt(shot.distance, 0)}" away)`);
    }
    const lv = body.current!.linvel();
    release(el, { x: hx * IN * scale + lv.x, y: vz * IN * scale, z: -hy * IN * scale + lv.z }, claw.world);
    mech.claw = 0;
    event("info", `Shot → ${level} basket from ${fmt(shot.distance, 0)}"`);
  };

  const queueClip = (level: "high" | "low") => {
    const el = st.current.holding;
    if (!el || el.kind !== "specimen") {
      event("miss", `No specimen to clip on the ${level} chamber`);
      return;
    }
    st.current.liftTarget = level === "high" ? 17 : 5;
    st.current.liftHold = 0.55;
    st.current.pending = { kind: "clip", level, t: 0.25 };
  };

  const fireClip = (level: "high" | "low") => {
    const el = st.current.holding;
    if (!el || el.kind !== "specimen") return;
    const pose = getPose();
    const ch = chamberCheck(pose, alliance, app().robot);
    if (!ch.ok) {
      const why = !ch.inSpan ? "outside the rung span" : ch.headingErrDeg >= 40 ? `${fmt(ch.headingErrDeg, 0)}° off square` : `${fmt(ch.gap)}" from the rung`;
      const claw = clawWorld(pose);
      const lv = body.current!.linvel();
      release(el, { x: lv.x + Math.cos(pose.heading) * 0.4, y: 0.2, z: lv.z - Math.sin(pose.heading) * 0.4 }, claw.world);
      event("miss", `Specimen clip missed — ${why}`);
      app().showToast("Clip missed", "bad");
      return;
    }
    const rungH = level === "high" ? HIVE.highChamber : HIVE.lowChamber;
    const out = alliance === "red" ? -1.4 : 1.4;
    el.clip = { alliance, level, local: [(ch.lineX - 72 + out) * IN, (rungH - 2.2) * IN, -(ch.clipY - 72) * IN] };
    el.state = "clipped";
    st.current.holding = null;
    bus.telemetry.holding = null;
    mech.claw = 0;
    // Clipping onto the rung shoves the Hive — watch it rock on its hinges.
    const hive = bus.hive;
    if (hive) {
      const [wx, , wz] = fieldToWorld(ch.lineX, ch.clipY);
      hive.applyImpulseAtPoint({ x: (alliance === "red" ? 1 : -1) * 2.2, y: -0.4, z: 0 }, { x: wx, y: rungH * IN, z: wz }, true);
    }
  };

  const drop = () => {
    const el = st.current.holding;
    if (!el) return;
    const pose = getPose();
    const claw = clawWorld(pose);
    const lv = body.current!.linvel();
    release(el, { x: lv.x, y: 0, z: lv.z }, claw.world);
    mech.claw = 0;
    event("info", `Dropped ${el.color} ${el.kind}`);
  };

  const runAction = (action: PathAction | "drop", extend?: number) => {
    switch (action) {
      case "intake":
      case "intake_sample":
      case "intake_specimen":
        return intake(action, extend);
      case "score_high":
        return queueShot("high");
      case "score_low":
        return queueShot("low");
      case "specimen_high":
        return queueClip("high");
      case "specimen_low":
        return queueClip("low");
      case "drop":
        return drop();
      case "park":
        return event("info", "Park pose reached");
      default:
        return;
    }
  };

  /* ---------------------------- control loop ---------------------------- */

  useBeforePhysicsStep((world) => {
    const b = body.current;
    if (!b) return;
    const dt = world.timestep;
    const s = st.current;
    const { runState, mode, robot } = app();
    const running = runState === "running";
    if (running) bus.simTime += dt;

    // Yaw inertia of the chassis box (read from mass, which is final by now; the body's own
    // principalInertia() is not populated until colliders attach).
    const mNow = b.mass();
    s.inertia = (mNow * ((robot.length * IN) ** 2 + (robot.width * IN) ** 2)) / 12;

    // Claim the preload once the element registry exists.
    if (!s.preloaded && bus.elements.sampleBodies && snap.compiled) {
      s.preloaded = true;
      // Preloads only exist in autonomous; driver mode starts empty-handed (matches GameElements).
      const pre = snap.mode === "auto" ? snap.compiled.spec.preload : "none";
      const list = pre === "sample" ? bus.elements.samples : pre === "specimen" ? bus.elements.specimens : null;
      const el = list?.[list.length - 1];
      if (el) {
        el.state = "free";
        grab(el);
        mech.claw = 1;
      }
    }

    const pose = getPose();
    const lv = b.linvel();
    const vx = lv.x / IN;
    const vy = -lv.z / IN;
    const omega = b.angvel().y;
    const speed = Math.hypot(vx, vy);

    let cmd = { vx: 0, vy: 0, omega: 0 };
    let phase = bus.telemetry.phase;
    const tel = bus.telemetry;

    if (mode === "auto" && follower) {
      if (running && !s.autoEnded && bus.simTime >= AUTO_SECONDS) {
        s.autoEnded = true;
        event("info", "Autonomous period over (30 s) — robot disabled");
        app().finish();
      }
      if (running && !s.autoEnded) {
        const out = follower.update(pose.x, pose.y, pose.heading, speed, dt);
        cmd = out;
        phase = out.phase;
        tel.crossTrack = out.crossTrack;
        tel.headingErr = (out.headingErr * 180) / Math.PI;
        tel.chain = out.chain;
        tel.targetX = out.targetX;
        tel.targetY = out.targetY;
        if (out.settleTimedOut) event("slip", `Settle timeout on chain ${out.chain + 1} — overshoot not recovered`);
        if (out.fire) {
          tel.action = out.fire.action;
          runAction(out.fire.action, out.fire.extend);
        }
        if (follower.done && !s.finished) {
          s.finished = true;
          event("info", `Routine complete in ${fmt(bus.simTime)} s`);
          app().finish();
        }
      } else phase = runState === "idle" ? "idle" : phase;
    } else if (mode === "manual") {
      phase = "manual";
      const k = bus.keys;
      const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
      const lat = (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);
      const rot = (k.has("KeyQ") ? 1 : 0) - (k.has("KeyE") ? 1 : 0);
      const slow = k.has("ShiftLeft") || k.has("ShiftRight") ? 0.4 : 1;
      // Camera-relative driving: "up" on the keyboard is away from the camera.
      const cy = bus.cameraYaw;
      const fx = Math.cos(cy);
      const fy = Math.sin(cy);
      let dx = fx * fwd - fy * lat;
      let dy = fy * fwd + fx * lat;
      const m = Math.hypot(dx, dy);
      if (m > 1) {
        dx /= m;
        dy /= m;
      }
      const v = robot.freeSpeed * 0.95 * slow;
      cmd = { vx: dx * v, vy: dy * v, omega: rot * 4.2 * slow };
      while (bus.manualRequests.length) {
        const r = bus.manualRequests.shift()!;
        if (r === "intake" && s.holding) drop();
        else runAction(r === "intake" ? "intake" : r);
      }
    }

    // Drivetrain → impulses.
    const d = driveAccel(cmd.vx, cmd.vy, vx, vy, pose.heading, robot, s.slipping);
    if (d.slipping && !s.slipping && bus.simTime - s.lastSlipEvent > 1.5 && speed > 10) {
      s.lastSlipEvent = bus.simTime;
      event("slip", `Wheel slip at ${fmt(speed, 0)} in/s — demanded ${fmt(d.slip * 100, 0)}% of traction`);
    }
    s.slipping = d.slipping;
    const m = mNow;
    b.applyImpulse({ x: d.ax * IN * m * dt, y: 0, z: -d.ay * IN * m * dt }, true);
    const alpha = angularAccel(cmd.omega, omega, robot);
    b.applyTorqueImpulse({ x: 0, y: s.inertia * alpha * dt, z: 0 }, true);
    Object.assign(bus.debug, { inertia: s.inertia, mass: m, omegaCmd: cmd.omega, alpha, torque: s.inertia * alpha, cmdVx: cmd.vx, cmdVy: cmd.vy, ax: d.ax, ay: d.ay, vx, vy });

    // Mechanism animation (shared with the visuals).
    if (s.extendHold > 0) s.extendHold -= dt;
    else s.extendTarget = 0;
    if (s.liftHold > 0) s.liftHold -= dt;
    else s.liftTarget = 0;
    mech.extend += (s.extendTarget - mech.extend) * Math.min(1, dt * 12);
    mech.lift += (s.liftTarget - mech.lift) * Math.min(1, dt * 9);
    mech.wheelSpin = (speed / 2) * (Math.sign(vx * Math.cos(pose.heading) + vy * Math.sin(pose.heading)) || 1);
    mech.led = s.slipping ? "slip" : s.holding ? "hold" : phase === "follow" || phase === "settle" ? "follow" : "idle";

    if (s.pending) {
      s.pending.t -= dt;
      if (s.pending.t <= 0) {
        const p = s.pending;
        s.pending = null;
        if (p.kind === "shot") fireShot(p.level);
        else fireClip(p.level);
      }
    }

    // Carry the held element in the claw.
    if (s.holding) {
      const eb = elBody(s.holding);
      if (eb) {
        const c = clawWorld(pose).world;
        eb.setNextKinematicTranslation({ x: c[0], y: c[1], z: c[2] });
        const yaw = pose.heading + Math.PI / 2;
        eb.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
      }
    }

    Object.assign(tel, {
      x: pose.x,
      y: pose.y,
      heading: pose.heading,
      vx,
      vy,
      speed,
      omega: (omega * 180) / Math.PI,
      cmdSpeed: Math.hypot(cmd.vx, cmd.vy),
      peakSpeed: Math.max(speed, tel.peakSpeed * 0.96),
      slip: d.slip,
      phase,
    });
    if (++s.step % 4 === 0 && (running || mode === "manual")) pushTrail(pose.x, pose.y, d.slip);
  });

  const onCollision = (e: CollisionEnterPayload) => {
    const kind = (e.other.rigidBodyObject?.userData as { kind?: string } | undefined)?.kind;
    if (!kind || kind === "element") return; // nudging game elements is normal play
    if (kind === "field") {
      // The field body is floor + walls: only report it when the chassis is actually at the perimeter.
      const t = bus.telemetry;
      const wall = outOfBounds(robotOBB(t.x, t.y, t.heading, app().robot.length, app().robot.width)) > -1.5;
      if (!wall) return;
    }
    const label = kind === "hive" ? "the Hive" : kind === "opponent" ? "the opponent robot" : kind === "basket" || kind === "tower" ? "the basket structure" : "the field wall";
    const now = bus.simTime;
    const last = bus.lastContact.get(label) ?? -10;
    if (now < 0.4 || now - last < 1.2 || bus.telemetry.peakSpeed < 8) return;
    bus.lastContact.set(label, now);
    event("contact", `Contact with ${label} at ${fmt(bus.telemetry.peakSpeed, 0)} in/s`);
  };

  return (
    <RigidBody
      ref={body}
      position={startPos}
      rotation={[0, deg2rad(start.heading), 0]}
      colliders={false}
      enabledRotations={[false, true, false]}
      linearDamping={0.02}
      angularDamping={0.05}
      canSleep={false}
      ccd
      userData={{ kind: "robot" }}
      onCollisionEnter={onCollision}
    >
      <CuboidCollider
        args={[9 * IN, CHASSIS_HALF_H * IN, 9 * IN]}
        position={[0, (CHASSIS_CENTER_Y - 0.5) * IN, 0]}
        mass={snap.mass}
        friction={0}
        frictionCombineRule={CoefficientCombineRule.Min}
        restitution={0.05}
      />
      <RobotModel alliance={alliance} team={snap.team} mech={mech} />
    </RigidBody>
  );
}
