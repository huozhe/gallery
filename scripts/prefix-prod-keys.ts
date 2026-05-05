/**
 * Copies all unprefixed prod Redis keys to the "prod:" namespace.
 * Idempotent: skips keys that already start with "prod:" or "dev:".
 *
 * Usage:
 *   # Copy only (safe to run while site is live):
 *   REDIS_URL="..." npx tsx scripts/prefix-prod-keys.ts --dry-run
 *   REDIS_URL="..." npx tsx scripts/prefix-prod-keys.ts
 *
 *   # After verifying the site works with REDIS_KEY_PREFIX=prod:, delete old keys:
 *   REDIS_URL="..." npx tsx scripts/prefix-prod-keys.ts --delete-old --dry-run
 *   REDIS_URL="..." npx tsx scripts/prefix-prod-keys.ts --delete-old
 */

import Redis from "ioredis";

const DRY_RUN = process.argv.includes("--dry-run");
const DELETE_OLD = process.argv.includes("--delete-old");

if (!process.env.REDIS_URL) {
  console.error("REDIS_URL is required");
  process.exit(1);
}

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

function log(msg: string) { console.log(msg); }

async function scan(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "COUNT", 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

async function main() {
  log(`DRY_RUN=${DRY_RUN}  DELETE_OLD=${DELETE_OLD}\n`);

  const allKeys = await scan();
  const targets = allKeys.filter(
    (k) => !k.startsWith("prod:") && !k.startsWith("dev:")
  );

  if (targets.length === 0) {
    log("No unprefixed keys found — nothing to do.");
    process.exit(0);
  }

  log(`Found ${targets.length} unprefixed key(s):\n`);

  if (!DELETE_OLD) {
    // ── Copy phase ────────────────────────────────────────────────────────────
    let copied = 0;
    let skipped = 0;

    for (const key of targets) {
      const dest = `prod:${key}`;
      const exists = await redis.exists(dest);
      if (exists) {
        log(`  skip  ${key}  (prod: copy already exists)`);
        skipped++;
        continue;
      }
      log(`  copy  ${key}  →  ${dest}`);
      if (!DRY_RUN) {
        // COPY preserves type, TTL, and value atomically
        const ok = await redis.copy(key, dest);
        if (!ok) throw new Error(`COPY failed for ${key}`);
      }
      copied++;
    }

    log(`\nDone. Copied: ${copied}  Skipped (already existed): ${skipped}`);
    if (DRY_RUN) log("(dry-run — no changes made)");
    log("\nNext steps:");
    log("  1. Set REDIS_KEY_PREFIX=prod: in Vercel env vars");
    log("  2. Redeploy");
    log("  3. Verify the site works");
    log("  4. Run with --delete-old to remove unprefixed keys");
  } else {
    // ── Delete phase ──────────────────────────────────────────────────────────
    // Only delete a key if its prod: copy exists (safety check)
    let deleted = 0;
    let protected_ = 0;

    for (const key of targets) {
      const dest = `prod:${key}`;
      const copyExists = await redis.exists(dest);
      if (!copyExists) {
        log(`  SKIP  ${key}  (no prod: copy found — refusing to delete)`);
        protected_++;
        continue;
      }
      log(`  del   ${key}`);
      if (!DRY_RUN) await redis.del(key);
      deleted++;
    }

    log(`\nDone. Deleted: ${deleted}  Protected (no copy): ${protected_}`);
    if (DRY_RUN) log("(dry-run — no changes made)");
  }

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
