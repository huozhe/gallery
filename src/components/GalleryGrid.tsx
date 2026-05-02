import type { Artwork } from "@/data/types";
import ArtworkCard from "./ArtworkCard";

export default function GalleryGrid({ artworks }: { artworks: Artwork[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 items-start">
      {artworks.map((artwork) => (
        <ArtworkCard key={artwork.id} artwork={artwork} />
      ))}
    </div>
  );
}
