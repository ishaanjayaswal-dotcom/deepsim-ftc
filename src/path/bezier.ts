import type { Vec2 } from "../config/field";

/** De Casteljau evaluation of an arbitrary-degree Bezier curve. */
export function bezierPoint(pts: Vec2[], t: number): Vec2 {
  const tmp = pts.map((p) => ({ x: p.x, y: p.y }));
  for (let k = tmp.length - 1; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      tmp[i].x += (tmp[i + 1].x - tmp[i].x) * t;
      tmp[i].y += (tmp[i + 1].y - tmp[i].y) * t;
    }
  }
  return tmp[0];
}

/** Control polygon of the derivative curve (hodograph). */
export function hodograph(pts: Vec2[]): Vec2[] {
  const n = pts.length - 1;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) out.push({ x: n * (pts[i + 1].x - pts[i].x), y: n * (pts[i + 1].y - pts[i].y) });
  return out;
}

export type BezierEval = { p: Vec2; d1: Vec2; d2: Vec2 };

export function makeBezier(pts: Vec2[]) {
  const h1 = pts.length > 1 ? hodograph(pts) : [{ x: 0, y: 0 }];
  const h2 = h1.length > 1 ? hodograph(h1) : [{ x: 0, y: 0 }];
  return (t: number): BezierEval => ({ p: bezierPoint(pts, t), d1: bezierPoint(h1, t), d2: bezierPoint(h2, t) });
}

export function curvatureOf(e: BezierEval) {
  const { d1, d2 } = e;
  const speed = Math.hypot(d1.x, d1.y);
  if (speed < 1e-9) return 0;
  return (d1.x * d2.y - d1.y * d2.x) / (speed * speed * speed);
}

/** Approximate arc length with dense chord sampling. */
export function bezierLength(pts: Vec2[], steps = 256) {
  let len = 0;
  let prev = pts[0];
  for (let i = 1; i <= steps; i++) {
    const p = bezierPoint(pts, i / steps);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

/**
 * Build an arc-length → t lookup so we can sample at uniform distance.
 * Returns a function mapping s in [0, length] to t in [0, 1].
 */
export function arcLengthParam(pts: Vec2[], steps = 512) {
  const ts: number[] = [0];
  const ss: number[] = [0];
  let prev = pts[0];
  let acc = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = bezierPoint(pts, t);
    acc += Math.hypot(p.x - prev.x, p.y - prev.y);
    ts.push(t);
    ss.push(acc);
    prev = p;
  }
  const length = acc;
  const tAt = (s: number) => {
    if (s <= 0) return 0;
    if (s >= length) return 1;
    let lo = 0;
    let hi = ss.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid] < s) lo = mid;
      else hi = mid;
    }
    const f = (s - ss[lo]) / (ss[hi] - ss[lo] || 1);
    return ts[lo] + (ts[hi] - ts[lo]) * f;
  };
  return { length, tAt };
}

export const wrapRad = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
