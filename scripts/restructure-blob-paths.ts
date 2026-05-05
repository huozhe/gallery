/**
 * Migrates existing blob files from the flat structure to the per-artwork structure:
 *
 *   {prefix}artwork/{uuid}.webp
 *     → {prefix}artists/1/artworks/{id}/images/{uuid}.webp
 *   {prefix}original/artwork/{uuid}.ext
 *     → {prefix}artists/1/artworks/{id}/images/original/{uuid}.ext
 *   {prefix}reference/{id}/{uuid}.webp
 *     → {prefix}artists/1/artworks/{id}/references/{uuid}.webp
 *   {prefix}original/reference/{slug}/...
 *     → {prefix}artists/1/artworks/{id}/references/original/{uuid}.ext
 *       (maps slug → numeric id via artworks:slugs; generates new UUID filename)
 *
 * Updates Redis artwork records to point at new URLs.
 * Idempotent: skips URLs that already match the new structure.
 *
 * Usage (run against prod):
 *   REDIS_URL="..." BLOB_READ_WRITE_TOKEN="..." REDIS_KEY_PREFIX="prod:" BLOB_PATH_PREFIX="prod/" \
 *     npx tsx scripts/restructure-blob-paths.ts --dry-run
 *
 *   REDIS_URL="..." BLOB_READ_WRITE_TOKEN="..." REDIS_KEY_PREFIX="prod:" BLOB_PATH_PREFIX="prod/" \
 *     npx tsx scripts/restructure-blob-paths.ts
 */

import Redis from "ioredis";
import { list, put, del } from "@vercel/blob";
import { randomUUID } from "crypto";
import type { Artwork } from "../src/data/types";
import { ARTIST_ID } from "../src/lib/config";

const DRY_RUN = process.argv.includes("--dry-run");
const REDIS_PREFIX = process.env.REDIS_KEY_PREFIX ?? "";
const BLOB_PREFIX = process.env.BLOB_PATH_PREFIX ?? "";

if (!process.env.REDIS_URL) { console.error("REDIS_URL required"); process.exit(1); }
if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error("BLOB_READ_WRITE_TOKEN required"); process.exit(1); }

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

function rk(key: string) { return `${REDIS_PREFIX}${key}`; }
function de<T>(v: string | null): T | null {
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}

function blobRelPath(url: string): string {
  const path = new URL(url).pathname.slice(1);
  return path.startsWith(BLOB_PREFIX) ? path.slice(BLOB_PREFIX.length) : path;
}

function isOldStyle(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  const rel = blobRelPath(url);
  return rel.startsWith("artwork/") || rel.startsWith("reference/") || rel.startsWith("original/");
}

function newImagePath(artworkId: number, uuid: string): string {
  return `${BLOB_PREFIX}artists/${ARTIST_ID}/artworks/${artworkId}/images/${uuid}.webp`;
}

function newOriginalImagePath(artworkId: number, uuid: string, ext: string): string {
  return `${BLOB_PREFIX}artists/${ARTIST_ID}/artworks/${artworkId}/images/original/${uuid}.${ext}`;
}

function newReferencePath(artworkId: number, uuid: string): string {
  return `${BLOB_PREFIX}artists/${ARTIST_ID}/artworks/${artworkId}/references/${uuid}.webp`;
}

function newReferenceOriginalPath(artworkId: number, uuid: string, ext: string): string {
  return `${BLOB_PREFIX}artists/${ARTIST_ID}/artworks/${artworkId}/references/original/${uuid}.${ext}`;
}

