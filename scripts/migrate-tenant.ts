#!/usr/bin/env npx tsx
/**
 * One-shot migration: moves all prod: Redis keys to prod:roamingbrush:
 * and all prod/ Vercel Blob files to prod/roamingbrush/.
 *
 * Artwork image URLs stored in Redis are rewritten to match new blob paths.
 *
 * Usage:
 *   npx tsx scripts/migrate-tenant.ts --dry-run   # preview only
 *   npx tsx scripts/migrate-tenant.ts             # execute migration
 *
 * Requires env vars: REDIS_URL, BLOB_READ_WRITE_TOKEN
 */

import Redis from "ioredis";
import { list, copy, del } from "@vercel/blob";

const DRY_RUN = process.argv.includes("--dry-run");

const OLD_REDIS_PREFIX = "prod:";
const NEW_REDIS_PREFIX = "prod:roamingbrush:";
const OLD_BLOB_PREFIX = "prod/";
const NEW_BLOB_PREFIX = "prod/roamingbrush/";

if (!process.env.REDIS_URL) {
  console.error("REDIS_URL is required");
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is required");
  process.exit(1);
}

// Minimal PrefixedRedis for script use
class PrefixedRedis {
  constructor(private r: Redis, private prefix: string) {}
  private k(key: string) { return `${this.prefix}${key}`; }
  get(key: string)                          { return this.r.get(this.k(key)); }
  set(key: string, val: string)             { return this.r.set(this.k(key), val); }
  del(key: string)                          { return this.r.del(this.k(key)); }
  sadd(key: string, ...m: string[])         { return this.r.sadd(this.k(key), ...m); }
  rpush(key: string, ...v: string[])        { return this.r.rpush(this.k(key), ...v); }
  hset(key: string, f: Record<string, string>) { return this.r.hset(this.k(key), f); }
  smembers(key: string)                     { return this.r.smembers(this.k(key)); }
  lrange(key: string, s: number, e: number) { return this.r.lrange(this.k(key), s, e); }
  hgetall(key: string)                      { return this.r.hgetall(this.k(key)); }
  type(key: string)                         { return this.r.type(this.k(key)); }

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

async function migrateBlobs(): Promise<Map<string, string>> {
  console.log(`\n=== Blob migration: ${OLD_BLOB_PREFIX} → ${NEW_BLOB_PREFIX} ===`);
  const urlMap = new Map<string, string>();

  let cursor: string | undefined;
  let totalBlobs = 0;
  do {
    const result = await list({ prefix: OLD_BLOB_PREFIX, cursor, limit: 1000 });
    for (const blob of result.blobs) {
      if (!blob.pathname.startsWith(OLD_BLOB_PREFIX)) continue;
      const newPathname = NEW_BLOB_PREFIX + blob.pathname.slice(OLD_BLOB_PREFIX.length);
      console.log(`  ${DRY_RUN ? "[DRY] " : ""}copy  ${blob.pathname}`);
      console.log(`        → ${newPathname}`);
      if (!DRY_RUN) {
        const result = await copy(blob.url, newPathname, {
          access: "public",
          allowOverwrite: true,
        });
        urlMap.set(blob.url, result.url);
      }
      totalBlobs++;
    }
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  console.log(`\nBlobs: ${totalBlobs} to copy${DRY_RUN ? " (dry run)" : ""}`);
  return urlMap;
}

function rewriteUrls(value: string, urlMap: Map<string, string>): string {
  let out = value;
  for (const [oldUrl, newUrl] of urlMap) {
    out = out.replaceAll(oldUrl, newUrl);
  }
  return out;
}

async function migrateRedis(urlMap: Map<string, string>): Promise<void> {
  console.log(`\n=== Redis migration: ${OLD_REDIS_PREFIX} → ${NEW_REDIS_PREFIX} ===`);

  const redis = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
  });

  const oldR = new PrefixedRedis(redis, OLD_REDIS_PREFIX);
  const newR = new PrefixedRedis(redis, NEW_REDIS_PREFIX);

