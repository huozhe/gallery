/**
 * Renames existing reference image Blob files to UUID-based paths,
 * matching the convention used for artwork images after migrate-to-uuids.ts.
 *
 * Only touches artworks that have a reference.image Blob URL with a
 * non-UUID filename. Idempotent: skips if the filename is already a UUID.
 *
 * Run:
 *   set -a && source .env.local && set +a && npx tsx scripts/migrate-reference-images.ts --dry-run
 *   set -a && source .env.local && set +a && npx tsx scripts/migrate-reference-images.ts
 *
 *   # Prod (no prefix):
 *   REDIS_URL="..." BLOB_READ_WRITE_TOKEN="..." REDIS_KEY_PREFIX="" BLOB_PATH_PREFIX="" npx tsx scripts/migrate-reference-images.ts --dry-run
 *   REDIS_URL="..." BLOB_READ_WRITE_TOKEN="..." REDIS_KEY_PREFIX="" BLOB_PATH_PREFIX="" npx tsx scripts/migrate-reference-images.ts
 */

import Redis from "ioredis";
import { put, del } from "@vercel/blob";
import type { Artwork } from "../src/data/types";

const DRY_RUN = process.argv.includes("--dry-run");
const PREFIX = process.env.REDIS_KEY_PREFIX ?? "";
const BLOB_PREFIX = process.env.BLOB_PATH_PREFIX ?? "";

if (!process.env.REDIS_URL) { console.error("REDIS_URL is required"); process.exit(1); }
if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error("BLOB_READ_WRITE_TOKEN is required"); process.exit(1); }

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./;

function k(key: string) { return `${PREFIX}${key}`; }
function ser(v: unknown) { return JSON.stringify(v); }
function de<T>(v: string | null): T | null {
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}

function extFromUrl(url: string): string {
  const match = url.match(/\.([^.?#/]+)(?:[?#]|$)/);
  return match ? match[1].toLowerCase() : "bin";
}

function filenameFromUrl(url: string): string {
  const decoded = decodeURIComponent(url);
  return decoded.split("/").pop()?.split("?")[0] ?? "";
}

async function main() {
  console.log(`DRY_RUN=${DRY_RUN}  PREFIX="${PREFIX}"  BLOB_PREFIX="${BLOB_PREFIX}"\n`);

  const ids = await redis.smembers(k("artworks:index"));
  if (!ids.length) { console.log("No artworks found."); process.exit(0); }

  const records = (
    await redis.mget(...ids.map((id) => k(`artwork:${id}`)))
  ).map((v) => de<Artwork>(v)).filter((a): a is Artwork => a !== null);

  const toMigrate = records.filter(
    (a) => a.reference?.image && a.reference.image.startsWith("https://")
      && !UUID_RE.test(filenameFromUrl(a.reference.image))
  );

  if (!toMigrate.length) {
    console.log("No reference images need migration.");
    process.exit(0);
  }

  console.log(`Found ${toMigrate.length} artwork(s) with reference images to migrate:\n`);

  for (const artwork of toMigrate) {
    const oldUrl = artwork.reference!.image!;
    const ext = extFromUrl(oldUrl);
    const uuid = crypto.randomUUID();
    const newBlobPath = `${BLOB_PREFIX}reference/${artwork.id}/${uuid}.${ext}`;

    console.log(`[${artwork.id}] ${artwork.slug}`);
    console.log(`  ${oldUrl}`);
    console.log(`  → ${newBlobPath}`);

    if (!DRY_RUN) {
      const res = await fetch(oldUrl);
      if (!res.ok) throw new Error(`Failed to fetch ${oldUrl}: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";

      const { url: newUrl } = await put(newBlobPath, buf, {
        access: "public",
        allowOverwrite: true,
        contentType,
      });

      const updated: Artwork = {
        ...artwork,
        reference: { ...artwork.reference!, image: newUrl },
        updatedAt: new Date().toISOString(),
      };
      await redis.set(k(`artwork:${artwork.id}`), ser(updated));
      await del(oldUrl);
      console.log(`  done → ${newUrl}`);
    }
  }

  console.log(`\nMigration ${DRY_RUN ? "(dry-run) " : ""}complete.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
