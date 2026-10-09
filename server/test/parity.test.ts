import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpPathRepository, LocalPathRepository } from "../../src/repo/client.js";
import type { PathRecord } from "../../src/repo/types.js";
import { createTestContext, validDraft, VOTER_A, type TestContext } from "./helpers.js";

const LOCAL_PATHS_KEY = "dsim.paths.v1";
const EDIT_KEYS_KEY = "deepsim.editKeys.v1";
const VOTED_KEY = "deepsim.voted.v1";
const VOTER_KEY = "deepsim.voterId.v1";

class MemoryStorage {
  private map = new Map<string, string>();
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
    (globalThis as { localStorage?: MemoryStorage }).localStorage = storage as unknown as Storage;

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
    const draft = validDraft({ name: "Parity Path", teamNumber: 24680 });

    const localCreated = await local.create(draft);
    const httpCreated = await http.create(draft);

    expect(oneVolatile(localCreated)).toEqual(oneVolatile(httpCreated));

    const localNew = stripVolatile(await local.list({ sort: "new" }));
    const httpNew = stripVolatile(await http.list({ sort: "new" }));
    expect(localNew).toEqual(httpNew);

    const localTop = stripVolatile(await local.list({ sort: "top" }));
    const httpTop = stripVolatile(await http.list({ sort: "top" }));
    expect(localTop).toEqual(httpTop);

    const localSearch = stripVolatile(await local.list({ q: "Parity" }));
    const httpSearch = stripVolatile(await http.list({ q: "Parity" }));
    expect(localSearch).toEqual(httpSearch);

    const localUp1 = await local.upvote(localCreated.id);
    const localUp2 = await local.upvote(localCreated.id);
    const httpUp1 = await http.upvote(httpCreated.id);
    const httpUp2 = await http.upvote(httpCreated.id);
    expect(localUp1.upvotes).toBe(1);
    expect(localUp2.upvotes).toBe(1);
    expect(httpUp1.upvotes).toBe(1);
    expect(httpUp2.upvotes).toBe(1);

    const localUpdated = await local.update(localCreated.id, { name: "Parity Renamed", data: draft.data });
    const httpUpdated = await http.update(httpCreated.id, { name: "Parity Renamed", data: draft.data });
    expect(oneVolatile(localUpdated)).toEqual(oneVolatile(httpUpdated));

    await local.remove(localCreated.id);
    await http.remove(httpCreated.id);

    await expect(local.get(localCreated.id)).rejects.toThrow(/not found/i);
    await expect(http.get(httpCreated.id)).rejects.toThrow(/not found/i);

    // Local store tracks edit keys and votes in localStorage; HTTP uses server auth and voter headers.
    expect(storage.getItem(EDIT_KEYS_KEY)).toBeTruthy();
    expect(JSON.parse(storage.getItem(VOTED_KEY) ?? "[]")).toContain(localCreated.id);
  });
});
