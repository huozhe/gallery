// Vercel KV + Blob store. Used in production when KV_REST_API_URL is set.
// Exported surface is identical to store.file.ts — callers are unaffected.

import { kv } from "@vercel/kv";
import { put } from "@vercel/blob";
import { ulid } from "ulid";
import type {
  AboutContent,
  Artwork,
  AuditEntry,
  Session,
  Tag,
  User,
} from "@/data/types";
import { seedAbout, seedArtworks, seedTags } from "@/data/seed";
import { hashPassword } from "@/lib/auth";
import { SESSION_TTL_SECONDS } from "@/lib/session-config";

const AUDIT_CAP = 5000;

// ---------- seeding ----------

let seeded = false;

async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  const count = await kv.scard("artworks:index");
  if (count === 0) {
    // Tags
    for (const tag of seedTags) {
      await kv.set(`tag:${tag.id}`, tag);
      await kv.sadd("tags:index", tag.id);
    }
    // Artworks
    for (const art of seedArtworks) {
      await kv.set(`artwork:${art.id}`, art);
      await kv.sadd("artworks:index", art.id);
    }
    // About
    await kv.set("about:content", seedAbout);
    // Admin user from env vars
    const userCount = await kv.scard("users:index");
    if (
      userCount === 0 &&
      process.env.GALLERY_ADMIN_EMAIL &&
      process.env.GALLERY_ADMIN_PASSWORD
    ) {
      const passwordHash = await hashPassword(process.env.GALLERY_ADMIN_PASSWORD);
      const user: User = {
        id: ulid(),
        email: process.env.GALLERY_ADMIN_EMAIL.toLowerCase(),
        passwordHash,
        createdAt: new Date().toISOString(),
      };
      await kv.set(`user:${user.email}`, user);
      await kv.sadd("users:index", user.email);
    }
  }
  seeded = true;
}

// ---------- seed (public, used by migrate script) ----------

export async function seed(): Promise<{ tags: number; artworks: number }> {
  let addedTags = 0;
  let addedArtworks = 0;
  for (const tag of seedTags) {
    const exists = await kv.exists(`tag:${tag.id}`);
    if (!exists) {
      await kv.set(`tag:${tag.id}`, tag);
      await kv.sadd("tags:index", tag.id);
      addedTags++;
    }
  }
  for (const art of seedArtworks) {
    const exists = await kv.exists(`artwork:${art.id}`);
    if (!exists) {
      await kv.set(`artwork:${art.id}`, art);
      await kv.sadd("artworks:index", art.id);
      addedArtworks++;
    }
  }
  return { tags: addedTags, artworks: addedArtworks };
}

// ---------- artworks ----------

