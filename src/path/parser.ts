import { FIELD, type Alliance, type Vec2 } from "../config/field";
import {
  DEFAULT_CONSTRAINTS,
  PATH_ACTIONS,
  type Constraints,
  type HeadingMode,
  type ParseIssue,
  type PathAction,
  type PathSpec,
  type Preload,
  type Waypoint,
} from "./types";

/**
 * Accepts strict JSON plus the things people paste from code: comments,
 * trailing commas, single quotes, unquoted keys and a `const path = ...;` wrapper.
 * Newlines are preserved so error line numbers match the editor.
 */
export function relaxedJsonToStrict(src: string): string {
  const text = src;

  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      out += '"';
      i++;
      while (i < n && text[i] !== q) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (q === "'" && text[i] === '"') out += '\\"';
        else out += text[i];
        i++;
      }
      out += '"';
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(text[j])) j++;
      const ident = text.slice(i, j);
      let k = j;
      while (k < n && /\s/.test(text[k])) k++;
      if (text[k] === ":") out += `"${ident}"`;
      else out += ident;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  const wrapper = /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=\s*/;
  const m = out.match(wrapper);
  if (m) out = "\n".repeat((m[0].match(/\n/g) ?? []).length) + out.slice(m[0].length);
  out = out.replace(/,(\s*[\]}])/g, "$1").trimEnd();
  if (out.endsWith(";")) out = out.slice(0, -1);
  return out;
}

function lineOfPosition(text: string, pos: number) {
  return text.slice(0, pos).split("\n").length;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function toVec(v: unknown): Vec2 | null {
  if (Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1])) return { x: v[0], y: v[1] };
  if (v && typeof v === "object" && isNum((v as Vec2).x) && isNum((v as Vec2).y)) return { x: (v as Vec2).x, y: (v as Vec2).y };
  return null;
}

/** Find the editor line where waypoint `idx` starts, for inline error markers. */
function waypointLines(text: string): number[] {
  const lines: number[] = [];
  const re = /\{[^{}]*?\b"?x"?\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) lines.push(lineOfPosition(text, m.index));
  return lines;
}

export type ParseResult = { spec: PathSpec | null; issues: ParseIssue[] };

