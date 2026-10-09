import { parsePath } from "../path/parser";
import { deriveFromSource } from "./derive";
import { SEED_PATHS } from "./seed";
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

export { thumbnailFor } from "./derive";

/** Build a publishable draft. Thumbnail, stats and grade always come from the source itself. */
export function draftFromSource(source: string, meta: { name: string; teamNumber: number; category: string; description: string }): PathDraft {
  return { ...meta, data: source, ...deriveFromSource(source) };
}

function seedRecords(): PathRecord[] {
  return SEED_PATHS.map((s) => {
    const at = new Date(Date.now() - s.daysAgo * 86400000).toISOString();
    const draft = draftFromSource(s.data, { name: s.name, teamNumber: s.teamNumber, category: s.category, description: s.description });
    return { ...draft, id: uid(), upvotes: s.upvotes, createdAt: at, updatedAt: at };
  });
}

export function createPathRepository(): PathRepository {
  const base = import.meta.env.VITE_PATHS_API as string | undefined;
  return base ? new HttpPathRepository(base.replace(/\/$/, "")) : new LocalPathRepository();
}

export const repository = createPathRepository();