export const artworks = {
  async list(
    opts: { status?: Artwork["status"]; trashed?: boolean; tagId?: string } = {}
  ): Promise<Artwork[]> {
    await ensureSeeded();
    const ids = await kv.smembers<string[]>("artworks:index");
    if (!ids.length) return [];
    const records = await kv.mget<Artwork[]>(...ids.map((id) => `artwork:${id}`));
    let list = records.filter((r): r is Artwork => r !== null);
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

  async get(id: string): Promise<Artwork | null> {
    await ensureSeeded();
    return kv.get<Artwork>(`artwork:${id}`);
  },

  async upsert(record: Artwork): Promise<Artwork> {
    const existing = await kv.get<Artwork>(`artwork:${record.id}`);
    const now = new Date().toISOString();
    const next: Artwork = {
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt ?? now,
      updatedAt: now,
    };
    await kv.set(`artwork:${next.id}`, next);
    await kv.sadd("artworks:index", next.id);
    return next;
  },

  async softDelete(id: string): Promise<void> {
    const a = await kv.get<Artwork>(`artwork:${id}`);
    if (!a) return;
    const now = new Date().toISOString();
    await kv.set(`artwork:${id}`, { ...a, status: "deleted", deletedAt: now, updatedAt: now });
  },

  async restore(id: string): Promise<void> {
    const a = await kv.get<Artwork>(`artwork:${id}`);
    if (!a) return;
    const { deletedAt: _d, ...rest } = a;
    await kv.set(`artwork:${id}`, { ...rest, status: "live", updatedAt: new Date().toISOString() });
  },

  async purge(id: string): Promise<void> {
    await kv.del(`artwork:${id}`);
    await kv.srem("artworks:index", id);
  },
};

// ---------- tags ----------

export const tags = {
  async list(opts: { visible?: boolean; primaryRoom?: boolean } = {}): Promise<Tag[]> {
    await ensureSeeded();
    const ids = await kv.smembers<string[]>("tags:index");
    if (!ids.length) return [];
    const records = await kv.mget<Tag[]>(...ids.map((id) => `tag:${id}`));
    let list = records.filter((r): r is Tag => r !== null);
    if (opts.visible !== undefined) list = list.filter((t) => t.visible === opts.visible);
    if (opts.primaryRoom !== undefined)
      list = list.filter((t) => t.isPrimaryRoom === opts.primaryRoom);
    list.sort((a, b) => a.order - b.order);
    return list;
  },

  async get(id: string): Promise<Tag | null> {
    return kv.get<Tag>(`tag:${id}`);
  },

  async upsert(record: Tag): Promise<Tag> {
    const existing = await kv.get<Tag>(`tag:${record.id}`);
    const now = new Date().toISOString();
    const next: Tag = {
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt ?? now,
      updatedAt: now,
    };
    await kv.set(`tag:${next.id}`, next);
    await kv.sadd("tags:index", next.id);
    return next;
  },

  async delete(id: string): Promise<void> {
    await kv.del(`tag:${id}`);
    await kv.srem("tags:index", id);
    // Remove tag from all artworks
    const ids = await kv.smembers<string[]>("artworks:index");
    for (const artId of ids) {
      const a = await kv.get<Artwork>(`artwork:${artId}`);
      if (!a || !a.tagIds.includes(id)) continue;
      const { [id]: _removed, ...orderByTag } = a.orderByTag;
      await kv.set(`artwork:${artId}`, {
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
    const emails = await kv.smembers<string[]>("users:index");
    if (!emails.length) return [];
    const records = await kv.mget<User[]>(...emails.map((e) => `user:${e}`));
    return records.filter((r): r is User => r !== null);
  },

  async getByEmail(email: string): Promise<User | null> {
    return kv.get<User>(`user:${email.toLowerCase()}`);
  },

  async getById(id: string): Promise<User | null> {
    const emails = await kv.smembers<string[]>("users:index");
    if (!emails.length) return null;
    const records = await kv.mget<User[]>(...emails.map((e) => `user:${e}`));
    return records.find((r): r is User => r !== null && r.id === id) ?? null;
  },

  async upsert(record: User): Promise<User> {
    await kv.set(`user:${record.email.toLowerCase()}`, record);
    await kv.sadd("users:index", record.email.toLowerCase());
    return record;
  },

  async delete(email: string): Promise<void> {
    await kv.del(`user:${email.toLowerCase()}`);
    await kv.srem("users:index", email.toLowerCase());
  },
};

// ---------- sessions ----------

export const sessions = {
  async get(tokenHash: string): Promise<Session | null> {
    const s = await kv.get<Session>(`session:${tokenHash}`);
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) {
      await kv.del(`session:${tokenHash}`);
      return null;
    }
    return s;
  },

  async upsert(tokenHash: string, record: Session): Promise<Session> {
    await kv.set(`session:${tokenHash}`, record, { ex: SESSION_TTL_SECONDS });
    return record;
  },

  async delete(tokenHash: string): Promise<void> {
    await kv.del(`session:${tokenHash}`);
  },
};

// ---------- audit ----------

export const audit = {
  async log(entry: AuditEntry): Promise<void> {
    await kv.lpush("audit:log", entry);
    await kv.ltrim("audit:log", 0, AUDIT_CAP - 1);
  },

  async list(limit = 200): Promise<AuditEntry[]> {
    const raw = await kv.lrange<AuditEntry>("audit:log", 0, limit - 1);
    return raw;
  },
};

// ---------- about ----------

export const about = {
  async get(): Promise<AboutContent> {
    const stored = await kv.get<AboutContent>("about:content");
    return stored ?? seedAbout;
  },

  async set(content: AboutContent): Promise<AboutContent> {
    await kv.set("about:content", content);
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
