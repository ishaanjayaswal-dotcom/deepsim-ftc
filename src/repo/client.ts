import { parsePath } from "../path/parser";
import { deriveFromSource } from "./derive";
import { SEED_PATHS } from "./seed";
import type { CreatedPathRecord, ListQuery, PathDraft, PathPatch, PathRecord, PathRepository, PathSummary } from "./types";

/* ------------------------------ Browser storage ------------------------------ */

const LOCAL_PATHS_KEY = "dsim.paths.v1";
const EDIT_KEYS_KEY = "deepsim.editKeys.v1";
const VOTED_KEY = "deepsim.voted.v1";
const VOTER_KEY = "deepsim.voterId.v1";
const IMPORTED_KEY = "deepsim.imported.v1";

// Mirror of everything written, so edit keys and votes survive the session even when localStorage is blocked.
const memory = new Map<string, string>();

function readJson<T>(key: string, fallback: T): T {
  let raw: string | null | undefined;
  try {
    raw = localStorage.getItem(key);
  } catch {
    /* storage blocked */
  }
  raw ??= memory.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    localStorage.setItem(key, raw);
  } catch {
    /* storage full or blocked — the in-memory copy keeps the session working */
  }
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);

/** Anonymous, per-browser id so the server can count one upvote per visitor. */
function voterId(): string {
  let id = readJson<string | null>(VOTER_KEY, null);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = uid().replace(/[^A-Za-z0-9_-]/g, "");
    writeJson(VOTER_KEY, id);
  }
  return id;
}

const editKeys = {
  all: () => readJson<Record<string, string>>(EDIT_KEYS_KEY, {}),
  get: (id: string) => editKeys.all()[id],
  set(id: string, key: string) {
    writeJson(EDIT_KEYS_KEY, { ...editKeys.all(), [id]: key });
  },
  drop(id: string) {
    const all = editKeys.all();
    delete all[id];
    writeJson(EDIT_KEYS_KEY, all);
  },
};

const votes = {
  has: (id: string) => readJson<string[]>(VOTED_KEY, []).includes(id),
  add(id: string) {
    const v = readJson<string[]>(VOTED_KEY, []);
    if (!v.includes(id)) writeJson(VOTED_KEY, [...v, id]);
  },
};

/* ------------------------------ HTTP adapter ------------------------------ */

