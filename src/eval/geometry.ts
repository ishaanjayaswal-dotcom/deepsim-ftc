import type { Rect, Vec2 } from "../config/field";

export type OBB = { cx: number; cy: number; hw: number; hl: number; angle: number };

export const robotOBB = (x: number, y: number, headingRad: number, length = 18, width = 18): OBB => ({
  cx: x,
  cy: y,
  hl: length / 2,
  hw: width / 2,
  angle: headingRad,
});

export function obbCorners(b: OBB): Vec2[] {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const fx = { x: c * b.hl, y: s * b.hl };
  const sx = { x: -s * b.hw, y: c * b.hw };
  return [
    { x: b.cx + fx.x + sx.x, y: b.cy + fx.y + sx.y },
    { x: b.cx + fx.x - sx.x, y: b.cy + fx.y - sx.y },
    { x: b.cx - fx.x - sx.x, y: b.cy - fx.y - sx.y },
    { x: b.cx - fx.x + sx.x, y: b.cy - fx.y + sx.y },
  ];
}

const rectCorners = (r: Rect): Vec2[] => [
  { x: r.minX, y: r.minY },
  { x: r.maxX, y: r.minY },
  { x: r.maxX, y: r.maxY },
  { x: r.minX, y: r.maxY },
];

function project(pts: Vec2[], axis: Vec2) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/** Separating-axis test between two convex quads. Returns penetration depth (0 = separated). */
export function quadOverlap(a: Vec2[], b: Vec2[]): number {
  const axes: Vec2[] = [];
  for (const poly of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const p = poly[i];
      const q = poly[i + 1];
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      axes.push({ x: -(q.y - p.y) / len, y: (q.x - p.x) / len });
    }
  }
  let minOverlap = Infinity;
  for (const ax of axes) {
    const pa = project(a, ax);
    const pb = project(b, ax);
    const o = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (o <= 0) return 0;
    if (o < minOverlap) minOverlap = o;
  }
  return minOverlap;
}

export const obbRectOverlap = (b: OBB, r: Rect) => quadOverlap(obbCorners(b), rectCorners(r));
export const obbObbOverlap = (a: OBB, b: OBB) => quadOverlap(obbCorners(a), obbCorners(b));

/** How far (inches) any corner pokes outside [0, size]^2. */
export function outOfBounds(b: OBB, size = 144) {
  let worst = 0;
  for (const p of obbCorners(b)) {
    worst = Math.max(worst, -p.x, -p.y, p.x - size, p.y - size);
  }
  return worst;
}

/** Shortest distance from an OBB to an axis-aligned rect (0 when overlapping). */
export function obbRectDistance(b: OBB, r: Rect) {
  if (obbRectOverlap(b, r) > 0) return 0;
  let best = Infinity;
  const corners = obbCorners(b);
  for (const p of corners) {
    const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX);
    const dy = Math.max(r.minY - p.y, 0, p.y - r.maxY);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  // Rect corners against OBB edges.
  for (const rc of rectCorners(r)) {
    for (let i = 0; i < 4; i++) best = Math.min(best, pointSegDist(rc, corners[i], corners[(i + 1) % 4]));
  }
  return best;
}

export function pointSegDist(p: Vec2, a: Vec2, b: Vec2) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1)));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Approximate clearance between two robot OBBs (0 when touching). */
export function obbObbDistance(a: OBB, b: OBB) {
  if (obbObbOverlap(a, b) > 0) return 0;
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  let best = Infinity;
  for (const p of ca) for (let i = 0; i < 4; i++) best = Math.min(best, pointSegDist(p, cb[i], cb[(i + 1) % 4]));
  for (const p of cb) for (let i = 0; i < 4; i++) best = Math.min(best, pointSegDist(p, ca[i], ca[(i + 1) % 4]));
  return best;
}
