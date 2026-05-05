/**
 * One-shot migration: converts slug-keyed artwork Redis records to numeric IDs
 * and renames Blob image files to UUIDs.
 *
 * Idempotent: skips if artworks:counter is already set (migration already ran).
 *
 * Run:
 *   set -a && source .env.local && set +a && npx tsx scripts/migrate-to-uuids.ts
 *   set -a && source .env.local && set +a && npx tsx scripts/migrate-to-uuids.ts --dry-run
 */

import Redis from "ioredis";
import { put, del } from "@vercel/blob";

const DRY_RUN = process.argv.includes("--dry-run");
const PREFIX = process.env.REDIS_KEY_PREFIX ?? "";
const BLOB_PREFIX = process.env.BLOB_PATH_PREFIX ?? "";

function k(key: string) { return `${PREFIX}${key}`; }

function log(msg: string) { console.log(msg); }

const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

function ser(v: unknown) { return JSON.stringify(v); }
function de<T>(v: string | null): T | null {
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}

type OldArtwork = {
  id: string;
  title: string;
  year: number;
  medium: string;
  dimensions?: string;
  description?: string;
  image: string;
  originalImage?: string;
  width: number;
  height: number;
  tagIds: string[];
  status: string;
  orderByTag: Record<string, number>;
  orderGlobal: number;
  reference?: {
    caption: string;
    url?: string;
    image?: string;
    imageWidth?: number;
    imageHeight?: number;
  };
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

type NewArtwork = Omit<OldArtwork, "id"> & { id: number; slug: string };

async function isBlobUrl(url: string): Promise<boolean> {
  return url.startsWith("https://");
}

function blobPathFromUrl(url: string): string {
  const parsed = new URL(url);
  let path = parsed.pathname.slice(1); // strip leading /
  if (BLOB_PREFIX && path.startsWith(BLOB_PREFIX)) path = path.slice(BLOB_PREFIX.length);
  return path;
}

function extFromPath(imagePath: string): string {
  const match = imagePath.match(/\.([^.?#]+)(?:[?#]|$)/);
  return match ? match[1].toLowerCase() : "bin";
}

async function renameBlob(oldUrl: string, newBlobPath: string): Promise<string> {
  log(`  copying ${oldUrl} → ${BLOB_PREFIX}${newBlobPath}`);
  if (DRY_RUN) return `https://blob.example.com/${newBlobPath}`;
  const res = await fetch(oldUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${oldUrl}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const { url } = await put(`${BLOB_PREFIX}${newBlobPath}`, buf, {
    access: "public",
    allowOverwrite: true,
    contentType,
  });
  return url;
}

async function deleteBlob(oldUrl: string): Promise<void> {
  log(`  deleting ${oldUrl}`);
  if (DRY_RUN) return;
  await del(oldUrl);
}

async function main() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is required");

  // Check if already migrated
  const counterRaw = await redis.get(k("artworks:counter"));
  if (counterRaw !== null) {
    log(`Migration already ran (artworks:counter = ${counterRaw}). Exiting.`);
    process.exit(0);
  }

  const slugIds = await redis.smembers(k("artworks:index"));
  if (slugIds.length === 0) {
    log("No artworks found. Exiting.");
    process.exit(0);
  }

  log(`Found ${slugIds.length} artwork(s) to migrate. DRY_RUN=${DRY_RUN}`);

  // Fetch all artworks and sort by orderGlobal for consistent numeric ID assignment
  const rawArtworks: OldArtwork[] = [];
  for (const slugId of slugIds) {
    const raw = await redis.get(k(`artwork:${slugId}`));
    const art = de<OldArtwork>(raw);
    if (!art) { log(`WARN: no record for artwork:${slugId}, skipping`); continue; }
    rawArtworks.push(art);
  }
  rawArtworks.sort((a, b) => a.orderGlobal - b.orderGlobal);

  let counter = 0;

  for (const art of rawArtworks) {
    counter++;
    const numericId = counter;
    const slug = art.id; // old string ID becomes the slug
    log(`\n[${numericId}] ${slug} (was artwork:${slug})`);

    let newImageUrl = art.image;
    let newOriginalUrl = art.originalImage;

    // Rename image blob
    if (await isBlobUrl(art.image)) {
      const uuid = crypto.randomUUID();
      const ext = "webp"; // migration source files are already webp
      const newPath = `artwork/${uuid}.${ext}`;
      newImageUrl = await renameBlob(art.image, newPath);
    }

    // Rename original blob
    if (art.originalImage && await isBlobUrl(art.originalImage)) {
      const uuid = crypto.randomUUID();
      const ext = extFromPath(art.originalImage);
      const newPath = `original/artwork/${uuid}.${ext}`;
      newOriginalUrl = await renameBlob(art.originalImage, newPath);
    }

    const newArtwork: NewArtwork = {
      ...art,
      id: numericId,
      slug,
      image: newImageUrl,
      originalImage: newOriginalUrl,
    };

    log(`  writing artwork:${numericId} slug=${slug}`);
    if (!DRY_RUN) {
      await redis.set(k(`artwork:${numericId}`), ser(newArtwork));
      await redis.sadd(k("artworks:index"), String(numericId));
      await redis.hset(k("artworks:slugs"), slug, String(numericId));
    }

    // Delete old blobs after writing new records
    if (newImageUrl !== art.image && await isBlobUrl(art.image)) {
      await deleteBlob(art.image);
    }
    if (art.originalImage && newOriginalUrl !== art.originalImage && await isBlobUrl(art.originalImage)) {
      await deleteBlob(art.originalImage);
    }

    // Delete old Redis record and remove old slug from index
    log(`  removing old artwork:${slug} from index`);
    if (!DRY_RUN) {
      await redis.del(k(`artwork:${slug}`));
      await redis.srem(k("artworks:index"), slug);
    }
  }

  log(`\nSetting artworks:counter = ${counter}`);
  if (!DRY_RUN) {
    await redis.set(k("artworks:counter"), String(counter));
  }

  log(`\nMigration ${DRY_RUN ? "(dry-run) " : ""}complete. ${counter} artwork(s) processed.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
