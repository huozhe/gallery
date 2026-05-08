import type { Metadata } from "next";
import { headers } from "next/headers";
import { about } from "@/lib/store";
import { getTenantFromHeaders } from "@/lib/tenant";
import { ContactForm } from "./_components/ContactForm";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const tenant = getTenantFromHeaders(h);
  const content = await about.get();
  const description = content.bio.split(/\n\n+/)[0]?.slice(0, 160) ?? "";
  return {
    title: `About — ${tenant.name}`,
    description,
    openGraph: { title: `About — ${tenant.name}`, description },
  };
}

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
      <div className="mt-12 pt-8 border-t border-neutral-200">
        <h2 className="text-sm font-medium mb-6">Send a message</h2>
        <ContactForm />
      </div>
    </main>
  );
}
