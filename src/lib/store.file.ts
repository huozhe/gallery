// Local-dev store backed by a JSON file on disk (.data/{tenantId}/store.json).
// This is the option-B fallback: matches the API surface the spec requires
// (Vercel KV + Blob), but persists to disk so the site works locally.
//
// To swap in Vercel KV + Blob later, replace readFile / persist / blob
// without changing the exported `artworks` / `tags` / etc. surface.
//
// No in-memory cache: every operation reads-then-writes atomically. This
// keeps multi-process scenarios (dev server + a CLI script writing concurrently)
// safe enough for local dev. Writes within a single process are serialized
// via per-tenant write chains.

import { promises as fs } from "fs";
import path from "path";
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
import { getTenantFromHeaders } from "@/lib/tenant";

type StoreData = {
  artworks: Record<string, Artwork>; // keyed by stringified numeric id
  artworkCounter: number;
  tags: Record<string, Tag>;
  users: Record<string, User>; // keyed by lowercased email
  sessions: Record<string, Session>; // keyed by token hash
  audit: AuditEntry[]; // newest-first, capped
  about?: AboutContent;
};

const AUDIT_CAP = 5000;

// Per-tenant write chains, keyed by resolved file path.
const writeChains = new Map<string, Promise<void>>();

function emptyData(): StoreData {
  return { artworks: {}, artworkCounter: 0, tags: {}, users: {}, sessions: {}, audit: [] };
}

async function getDataFile(): Promise<string> {
  try {
    const h = await headers();
    const tenant = getTenantFromHeaders(h);
    if (tenant.id !== "default") {
      return path.join(process.cwd(), ".data", tenant.id, "store.json");
    }
  } catch {
    // Outside request context (scripts, tests) — use default path.
  }
  return path.join(process.cwd(), ".data", "store.json");
}

async function readFile(): Promise<StoreData> {
  const dataFile = await getDataFile();
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    return { ...emptyData(), ...(JSON.parse(raw) as Partial<StoreData>) };
  } catch {
    return emptyData();
  }
}

async function persist(dataFile: string, data: StoreData): Promise<void> {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(data, null, 2), "utf8");
}

/** Read latest from disk, run mutator, write back. Serialized per tenant. */
async function update<T>(mutator: (data: StoreData) => T | Promise<T>): Promise<T> {
  const dataFile = await getDataFile();
  let result!: T;
  const prev = writeChains.get(dataFile) ?? Promise.resolve();
  const next = prev.then(async () => {
    const data = await readFile();
    result = await mutator(data);
    await persist(dataFile, data);
  });
  writeChains.set(dataFile, next);
  await next;
  return result;
}

/** Read with auto-seed: if both artworks+tags are empty, seed first. */
async function load(): Promise<StoreData> {
  const data = await readFile();
  if (
    Object.keys(data.artworks).length === 0 &&
    Object.keys(data.tags).length === 0
  ) {
    return update((d) => {
      for (const tag of seedTags) d.tags[tag.id] = tag;
      for (const art of seedArtworks) d.artworks[String(art.id)] = art;
      d.artworkCounter = seedArtworks.length;
      return d;
    });
  }
  return data;
}

/** Re-seed explicitly (used by `npm run migrate`). Idempotent. */
export async function seed(): Promise<{ tags: number; artworks: number }> {
  return update((data) => {
    let addedTags = 0;
    let addedArtworks = 0;
    for (const tag of seedTags) {
      if (!data.tags[tag.id]) {
        data.tags[tag.id] = tag;
        addedTags++;
      }
    }
    for (const art of seedArtworks) {
      if (!data.artworks[String(art.id)]) {
        data.artworks[String(art.id)] = art;
        addedArtworks++;
      }
    }
    if (addedArtworks > 0 && data.artworkCounter < seedArtworks.length) {
      data.artworkCounter = seedArtworks.length;
    }
    return { tags: addedTags, artworks: addedArtworks };
  });
}

