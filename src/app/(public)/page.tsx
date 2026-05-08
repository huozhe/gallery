import type { Metadata } from "next";
import { headers } from "next/headers";
import GalleryGrid from "@/components/GalleryGrid";
import SlideshowButton from "@/components/SlideshowButton";
import { about, artworks, tags } from "@/lib/store";
import { getTenantFromHeaders } from "@/lib/tenant";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const tenant = getTenantFromHeaders(h);
  const content = await about.get();
  const description = content.bio.split(/\n\n+/)[0]?.slice(0, 160) ?? "";
  return {
    title: tenant.name,
    description,
    openGraph: { title: tenant.name, description, type: "website" },
  };
}

function toRoman(n: number): string {
  const map: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let result = "";
  let rem = n;
  for (const [val, sym] of map) {
    while (rem >= val) { result += sym; rem -= val; }
  }
  return result;
}

export default async function Home() {
  const [allWorks, primaryTags] = await Promise.all([
    artworks.list({ status: "live" }),
    tags.list({ visible: true, primaryRoom: true }),
  ]);

  const rooms = primaryTags
    .map((tag) => ({
      tag,
      works: allWorks
        .filter((w) => w.tagIds.includes(tag.id))
        .sort((a, b) => (a.orderByTag[tag.id] ?? 999) - (b.orderByTag[tag.id] ?? 999)),
    }))
    .filter(({ works }) => works.length > 0);

  const seen = new Set<number>();
  const slideshowWorks = rooms
    .flatMap(({ works }) => works)
    .filter((w) => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    });

  return (
    <main className="px-8 py-12">
      {slideshowWorks.length > 0 && (
        <div className="flex items-center gap-2 mb-10">
          {rooms.length > 1 && rooms.map(({ tag, works }) => (
            <a
              key={tag.id}
              href={`#room-${tag.id}`}
              className="text-xs px-3 py-1 rounded-full border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 transition-colors"
            >
              {tag.title} · {works.length}
            </a>
          ))}
          <div className="flex-1" />
          <SlideshowButton artworks={slideshowWorks} />
        </div>
      )}

      {rooms.map(({ tag, works }, i) => (
        <section key={tag.id} id={`room-${tag.id}`} className="mb-16 scroll-mt-6">
          <div className="flex items-baseline justify-between border-b border-neutral-200 pb-2 mb-6">
            <h2 className="text-base font-medium">
              Room {toRoman(i + 1)} — {tag.title}
            </h2>
            <span className="text-xs text-neutral-400">
              {works.length} {works.length === 1 ? "work" : "works"}
            </span>
          </div>
          {tag.note && (
            <p className="text-sm text-neutral-500 -mt-2 mb-6">{tag.note}</p>
          )}
          <GalleryGrid artworks={works} priorityCount={i === 0 ? 3 : 1} />
        </section>
      ))}

      {rooms.length === 0 && (
        <p className="text-sm text-neutral-400">No works yet.</p>
      )}
    </main>
  );
}
