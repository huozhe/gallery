// One-shot: converts artworks from single image/reference fields to arrays.
//
// Usage:
//   Local (file store):  npm run migrate:multi-image
//   Local (Redis):       node_modules/.bin/tsx --env-file .env.local scripts/migrate-to-multi-image.ts
//   Prod (roamingbrush): REDIS_KEY_PREFIX=prod:roamingbrush: REDIS_URL=... npm run migrate:multi-image
//
// Run once per tenant prefix before deploying new code.

import { artworks } from "../src/lib/store";
import type { ArtworkImage, ArtworkReference } from "../src/data/types";

type LegacyArtwork = {
  id: number;
  title: string;
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

async function main() {
  const all = await (artworks.list as () => Promise<LegacyArtwork[]>)();
  let migrated = 0;

  for (const aw of all) {
    if (Array.isArray(aw.images) && aw.images.length > 0) {
      console.log(`  skip ${aw.id}: ${aw.title} (already migrated)`);
      continue;
    }

    const images: ArtworkImage[] = aw.image
      ? [{
          url: aw.image,
          originalUrl: aw.originalImage,
          filename: aw.imageFilename,
          width: aw.width ?? 0,
          height: aw.height ?? 0,
        }]
      : [];

    const references: ArtworkReference[] = aw.reference?.caption
      ? [aw.reference]
      : [];

    const next = { ...aw, images, references };
    delete next.image;
    delete next.originalImage;
    delete next.imageFilename;
    delete next.width;
    delete next.height;
    delete next.reference;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (artworks.upsert as (a: any) => Promise<unknown>)(next);
    console.log(`  migrated ${aw.id}: ${aw.title}`);
    migrated++;
  }

  console.log(`\nDone. ${migrated} artworks migrated, ${all.length - migrated} skipped.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
