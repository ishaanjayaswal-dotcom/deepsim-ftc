/**
 * Into The Deep field model.
 *
 * Coordinates follow the Pedro Pathing convention: inches, origin in a field
 * corner, x/y in [0, 144], heading in degrees counter-clockwise from +x.
 *
 *   y=144 ┌──────────────────────────────┐
 *         │ RED NET          BLUE OBS    │
 *  red    │        ┌──────────┐          │  blue
 *  alliance        │   HIVE   │          │  alliance
 *  wall   │        └──────────┘          │  wall
 *  (x=0)  │ RED OBS          BLUE NET    │  (x=144)
 *     y=0 └──────────────────────────────┘
 *
 * The field is rotationally symmetric: mirror(x, y) = (144 - x, 144 - y).
 * World space (three.js / Rapier) is metres, Y up, field centre at origin.
 */

export const IN = 0.0254;
export const FIELD = 144;
export const HALF = FIELD / 2;
export const TILE = 24;
export const WALL_HEIGHT = 12.25;
export const WALL_THICKNESS = 1.25;

export type Alliance = "red" | "blue";
export type Vec2 = { x: number; y: number };
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

export const fieldToWorld = (x: number, y: number, h = 0): [number, number, number] => [
  (x - HALF) * IN,
  h * IN,
  (HALF - y) * IN,
];

export const worldToField = (wx: number, wz: number): Vec2 => ({
  x: wx / IN + HALF,
  y: HALF - wz / IN,
});

export const mirror = (p: Vec2): Vec2 => ({ x: FIELD - p.x, y: FIELD - p.y });
export const mirrorHeading = (deg: number) => normDeg(deg + 180);
export const normDeg = (deg: number) => ((deg % 360) + 360) % 360;

/** Submersible ("Hive"). Long sides face the alliance walls and carry the chambers. */
export const HIVE = {
  cx: 72,
  cy: 72,
  depth: 29, // along x (alliance to alliance)
  length: 44.5, // along y
  postSize: 2,
  topHeight: 36.5,
  highChamber: 26,
  lowChamber: 13,
  lowRung: 20,
  highRung: 36,
  barrierHeight: 3,
} as const;

export const HIVE_RECT: Rect = {
  minX: HIVE.cx - HIVE.depth / 2,
  maxX: HIVE.cx + HIVE.depth / 2,
  minY: HIVE.cy - HIVE.length / 2,
  maxY: HIVE.cy + HIVE.length / 2,
};

/** Chamber rung line for an alliance (the long side facing that alliance wall). */
export const chamberLine = (alliance: Alliance) => ({
  x: alliance === "red" ? HIVE_RECT.minX : HIVE_RECT.maxX,
  minY: HIVE_RECT.minY + 3,
  maxY: HIVE_RECT.maxY - 3,
  facing: alliance === "red" ? 0 : 180, // robot heading that faces the chamber
});

/** Corner tower that carries both baskets (red at the x=0/y=144 corner). */
export const BASKET_TOWER = { x: 1.5, y: 142.5, size: 3, height: 47 };

export const BASKET = {
  size: 11, // square opening, inches
  depth: 6,
  highRim: 43,
  lowRim: 25.75,
};

type BasketDef = { id: string; alliance: Alliance; level: "high" | "low"; x: number; y: number; rim: number };

const redBaskets: BasketDef[] = [
  { id: "red-high", alliance: "red", level: "high", x: 7, y: 135.5, rim: BASKET.highRim },
  { id: "red-low", alliance: "red", level: "low", x: 7, y: 121.5, rim: BASKET.lowRim },
];

export const BASKETS: BasketDef[] = [
  ...redBaskets,
  ...redBaskets.map((b) => {
    const m = mirror(b);
    return { ...b, ...m, id: b.id.replace("red", "blue"), alliance: "blue" as const };
  }),
];

export const basketFor = (alliance: Alliance, level: "high" | "low") =>
  BASKETS.find((b) => b.alliance === alliance && b.level === level)!;

/** Polygons for zones, used by tape rendering, scoring and the evaluator. */
export const NET_ZONE_LEG = 23.5;
export const netZone = (alliance: Alliance): Vec2[] => {
  const tri: Vec2[] = [
    { x: 0, y: FIELD },
    { x: 0, y: FIELD - NET_ZONE_LEG },
    { x: NET_ZONE_LEG, y: FIELD },
  ];
  return alliance === "red" ? tri : tri.map(mirror);
};