// ---------- artworks ----------
export const artworks = {
  async list(opts: {
    status?: Artwork["status"];
    trashed?: boolean;
    tagId?: string;
  } = {}): Promise<Artwork[]> {
    const data = await load();
    let list = Object.values(data.artworks);
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
    const data = await load();
    return data.artworks[String(id)] ?? null;
  },

  async getBySlug(slug: string): Promise<Artwork | null> {
    const data = await load();
    return Object.values(data.artworks).find((a) => a.slug === slug) ?? null;
  },

  async nextId(): Promise<number> {
    return update((data) => {
      data.artworkCounter = (data.artworkCounter ?? 0) + 1;
      return data.artworkCounter;
    });
  },

  async upsert(record: Artwork): Promise<Artwork> {
    return update((data) => {
      const now = new Date().toISOString();
      const existing = data.artworks[String(record.id)];
      const next: Artwork = {
        ...record,
        createdAt: existing?.createdAt ?? record.createdAt ?? now,
        updatedAt: now,
      };
      data.artworks[String(record.id)] = next;
      return next;
    });
  },

  async softDelete(id: number): Promise<void> {
    await update((data) => {
      const a = data.artworks[String(id)];
      if (!a) return;
      const now = new Date().toISOString();
      a.status = "deleted";
      a.deletedAt = now;
      a.updatedAt = now;
    });
  },

  async restore(id: number): Promise<void> {
    await update((data) => {
      const a = data.artworks[String(id)];
      if (!a) return;
      a.status = "live";
      delete a.deletedAt;
      a.updatedAt = new Date().toISOString();
    });
  },

  async purge(id: number): Promise<void> {
    await update((data) => {
      delete data.artworks[String(id)];
    });
  },
};

// ---------- tags ----------
export const tags = {
  async list(opts: { visible?: boolean; primaryRoom?: boolean } = {}): Promise<Tag[]> {
    const data = await load();
    let list = Object.values(data.tags);
    if (opts.visible !== undefined) list = list.filter((t) => t.visible === opts.visible);
    if (opts.primaryRoom !== undefined)
      list = list.filter((t) => t.isPrimaryRoom === opts.primaryRoom);
    list.sort((a, b) => a.order - b.order);
    return list;
  },

  async get(id: string): Promise<Tag | null> {
    const data = await load();
    return data.tags[id] ?? null;
  },

  async upsert(record: Tag): Promise<Tag> {
    return update((data) => {
      const now = new Date().toISOString();
      const existing = data.tags[record.id];
      const next: Tag = {
        ...record,
        createdAt: existing?.createdAt ?? record.createdAt ?? now,
        updatedAt: now,
      };
      data.tags[record.id] = next;
      return next;
    });
  },

  async delete(id: string): Promise<void> {
    await update((data) => {
      delete data.tags[id];
      for (const a of Object.values(data.artworks)) {
        if (a.tagIds.includes(id)) {
          a.tagIds = a.tagIds.filter((t) => t !== id);
          delete a.orderByTag[id];
          a.updatedAt = new Date().toISOString();
        }
      }
    });
  },
};

// ---------- users ----------
export const users = {
  async list(): Promise<User[]> {
    const data = await readFile();
    return Object.values(data.users);
  },

  async getByEmail(email: string): Promise<User | null> {
    const data = await readFile();
    return data.users[email.toLowerCase()] ?? null;
  },

  async getById(id: string): Promise<User | null> {
    const data = await readFile();
    for (const u of Object.values(data.users)) if (u.id === id) return u;
    return null;
  },

  async upsert(record: User): Promise<User> {
    return update((data) => {
      data.users[record.email.toLowerCase()] = record;
      return record;
    });
  },

  async delete(email: string): Promise<void> {
    await update((data) => {
      delete data.users[email.toLowerCase()];
    });
  },
};

// ---------- sessions ----------
export const sessions = {
  async get(tokenHash: string): Promise<Session | null> {
    const data = await readFile();
    const s = data.sessions[tokenHash];
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) {
      await update((d) => {
        delete d.sessions[tokenHash];
      });
      return null;
    }
    return s;
  },

  async upsert(tokenHash: string, record: Session): Promise<Session> {
    return update((data) => {
      data.sessions[tokenHash] = record;
      return record;
    });
  },

  async delete(tokenHash: string): Promise<void> {
    await update((data) => {
      delete data.sessions[tokenHash];
    });
  },
};

// ---------- audit ----------
export const audit = {
  async log(entry: AuditEntry): Promise<void> {
    await update((data) => {
      data.audit.unshift(entry);
      if (data.audit.length > AUDIT_CAP) data.audit.length = AUDIT_CAP;
    });
  },

  async list(limit = 200): Promise<AuditEntry[]> {
    const data = await readFile();
    return data.audit.slice(0, limit);
  },
};

// ---------- about ----------
export const about = {
  async get(): Promise<AboutContent> {
    const data = await load();
    return data.about ?? seedAbout;
  },

  async set(content: AboutContent): Promise<AboutContent> {
    return update((data) => {
      data.about = content;
      return content;
    });
  },
};

// ---------- blob (stubbed; swap for Vercel Blob later) ----------
export const blob = {
  async upload(_pathname: string, _data: Buffer | Uint8Array): Promise<string> {
    throw new Error(
      "Blob storage not configured. Wire up Vercel Blob in src/lib/store.ts."
    );
  },
  async signedUploadUrl(_pathname: string): Promise<string> {
    throw new Error(
      "Blob storage not configured. Wire up Vercel Blob in src/lib/store.ts."
    );
  },
};
