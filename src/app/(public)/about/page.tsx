import { about } from "@/lib/store";

export default async function About() {
  const content = await about.get();
  const paragraphs = content.bio.split(/\n\n+/).filter(Boolean);

  return (
    <main className="px-8 py-12 max-w-xl">
      <h1 className="text-2xl font-medium mb-6">About</h1>
      <div className="space-y-4 text-sm leading-relaxed text-neutral-700">
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      <div className="mt-8 text-sm text-neutral-500">
        <a href={`mailto:${content.email}`} className="hover:text-neutral-900 transition-colors">
          {content.email}
        </a>
      </div>
    </main>
  );
}
