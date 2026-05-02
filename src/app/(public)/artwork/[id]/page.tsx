import Link from "next/link";
import { notFound } from "next/navigation";
import { artworks } from "@/lib/store";
import type { Artwork } from "@/data/types";
import ArtworkImage from "@/components/ArtworkImage";

function Metadata({ artwork }: { artwork: Artwork }) {
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
        <div className="mt-6 space-y-3 text-sm leading-relaxed text-neutral-700">
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
      )}
      {artwork.reference && (
        <div className="mt-6 pt-4 border-t border-neutral-200 text-sm text-neutral-600">
          <p>{artwork.reference.caption}</p>
          {artwork.reference.url && (
            <a
              href={artwork.reference.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-900 transition-colors"
            >
              link
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default async function ArtworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const artwork = await artworks.get(id);
  if (!artwork || artwork.status !== "live") notFound();

  const isLandscape = artwork.width > artwork.height;

  return (
    <main className="px-8 py-12 max-w-5xl mx-auto">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-10 inline-block"
      >
        ← Back
      </Link>

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
    </main>
  );
}
