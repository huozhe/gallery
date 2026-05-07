import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- in-memory Redis mock ----
const store: Record<string, string> = {};
const sets: Record<string, Set<string>> = {};
const lists: Record<string, string[]> = {};

const hashes: Record<string, Record<string, string>> = {};

const redisMock = {
  get: vi.fn((k: string) => Promise.resolve(store[k] ?? null)),
  set: vi.fn((k: string, v: string) => { store[k] = v; return Promise.resolve("OK"); }),
  setex: vi.fn((k: string, _s: number, v: string) => { store[k] = v; return Promise.resolve("OK"); }),
  del: vi.fn((k: string) => { const had = k in store || k in sets || k in lists || k in hashes; delete store[k]; delete sets[k]; delete lists[k]; delete hashes[k]; return Promise.resolve(had ? 1 : 0); }),
  exists: vi.fn((k: string) => Promise.resolve(k in store ? 1 : 0)),
  sadd: vi.fn((k: string, ...members: string[]) => { if (!sets[k]) sets[k] = new Set(); members.forEach(m => sets[k].add(m)); return Promise.resolve(members.length); }),
  srem: vi.fn((k: string, ...members: string[]) => { members.forEach(m => sets[k]?.delete(m)); return Promise.resolve(members.length); }),
  scard: vi.fn((k: string) => Promise.resolve(sets[k]?.size ?? 0)),
  smembers: vi.fn((k: string) => Promise.resolve([...(sets[k] ?? [])])),
  mget: vi.fn((...keys: string[]) => Promise.resolve(keys.map(k => store[k] ?? null))),
  lpush: vi.fn((k: string, ...vals: string[]) => { if (!lists[k]) lists[k] = []; vals.forEach(v => lists[k].unshift(v)); return Promise.resolve(lists[k].length); }),
  ltrim: vi.fn((k: string, start: number, stop: number) => { if (lists[k]) lists[k] = lists[k].slice(start, stop + 1); return Promise.resolve("OK"); }),
  lrange: vi.fn((k: string, start: number, stop: number) => Promise.resolve((lists[k] ?? []).slice(start, stop === -1 ? undefined : stop + 1))),
  incr: vi.fn((k: string) => { const n = parseInt(store[k] ?? "0", 10) + 1; store[k] = String(n); return Promise.resolve(n); }),
  hset: vi.fn((k: string, field: string, value: string) => { if (!hashes[k]) hashes[k] = {}; hashes[k][field] = value; return Promise.resolve(1); }),
  hget: vi.fn((k: string, field: string) => Promise.resolve(hashes[k]?.[field] ?? null)),
  hdel: vi.fn((k: string, field: string) => { const had = !!hashes[k]?.[field]; delete hashes[k]?.[field]; return Promise.resolve(had ? 1 : 0); }),
};

vi.mock("ioredis", () => ({
  default: class {
    constructor() { return redisMock; }
  },
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => ({ url: `https://blob.example.com/${pathname}` })),
}));

// Set REDIS_URL before importing the module
process.env.REDIS_URL = "redis://localhost:6379";
process.env.REDIS_KEY_PREFIX = "test:";
process.env.GALLERY_ADMIN_EMAIL = "admin@test.com";
process.env.GALLERY_ADMIN_PASSWORD = "testpass123";

// Reset the global raw connection before import so each test file gets a fresh instance
delete (globalThis as Record<string, unknown>)._redisRaw;

const { artworks, tags, users, sessions, audit, about, blob, _seededPrefixes } = await import("@/lib/store.kv");

function clearAll() {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(sets)) delete sets[k];
  for (const k of Object.keys(lists)) delete lists[k];
  for (const k of Object.keys(hashes)) delete hashes[k];
  // Do NOT clear _seededPrefixes: keeping seeded state across tests prevents
  // ensureSeeded() from re-seeding into a cleared store, which would restore
  // explicitly purged records and break tests like "purges an artwork".
}

