import GalleryGrid from "@/components/GalleryGrid";
import { artworks } from "@/lib/store";

export default async function Home() {
  const works = await artworks.list({ status: "live" });
  return (
    <main className="px-8 py-12">
      <GalleryGrid artworks={works} />
    </main>
  );
}
