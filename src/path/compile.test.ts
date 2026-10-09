import { describe, expect, it } from "vitest";
import { DEFAULT_ROBOT } from "../config/robot";
import { evaluatePath } from "../eval/advocate";
import { compilePath, poseAtTime } from "./compile";
import { parsePath, relaxedJsonToStrict } from "./parser";
import { PRESETS, opponentSpec, presetSource } from "./presets";
import { bezierPoint } from "./bezier";

describe("parser", () => {
  it("accepts relaxed JS-ish input", () => {
    const src = `// my auto
const path = [
  { x: 9, y: 60, heading: 0 }, // start
  { x: 30, y: 60, heading: 0, type: 'line', },
];`;
    const strict = relaxedJsonToStrict(src);
    expect(() => JSON.parse(strict)).not.toThrow();
    const r = parsePath(src);
    expect(r.spec?.waypoints).toHaveLength(2);
  });
  it("reports bad actions with a line number", () => {
    const r = parsePath(`[\n{"x":9,"y":60,"heading":0},\n{"x":30,"y":60,"heading":0,"action":"fly"}\n]`);
    expect(r.spec).toBeNull();
    expect(r.issues[0].line).toBe(3);
  });
  it("infers bezier from control points", () => {
    const r = parsePath(`[{x:0,y:0,heading:0},{x:10,y:0,heading:0,controlPoints:[[5,5]]}]`);
    expect(r.spec?.waypoints[1].type).toBe("bezier");
  });
});

describe("bezier + compile", () => {
  it("evaluates quadratic midpoint", () => {
    const p = bezierPoint([{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }], 0.5);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(5);
  });
  it("profiles respect constraints and start/end at rest", () => {
    const spec = parsePath(presetSource("four-sample")).spec!;
    const c = compilePath(spec);
    for (const ch of c.chains) {
      expect(ch.samples[0].v).toBe(0);
      expect(ch.samples[ch.samples.length - 1].v).toBe(0);
      for (const s of ch.samples) expect(s.v).toBeLessThanOrEqual(spec.constraints.maxVel + 1e-9);
    }
    const mid = poseAtTime(c, c.chains[0].startTime + c.chains[0].duration / 2);
    expect(mid.phase).toBe("move");
  });
});

describe("advocate", () => {
  for (const p of PRESETS) {
    it(`evaluates preset ${p.id}`, () => {
      const spec = parsePath(presetSource(p.id)).spec!;
      const c = compilePath(spec);
      const opp = opponentSpec("raider", spec);
      const ev = evaluatePath(c, DEFAULT_ROBOT, opp ? compilePath(opp) : null);
      console.log(p.id, c.duration.toFixed(1), "s", ev.grade, ev.overall, Object.values(ev.metrics).map((m) => `${m.id}:${m.score}(${m.value})`).join(" "));
      for (const m of Object.values(ev.metrics)) for (const f of m.findings) if (f.level === "fail" || f.level === "warn") console.log("   ", m.id, f.level, f.text);
      expect(ev.overall).toBeGreaterThanOrEqual(0);
    });
  }
  it("flags a path through the hive", () => {
    const spec = parsePath(`[{x:9,y:72,heading:0},{x:120,y:72,heading:0}]`).spec!;
    const ev = evaluatePath(compilePath(spec), DEFAULT_ROBOT, null);
    expect(ev.metrics.legality.findings.some((f) => f.level === "fail" && /Submersible/.test(f.text))).toBe(true);
  });
});

describe("data strings", () => {
  it("round-trips a path through base64", async () => {
    const { encodeDataString } = await import("./parser");
    const src = presetSource("specimen-cycle");
    const r = parsePath(encodeDataString(src));
    expect(r.spec?.name).toBe("Specimen Cycle · Red");
  });
});