  const keys = await oldR.scan("*");
  const dataKeys = keys.filter((k) => !k.startsWith("session:"));
  console.log(`Found ${dataKeys.length} non-session keys under ${OLD_REDIS_PREFIX}`);

  let copied = 0;
  for (const key of dataKeys) {
    const type = await oldR.type(key);
    console.log(`  ${DRY_RUN ? "[DRY] " : ""}${key} (${type})`);

    if (!DRY_RUN) {
      switch (type) {
        case "string": {
          const val = await oldR.get(key);
          if (val !== null) {
            const rewritten = rewriteUrls(val, urlMap);
            await newR.set(key, rewritten);
          }
          break;
        }
        case "set": {
          const members = await oldR.smembers(key);
          if (members.length > 0) await newR.sadd(key, ...members);
          break;
        }
        case "hash": {
          const hash = await oldR.hgetall(key);
          if (hash && Object.keys(hash).length > 0) {
            const rewritten = Object.fromEntries(
              Object.entries(hash).map(([f, v]) => [f, rewriteUrls(v, urlMap)])
            );
            await newR.hset(key, rewritten);
          }
          break;
        }
        case "list": {
          const items = await oldR.lrange(key, 0, -1);
          if (items.length > 0) {
            // lrange returns newest-first; rpush preserves order for restore
            await newR.rpush(key, ...items.reverse());
          }
          break;
        }
        default:
          console.warn(`  Skipping unknown type "${type}" for key ${key}`);
      }
      copied++;
    }
  }

  if (!DRY_RUN) {
    // Verify before deleting
    const newKeys = await newR.scan("*");
    const newDataKeys = newKeys.filter((k) => !k.startsWith("session:"));
    if (newDataKeys.length !== dataKeys.length) {
      redis.disconnect();
      throw new Error(
        `Count mismatch: ${dataKeys.length} old keys, ${newDataKeys.length} new keys. ` +
        `Aborting delete to preserve data.`
      );
    }
    console.log(`\nVerified: ${newDataKeys.length} keys under ${NEW_REDIS_PREFIX}`);

    // Delete old keys
    console.log(`Deleting ${dataKeys.length} old keys under ${OLD_REDIS_PREFIX}...`);
    for (const key of dataKeys) {
      await oldR.del(key);
    }
    console.log("Old keys deleted.");
  }

  redis.disconnect();
  console.log(`\nRedis: ${dataKeys.length} keys migrated${DRY_RUN ? " (dry run)" : ""}`);
}

async function deleteOldBlobs(urlMap: Map<string, string>): Promise<void> {
  if (urlMap.size === 0) return;
  const oldUrls = Array.from(urlMap.keys());
  console.log(`\nDeleting ${oldUrls.length} old blobs...`);
  // del accepts up to 500 URLs per call
  for (let i = 0; i < oldUrls.length; i += 500) {
    await del(oldUrls.slice(i, i + 500));
  }
  console.log("Old blobs deleted.");
}

async function main() {
  console.log(`Migration mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Redis:  ${OLD_REDIS_PREFIX} → ${NEW_REDIS_PREFIX}`);
  console.log(`Blobs:  ${OLD_BLOB_PREFIX} → ${NEW_BLOB_PREFIX}`);

  const urlMap = await migrateBlobs();
  await migrateRedis(urlMap);

  if (!DRY_RUN && urlMap.size > 0) {
    await deleteOldBlobs(urlMap);
  }

  console.log("\nDone.");
  if (DRY_RUN) {
    console.log("Re-run without --dry-run to execute.");
  } else {
    console.log("Next steps:");
    console.log("  1. Deploy Phase 5 code");
    console.log("  2. Set GALLERY_TENANTS in Vercel env vars");
    console.log("  3. Remove REDIS_KEY_PREFIX, BLOB_PATH_PREFIX, ARTIST_BLOB_ID env vars");
    console.log("  4. Redeploy and verify");
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
