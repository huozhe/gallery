import GalleryGrid from "@/components/GalleryGrid";
import { artworks, tags } from "@/lib/store";

export default async function Home() {
  const [works, allTags] = await Promise.all([
    artworks.list({ status: "live" }),
    tags.list(),
  ]);

  // Exclude works whose every tag is marked invisible.
  // Untagged works are always shown.
  // (When rooms are built in step 10, this becomes a room-level filter.)
  const visibleTagIds = new Set(allTags.filter((t) => t.visible).map((t) => t.id));
  const publicWorks = works.filter(
    (w) => w.tagIds.length === 0 || w.tagIds.some((id) => visibleTagIds.has(id)),
  );

  return (
    <main className="px-8 py-12">
      <GalleryGrid artworks={publicWorks} />
    </main>
  );
}
