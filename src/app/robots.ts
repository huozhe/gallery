import type { MetadataRoute } from "next";
import { headers } from "next/headers";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const host = h.get("host") ?? "roamingbrush.art";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const base = `${proto}://${host}`;

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/admin/" },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
