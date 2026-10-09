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

describe("parser work bounds", () => {
  const source = (end: unknown, start: unknown = { x: 0, y: 0 }) => JSON.stringify({ path: [start, end] });
  const rejects = (text: string, message: RegExp) => {
    const parsed = parsePath(text);
    expect(parsed.spec).toBeNull();
    expect(parsed.issues.some((issue) => issue.severity === "error" && message.test(issue.message))).toBe(true);
  };

  it("bounds both coordinates for object and shorthand waypoints", () => {
    for (const value of [-72.01, 216.01, 1e9]) {
      rejects(source({ x: value, y: 0 }), /off the field/);
      rejects(source({ x: 0, y: value }), /off the field/);
      rejects(source([value, 0]), /off the field/);
      rejects(source([0, value]), /off the field/);
    }
    expect(parsePath(source({ x: 216, y: -72 }, [-72, 216])).spec).not.toBeNull();
  });

  it("bounds control points even when they would be ignored", () => {
    for (const cp of [[217, 0], [0, -73], { x: -73, y: 0 }, { x: 0, y: 217 }]) {
      rejects(source({ x: 10, y: 0, controlPoints: [cp] }), /off the field/);
      rejects(source({ x: 10, y: 0, type: "line", controlPoints: [cp] }), /off the field/);
      rejects(source({ x: 10, y: 0 }, { x: 0, y: 0, controlPoints: [cp] }), /off the field/);
    }
  });

  it("caps waypoints at 200", () => {
    const path = Array.from({ length: 200 }, () => ({ x: 0, y: 0 }));
    expect(parsePath(JSON.stringify({ path })).spec?.waypoints).toHaveLength(200);
    rejects(JSON.stringify({ path: [...path, path[0]] }), /200 waypoints/);
  });

  it("caps control points per segment at 16", () => {
    const controlPoints = Array.from({ length: 16 }, () => [5, 5]);
    expect(parsePath(source({ x: 10, y: 0, controlPoints })).spec).not.toBeNull();
    rejects(source({ x: 10, y: 0, controlPoints: [...controlPoints, [5, 5]] }), /16 points/);
  });

  it("caps wait at 30 seconds and extend at 30 inches", () => {
    expect(parsePath(source({ x: 10, y: 0, wait: 30, extend: 30 })).spec).not.toBeNull();
    for (const value of [-1, 30.01, 1e9]) {
      rejects(source({ x: 10, y: 0, wait: value }), /wait.*0–30 seconds/);
      rejects(source({ x: 10, y: 0, extend: value }), /extend.*0–30 inches/);
    }
  });

  it("preserves all preset sources without parse issues", () => {
    for (const preset of PRESETS) {
      const parsed = parsePath(presetSource(preset.id));
      expect(parsed.spec).not.toBeNull();
      expect(parsed.issues).toEqual([]);
    }
  });
});
