import { requireSession } from "@/lib/auth";
import { artworks, tags } from "@/lib/store";
import AdminDashboard from "./_components/AdminDashboard";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: viewParam } = await searchParams;
  const view = viewParam === "trash" ? "trash" : "all";

  await requireSession(view === "trash" ? "/admin?view=trash" : "/admin");

  const [works, allTags, allCounts] = await Promise.all([
    view === "trash" ? artworks.list({ trashed: true }) : artworks.list(),
    tags.list(),
    artworks.list({ trashed: true }).then((trash) =>
      artworks.list().then((live) => ({ live: live.length, trash: trash.length })),
    ),
  ]);

  return (
    <AdminDashboard
      view={view}
      works={works}
      tags={allTags}
      liveCount={allCounts.live}
      trashCount={allCounts.trash}
    />
  );
}
