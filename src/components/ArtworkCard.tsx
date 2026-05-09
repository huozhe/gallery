import Link from "next/link";
import Image from "next/image";
import type { Artwork } from "@/data/types";

export default function ArtworkCard({ artwork, priority = false }: { artwork: Artwork; priority?: boolean }) {
  const primary = artwork.images[0];
  const isLandscape = primary.width > primary.height;

  return (
    <Link href={`/artwork/${artwork.slug}`} className="group block break-inside-avoid mb-8">
      <div className={`overflow-hidden bg-neutral-100 ${isLandscape ? "aspect-[4/3]" : "aspect-[3/4]"}`}>
        <Image
          src={primary.url}
          alt={artwork.title}
          width={primary.width}
          height={primary.height}
          priority={priority}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
      </div>
      <div className="mt-3">
        <p className="text-sm font-medium">{artwork.title}</p>
        <p className="text-xs text-neutral-500 mt-0.5">
          {artwork.medium}, {artwork.year}
        </p>
      </div>
    </Link>
  );
}
