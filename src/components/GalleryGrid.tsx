import type { Artwork } from "@/data/types";
import ArtworkCard from "./ArtworkCard";

export default function GalleryGrid({ artworks, priorityCount = 1 }: { artworks: Artwork[]; priorityCount?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 items-start">
      {artworks.map((artwork, i) => (
        <ArtworkCard key={artwork.id} artwork={artwork} priority={i < priorityCount} />
      ))}
    </div>
  );
}
