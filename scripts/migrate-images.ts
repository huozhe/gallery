// @ts-nocheck — legacy script, references old Artwork fields (pre-multi-image migration)
// One-shot script: converts existing artwork images to WebP and saves originals.
// Works in both local dev (file store) and production (Blob + Redis).
//
// Usage:
//   Local:  tsx scripts/migrate-images.ts
//   Prod:   REDIS_URL=... BLOB_READ_WRITE_TOKEN=... tsx scripts/migrate-images.ts

import path from "path";
import { readFile, mkdir, writeFile } from "fs/promises";
import sharp from "sharp";
import { artworks } from "../src/lib/store";

const MAX_EDGE = 2000;
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

async function processImage(inputBuffer: Buffer) {
  const img = sharp(inputBuffer);
  const { width: origW = 0, height: origH = 0 } = await img.metadata();
  const longestEdge = Math.max(origW, origH);
  const resize =
    longestEdge > MAX_EDGE
      ? origW >= origH
        ? { width: MAX_EDGE }
        : { height: MAX_EDGE }
      : undefined;
  const { data: webpBuffer, info } = await img
    .resize(resize)
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { webpBuffer, width: info.width, height: info.height };
}

function parsePath(imgPath: string): { dir: string; fileName: string } {
  if (imgPath.startsWith("http")) {
    const url = new URL(imgPath);
    let part = url.pathname.slice(1);
    const prefix = process.env.BLOB_PATH_PREFIX ?? "";
    if (prefix && part.startsWith(prefix)) part = part.slice(prefix.length);
    const i = part.lastIndexOf("/");
    return { dir: part.slice(0, i), fileName: part.slice(i + 1) };
  }
  const rel = imgPath.replace(/^\//, "");
  const i = rel.lastIndexOf("/");
  return { dir: rel.slice(0, i), fileName: rel.slice(i + 1) };
}

async function readImage(imgPath: string): Promise<Buffer> {
  if (imgPath.startsWith("http")) {
    const res = await fetch(imgPath);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${imgPath}`);
    return Buffer.from(await res.arrayBuffer());
  }
  // Try public/ first, then public/original/ (fallback after originals were moved)
  const primary = path.join(process.cwd(), "public", imgPath);
  try {
    return await readFile(primary);
  } catch {
    return readFile(path.join(process.cwd(), "public", "original", imgPath));
  }
}

async function saveLocalPair(
  dir: string,
  webpName: string,
  fileName: string,
  webpBuffer: Buffer,
  inputBuffer: Buffer,
) {
  const webpDest = path.join(process.cwd(), "public", dir, webpName);
  const origDest = path.join(process.cwd(), "public", "original", dir, fileName);
  await mkdir(path.dirname(webpDest), { recursive: true });
  await mkdir(path.dirname(origDest), { recursive: true });
  await Promise.all([writeFile(webpDest, webpBuffer), writeFile(origDest, inputBuffer)]);
  return {
    newPath: `/${dir}/${webpName}`,
    originalPath: `/original/${dir}/${fileName}`,
  };
}

async function saveBlobPair(
  dir: string,
  webpName: string,
  fileName: string,
  webpBuffer: Buffer,
  inputBuffer: Buffer,
) {
  const { put } = await import("@vercel/blob");
  const blobPrefix = process.env.BLOB_PATH_PREFIX ?? "";
  const [{ url: newPath }, { url: originalPath }] = await Promise.all([
    put(`${blobPrefix}${dir}/${webpName}`, webpBuffer, {
      access: "public",
      allowOverwrite: true,
      contentType: "image/webp",
    }),
    put(`${blobPrefix}original/${dir}/${fileName}`, inputBuffer, {
      access: "public",
      allowOverwrite: true,
    }),
  ]);
  return { newPath, originalPath };
}

async function migrateImage(imgPath: string) {
  const { dir, fileName } = parsePath(imgPath);
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const webpName = `${baseName}.webp`;

  const inputBuffer = await readImage(imgPath);
  const { webpBuffer, width, height } = await processImage(inputBuffer);

  const { newPath, originalPath } = USE_BLOB
    ? await saveBlobPair(dir, webpName, fileName, webpBuffer, inputBuffer)
    : await saveLocalPair(dir, webpName, fileName, webpBuffer, inputBuffer);

  return { newPath, originalPath, width, height };
}

async function main() {
  const all = await artworks.list();
  console.log(`Found ${all.length} artworks. Mode: ${USE_BLOB ? "Blob" : "local"}\n`);
  let updated = 0;

  for (const artwork of all) {
    const patch: Partial<typeof artwork> = {};

    if (artwork.image && !artwork.image.endsWith(".webp")) {
      process.stdout.write(`[${artwork.id}] ${artwork.image} → `);
      const { newPath, originalPath, width, height } = await migrateImage(artwork.image);
      patch.image = newPath;
      patch.originalImage = originalPath;
      patch.width = width;
      patch.height = height;
      console.log(newPath);
    }

    if (artwork.reference?.image && !artwork.reference.image.endsWith(".webp")) {
      process.stdout.write(`[${artwork.id}] ref ${artwork.reference.image} → `);
      const { newPath, width, height } = await migrateImage(artwork.reference.image);
      patch.reference = { ...artwork.reference, image: newPath, imageWidth: width, imageHeight: height };
      console.log(newPath);
    }

    if (Object.keys(patch).length > 0) {
      await artworks.upsert({ ...artwork, ...patch, updatedAt: new Date().toISOString() });
      updated++;
    }
  }

  console.log(`\nDone. Updated ${updated} artwork(s).`);

  if (!USE_BLOB) {
    console.log(`
Next steps:
  1. Start dev server and verify images: npm run dev
  2. Remove original seed files from git:
       git rm public/artwork/*.jpg public/artwork/*.png
       git rm -r public/reference/
  3. Commit`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
