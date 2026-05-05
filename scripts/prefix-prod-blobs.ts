/**
 * Copies all un-prefixed prod Blob files to the "prod/" namespace and updates
 * Redis artwork records to point to the new URLs.
 *
 * Covers: artwork.image, artwork.originalImage, artwork.reference.image
 * Skips URLs already under prod/ or dev/.
 * Idempotent: re-running after a partial run is safe.
 *
 * Run against prod (no Redis/Blob prefix set):
 *   REDIS_URL="..." BLOB_READ_WRITE_TOKEN="..." REDIS_KEY_PREFIX="" BLOB_PATH_PREFIX="" \
 *     npx tsx scripts/prefix-prod-blobs.ts --dry-run
 *
 *   REDIS_URL="..." BLOB_READ_WRITE_TOKEN="..." REDIS_KEY_PREFIX="" BLOB_PATH_PREFIX="" \
 *     npx tsx scripts/prefix-prod-blobs.ts
 *
 * After verifying the site works with BLOB_PATH_PREFIX=prod:
 *   (old blobs are deleted during the same run — no separate cleanup step needed)
 */

import Redis from "ioredis";
import { list, put, del } from "@vercel/blob";
import type { Artwork } from "../src/data/types";

const DRY_RUN = process.argv.includes("--dry-run");
const REDIS_PREFIX = process.env.REDIS_KEY_PREFIX ?? "";

if (!process.env.REDIS_URL) { console.error("REDIS_URL is required"); process.exit(1); }
if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error("BLOB_READ_WRITE_TOKEN is required"); process.exit(1); }

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

function rk(key: string) { return `${REDIS_PREFIX}${key}`; }
function ser(v: unknown) { return JSON.stringify(v); }
function de<T>(v: string | null): T | null {
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}

function needsPrefix(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  const path = new URL(url).pathname.slice(1);
  return !path.startsWith("prod/") && !path.startsWith("dev/");
}

function toProdPath(url: string): string {
  return `prod/${new URL(url).pathname.slice(1)}`;
}

function extFromUrl(url: string): string {
  return url.match(/\.([^.?#/]+)(?:[?#]|$)/)?.[1].toLowerCase() ?? "bin";
}

async function copyBlob(oldUrl: string): Promise<string> {
  const newPath = toProdPath(oldUrl);
  console.log(`    copy  ${oldUrl}`);
  console.log(`      →   ${newPath}`);
  if (DRY_RUN) return `https://dry-run.example.com/${newPath}`;

  const res = await fetch(oldUrl);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${oldUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? `image/${extFromUrl(oldUrl)}`;
  const { url } = await put(newPath, buf, { access: "public", allowOverwrite: true, contentType });
  return url;
}

async function deleteBlob(url: string): Promise<void> {
  console.log(`    del   ${url}`);
  if (!DRY_RUN) await del(url);
}

async function listAllBlobs(prefix: string): Promise<string[]> {
  const urls: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await list({ prefix, limit: 1000, cursor });
    urls.push(...res.blobs.map((b) => b.url));
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  return urls;
}

async function main() {
  console.log(`DRY_RUN=${DRY_RUN}  REDIS_PREFIX="${REDIS_PREFIX}"\n`);

  const ids = await redis.smembers(rk("artworks:index"));
  if (!ids.length) { console.log("No artworks found."); process.exit(0); }

  const records = (await redis.mget(...ids.map((id) => rk(`artwork:${id}`))))
    .map((v) => de<Artwork>(v))
    .filter((a): a is Artwork => a !== null);

  const toMigrate = records.filter(
    (a) => needsPrefix(a.image)
      || (a.originalImage && needsPrefix(a.originalImage))
      || (a.reference?.image && needsPrefix(a.reference.image))
  );

  if (toMigrate.length) {
    console.log(`${toMigrate.length} artwork(s) have un-prefixed blob URLs:\n`);
  } else {
    console.log("All Redis-referenced blob URLs already have a prefix.\n");
  }

  for (const artwork of toMigrate) {
    console.log(`[${artwork.id}] ${artwork.slug}`);
    const updated = { ...artwork, reference: artwork.reference ? { ...artwork.reference } : undefined };
    const oldUrls: string[] = [];

    if (needsPrefix(artwork.image)) {
      updated.image = await copyBlob(artwork.image);
      oldUrls.push(artwork.image);
    }
    if (artwork.originalImage && needsPrefix(artwork.originalImage)) {
      updated.originalImage = await copyBlob(artwork.originalImage);
      oldUrls.push(artwork.originalImage);
    }
    if (artwork.reference?.image && needsPrefix(artwork.reference.image)) {
      updated.reference!.image = await copyBlob(artwork.reference.image);
      oldUrls.push(artwork.reference.image);
    }

    console.log(`  updating Redis record`);
    if (!DRY_RUN) {
      await redis.set(rk(`artwork:${artwork.id}`), ser({ ...updated, updatedAt: new Date().toISOString() }));
    }

    for (const url of oldUrls) await deleteBlob(url);
    console.log();
  }

  // ── Orphaned original/reference/ blobs (not stored in Redis) ────────────────
  console.log("Scanning for orphaned original/reference/ blobs...\n");
  const orphanedOriginals = (await listAllBlobs("original/reference/")).filter(needsPrefix);

  if (orphanedOriginals.length) {
    console.log(`${orphanedOriginals.length} orphaned original/reference/ blob(s):\n`);
    for (const url of orphanedOriginals) {
      await copyBlob(url);
      await deleteBlob(url);
      console.log();
    }
  } else {
    console.log("No orphaned original/reference/ blobs found.\n");
  }

  console.log(`Migration ${DRY_RUN ? "(dry-run) " : ""}complete.`);
  if (!DRY_RUN) {
    console.log("\nNext steps:");
    console.log("  1. Set BLOB_PATH_PREFIX=prod/ in Vercel env vars");
    console.log("  2. Redeploy");
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
