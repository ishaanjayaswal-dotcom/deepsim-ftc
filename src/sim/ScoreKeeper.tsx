import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { IN, netZone, pointInPolygon, type Alliance } from "../config/field";
import { AUTO_SECONDS, POINTS } from "../config/robot";
import { parkCheck } from "../lib/rules";
import { scoreTotal, useApp, type Score } from "../store/app";
import { bus } from "./bus";

const LABEL: Record<string, string> = {
  highBasket: "High basket",
  lowBasket: "Low basket",
  netZone: "Net zone",
  highChamber: "High chamber",
  lowChamber: "Low chamber",
};
const VALUE: Record<string, number> = {
  highBasket: POINTS.highBasket,
  lowBasket: POINTS.lowBasket,
  netZone: POINTS.netZone,
  highChamber: POINTS.highChamber,
  lowChamber: POINTS.lowChamber,
};

/** Polls element state at 5 Hz, settles flying elements, and commits score changes to the store. */
export function ScoreKeeper({ alliance }: { alliance: Alliance }) {
  const acc = useRef(0);
  const prev = useRef<Score | null>(null);

  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.2) return;
    acc.current = 0;
    const els = bus.elements;
    if (!els.sampleBodies) return;
    const app = useApp.getState();
    const nz = netZone(alliance);
    const counts = { highBasket: 0, lowBasket: 0, netZone: 0, highChamber: 0, lowChamber: 0 };
    const scoresFor = (c: string) => c === "yellow" || c === alliance;

    els.samples.forEach((el, i) => {
      const b = els.sampleBodies![i];
      if (!b || el.state === "disabled") return;
      const t = b.translation();
      el.fx = t.x / IN + 72;
      el.fy = 72 - t.z / IN;
      if (el.state === "flying") {
        const v = b.linvel();
        if (Math.hypot(v.x, v.y, v.z) < 0.08) el.state = "free";
      }
      if (el.state === "held") return;
      if (el.basket && el.basket.alliance === alliance && scoresFor(el.color)) counts[el.basket.level === "high" ? "highBasket" : "lowBasket"]++;
      else if (!el.basket && t.y < 3 * IN && scoresFor(el.color) && pointInPolygon({ x: el.fx, y: el.fy }, nz)) counts.netZone++;
    });
    els.specimens.forEach((el, i) => {
      const b = els.specimenBodies?.[i];
      if (b && el.state === "flying" && Math.hypot(b.linvel().x, b.linvel().y, b.linvel().z) < 0.08) el.state = "free";
      if (el.state === "clipped" && el.clip?.alliance === alliance) counts[el.clip.level === "high" ? "highChamber" : "lowChamber"]++;
    });

    const tel = bus.telemetry;
    const parkLive = app.mode === "manual" || tel.phase === "done" || app.runState === "finished";
    const park = parkLive && tel.speed < 4 ? parkCheck({ x: tel.x, y: tel.y, heading: tel.heading }, alliance, app.robot) : null;
    bus.park = park;

    // Autonomous points freeze when the period ends.
    if (app.mode === "auto" && bus.simTime > AUTO_SECONDS + 1.5) return;
    if (app.runState === "idle") return;

    const next: Score = { ...counts, park, total: scoreTotal({ ...counts, park }) };
    const p = prev.current ?? app.score;
    for (const k of Object.keys(counts) as (keyof typeof counts)[]) {
      const diff = next[k] - p[k];
      if (diff > 0) {
        app.pushEvent({ t: bus.simTime, kind: "score", text: `${LABEL[k]} +${VALUE[k] * diff}`, points: VALUE[k] * diff });
        app.showToast(`+${VALUE[k] * diff}  ${LABEL[k]}`, "good");
      } else if (diff < 0) {
        app.pushEvent({ t: bus.simTime, kind: "miss", text: `${LABEL[k]} lost ${-VALUE[k] * diff} — element bounced out` });
      }
    }
    if (next.park && !p.park) app.pushEvent({ t: bus.simTime, kind: "score", text: `${next.park === "ascent" ? "Level 1 ascent" : "Observation park"} +3`, points: 3 });
    if (next.total !== p.total || next.park !== p.park) app.setScore(next);
    prev.current = next;
  });

  return null;
}
