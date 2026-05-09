// One-shot: converts artworks from single image/reference fields to arrays.
// Idempotent — skips artworks that already have images[].
//
// Usage:
//   Local (file store):  npm run migrate:multi-image
//   Local (Redis):       node_modules/.bin/tsx --env-file .env.local scripts/migrate-to-multi-image.ts
//   Prod (manual):       REDIS_KEY_PREFIX=prod:roamingbrush: REDIS_URL=... npm run migrate:multi-image
//
// When GALLERY_TENANTS is set, migrates every tenant's Redis prefix automatically.
// This runs as part of `npm run build` so Vercel migrates its own prod data before prerendering.

import Redis from "ioredis";
import type { ArtworkImage, ArtworkReference } from "../src/data/types";

type LegacyArtwork = {
  id: number;
  title: string;
  slug: string;
  status: string;
  images?: ArtworkImage[];
  references?: ArtworkReference[];
  image?: string;
  originalImage?: string;
  imageFilename?: string;
  width?: number;
  height?: number;
  reference?: ArtworkReference;
  [key: string]: unknown;
};

function getRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set — skipping Redis migration");
  const u = new URL(url);
  return new Redis({
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

async function migratePrefix(r: Redis, prefix: string): Promise<void> {
  const ids = await r.smembers(`${prefix}artworks:index`);
  if (!ids.length) { console.log(`  [${prefix || "no-prefix"}] no artworks`); return; }

  let migrated = 0;
  for (const id of ids) {
    const raw = await r.get(`${prefix}artwork:${id}`);
    if (!raw) continue;
    const aw = JSON.parse(raw) as LegacyArtwork;

    if (Array.isArray(aw.images) && aw.images.length > 0) continue; // already migrated

    const images: ArtworkImage[] = aw.image
      ? [{ url: aw.image, originalUrl: aw.originalImage, filename: aw.imageFilename,
           width: aw.width ?? 0, height: aw.height ?? 0 }]
      : [];
    const references: ArtworkReference[] = aw.reference?.caption ? [aw.reference] : [];

    const next = { ...aw, images, references };
    delete next.image; delete next.originalImage; delete next.imageFilename;
    delete next.width; delete next.height; delete next.reference;

    await r.set(`${prefix}artwork:${id}`, JSON.stringify(next));
    console.log(`  [${prefix || "no-prefix"}] migrated ${id}: ${aw.title}`);
    migrated++;
  }
  if (migrated === 0) console.log(`  [${prefix || "no-prefix"}] all ${ids.length} artworks already migrated`);
}

async function main() {
  if (!process.env.REDIS_URL) {
    console.log("REDIS_URL not set — using file store, no Redis migration needed.");
    return;
  }

  const r = getRedis();

  // Collect all prefixes to migrate
  const prefixes: string[] = [];
  const tenantsRaw = process.env.GALLERY_TENANTS;
  if (tenantsRaw) {
    try {
      const tenants = JSON.parse(tenantsRaw) as Array<{ redisPrefix: string }>;
      for (const t of tenants) prefixes.push(t.redisPrefix);
    } catch {
      console.error("Failed to parse GALLERY_TENANTS");
    }
  }
  if (!prefixes.length) {
    // Fall back to REDIS_KEY_PREFIX env var
    prefixes.push(process.env.REDIS_KEY_PREFIX ?? "");
  }

  console.log(`Migrating prefixes: ${prefixes.map(p => `"${p}"`).join(", ")}`);
  for (const prefix of prefixes) {
    await migratePrefix(r, prefix);
  }

  await r.quit();
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration error:", err.message);
  // Don't exit 1 — let the build continue; data may already be migrated.
});
