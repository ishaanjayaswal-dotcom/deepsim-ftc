import { describe, expect, it } from "vitest";
import { DEFAULT_ROBOT } from "../../src/config/robot.js";
import { evaluatePath } from "../../src/eval/advocate.js";
import { compilePath } from "../../src/path/compile.js";
import { parsePath } from "../../src/path/parser.js";
import { opponentSpec, presetSource } from "../../src/path/presets.js";
import { deriveFromSource, REFERENCE_OPPONENT, thumbnailFor } from "../../src/repo/derive.js";
import { SEED_PATHS } from "../../src/repo/seed.js";

function browserDerived(source: string) {
  const parsed = parsePath(source);
  if (!parsed.spec) throw new Error(parsed.issues.find((i) => i.severity === "error")?.message ?? "Path does not parse");
  const compiled = compilePath(parsed.spec);
  const oppSpec = opponentSpec(REFERENCE_OPPONENT, parsed.spec);
  const evaluation = evaluatePath(compiled, DEFAULT_ROBOT, oppSpec ? compilePath(oppSpec) : null);
  return {
    thumbnail: thumbnailFor(compiled),
    stats: {
      lengthIn: Math.round(compiled.totalLength),
      durationS: Math.round(compiled.duration * 10) / 10,
      segments: compiled.segments.length,
      grade: evaluation.grade,
    },
  };
}

describe("deriveFromSource", () => {
  it("matches the browser derivation pipeline for seed sources", () => {
    for (const seed of SEED_PATHS) {
      const derived = deriveFromSource(seed.data);
      const browser = browserDerived(seed.data);
      expect(derived.thumbnail).toBe(browser.thumbnail);
      expect(derived.stats).toEqual(browser.stats);
    }
  });

  it("throws a readable message for bad sources", () => {
    expect(() => deriveFromSource("not valid path json")).toThrow(/parse|JSON|path/i);
    const badAction = `[
      {"x":9,"y":60,"heading":0},
      {"x":30,"y":60,"heading":0,"action":"fly"}
    ]`;
    expect(() => deriveFromSource(badAction)).toThrow();
    try {
      deriveFromSource("{");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message.length).toBeGreaterThan(3);
    }
  });
});
