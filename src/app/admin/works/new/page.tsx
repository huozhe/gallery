import Link from "next/link";
import { requireSession } from "@/lib/auth";

export default async function NewWorkPage() {
  await requireSession();
  return (
    <main className="px-8 py-12 max-w-2xl mx-auto">
      <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-900 underline">
        ← Back to dashboard
      </Link>
      <h1 className="text-2xl font-medium mt-4">New work</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Create form not built yet — see <code>data-model.md</code> §9 step 6.
      </p>
    </main>
  );
}
