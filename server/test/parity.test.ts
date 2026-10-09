import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpPathRepository, LocalPathRepository } from "../../src/repo/client.js";
import type { PathDraft, PathRecord } from "../../src/repo/types.js";
import { deriveFromSource } from "../../src/repo/derive.js";
import { presetSource } from "../../src/path/presets.js";
import { createTestContext, validDraft, VOTER_A, type TestContext } from "./helpers.js";

const LOCAL_PATHS_KEY = "dsim.paths.v1";
const EDIT_KEYS_KEY = "deepsim.editKeys.v1";
const VOTED_KEY = "deepsim.voted.v1";
const VOTER_KEY = "deepsim.voterId.v1";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

function clientDraft(overrides: Parameters<typeof validDraft>[0] = {}): PathDraft {
  const draft = validDraft(overrides);
  const derived = deriveFromSource(draft.data);
  return { ...draft, thumbnail: derived.thumbnail, stats: derived.stats };
}

function stripVolatile(rows: PathRecord[]) {
  return rows.map((r) => ({
    name: r.name,
    teamNumber: r.teamNumber,
    category: r.category,
    description: r.description,
    data: r.data,
    thumbnail: r.thumbnail,
    stats: r.stats,
    upvotes: r.upvotes,
  }));
}

function oneVolatile(row: PathRecord) {
  return stripVolatile([row])[0];
}

describe("LocalPathRepository vs HttpPathRepository", () => {
  let ctx: TestContext;
  let storage: MemoryStorage;
  let local: LocalPathRepository;
  let http: HttpPathRepository;
  const API_BASE = "http://parity.test/api";

  beforeEach(async () => {
    ctx = await createTestContext();
    storage = new MemoryStorage();
    storage.setItem(LOCAL_PATHS_KEY, "[]");
    (globalThis as { localStorage?: Storage }).localStorage = storage;

    local = new LocalPathRepository();
    http = new HttpPathRepository(API_BASE);

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const path = url.pathname + url.search;
      const headers = new Headers(init?.headers);
      if (!headers.has("X-Voter-Id") && storage.getItem(VOTER_KEY)) {
        headers.set("X-Voter-Id", JSON.parse(storage.getItem(VOTER_KEY)!));
      }
      return ctx.app.request(path, { ...init, headers });
    };

    storage.setItem(VOTER_KEY, JSON.stringify(VOTER_A));
  });

  afterEach(() => {
    ctx.close();
    delete (globalThis as { fetch?: typeof fetch }).fetch;
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("matches create, list, search, upvote, update, and delete behavior", async () => {
    const drafts = [
      clientDraft({ name: "Parity First", teamNumber: 24680 }),
      clientDraft({ name: "Parity Second", teamNumber: 24681 }),
      clientDraft({ name: "Parity Third", teamNumber: 24682 }),
    ];

    const localRows = [];
    const httpRows = [];
    for (const draft of drafts) {
      localRows.push(await local.create(draft));
      httpRows.push(await http.create(draft));
    }
    expect(oneVolatile(localRows[0])).toEqual(oneVolatile(httpRows[0]));

    await local.upvote(localRows[1].id);
    await http.upvote(httpRows[1].id);
    await local.upvote(localRows[2].id);
    await http.upvote(httpRows[2].id);

    const namesNew = (rows: PathRecord[]) => stripVolatile(rows).map((r) => r.name);
    const localNew = namesNew(await local.list({ sort: "new" }));
    const httpNew = namesNew(await http.list({ sort: "new" }));
    expect(localNew).toEqual(httpNew);
    expect(localNew).toEqual(["Parity Third", "Parity Second", "Parity First"]);

    const localTop = namesNew(await local.list({ sort: "top" }));
    const httpTop = namesNew(await http.list({ sort: "top" }));
    expect(localTop).toEqual(httpTop);
    expect(localTop).toEqual(["Parity Third", "Parity Second", "Parity First"]);

    const localSearch = stripVolatile(await local.list({ q: "Parity" }));
    const httpSearch = stripVolatile(await http.list({ q: "Parity" }));
    expect(localSearch).toEqual(httpSearch);
    expect(localSearch).toHaveLength(3);

    const localUp1 = await local.upvote(localRows[0].id);
    const localUp2 = await local.upvote(localRows[0].id);
    const httpUp1 = await http.upvote(httpRows[0].id);
    const httpUp2 = await http.upvote(httpRows[0].id);
    expect(localUp1.upvotes).toBe(1);
    expect(localUp2.upvotes).toBe(1);
    expect(httpUp1.upvotes).toBe(1);
    expect(httpUp2.upvotes).toBe(1);

    const updatedSource = presetSource("four-sample");
    const localUpdated = await local.update(localRows[0].id, { name: "Parity Renamed", data: updatedSource });
    const httpUpdated = await http.update(httpRows[0].id, { name: "Parity Renamed", data: updatedSource });
    expect(oneVolatile(localUpdated)).toEqual(oneVolatile(httpUpdated));
    expect(localUpdated.data).toBe(updatedSource);
    expect(httpUpdated.data).toBe(updatedSource);
    const derived = deriveFromSource(updatedSource);
    expect(localUpdated.thumbnail).toBe(derived.thumbnail);
    expect(httpUpdated.thumbnail).toBe(derived.thumbnail);
    expect(localUpdated.stats).toEqual(derived.stats);
    expect(httpUpdated.stats).toEqual(derived.stats);

    await local.remove(localRows[0].id);
    await http.remove(httpRows[0].id);

    await expect(local.get(localRows[0].id)).rejects.toThrow(/not found/i);
    await expect(http.get(httpRows[0].id)).rejects.toThrow(/not found/i);

    // Local store tracks edit keys and votes in localStorage; HTTP uses server auth and voter headers.
    expect(storage.getItem(EDIT_KEYS_KEY)).toBeTruthy();
    expect(JSON.parse(storage.getItem(VOTED_KEY) ?? "[]")).toContain(localRows[0].id);
  });
});
