import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { artworks, getArtwork } from "@/data/artwork";

export function generateStaticParams() {
  return artworks.map((a) => ({ id: a.id }));
}

export default async function ArtworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const artwork = getArtwork(id);
  if (!artwork) notFound();

  return (
    <main className="px-8 py-12 max-w-5xl mx-auto">
      <Link
        href="/"
        className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-10 inline-block"
      >
        ← Back
      </Link>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
        <div className="bg-neutral-100 overflow-hidden">
          <Image
            src={artwork.image}
            alt={artwork.title}
            width={800}
            height={1000}
            className="w-full h-auto object-contain"
            priority
          />
        </div>
        <div className="md:pt-4">
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
            <p className="mt-6 text-sm leading-relaxed text-neutral-700">
              {artwork.description.split(/(https?:\/\/\S+)/).map((part, i) =>
                /^https?:\/\//.test(part) ? (
                  <a
                    key={i}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-neutral-900 transition-colors"
                  >
                    {part}
                  </a>
                ) : (
                  part
                )
              )}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
