import Link from "next/link";
import Image from "next/image";
import type { Artwork } from "@/data/artwork";

export default function ArtworkCard({ artwork }: { artwork: Artwork }) {
  return (
    <Link href={`/artwork/${artwork.id}`} className="group block">
      <div className="overflow-hidden bg-neutral-100 aspect-[4/5]">
        <Image
          src={artwork.image}
          alt={artwork.title}
          width={800}
          height={1000}
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
