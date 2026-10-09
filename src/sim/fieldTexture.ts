import * as THREE from "three";
import {
  FIELD,
  HIVE_RECT,
  SPIKE_MARKS,
  TILE,
  netZone,
  observationZone,
  type Alliance,
  type Vec2,
} from "../config/field";

export const ALLIANCE_HEX: Record<Alliance, string> = { red: "#e5383b", blue: "#2f6fed" };

/** One canvas texture for tiles + all tape — keeps the floor to a single draw call. */
export function makeFieldTexture(px = 2048) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const g = canvas.getContext("2d")!;
  const k = px / FIELD;
  const X = (x: number) => x * k;
  const Y = (y: number) => (FIELD - y) * k;

  // Foam tiles with alternating tone and a fine speckle.
  for (let i = 0; i < FIELD / TILE; i++) {
    for (let j = 0; j < FIELD / TILE; j++) {
      g.fillStyle = (i + j) % 2 ? "#26282c" : "#24262a";
      g.fillRect(i * TILE * k, j * TILE * k, TILE * k, TILE * k);
    }
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 26000; n++) {
    g.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.08)";
    g.fillRect(rnd() * px, rnd() * px, 1.5, 1.5);
  }
  g.strokeStyle = "#17181b";
  g.lineWidth = 3;
  for (let i = 1; i < FIELD / TILE; i++) {
    g.beginPath();
    g.moveTo(i * TILE * k, 0);
    g.lineTo(i * TILE * k, px);
    g.moveTo(0, i * TILE * k);
    g.lineTo(px, i * TILE * k);
    g.stroke();
  }

  const tape = (pts: Vec2[], color: string, w = 2, close = false) => {
    g.strokeStyle = color;
    g.lineWidth = w * k;
    g.lineCap = "butt";
    g.lineJoin = "miter";
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
    if (close) g.closePath();
    g.stroke();
  };

  for (const a of ["red", "blue"] as Alliance[]) {
    const c = ALLIANCE_HEX[a];
    // Net zone: tinted triangle + tape on the hypotenuse.
    const nz = netZone(a);
    g.fillStyle = a === "red" ? "rgba(229,56,59,0.10)" : "rgba(47,111,237,0.10)";
    g.beginPath();
    nz.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
    g.closePath();
    g.fill();
    tape([nz[1], nz[2]], c, 2);
    // Observation zone outline (inner edges).
    const oz = observationZone(a);
    g.fillStyle = a === "red" ? "rgba(229,56,59,0.06)" : "rgba(47,111,237,0.06)";
    g.fillRect(X(oz.minX), Y(oz.maxY), (oz.maxX - oz.minX) * k, (oz.maxY - oz.minY) * k);
    if (a === "red") tape([{ x: oz.maxX, y: 0 }, { x: oz.maxX, y: oz.maxY }, { x: 0, y: oz.maxY }], c, 2);
    else tape([{ x: oz.minX, y: FIELD }, { x: oz.minX, y: oz.minY }, { x: FIELD, y: oz.minY }], c, 2);
  }

  // Spike marks: short tape strips under each staged sample.
  const spike = (p: Vec2, color: string) => tape([{ x: p.x - 3, y: p.y }, { x: p.x + 3, y: p.y }], color, 1);
  SPIKE_MARKS.yellow.forEach((p) => spike(p, "#d9b21a"));
  SPIKE_MARKS.red.forEach((p) => spike(p, ALLIANCE_HEX.red));
  SPIKE_MARKS.blue.forEach((p) => spike(p, ALLIANCE_HEX.blue));

  // Submersible zone outline + a faint "deep water" glow inside.
  const grad = g.createRadialGradient(X(72), Y(72), 0, X(72), Y(72), 30 * k);
  grad.addColorStop(0, "rgba(34,211,238,0.16)");
  grad.addColorStop(1, "rgba(34,211,238,0.02)");
  g.fillStyle = grad;
  g.fillRect(X(HIVE_RECT.minX), Y(HIVE_RECT.maxY), (HIVE_RECT.maxX - HIVE_RECT.minX) * k, (HIVE_RECT.maxY - HIVE_RECT.minY) * k);
  tape(
    [
      { x: HIVE_RECT.minX - 1, y: HIVE_RECT.minY - 1 },
      { x: HIVE_RECT.maxX + 1, y: HIVE_RECT.minY - 1 },
      { x: HIVE_RECT.maxX + 1, y: HIVE_RECT.maxY + 1 },
      { x: HIVE_RECT.minX - 1, y: HIVE_RECT.maxY + 1 },
    ],
    "rgba(226,232,240,0.55)",
    1,
    true,
  );

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Small plate texture (team number) for robot side panels. */
export function makePlateTexture(text: string, bg: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#ffffff";
  g.font = "700 64px 'Inter Variable', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