const BASE_TAG = {
  id: "paintings",
  title: "Paintings",
  order: 0,
  visible: true,
  isPrimaryRoom: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const BASE_ARTWORK = {
  id: 1,
  slug: "work-1",
  title: "Test Work",
  year: 2024,
  medium: "Oil",
  image: "/test.jpg",
  width: 800,
  height: 600,
  status: "live" as const,
  tagIds: ["paintings"],
  orderGlobal: 0,
  orderByTag: { paintings: 0 },
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("artworks", () => {
  beforeEach(clearAll);

  it("upserts and retrieves an artwork", async () => {
    await artworks.upsert(BASE_ARTWORK);
    const found = await artworks.get(1);
    expect(found?.title).toBe("Test Work");
  });

  it("retrieves an artwork by slug", async () => {
    await artworks.upsert(BASE_ARTWORK);
    const found = await artworks.getBySlug("work-1");
    expect(found?.title).toBe("Test Work");
  });

  it("lists only non-deleted artworks by default", async () => {
    await artworks.upsert(BASE_ARTWORK);
    await artworks.upsert({ ...BASE_ARTWORK, id: 2, slug: "work-2", status: "deleted", orderGlobal: 1 });
    const list = await artworks.list();
    expect(list.map(a => a.slug)).not.toContain("work-2");
  });

  it("lists trashed artworks", async () => {
    await artworks.upsert({ ...BASE_ARTWORK, status: "deleted" });
    const list = await artworks.list({ trashed: true });
    expect(list[0].slug).toBe("work-1");
  });

  it("soft-deletes an artwork", async () => {
    await artworks.upsert(BASE_ARTWORK);
    await artworks.softDelete(1);
    const found = await artworks.get(1);
    expect(found?.status).toBe("deleted");
  });

  it("restores a soft-deleted artwork", async () => {
    await artworks.upsert({ ...BASE_ARTWORK, status: "deleted" });
    await artworks.restore(1);
    const found = await artworks.get(1);
    expect(found?.status).toBe("live");
    expect(found?.deletedAt).toBeUndefined();
  });

  it("purges an artwork", async () => {
    await artworks.upsert(BASE_ARTWORK);
    await artworks.purge(1);
    expect(await artworks.get(1)).toBeNull();
  });
});

describe("tags", () => {
  beforeEach(clearAll);

  it("upserts and retrieves a tag", async () => {
    await tags.upsert(BASE_TAG);
    const found = await tags.get("paintings");
    expect(found?.title).toBe("Paintings");
  });

  it("lists and filters by visible", async () => {
    await tags.upsert(BASE_TAG);
    await tags.upsert({ ...BASE_TAG, id: "hidden-tag", visible: false });
    const visible = await tags.list({ visible: true });
    expect(visible.every(t => t.visible)).toBe(true);
  });

  it("deletes a tag and removes it from artwork tagIds", async () => {
    await tags.upsert(BASE_TAG);
    await artworks.upsert(BASE_ARTWORK);
    await tags.delete("paintings");
    expect(await tags.get("paintings")).toBeNull();
    const work = await artworks.get(1);
    expect(work?.tagIds).not.toContain("paintings");
  });
});

describe("users", () => {
  beforeEach(clearAll);

  const USER = {
    id: "user-1",
    email: "test@example.com",
    passwordHash: "fakehash",
    createdAt: "2024-01-01T00:00:00.000Z",
  };

  it("upserts and retrieves by email", async () => {
    await users.upsert(USER);
    const found = await users.getByEmail("test@example.com");
    expect(found?.id).toBe("user-1");
  });

  it("retrieves by id", async () => {
    await users.upsert(USER);
    const found = await users.getById("user-1");
    expect(found?.email).toBe("test@example.com");
  });

  it("email lookup is case-insensitive", async () => {
    await users.upsert(USER);
    expect(await users.getByEmail("TEST@EXAMPLE.COM")).not.toBeNull();
  });

  it("deletes a user", async () => {
    await users.upsert(USER);
    await users.delete("test@example.com");
    expect(await users.getByEmail("test@example.com")).toBeNull();
  });
});

describe("sessions", () => {
  beforeEach(clearAll);

  it("stores and retrieves a session", async () => {
    const session = {
      id: "sess-1",
      userId: "user-1",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    await sessions.upsert("hash-abc", session);
    const found = await sessions.get("hash-abc");
    expect(found?.id).toBe("sess-1");
  });

  it("returns null for expired sessions", async () => {
    const session = {
      id: "sess-exp",
      userId: "user-1",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    await sessions.upsert("hash-expired", session);
    expect(await sessions.get("hash-expired")).toBeNull();
  });

  it("deletes a session", async () => {
    const session = {
      id: "sess-2",
      userId: "user-1",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    await sessions.upsert("hash-del", session);
    await sessions.delete("hash-del");
    expect(await sessions.get("hash-del")).toBeNull();
  });
});

describe("audit", () => {
  beforeEach(clearAll);

  it("logs and lists entries", async () => {
    await audit.log({ id: "a1", at: new Date().toISOString(), actorId: "u1", actorEmail: "u@test.com", action: "artwork.create", target: "w1", ip: "127.0.0.1" });
    const entries = await audit.list();
    expect(entries[0].id).toBe("a1");
  });
});

describe("about", () => {
  beforeEach(clearAll);

  it("stores and retrieves about content", async () => {
    await about.set({ bio: "Test bio", email: "a@b.com", updatedAt: new Date().toISOString() });
    const content = await about.get();
    expect(content.bio).toBe("Test bio");
  });
});

describe("blob", () => {
  it("uploads and returns URL", async () => {
    const url = await blob.upload("artwork/test.jpg", Buffer.from("data"));
    expect(url).toContain("blob.example.com");
  });
});
