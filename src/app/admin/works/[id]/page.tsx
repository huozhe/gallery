import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { artworks, tags } from "@/lib/store";
import ArtworkForm from "../_components/ArtworkForm";

export default async function EditWorkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const numericId = parseInt(id, 10);
  if (isNaN(numericId)) notFound();
  const [work, allTags] = await Promise.all([artworks.get(numericId), tags.list()]);
  if (!work) notFound();

  return <ArtworkForm mode="edit" artwork={work} allTags={allTags} />;
}
