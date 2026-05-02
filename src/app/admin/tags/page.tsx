import { requireSession } from "@/lib/auth";
import { artworks, tags } from "@/lib/store";
import TagsManager from "./_components/TagsManager";

export default async function TagsPage() {
  await requireSession("/admin/tags");
  const [allTags, allWorks] = await Promise.all([tags.list(), artworks.list()]);

  return <TagsManager tags={allTags} artworks={allWorks} />;
}
