import { artworks } from "@/data/artwork";
import ArtworkCard from "./ArtworkCard";

export default function GalleryGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
      {artworks.map((artwork) => (
        <ArtworkCard key={artwork.id} artwork={artwork} />
      ))}
    </div>
  );
}
