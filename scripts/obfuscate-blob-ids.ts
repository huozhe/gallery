/**
 * Assigns a stable UUID blobId to each artwork and migrates blob paths from
 * numeric IDs to opaque UUIDs at both the artist and artwork level:
 *
 *   {prefix}artists/1/artworks/{numericId}/images/{uuid}.webp
 *     → {prefix}artists/{ARTIST_BLOB_ID}/artworks/{blobId}/images/{uuid}.webp
 *
 * Also covers: images/original/, references/, references/original/
 * Updates Redis records with new blobId and new blob URLs.
 * Idempotent: artworks that already have a blobId and new-structure URLs are skipped.
 *
 * Usage (run against prod):
 *   REDIS_URL="..." BLOB_READ_WRITE_TOKEN="..." REDIS_KEY_PREFIX="prod:" BLOB_PATH_PREFIX="prod/" \
 *     npx tsx scripts/obfuscate-blob-ids.ts --dry-run
 *
 *   REDIS_URL="..." BLOB_READ_WRITE_TOKEN="..." REDIS_KEY_PREFIX="prod:" BLOB_PATH_PREFIX="prod/" \
 *     npx tsx scripts/obfuscate-blob-ids.ts
 */

import Redis from "ioredis";
import { list, put, del } from "@vercel/blob";
import { randomUUID } from "crypto";
import type { Artwork } from "../src/data/types";
import { ARTIST_BLOB_ID } from "../src/lib/config";

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

function isOldStructure(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  const path = new URL(url).pathname.slice(1);
  const rel = path.startsWith(BLOB_PREFIX) ? path.slice(BLOB_PREFIX.length) : path;
  // Old structure uses "artists/1/" (numeric artist ID), new uses ARTIST_BLOB_ID
  return rel.startsWith("artists/1/");
}

function rewriteUrl(url: string, blobId: string): string {
  const path = new URL(url).pathname.slice(1);
  const rel = path.startsWith(BLOB_PREFIX) ? path.slice(BLOB_PREFIX.length) : path;
  // rel looks like: artists/1/artworks/{numericId}/{rest}
  const match = rel.match(/^artists\/1\/artworks\/\d+\/(.+)$/);
  if (!match) throw new Error(`Unexpected URL format: ${url}`);
  return `${BLOB_PREFIX}artists/${ARTIST_BLOB_ID}/artworks/${blobId}/${match[1]}`;
}

function extFromUrl(url: string): string {
  return url.match(/\.([^.?#/]+)(?:[?#]|$)/)?.[1].toLowerCase() ?? "bin";
}

async function copyBlob(oldUrl: string, newPath: string): Promise<string> {
  console.log(`    copy  ${oldUrl}`);
  console.log(`      →   ${newPath}`);
  if (DRY_RUN) return `https://dry-run.example.com/${newPath}`;
  const res = await fetch(oldUrl);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${oldUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? `image/${extFromUrl(oldUrl)}`;
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
  console.log(`DRY_RUN=${DRY_RUN}  REDIS_PREFIX="${REDIS_PREFIX}"  BLOB_PREFIX="${BLOB_PREFIX}"`);
  console.log(`ARTIST_BLOB_ID=${ARTIST_BLOB_ID}\n`);

  const ids = await redis.smembers(rk("artworks:index"));
  if (!ids.length) { console.log("No artworks found."); process.exit(0); }

  const records = (await redis.mget(...ids.map((id) => rk(`artwork:${id}`))))
    .map((v) => de<Artwork>(v))
    .filter((a): a is Artwork => a !== null);

  const toMigrate = records.filter(
    (a) => !a.blobId || isOldStructure(a.image)
  );

  if (!toMigrate.length) {
    console.log("All artworks already have a blobId and new-structure URLs. Nothing to do.");
    process.exit(0);
  }

  console.log(`${toMigrate.length} artwork(s) to migrate:\n`);

  for (const artwork of toMigrate) {
    const blobId = artwork.blobId && !isOldStructure(artwork.image)
      ? artwork.blobId  // has blobId but URLs were somehow already new — preserve
      : randomUUID();

    console.log(`[${artwork.id}] ${artwork.slug}  →  blobId=${blobId}`);
    const updated = { ...artwork, blobId, reference: artwork.reference ? { ...artwork.reference } : undefined };
    const oldUrls: string[] = [];

    if (isOldStructure(artwork.image)) {
      updated.image = await copyBlob(artwork.image, rewriteUrl(artwork.image, blobId));
      oldUrls.push(artwork.image);
    }
    if (artwork.originalImage && isOldStructure(artwork.originalImage)) {
      updated.originalImage = await copyBlob(artwork.originalImage, rewriteUrl(artwork.originalImage, blobId));
      oldUrls.push(artwork.originalImage);
    }
    if (artwork.reference?.image && isOldStructure(artwork.reference.image)) {
      updated.reference!.image = await copyBlob(artwork.reference.image, rewriteUrl(artwork.reference.image, blobId));
      oldUrls.push(artwork.reference.image);
    }

    // Also migrate any reference originals stored under this artwork's old path
    const oldRefOrigPrefix = `${BLOB_PREFIX}artists/1/artworks/${artwork.id}/references/original/`;
    const orphanOriginals = await listAllBlobs(oldRefOrigPrefix);
    for (const url of orphanOriginals) {
      await copyBlob(url, rewriteUrl(url, blobId));
      oldUrls.push(url);
    }

    console.log(`  updating Redis record`);
    if (!DRY_RUN) {
      await redis.set(rk(`artwork:${artwork.id}`), JSON.stringify({ ...updated, updatedAt: new Date().toISOString() }));
    }

    for (const url of oldUrls) await deleteBlob(url);
    console.log();
  }

  console.log(`Migration ${DRY_RUN ? "(dry-run) " : ""}complete.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
