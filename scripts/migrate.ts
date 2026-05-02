// One-shot migration: seeds the store with the initial 5 works + 3 tags
// per data-model.md §3. Idempotent — running on populated data is a no-op.
//
// Usage: npm run migrate

import { seed } from "../src/lib/store";

async function main() {
  const result = await seed();
  if (result.tags === 0 && result.artworks === 0) {
    console.log("Store already seeded — nothing to do.");
  } else {
    console.log(
      `Seeded ${result.tags} tag(s) and ${result.artworks} artwork(s) into .data/store.json.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