/** Repository "data strings" are base64(UTF-8 source). */
export const encodeDataString = (source: string) => btoa(String.fromCharCode(...new TextEncoder().encode(source)));
export function decodeDataString(s: string): string | null {
  const t = s.trim();
  if (t.length < 24 || !/^[A-Za-z0-9+/=\s]+$/.test(t)) return null;
  try {
    const bin = atob(t.replace(/\s+/g, ""));
    const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return /[[{]/.test(text) ? text : null;
  } catch {
    return null;
  }
}

export function parsePath(input: string): ParseResult {
  const issues: ParseIssue[] = [];
  const source = decodeDataString(input) ?? input;
  if (!source.trim()) return { spec: null, issues: [{ severity: "error", message: "Editor is empty — paste a path array or object." }] };

  const strict = relaxedJsonToStrict(source);
  let raw: unknown;
  try {
    raw = JSON.parse(strict);
  } catch (e) {
    const msg = (e as Error).message;
    const pos = msg.match(/position (\d+)/);
    const lineCol = msg.match(/line (\d+)/);
    const line = lineCol ? Number(lineCol[1]) : pos ? lineOfPosition(strict, Number(pos[1])) : undefined;
    return { spec: null, issues: [{ severity: "error", message: `Syntax: ${msg.replace(/^JSON\.parse: /, "")}`, line }] };
  }

  const root = (Array.isArray(raw) ? { path: raw } : raw) as Record<string, unknown>;
  if (!root || typeof root !== "object") {
    return { spec: null, issues: [{ severity: "error", message: "Expected an array of waypoints or an object with a `path` array." }] };
  }

  const list = (root.path ?? root.waypoints ?? root.points) as unknown;
  if (!Array.isArray(list)) {
    return { spec: null, issues: [{ severity: "error", message: "Missing `path` array (also accepts `waypoints` or `points`)." }] };
  }
  if (list.length > 200) {
    return { spec: null, issues: [{ severity: "error", message: "A path must have at most 200 waypoints." }] };
  }
  const withinBounds = (p: Vec2) => p.x >= -72 && p.x <= 216 && p.y >= -72 && p.y <= 216;
  const checkBounds = (p: Vec2, where: string, line?: number) => {
    if (!withinBounds(p)) issues.push({ severity: "error", message: `${where} is off the field (coordinates must be -72–216 inches).`, where, line });
  };
  const wpLines = waypointLines(source);
  const radians = root.headingUnits === "rad" || root.headingUnits === "radians";

  const alliance: Alliance = root.alliance === "blue" ? "blue" : "red";
  if (root.alliance !== undefined && root.alliance !== "red" && root.alliance !== "blue") {
    issues.push({ severity: "warning", message: `Unknown alliance "${String(root.alliance)}" — defaulting to red.`, where: "alliance" });
  }
  const preload: Preload = root.preload === "sample" || root.preload === "specimen" ? root.preload : "none";

  const constraints: Constraints = { ...DEFAULT_CONSTRAINTS };
  if (root.constraints && typeof root.constraints === "object") {
    for (const [k, v] of Object.entries(root.constraints as Record<string, unknown>)) {
      if (!(k in constraints)) {
        issues.push({ severity: "warning", message: `Unknown constraint "${k}" ignored.`, where: `constraints.${k}` });
        continue;
      }
      if (!isNum(v) || v <= 0) {
        issues.push({ severity: "error", message: `constraints.${k} must be a positive number.`, where: `constraints.${k}` });
        continue;
      }
      constraints[k as keyof Constraints] = v;
    }
  }

  const waypoints: Waypoint[] = [];
  let lastHeading = 0;
  list.forEach((item, idx) => {
    const where = `path[${idx}]`;
    const line = wpLines[idx];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      const v = toVec(item);
      if (v) {
        checkBounds(v, where, line);
        waypoints.push({ ...v, heading: lastHeading });
        return;
      }
      issues.push({ severity: "error", message: `${where} must be an object like {x, y, heading}.`, where, line });
      return;
    }
    const o = item as Record<string, unknown>;
    if (!isNum(o.x) || !isNum(o.y)) {
      issues.push({ severity: "error", message: `${where} needs numeric x and y (inches).`, where, line });
      return;
    }
    const hRaw = o.heading ?? o.h ?? o.theta;
    let heading = lastHeading;
    if (hRaw !== undefined) {
      if (!isNum(hRaw)) issues.push({ severity: "error", message: `${where}.heading must be a number.`, where, line });
      else heading = radians ? (hRaw * 180) / Math.PI : hRaw;
    }
    lastHeading = heading;

    const wp: Waypoint = { x: o.x, y: o.y, heading };
    checkBounds(wp, where, line);

    let cps: Vec2[] = [];
    if (o.controlPoints !== undefined) {
      if (!Array.isArray(o.controlPoints)) {
        issues.push({ severity: "error", message: `${where}.controlPoints must be an array of [x, y] or {x, y}.`, where, line });
      } else if (o.controlPoints.length > 16) {
        issues.push({ severity: "error", message: `${where}.controlPoints must have at most 16 points.`, where, line });
      } else {
        o.controlPoints.forEach((cp, ci) => {
          const v = toVec(cp);
          if (v) { checkBounds(v, `${where}.controlPoints[${ci}]`, line); cps.push(v); }
          else issues.push({ severity: "error", message: `${where}.controlPoints[${ci}] is not a point.`, where, line });
        });
      }
    }

    let type = o.type as string | undefined;
    if (type !== undefined && type !== "line" && type !== "bezier" && type !== "curve") {
      issues.push({ severity: "error", message: `${where}.type must be "line" or "bezier".`, where, line });
      type = undefined;
    }
    if (type === "curve") type = "bezier";
    if (!type) type = cps.length ? "bezier" : "line";
    if (type === "bezier" && cps.length === 0 && idx > 0) {
      issues.push({ severity: "warning", message: `${where} is a bezier with no controlPoints — treated as a line.`, where, line });
      type = "line";
    }
    if (type === "line" && cps.length) {
      issues.push({ severity: "warning", message: `${where} is a line; its controlPoints are ignored.`, where, line });
      cps = [];
    }
    if (idx === 0 && (o.type !== undefined || cps.length)) {
      issues.push({ severity: "warning", message: `path[0] is the start pose — type/controlPoints ignored.`, where, line });
      cps = [];
    }
    wp.type = type as Waypoint["type"];
    if (cps.length) wp.controlPoints = cps;

    const hm = o.headingInterpolation ?? o.headingMode;
    if (hm !== undefined) {
      if (hm === "linear" || hm === "tangent" || hm === "reverseTangent" || hm === "constant") wp.headingInterpolation = hm as HeadingMode;
      else issues.push({ severity: "error", message: `${where}.headingInterpolation must be linear | tangent | reverseTangent | constant.`, where, line });
    }
    if (o.maxVel !== undefined) {
      if (isNum(o.maxVel) && o.maxVel > 0) wp.maxVel = o.maxVel;
      else issues.push({ severity: "error", message: `${where}.maxVel must be a positive number (in/s).`, where, line });
    }
    if (o.action !== undefined) {
      if (PATH_ACTIONS.includes(o.action as PathAction)) wp.action = o.action as PathAction;
      else issues.push({ severity: "error", message: `${where}.action "${String(o.action)}" is not one of ${PATH_ACTIONS.join(", ")}.`, where, line });
    }
    if (o.wait !== undefined) {
      if (isNum(o.wait) && o.wait >= 0 && o.wait <= 30) wp.wait = o.wait;
      else issues.push({ severity: "error", message: `${where}.wait must be 0–30 seconds.`, where, line });
    }
    if (o.stop !== undefined) wp.stop = Boolean(o.stop);
    if (o.extend !== undefined) {
      if (isNum(o.extend) && o.extend >= 0 && o.extend <= 30) wp.extend = o.extend;
      else issues.push({ severity: "error", message: `${where}.extend must be 0–30 inches.`, where, line });
    }

    const inField = (p: Vec2) => p.x >= 0 && p.x <= FIELD && p.y >= 0 && p.y <= FIELD;
    if (!inField(wp)) issues.push({ severity: "warning", message: `${where} (${wp.x}, ${wp.y}) is outside the 144×144 in field.`, where, line });
    cps.forEach((cp, ci) => {
      if (!inField(cp)) issues.push({ severity: "warning", message: `${where}.controlPoints[${ci}] is off-field; the curve may leave the field.`, where, line });
    });

    waypoints.push(wp);
  });

  if (waypoints.length < 2 && !issues.some((i) => i.severity === "error")) {
    issues.push({ severity: "error", message: "A path needs a start pose plus at least one more waypoint." });
  }

  const hasError = issues.some((i) => i.severity === "error");
  const name = typeof root.name === "string" && root.name.trim() ? root.name.trim() : "Untitled path";
  return {
    spec: hasError ? null : { name, alliance, preload, constraints, waypoints },
    issues,
  };
}

/** Pretty-print a spec back to the canonical editor format. */
export function specToSource(spec: PathSpec): string {
  const wp = spec.waypoints.map((w, i) => {
    const o: Record<string, unknown> = { x: round(w.x), y: round(w.y), heading: round(w.heading) };
    if (i > 0) o.type = w.type ?? "line";
    if (w.controlPoints?.length) o.controlPoints = w.controlPoints.map((c) => [round(c.x), round(c.y)]);
    if (w.headingInterpolation) o.headingInterpolation = w.headingInterpolation;
    if (w.maxVel) o.maxVel = w.maxVel;
    if (w.action) o.action = w.action;
    if (w.wait) o.wait = w.wait;
    if (w.stop) o.stop = true;
    if (w.extend) o.extend = w.extend;
    return o;
  });
  const body = {
    name: spec.name,
    alliance: spec.alliance,
    preload: spec.preload,
    constraints: spec.constraints,
    path: wp,
  };
  return formatCompact(body);
}

const round = (v: number) => Math.round(v * 100) / 100;

/** JSON formatter that keeps each waypoint on a single line — reads like code. */
export function formatCompact(value: unknown): string {
  const obj = value as Record<string, unknown>;
  const lines: string[] = ["{"];
  const keys = Object.keys(obj);
  keys.forEach((k, ki) => {
    const v = obj[k];
    const comma = ki < keys.length - 1 ? "," : "";
    if (Array.isArray(v) && v.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      lines.push(`  "${k}": [`);
      v.forEach((item, ii) => lines.push(`    ${inline(item)}${ii < v.length - 1 ? "," : ""}`));
      lines.push(`  ]${comma}`);
    } else {
      lines.push(`  "${k}": ${inline(v)}${comma}`);
    }
  });
  lines.push("}");
  return lines.join("\n");
}

function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (v && typeof v === "object") {
    return `{ ${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `"${k}": ${inline(x)}`)
      .join(", ")} }`;
  }
  return JSON.stringify(v);
}

/** Reformat whatever is in the editor (if parseable) into the canonical layout. */
export function formatSource(source: string): string | null {
  try {
    const parsed = JSON.parse(relaxedJsonToStrict(source));
    const root = Array.isArray(parsed) ? { path: parsed } : parsed;
    return formatCompact(root);
  } catch {
    return null;
  }
}
