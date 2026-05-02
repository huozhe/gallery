import { requireSession } from "@/lib/auth";
import { artworks, tags } from "@/lib/store";
import ArtworkForm from "../_components/ArtworkForm";

export default async function NewWorkPage() {
  await requireSession();
  const [allWorks, allTags] = await Promise.all([artworks.list(), tags.list()]);

  return <ArtworkForm mode="create" allTags={allTags} nextOrder={allWorks.length} />;
}