const PAGE = 100;
const MAX_LIST = 1000;

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

  private keyHeader(id: string): Record<string, string> {
    const key = editKeys.get(id);
    return key ? { "X-Edit-Key": key } : {};
  }

  /** Pages through the server's results (100 per request), up to MAX_LIST rows. */
  async list(query: ListQuery = {}) {
    const rows: PathSummary[] = [];
    while (rows.length < MAX_LIST) {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(rows.length) });
      if (query.q) qs.set("q", query.q);
      if (query.category) qs.set("category", query.category);
      if (query.sort) qs.set("sort", query.sort);
      const page = await this.req<PathSummary[]>(`/paths?${qs}`);
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  }
  get(id: string) {
    return this.req<PathRecord>(`/paths/${encodeURIComponent(id)}`);
  }
  async create(draft: PathDraft) {
    const { editKey, ...record } = await this.req<CreatedPathRecord>(`/paths`, { method: "POST", body: JSON.stringify(draft) });
    if (editKey) editKeys.set(record.id, editKey);
    return record;
  }
  update(id: string, patch: PathPatch) {
    return this.req<PathRecord>(`/paths/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch), headers: this.keyHeader(id) });
  }
  async remove(id: string) {
    await this.req<void>(`/paths/${encodeURIComponent(id)}`, { method: "DELETE", headers: this.keyHeader(id) });
    editKeys.drop(id);
  }
  async upvote(id: string) {
    const rec = await this.req<PathRecord>(`/paths/${encodeURIComponent(id)}/upvote`, { method: "POST", headers: { "X-Voter-Id": voterId() } });
    votes.add(id);
    return rec;
  }
  canEdit(id: string) {
    return Boolean(editKeys.get(id));
  }
  hasVoted(id: string) {
    return votes.has(id);
  }
}

/* ------------------------------ Local adapter ------------------------------ */

/** Browser-only stand-in with the same contract, so the app is fully usable without a server (e.g. GitHub Pages). */
export class LocalPathRepository implements PathRepository {
  readonly kind = "local" as const;
  private latency = 120;

  private read(): PathRecord[] {
    const rows = readJson<PathRecord[] | null>(LOCAL_PATHS_KEY, null);
    if (Array.isArray(rows)) return rows;
    const seeded = seedRecords();
    this.write(seeded);
    return seeded;
  }
  private write(rows: PathRecord[]) {
    writeJson(LOCAL_PATHS_KEY, rows);
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
    rows.sort((a, b) => (query.sort === "top" ? b.upvotes - a.upvotes || b.createdAt.localeCompare(a.createdAt) : b.createdAt.localeCompare(a.createdAt)));
    return this.delay(rows.map(({ data: _data, ...summary }): PathSummary => ({ ...summary, stats: { ...summary.stats, alliance: summary.stats.alliance ?? (parsePath(_data).spec?.alliance ?? "red") } })));
  }
  async get(id: string) {
    const row = this.read().find((r) => r.id === id);
    if (!row) throw new Error("Path not found");
    return this.delay(row);
  }
  async create(draft: PathDraft) {
    validateDraft(draft);
    const now = new Date().toISOString();
    const row: PathRecord = { ...draft, ...deriveFromSource(draft.data), id: uid(), upvotes: 0, createdAt: now, updatedAt: now };
    this.write([row, ...this.read()]);
    return this.delay(row);
  }
  async update(id: string, patch: PathPatch) {
    const rows = this.read();
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw new Error("Path not found");
    rows[i] = { ...rows[i], ...patch, id, updatedAt: new Date().toISOString() };
    validateDraft(rows[i]);
    if (patch.data !== undefined) Object.assign(rows[i], deriveFromSource(rows[i].data));
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
    if (!votes.has(id)) {
      row.upvotes += 1;
      votes.add(id);
      this.write(rows);
    }
    return this.delay(row);
  }
  canEdit() {
    return true;
  }
  hasVoted(id: string) {
    return votes.has(id);
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

/* ------------------------------ Local → server import ------------------------------ */

const seedKey = (r: { name: string; data: string }) => `${r.name}\u0000${r.data}`;
const SEED_KEYS = new Set(SEED_PATHS.map(seedKey));

/** Paths this browser published to its local store (seeds excluded) that have not been copied to the server yet. */
export function localPathsToImport(): PathRecord[] {
  const rows = readJson<PathRecord[]>(LOCAL_PATHS_KEY, []);
  const done = new Set(readJson<string[]>(IMPORTED_KEY, []));
  return Array.isArray(rows) ? rows.filter((r) => !SEED_KEYS.has(seedKey(r)) && !done.has(r.id)) : [];
}

export async function importLocalPaths(target: PathRepository): Promise<number> {
  const done = readJson<string[]>(IMPORTED_KEY, []);
  let n = 0;
  for (const r of localPathsToImport()) {
    await target.create(draftFromSource(r.data, { name: r.name, teamNumber: r.teamNumber, category: r.category, description: r.description }));
    done.push(r.id);
    writeJson(IMPORTED_KEY, done);
    n++;
  }
  return n;
}

/* ------------------------------ Resolution ------------------------------ */

/**
 * Pick the backend once at startup: an explicit VITE_PATHS_API, else the same-origin `/api` when it answers
 * a health check, else the browser-local store (static hosting).
 */
async function resolveRepository(): Promise<PathRepository> {
  const explicit = (import.meta.env.VITE_PATHS_API as string | undefined)?.replace(/\/$/, "");
  if (explicit) return new HttpPathRepository(explicit);
  const base = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
    if (res.ok && (await res.json())?.ok === true) return new HttpPathRepository(base);
  } catch {
    /* no server here */
  }
  return new LocalPathRepository();
}

class AutoPathRepository implements PathRepository {
  private target: PathRepository | null = null;
  readonly ready: Promise<PathRepository>;
  constructor() {
    this.ready = resolveRepository().then((r) => (this.target = r));
  }
  get kind() {
    return this.target?.kind ?? "pending";
  }
  list(query?: ListQuery) {
    return this.ready.then((r) => r.list(query));
  }
  get(id: string) {
    return this.ready.then((r) => r.get(id));
  }
  create(draft: PathDraft) {
    return this.ready.then((r) => r.create(draft));
  }
  update(id: string, patch: PathPatch) {
    return this.ready.then((r) => r.update(id, patch));
  }
  remove(id: string) {
    return this.ready.then((r) => r.remove(id));
  }
  upvote(id: string) {
    return this.ready.then((r) => r.upvote(id));
  }
  canEdit(id: string) {
    return this.target?.canEdit(id) ?? false;
  }
  hasVoted(id: string) {
    return this.target?.hasVoted(id) ?? false;
  }
}

export const repository = new AutoPathRepository();