export const observationZone = (alliance: Alliance): Rect => {
  const r: Rect = { minX: 0, minY: 0, maxX: 17, maxY: 24 };
  return alliance === "red" ? r : { minX: FIELD - r.maxX, minY: FIELD - r.maxY, maxX: FIELD, maxY: FIELD };
};

/** Static obstacles a chassis must not overlap (structure footprints). */
export const STATIC_OBSTACLES: { id: string; label: string; rect: Rect }[] = [
  { id: "hive", label: "Submersible (Hive)", rect: HIVE_RECT },
  { id: "red-basket-post", label: "Red basket tower", rect: { minX: 0, minY: 141, maxX: 3, maxY: 144 } },
  { id: "blue-basket-post", label: "Blue basket tower", rect: { minX: 141, minY: 0, maxX: 144, maxY: 3 } },
];

/** Game element spawn layout. */
export type ElementColor = "yellow" | "red" | "blue";
export type SampleSpawn = { x: number; y: number; rot: number; color: ElementColor; zone: string };
export type SpecimenSpawn = { x: number; y: number; rot: number; alliance: Alliance; zone: string };

const redYellowSpikes: Vec2[] = [
  { x: 48, y: 121 },
  { x: 48, y: 131 },
  { x: 48, y: 141 },
];
const redAllianceSpikes: Vec2[] = redYellowSpikes.map((p) => ({ x: p.x, y: FIELD - p.y }));

export const SPIKE_MARKS = {
  yellow: [...redYellowSpikes, ...redYellowSpikes.map(mirror)],
  red: redAllianceSpikes,
  blue: redAllianceSpikes.map(mirror),
};

const hiveSamples = (): SampleSpawn[] => {
  // Samples dumped inside the submersible zone — the "Flowers".
  const out: SampleSpawn[] = [];
  const cols = 4;
  const rows = 6;
  const palette: ElementColor[] = ["yellow", "red", "yellow", "blue", "yellow", "red", "blue", "yellow"];
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = HIVE_RECT.minX + 6 + c * ((HIVE.depth - 12) / (cols - 1));
      const y = HIVE_RECT.minY + 7 + r * ((HIVE.length - 14) / (rows - 1));
      const jitter = ((k * 37) % 11) / 11 - 0.5;
      out.push({ x: x + jitter * 2, y: y - jitter, rot: (k * 47) % 180, color: palette[k % palette.length], zone: "hive" });
      k++;
    }
  }
  return out;
};

export const SAMPLE_SPAWNS: SampleSpawn[] = [
  ...SPIKE_MARKS.yellow.map((p) => ({ ...p, rot: 0, color: "yellow" as const, zone: "spike" })),
  ...SPIKE_MARKS.red.map((p) => ({ ...p, rot: 0, color: "red" as const, zone: "spike" })),
  ...SPIKE_MARKS.blue.map((p) => ({ ...p, rot: 0, color: "blue" as const, zone: "spike" })),
  ...hiveSamples(),
];

const redSpecimens: SpecimenSpawn[] = [
  { x: 4, y: 9, rot: 90, alliance: "red", zone: "observation" },
  { x: 4, y: 15, rot: 90, alliance: "red", zone: "observation" },
  { x: 4, y: 21, rot: 90, alliance: "red", zone: "observation" },
];

export const SPECIMEN_SPAWNS: SpecimenSpawn[] = [
  ...redSpecimens,
  ...redSpecimens.map((s) => ({ ...s, ...mirror(s), alliance: "blue" as const })),
];

/** Element physical dimensions (inches). */
export const SAMPLE_DIMS = { l: 3.5, w: 1.5, h: 1.5 };
export const SPECIMEN_DIMS = { radius: 0.9, halfLength: 0.85 };

export const pointInRect = (p: Vec2, r: Rect, pad = 0) =>
  p.x >= r.minX - pad && p.x <= r.maxX + pad && p.y >= r.minY - pad && p.y <= r.maxY + pad;

export const pointInPolygon = (p: Vec2, poly: Vec2[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
