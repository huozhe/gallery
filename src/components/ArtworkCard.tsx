import Link from "next/link";
import Image from "next/image";
import type { Artwork } from "@/data/types";

export default function ArtworkCard({ artwork }: { artwork: Artwork }) {
  const isLandscape = artwork.width > artwork.height;

  return (
    <Link href={`/artwork/${artwork.id}`} className="group block break-inside-avoid mb-8">
      <div className={`overflow-hidden bg-neutral-100 ${isLandscape ? "aspect-[4/3]" : "aspect-[3/4]"}`}>
        <Image
          src={artwork.image}
          alt={artwork.title}
          width={artwork.width}
          height={artwork.height}
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
