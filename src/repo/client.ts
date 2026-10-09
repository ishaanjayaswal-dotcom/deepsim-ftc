import { compilePath } from "../path/compile";
import { parsePath } from "../path/parser";
import { PRESETS, presetSource } from "../path/presets";
import type { CompiledPath } from "../path/types";
import type { ListQuery, PathDraft, PathPatch, PathRecord, PathRepository } from "./types";

/* ------------------------------ HTTP adapter ------------------------------ */

export class HttpPathRepository implements PathRepository {
  readonly kind = "http" as const;
  constructor(private base: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(msg);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  list(query: ListQuery = {}) {
    const qs = new URLSearchParams();
    if (query.q) qs.set("q", query.q);
    if (query.category) qs.set("category", query.category);
    if (query.sort) qs.set("sort", query.sort);
    const s = qs.toString();
    return this.req<PathRecord[]>(`/paths${s ? `?${s}` : ""}`);
  }
  get(id: string) {
    return this.req<PathRecord>(`/paths/${encodeURIComponent(id)}`);
  }
  create(draft: PathDraft) {
    return this.req<PathRecord>(`/paths`, { method: "POST", body: JSON.stringify(draft) });
  }
  update(id: string, patch: PathPatch) {
    return this.req<PathRecord>(`/paths/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  }
  remove(id: string) {
    return this.req<void>(`/paths/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  upvote(id: string) {
    return this.req<PathRecord>(`/paths/${encodeURIComponent(id)}/upvote`, { method: "POST" });
  }
}

/* ------------------------------ Local adapter ------------------------------ */

const STORAGE_KEY = "dsim.paths.v1";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);

/** Browser-only stand-in with the exact same contract, so the UI is fully usable without a server. */
export class LocalPathRepository implements PathRepository {
  readonly kind = "local" as const;
  private latency = 120;

  private read(): PathRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as PathRecord[];
    } catch {
      /* corrupted storage — reseed */
    }
    const seeded = seedRecords();
    this.write(seeded);
    return seeded;
  }
  private write(rows: PathRecord[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }
  private delay<T>(v: T): Promise<T> {
    return new Promise((r) => setTimeout(() => r(structuredClone(v)), this.latency));
  }

  async list(query: ListQuery = {}) {
    let rows = this.read();
    if (query.category) rows = rows.filter((r) => r.category === query.category);
    if (query.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter((r) => `${r.name} ${r.teamNumber} ${r.category} ${r.description}`.toLowerCase().includes(q));
    }
    rows.sort((a, b) => (query.sort === "top" ? b.upvotes - a.upvotes : b.createdAt.localeCompare(a.createdAt)));
    return this.delay(rows);
  }
  async get(id: string) {
    const row = this.read().find((r) => r.id === id);
    if (!row) throw new Error("Path not found");
    return this.delay(row);
  }
  async create(draft: PathDraft) {
    validateDraft(draft);
    const now = new Date().toISOString();
    const row: PathRecord = { ...draft, id: uid(), upvotes: 0, createdAt: now, updatedAt: now };
    this.write([row, ...this.read()]);
    return this.delay(row);
  }
  async update(id: string, patch: PathPatch) {
    const rows = this.read();
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw new Error("Path not found");
    rows[i] = { ...rows[i], ...patch, id, updatedAt: new Date().toISOString() };
    validateDraft(rows[i]);
    this.write(rows);
    return this.delay(rows[i]);
  }
  async remove(id: string) {
    this.write(this.read().filter((r) => r.id !== id));
    return this.delay(undefined);
  }
  async upvote(id: string) {
    const rows = this.read();
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error("Path not found");
    row.upvotes += 1;
    this.write(rows);
    return this.delay(row);
  }
}

function validateDraft(d: Pick<PathRecord, "name" | "teamNumber" | "data">) {
  if (!d.name?.trim()) throw new Error("Path name is required");
  if (!Number.isInteger(d.teamNumber) || d.teamNumber <= 0 || d.teamNumber > 99999) throw new Error("Team number must be 1–99999");
  if (!parsePath(d.data).spec) throw new Error("Path data does not parse");
}

/* ------------------------------ Helpers ------------------------------ */

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

export function draftFromSource(source: string, meta: { name: string; teamNumber: number; category: string; description: string }, grade?: string): PathDraft {
  const parsed = parsePath(source);
  if (!parsed.spec) throw new Error(parsed.issues.find((i) => i.severity === "error")?.message ?? "Path does not parse");
  const compiled = compilePath(parsed.spec);
  return {
    ...meta,
    data: source,
    thumbnail: thumbnailFor(compiled),
    stats: { lengthIn: Math.round(compiled.totalLength), durationS: Math.round(compiled.duration * 10) / 10, segments: compiled.segments.length, grade },
  };
}

function seedRecords(): PathRecord[] {
  const seeds: { preset: string; team: number; desc: string; votes: number; daysAgo: number; name?: string }[] = [
    { preset: "four-sample", team: 31415, desc: "Preload + 3 spikes. Backs into the basket at 315°, flows the pickups with a single control point.", votes: 42, daysAgo: 2 },
    { preset: "specimen-cycle", team: 27182, desc: "Three high-chamber clips with two human-player grabs. Bezier returns keep the chamber approach square.", votes: 37, daysAgo: 4 },
    { preset: "hive-raid", team: 16180, desc: "Colour-sorted sub intake with a 16 in extension — two raids, both into the high basket.", votes: 29, daysAgo: 6 },
    { preset: "stress", team: 14142, desc: "Tuning fixture. Run it at μ 0.5 to see the follower lose traction and overshoot the stop.", votes: 12, daysAgo: 9 },
  ];
  const out: PathRecord[] = [];
  for (const s of seeds) {
    const def = PRESETS.find((p) => p.id === s.preset)!;
    const source = presetSource(s.preset);
    const draft = draftFromSource(source, { name: (def.body.name as string) ?? def.id, teamNumber: s.team, category: def.category, description: s.desc });
    const at = new Date(Date.now() - s.daysAgo * 86400000).toISOString();
    out.push({ ...draft, id: uid(), upvotes: s.votes, createdAt: at, updatedAt: at });
  }
  // A park-only starter so the board has a beginner example.
  const park = `{
  "name": "Safe Park · Red",
  "alliance": "red",
  "preload": "none",
  "path": [
    { "x": 9, "y": 40, "heading": 0 },
    { "x": 12, "y": 13, "heading": 0, "type": "bezier", "controlPoints": [[24, 30]], "action": "park" }
  ]
}`;
  const at = new Date(Date.now() - 12 * 86400000).toISOString();
  out.push({
    ...draftFromSource(park, { name: "Safe Park · Red", teamNumber: 17320, category: "Park Only", description: "Three points, zero risk. A rookie-friendly starting template." }),
    id: uid(),
    upvotes: 8,
    createdAt: at,
    updatedAt: at,
  });
  return out;
}

export function createPathRepository(): PathRepository {
  const base = import.meta.env.VITE_PATHS_API as string | undefined;
  return base ? new HttpPathRepository(base.replace(/\/$/, "")) : new LocalPathRepository();
}

export const repository = createPathRepository();
