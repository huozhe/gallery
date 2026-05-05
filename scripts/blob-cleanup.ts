// One-off: delete orphaned pre-migration JPG/PNG files from Blob.
// Usage: BLOB_READ_WRITE_TOKEN=... npx tsx scripts/blob-cleanup.ts [--dry-run]

import { list, del } from "@vercel/blob";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const toDelete: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await list({ cursor, limit: 1000 });
    for (const blob of page.blobs) {
      if (/\.(jpg|jpeg|png)$/i.test(blob.pathname) && !/^(dev\/)?original\//.test(blob.pathname)) {
        toDelete.push(blob.url);
        console.log(`  ${DRY_RUN ? "[dry]" : "[del]"} ${blob.pathname}`);
      }
    }
    cursor = page.cursor;
  } while (cursor);

  if (toDelete.length === 0) {
    console.log("Nothing to delete.");
    process.exit(0);
  }

  console.log(`\n${toDelete.length} file(s) to delete.`);

  if (!DRY_RUN) {
    await del(toDelete);
    console.log("Done.");
  } else {
    console.log("Dry run — pass without --dry-run to actually delete.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
