// Vercel Redis (marketplace) + Blob store.
// Used in production when REDIS_URL is set.
// Exported surface is identical to store.file.ts — callers are unaffected.

import Redis from "ioredis";
import { put } from "@vercel/blob";
import { ulid } from "ulid";
import { headers } from "next/headers";
import type {
  AboutContent,
  Artwork,
  AuditEntry,
  Session,
  Tag,
  User,
} from "@/data/types";
import { seedAbout, seedArtworks, seedTags } from "@/data/seed";
import { SESSION_TTL_SECONDS } from "@/lib/session-config";
import { getTenantFromHeaders } from "@/lib/tenant";

const AUDIT_CAP = 5000;

// Wraps ioredis and prepends prefix to every key automatically.
// All code uses PrefixedRedis — raw string keys can never bypass the prefix.
class PrefixedRedis {
  constructor(private r: Redis, readonly prefix: string) {}
  private k(key: string) { return `${this.prefix}${key}`; }

  get(key: string)                                        { return this.r.get(this.k(key)); }
  set(key: string, val: string)                           { return this.r.set(this.k(key), val); }
  setex(key: string, seconds: number, val: string)        { return this.r.setex(this.k(key), seconds, val); }
  del(key: string)                                        { return this.r.del(this.k(key)); }
  exists(key: string)                                     { return this.r.exists(this.k(key)); }
  sadd(key: string, ...members: string[])                 { return this.r.sadd(this.k(key), ...members); }
  srem(key: string, ...members: string[])                 { return this.r.srem(this.k(key), ...members); }
  scard(key: string)                                      { return this.r.scard(this.k(key)); }
  smembers(key: string)                                   { return this.r.smembers(this.k(key)); }
  mget(...keys: string[])                                 { return this.r.mget(...keys.map(k => this.k(k))); }
  lpush(key: string, ...values: string[])                 { return this.r.lpush(this.k(key), ...values); }
  ltrim(key: string, start: number, stop: number)         { return this.r.ltrim(this.k(key), start, stop); }
  lrange(key: string, start: number, stop: number)        { return this.r.lrange(this.k(key), start, stop); }
  incr(key: string)                                       { return this.r.incr(this.k(key)); }
  hset(key: string, field: string, value: string)         { return this.r.hset(this.k(key), field, value); }
  hmset(key: string, fields: Record<string, string>)      { return this.r.hset(this.k(key), fields); }
  hget(key: string, field: string)                        { return this.r.hget(this.k(key), field); }
  hdel(key: string, field: string)                        { return this.r.hdel(this.k(key), field); }
  hgetall(key: string)                                    { return this.r.hgetall(this.k(key)); }
  rpush(key: string, ...values: string[])                 { return this.r.rpush(this.k(key), ...values); }
  type(key: string)                                       { return this.r.type(this.k(key)); }

  async scan(pattern: string): Promise<string[]> {
    const all: string[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await this.r.scan(cursor, "MATCH", this.k(pattern), "COUNT", 100);
      cursor = next;
      all.push(...keys.map((k) => k.slice(this.prefix.length)));
    } while (cursor !== "0");
    return all;
  }
}

// Raw ioredis connection — singleton shared across all tenants and requests.
// Creating a new connection per request would be prohibitively expensive on serverless.
declare global {
  // eslint-disable-next-line no-var
  var _redisRaw: Redis | undefined;
}

