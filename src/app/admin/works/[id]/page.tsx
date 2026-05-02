import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { artworks } from "@/lib/store";

export default async function EditWorkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const work = await artworks.get(id);
  if (!work) notFound();

  return (
    <main className="px-8 py-12 max-w-2xl mx-auto">
      <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-900 underline">
        ← Back to dashboard
      </Link>
      <h1 className="text-2xl font-medium mt-4">{work.title}</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Edit form not built yet — see <code>data-model.md</code> §9 step 6 (form
        with live preview + Vercel Blob upload).
      </p>

      <dl className="mt-8 space-y-2 text-sm border border-neutral-200 p-4">
        <Row label="ID" value={work.id} />
        <Row label="Status" value={work.status} />
        <Row label="Medium" value={work.medium} />
        <Row label="Year" value={String(work.year)} />
        <Row label="Tags" value={work.tagIds.join(", ") || "—"} />
        <Row label="Order (global)" value={String(work.orderGlobal)} />
      </dl>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-neutral-900">{value}</dd>
    </div>
  );
}
