import { requireSession } from "@/lib/auth";
import { about } from "@/lib/store";
import AboutForm from "./_components/AboutForm";

export default async function AdminAboutPage() {
  await requireSession();
  const content = await about.get();
  return (
    <main className="px-8 py-10 max-w-2xl">
      <h1 className="text-xl font-medium mb-6">About page</h1>
      <AboutForm initial={content} />
    </main>
  );
}