function getRawConnection(): Redis {
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL is not set");
  }
  if (!globalThis._redisRaw) {
    // Parse with WHATWG URL to avoid ioredis's internal url.parse() deprecation warning (DEP0169).
    const u = new URL(process.env.REDIS_URL);
    globalThis._redisRaw = new Redis({
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : 6379,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      tls: u.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return globalThis._redisRaw;
}

// Returns a PrefixedRedis scoped to the current tenant's prefix.
// Reads from x-tenant-redis-prefix header (stamped by middleware).
// Falls back to REDIS_KEY_PREFIX env var when called outside a request context.
async function getClient(): Promise<PrefixedRedis> {
  let prefix = process.env.REDIS_KEY_PREFIX ?? "";
  try {
    const h = await headers();
    prefix = getTenantFromHeaders(h).redisPrefix;
  } catch {
    // Outside request context (scripts, tests) — env var fallback applies.
  }
  return new PrefixedRedis(getRawConnection(), prefix);
}

// ---------- JSON helpers ----------

function ser(value: unknown): string {
  return JSON.stringify(value);
}

function de<T>(value: string | null): T | null {
  if (value === null) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

async function get<T>(key: string): Promise<T | null> {
  return de<T>(await (await getClient()).get(key));
}

async function set(key: string, value: unknown, exSeconds?: number): Promise<void> {
  const r = await getClient();
  if (exSeconds) {
    await r.setex(key, exSeconds, ser(value));
  } else {
    await r.set(key, ser(value));
  }
}

async function mget<T>(keys: string[]): Promise<(T | null)[]> {
  if (!keys.length) return [];
  const raw = await (await getClient()).mget(...keys);
  return raw.map((v) => de<T>(v));
}

// ---------- seeding ----------

// Keyed by prefix so each tenant seeds independently.
const seeded = new Set<string>();

// Exported for test teardown only (clear between tests).
export const _seededPrefixes = seeded;

async function ensureSeeded(): Promise<void> {
  const r = await getClient();
  if (seeded.has(r.prefix)) return;
  const count = await r.scard("artworks:index");
  if (count === 0) {
    for (const tag of seedTags) {
      await set(`tag:${tag.id}`, tag);
      await r.sadd("tags:index", tag.id);
    }
    for (const art of seedArtworks) {
      await set(`artwork:${art.id}`, art);
      await r.sadd("artworks:index", String(art.id));
      await r.hset("artworks:slugs", art.slug, String(art.id));
    }
    await r.set("artworks:counter", String(seedArtworks.length));
    await set("about:content", seedAbout);
  }

  // Admin user seeding is independent — runs even if artworks were already seeded
  const userCount = await r.scard("users:index");
  if (
    userCount === 0 &&
    process.env.GALLERY_ADMIN_EMAIL &&
    process.env.GALLERY_ADMIN_PASSWORD
  ) {
    const { hashPassword } = await import("@/lib/auth");
    const passwordHash = await hashPassword(process.env.GALLERY_ADMIN_PASSWORD);
    const user: User = {
      id: ulid(),
      email: process.env.GALLERY_ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    await set(`user:${user.email}`, user);
    await r.sadd("users:index", user.email);
  }
  seeded.add(r.prefix);
}

// ---------- seed (public, used by migrate script) ----------

export async function seed(): Promise<{ tags: number; artworks: number }> {
  const r = await getClient();
  let addedTags = 0;
  let addedArtworks = 0;
  for (const tag of seedTags) {
    const exists = await r.exists(`tag:${tag.id}`);
    if (!exists) {
      await set(`tag:${tag.id}`, tag);
      await r.sadd("tags:index", tag.id);
      addedTags++;
    }
  }
  for (const art of seedArtworks) {
    const exists = await r.exists(`artwork:${art.id}`);
    if (!exists) {
      await set(`artwork:${art.id}`, art);
      await r.sadd("artworks:index", String(art.id));
      await r.hset("artworks:slugs", art.slug, String(art.id));
      addedArtworks++;
    }
  }
  if (addedArtworks > 0) {
    await r.set("artworks:counter", String(seedArtworks.length));
  }
  return { tags: addedTags, artworks: addedArtworks };
}

// ---------- artworks ----------

export const artworks = {
  async list(
    opts: { status?: Artwork["status"]; trashed?: boolean; tagId?: string } = {}
  ): Promise<Artwork[]> {
    await ensureSeeded();
    const r = await getClient();
    const ids = await r.smembers("artworks:index");
    if (!ids.length) return [];
    let list = (await mget<Artwork>(ids.map((id) => `artwork:${id}`))).filter(
      (a): a is Artwork => a !== null
    );
    if (opts.trashed) {
      list = list.filter((a) => a.status === "deleted");
    } else {
      list = list.filter((a) => a.status !== "deleted");
    }
    if (opts.status) list = list.filter((a) => a.status === opts.status);
    if (opts.tagId) list = list.filter((a) => a.tagIds.includes(opts.tagId!));
    list.sort((a, b) => a.orderGlobal - b.orderGlobal);
    return list;
  },

  async get(id: number): Promise<Artwork | null> {
    await ensureSeeded();
    return get<Artwork>(`artwork:${id}`);
  },

  async getBySlug(slug: string): Promise<Artwork | null> {
    await ensureSeeded();
    const r = await getClient();
    const idStr = await r.hget("artworks:slugs", slug);
    if (!idStr) return null;
    return get<Artwork>(`artwork:${idStr}`);
  },

  async nextId(): Promise<number> {
    return (await getClient()).incr("artworks:counter");
  },

  async upsert(record: Artwork): Promise<Artwork> {
    const r = await getClient();
    const existing = await get<Artwork>(`artwork:${record.id}`);
    const now = new Date().toISOString();
    const next: Artwork = {
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt ?? now,
      updatedAt: now,
    };
    if (existing && existing.slug !== next.slug) {
      await r.hdel("artworks:slugs", existing.slug);
    }
    await r.hset("artworks:slugs", next.slug, String(next.id));
    await set(`artwork:${next.id}`, next);
    await r.sadd("artworks:index", String(next.id));
    return next;
  },

  async softDelete(id: number): Promise<void> {
    const a = await get<Artwork>(`artwork:${id}`);
    if (!a) return;
    const now = new Date().toISOString();
    await set(`artwork:${id}`, { ...a, status: "deleted", deletedAt: now, updatedAt: now });
  },

  async restore(id: number): Promise<void> {
    const a = await get<Artwork>(`artwork:${id}`);
    if (!a) return;
    const { deletedAt: _d, ...rest } = a;
    await set(`artwork:${id}`, { ...rest, status: "live", updatedAt: new Date().toISOString() });
  },

  async purge(id: number): Promise<void> {
    const r = await getClient();
    const existing = await get<Artwork>(`artwork:${id}`);
    if (existing) await r.hdel("artworks:slugs", existing.slug);
    await r.del(`artwork:${id}`);
    await r.srem("artworks:index", String(id));
  },
};

// ---------- tags ----------

export const tags = {
  async list(opts: { visible?: boolean; primaryRoom?: boolean } = {}): Promise<Tag[]> {
    await ensureSeeded();
    const r = await getClient();
    const ids = await r.smembers("tags:index");
    if (!ids.length) return [];
    let list = (await mget<Tag>(ids.map((id) => `tag:${id}`))).filter(
      (t): t is Tag => t !== null
    );
    if (opts.visible !== undefined) list = list.filter((t) => t.visible === opts.visible);
    if (opts.primaryRoom !== undefined)
      list = list.filter((t) => t.isPrimaryRoom === opts.primaryRoom);
    list.sort((a, b) => a.order - b.order);
    return list;
  },

  async get(id: string): Promise<Tag | null> {
    return get<Tag>(`tag:${id}`);
  },

  async upsert(record: Tag): Promise<Tag> {
    const r = await getClient();
    const existing = await get<Tag>(`tag:${record.id}`);
    const now = new Date().toISOString();
    const next: Tag = {
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt ?? now,
      updatedAt: now,
    };
    await set(`tag:${next.id}`, next);
    await r.sadd("tags:index", next.id);
    return next;
  },

  async delete(id: string): Promise<void> {
    const r = await getClient();
    await r.del(`tag:${id}`);
    await r.srem("tags:index", id);
    const ids = await r.smembers("artworks:index");
    for (const artId of ids) {
      const a = await get<Artwork>(`artwork:${artId}`);
      if (!a || !a.tagIds.includes(id)) continue;
      const { [id]: _removed, ...orderByTag } = a.orderByTag;
      await set(`artwork:${artId}`, {
        ...a,
        tagIds: a.tagIds.filter((t) => t !== id),
        orderByTag,
        updatedAt: new Date().toISOString(),
      });
    }
  },
};

// ---------- users ----------

export const users = {
  async list(): Promise<User[]> {
    await ensureSeeded();
    const r = await getClient();
    const emails = await r.smembers("users:index");
    if (!emails.length) return [];
    return (await mget<User>(emails.map((e) => `user:${e}`))).filter(
      (u): u is User => u !== null
    );
  },

  async getByEmail(email: string): Promise<User | null> {
    await ensureSeeded();
    return get<User>(`user:${email.toLowerCase()}`);
  },

  async getById(id: string): Promise<User | null> {
    await ensureSeeded();
    const r = await getClient();
    const emails = await r.smembers("users:index");
    if (!emails.length) return null;
    const records = await mget<User>(emails.map((e) => `user:${e}`));
    return records.find((u): u is User => u !== null && u.id === id) ?? null;
  },

  async upsert(record: User): Promise<User> {
    const r = await getClient();
    await set(`user:${record.email.toLowerCase()}`, record);
    await r.sadd("users:index", record.email.toLowerCase());
    return record;
  },

  async delete(email: string): Promise<void> {
    const r = await getClient();
    await r.del(`user:${email.toLowerCase()}`);
    await r.srem("users:index", email.toLowerCase());
  },
};

// ---------- sessions ----------

export const sessions = {
  async get(tokenHash: string): Promise<Session | null> {
    await ensureSeeded();
    const s = await get<Session>(`session:${tokenHash}`);
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) {
      await (await getClient()).del(`session:${tokenHash}`);
      return null;
    }
    return s;
  },

  async upsert(tokenHash: string, record: Session): Promise<Session> {
    await set(`session:${tokenHash}`, record, SESSION_TTL_SECONDS);
    return record;
  },

  async delete(tokenHash: string): Promise<void> {
    await (await getClient()).del(`session:${tokenHash}`);
  },
};

// ---------- audit ----------

export const audit = {
  async log(entry: AuditEntry): Promise<void> {
    const r = await getClient();
    await r.lpush("audit:log", ser(entry));
    await r.ltrim("audit:log", 0, AUDIT_CAP - 1);
  },

  async list(limit = 200): Promise<AuditEntry[]> {
    const raw = await (await getClient()).lrange("audit:log", 0, limit - 1);
    return raw.map((v) => de<AuditEntry>(v)).filter((e): e is AuditEntry => e !== null);
  },
};

// ---------- about ----------

export const about = {
  async get(): Promise<AboutContent> {
    return (await get<AboutContent>("about:content")) ?? seedAbout;
  },

  async set(content: AboutContent): Promise<AboutContent> {
    await set("about:content", content);
    return content;
  },
};

// ---------- blob ----------

export const blob = {
  async upload(pathname: string, data: Buffer | Uint8Array): Promise<string> {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const { url } = await put(pathname, buf, { access: "public" });
    return url;
  },
  async signedUploadUrl(_pathname: string): Promise<string> {
    throw new Error("Use the upload route to upload files via Vercel Blob.");
  },
};

// ---------- backup ----------

export type BackupEntry =
  | { type: "string"; value: string }
  | { type: "set"; value: string[] }
  | { type: "hash"; value: Record<string, string> }
  | { type: "list"; value: string[] };

export type BackupData = {
  timestamp: string;
  prefix: string;
  data: Record<string, BackupEntry>;
};

export async function backupRedis(): Promise<BackupData> {
  const r = await getClient();
  const keys = await r.scan("*");
  const data: Record<string, BackupEntry> = {};
  for (const key of keys) {
    if (key.startsWith("session:")) continue;
    const type = await r.type(key);
    let entry: BackupEntry | null = null;
    switch (type) {
      case "string": {
        const v = await r.get(key);
        if (v !== null) entry = { type: "string", value: v };
        break;
      }
      case "set":
        entry = { type: "set", value: await r.smembers(key) };
        break;
      case "hash": {
        const h = await r.hgetall(key);
        if (h) entry = { type: "hash", value: h };
        break;
      }
      case "list":
        entry = { type: "list", value: await r.lrange(key, 0, -1) };
        break;
    }
    if (entry) data[key] = entry;
  }
  return { timestamp: new Date().toISOString(), prefix: r.prefix, data };
}

export async function restoreRedis(data: BackupData): Promise<{ keys: number }> {
  const r = await getClient();

  if (data.prefix && data.prefix !== r.prefix) {
    throw new Error(
      `Backup prefix "${data.prefix}" does not match current tenant prefix "${r.prefix}". ` +
      `Log in to the correct tenant admin to restore this backup.`
    );
  }

  // delete all non-session keys under the current prefix
  const existing = await r.scan("*");
  for (const key of existing) {
    if (!key.startsWith("session:")) await r.del(key);
  }

  // write all keys from backup (sessions excluded at backup time, but guard anyway)
  let count = 0;
  for (const [key, entry] of Object.entries(data.data)) {
    if (key.startsWith("session:")) continue;
    switch (entry.type) {
      case "string":
        await r.set(key, entry.value);
        break;
      case "set":
        if (entry.value.length > 0) await r.sadd(key, ...entry.value);
        break;
      case "hash":
        if (Object.keys(entry.value).length > 0) await r.hmset(key, entry.value);
        break;
      case "list":
        if (entry.value.length > 0) await r.rpush(key, ...entry.value);
        break;
    }
    count++;
  }

  return { keys: count };
}
