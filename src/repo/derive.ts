/**
 * Everything the hub stores about a path that can be computed from its source.
 * Pure and DOM-free: the browser uses it for previews, the server uses it as the
 * source of truth so a published card can never carry a hand-edited grade.
 */
import { DEFAULT_ROBOT } from "../config/robot";
import { evaluatePath } from "../eval/advocate";
import { compilePath } from "../path/compile";
import { parsePath } from "../path/parser";
import { opponentSpec, type OpponentId } from "../path/presets";
import type { CompiledPath } from "../path/types";
import type { PathStats } from "./types";

/** Hub grades are always taken against this opponent so cards compare like for like. */
export const REFERENCE_OPPONENT: OpponentId = "raider";

/** Downsample a compiled path into a 0..100 SVG polyline string (y flipped for screen). */
export function thumbnailFor(path: CompiledPath, points = 64): string {
  const s = path.samples;
  if (!s.length) return "";
  const step = Math.max(1, Math.floor(s.length / points));
  const pts: string[] = [];
  for (let i = 0; i < s.length; i += step) pts.push(`${((s[i].x / 144) * 100).toFixed(1)},${(100 - (s[i].y / 144) * 100).toFixed(1)}`);
  const last = s[s.length - 1];
  pts.push(`${((last.x / 144) * 100).toFixed(1)},${(100 - (last.y / 144) * 100).toFixed(1)}`);
  return pts.join(" ");
}

export type Derived = { thumbnail: string; stats: PathStats };

/** Parse, compile and grade a path source. Throws an Error with a user-facing message if it does not parse. */
export function deriveFromSource(source: string): Derived {
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
      alliance: parsed.spec.alliance,
    },
  };
}
