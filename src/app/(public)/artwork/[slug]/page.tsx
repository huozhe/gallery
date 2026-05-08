import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { artworks, tags } from "@/lib/store";
import type { Artwork } from "@/data/types";
import { getTenantFromHeaders } from "@/lib/tenant";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const artwork = await artworks.getBySlug(slug);
  if (!artwork || artwork.status !== "live") return {};

  const h = await headers();
  const tenant = getTenantFromHeaders(h);
  const host = h.get("host") ?? "roamingbrush.art";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const baseUrl = `${proto}://${host}`;

  const description = artwork.description
    ? artwork.description.split("\n")[0].slice(0, 160)
    : `${artwork.title}, ${artwork.year}. ${artwork.medium}.`;

  const imageUrl = artwork.image.startsWith("http")
    ? artwork.image
    : `${baseUrl}${artwork.image}`;

  return {
    title: `${artwork.title} — ${tenant.name}`,
    description,
    openGraph: {
      title: artwork.title,
      description,
      type: "article",
      images: [{ url: imageUrl, width: artwork.width, height: artwork.height, alt: artwork.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: artwork.title,
      description,
      images: [imageUrl],
    },
  };
}
import ArtworkImage from "@/components/ArtworkImage";
import ReferenceImage from "@/components/ReferenceImage";

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-3">
      {children}
    </p>
  );
}

function Metadata({ artwork }: { artwork: Artwork }) {
  const ref = artwork.reference;
  return (
    <div>
      <h1 className="text-2xl font-medium">{artwork.title}</h1>
      <dl className="mt-4 space-y-2 text-sm text-neutral-600">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0">Year</dt>
          <dd>{artwork.year}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0">Medium</dt>
          <dd>{artwork.medium}</dd>
        </div>
        {artwork.dimensions && (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0">Dimensions</dt>
            <dd>{artwork.dimensions}</dd>
          </div>
        )}
      </dl>

      {artwork.description && (
        <div className="mt-8">
          <SectionLabel>On the subject</SectionLabel>
          <div className="space-y-3 text-sm leading-relaxed text-neutral-700">
            {artwork.description.split("\n").map((line, li) => (
              <p key={li}>
                {line.split(/(https?:\/\/\S+)/).map((part, i) =>
                  /^https?:\/\//.test(part) ? (
                    <a
                      key={i}
                      href={part}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-neutral-900 transition-colors"
                    >
                      link
                    </a>
                  ) : (
                    part
                  )
                )}
              </p>
            ))}
          </div>
        </div>
      )}

      {ref && (
        <div className="mt-8 pt-6 border-t border-neutral-200">
          <SectionLabel>Reference</SectionLabel>
          <div className="text-sm text-neutral-600 space-y-3">
            {ref.image && (
              <ReferenceImage
                src={ref.image}
                alt={ref.caption}
                width={ref.imageWidth ?? 800}
                height={ref.imageHeight ?? 600}
                caption={ref.caption}
              />
            )}
            <p>{ref.caption}</p>
            {ref.url && (
              <a
                href={ref.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-neutral-900 transition-colors"
              >
                link ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default async function ArtworkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [artwork, allWorks, primaryTags] = await Promise.all([
    artworks.getBySlug(slug),
    artworks.list({ status: "live" }),
    tags.list({ visible: true, primaryRoom: true }),
  ]);
  if (!artwork || artwork.status !== "live") notFound();

  const roomIndex = primaryTags.findIndex((t) => artwork.tagIds.includes(t.id));
  const roomTag = roomIndex !== -1 ? primaryTags[roomIndex] : null;
  const roomWorks = roomTag
    ? allWorks
        .filter((w) => w.tagIds.includes(roomTag.id))
        .sort((a, b) => (a.orderByTag[roomTag.id] ?? 999) - (b.orderByTag[roomTag.id] ?? 999))
    : [];
  const pos = roomWorks.findIndex((w) => w.slug === slug);
  const prevWork = pos > 0 ? roomWorks[pos - 1] : null;
  const nextWork = pos !== -1 && pos < roomWorks.length - 1 ? roomWorks[pos + 1] : null;

  const isLandscape = artwork.width > artwork.height;

  return (
    <main className="px-8 py-12 max-w-5xl mx-auto">
      {roomTag && pos !== -1 ? (
        <p className="text-xs font-mono text-neutral-400 mb-10">
          <Link
            href={`/#room-${roomTag.id}`}
            className="hover:text-neutral-600 transition-colors"
          >
            Room {toRoman(roomIndex + 1)} — {roomTag.title}
          </Link>
          {" · Plate "}
          {String(pos + 1).padStart(2, "0")} / {String(roomWorks.length).padStart(2, "0")}
        </p>
      ) : (
        <div className="mb-10" />
      )}

      {isLandscape ? (
        <div className="space-y-8">
          <ArtworkImage
            src={artwork.image}
            alt={artwork.title}
            width={artwork.width}
            height={artwork.height}
          />
          <Metadata artwork={artwork} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-12 items-start">
          <ArtworkImage
            src={artwork.image}
            alt={artwork.title}
            width={artwork.width}
            height={artwork.height}
          />
          <Metadata artwork={artwork} />
        </div>
      )}

      <nav className="mt-16 pt-6 border-t border-neutral-200 flex justify-between items-center text-sm">
        {prevWork ? (
          <Link
            href={`/artwork/${prevWork.slug}`}
            className="text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            ← Prev: {prevWork.title}
          </Link>
        ) : (
          <span />
        )}
        <Link
          href={roomTag ? `/#room-${roomTag.id}` : "/"}
          className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          {roomTag ? `Room ${toRoman(roomIndex + 1)} — ${roomTag.title}` : "↑ Index"}
        </Link>
        {nextWork ? (
          <Link
            href={`/artwork/${nextWork.slug}`}
            className="text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            Next: {nextWork.title} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