function extFromUrl(url: string): string {
  return url.match(/\.([^.?#/]+)(?:[?#]|$)/)?.[1].toLowerCase() ?? "bin";
}

function uuidFromUrl(url: string): string {
  const filename = new URL(url).pathname.split("/").pop() ?? "";
  return filename.replace(/\.[^.]+$/, "");
}

async function copyBlob(oldUrl: string, newPath: string, contentType?: string): Promise<string> {
  console.log(`    copy  ${oldUrl}`);
  console.log(`      →   ${newPath}`);
  if (DRY_RUN) return `https://dry-run.example.com/${newPath}`;
  const res = await fetch(oldUrl);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${oldUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = contentType ?? res.headers.get("content-type") ?? `image/${extFromUrl(oldUrl)}`;
  const { url } = await put(newPath, buf, { access: "public", allowOverwrite: true, contentType: ct });
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
    const page = await list({ prefix, limit: 1000, cursor });
    urls.push(...page.blobs.map((b) => b.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return urls;
}

async function main() {
  console.log(`DRY_RUN=${DRY_RUN}  REDIS_PREFIX="${REDIS_PREFIX}"  BLOB_PREFIX="${BLOB_PREFIX}"\n`);

  const ids = await redis.smembers(rk("artworks:index"));
  if (!ids.length) { console.log("No artworks found."); process.exit(0); }

  const records = (await redis.mget(...ids.map((id) => rk(`artwork:${id}`))))
    .map((v) => de<Artwork>(v))
    .filter((a): a is Artwork => a !== null);

  const toMigrate = records.filter(
    (a) => isOldStyle(a.image)
      || (a.originalImage && isOldStyle(a.originalImage))
      || (a.reference?.image && isOldStyle(a.reference.image))
  );

  if (toMigrate.length) {
    console.log(`${toMigrate.length} artwork(s) need migration:\n`);
  } else {
    console.log("All Redis-referenced blob URLs already use the new path structure.\n");
  }

  for (const artwork of toMigrate) {
    console.log(`[${artwork.id}] ${artwork.slug}`);
    const updated = { ...artwork, reference: artwork.reference ? { ...artwork.reference } : undefined };
    const oldUrls: string[] = [];

    if (isOldStyle(artwork.image)) {
      const uuid = uuidFromUrl(artwork.image);
      updated.image = await copyBlob(artwork.image, newImagePath(artwork.id, uuid), "image/webp");
      oldUrls.push(artwork.image);
    }

    if (artwork.originalImage && isOldStyle(artwork.originalImage)) {
      const uuid = uuidFromUrl(artwork.originalImage);
      const ext = extFromUrl(artwork.originalImage);
      updated.originalImage = await copyBlob(artwork.originalImage, newOriginalImagePath(artwork.id, uuid, ext));
      oldUrls.push(artwork.originalImage);
    }

    if (artwork.reference?.image && isOldStyle(artwork.reference.image)) {
      const uuid = uuidFromUrl(artwork.reference.image);
      updated.reference!.image = await copyBlob(artwork.reference.image, newReferencePath(artwork.id, uuid), "image/webp");
      oldUrls.push(artwork.reference.image);
    }

    console.log(`  updating Redis record`);
    if (!DRY_RUN) {
      await redis.set(rk(`artwork:${artwork.id}`), JSON.stringify({ ...updated, updatedAt: new Date().toISOString() }));
    }

    for (const url of oldUrls) await deleteBlob(url);
    console.log();
  }

  // ── Orphaned original/reference/ blobs (not in Redis) ───────────────────────
  const orphanedPrefix = `${BLOB_PREFIX}original/reference/`;
  console.log(`Scanning for orphaned blobs at ${orphanedPrefix}...\n`);
  const orphans = (await listAllBlobs(orphanedPrefix)).filter(isOldStyle);

  if (orphans.length) {
    console.log(`${orphans.length} orphaned reference original(s):\n`);

    for (const url of orphans) {
      // Path: {prefix}original/reference/{slug}/{filename.ext}
      const rel = blobRelPath(url);
      const parts = rel.replace(/^original\/reference\//, "").split("/");
      const slug = parts[0];
      const ext = extFromUrl(url);

      const artworkIdStr = await redis.hget(rk("artworks:slugs"), slug);
      if (!artworkIdStr) {
        console.log(`  skip  ${url} (slug "${slug}" not found in Redis)`);
        continue;
      }
      const artworkId = parseInt(artworkIdStr, 10);
      const newUuid = randomUUID();
      await copyBlob(url, newReferenceOriginalPath(artworkId, newUuid, ext));
      await deleteBlob(url);
      console.log();
    }
  } else {
    console.log("No orphaned reference originals found.\n");
  }

  console.log(`Migration ${DRY_RUN ? "(dry-run) " : ""}complete.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
