import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { artworks } from "@/lib/store";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const host = h.get("host") ?? "roamingbrush.art";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const base = `${proto}://${host}`;

  const liveWorks = await artworks.list({ status: "live" });

  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.7 },
    ...liveWorks.map((w) => ({
      url: `${w.slug}`.startsWith("http") ? w.slug : `${base}/artwork/${w.slug}`,
      lastModified: new Date(w.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
