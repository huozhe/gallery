import { cookies } from "next/headers";
import { sessions } from "@/lib/store";
import { hashSessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  const token = (await cookies()).get("gallery_session")?.value;
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const session = await sessions.get(hashSessionToken(token));
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const width = parseInt(formData.get("width") as string, 10) || 0;
  const height = parseInt(formData.get("height") as string, 10) || 0;
  const rawDir = (formData.get("dir") as string | null) || "artwork";
  const dir = rawDir.replace(/[^a-zA-Z0-9-/]/g, "");

  if (!file?.name) return Response.json({ error: "No file" }, { status: 400 });

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // Production: upload to Vercel Blob
    const { put } = await import("@vercel/blob");
    const blobPrefix = process.env.BLOB_PATH_PREFIX ?? "";
    const { url } = await put(`${blobPrefix}${dir}/${safeName}`, file, { access: "public", allowOverwrite: true });
    return Response.json({ path: url, width, height });
  } else {
    // Local dev: write to public/ on disk
    const { mkdir, writeFile } = await import("fs/promises");
    const path = await import("path");
    const dest = path.join(process.cwd(), "public", dir, safeName);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await file.arrayBuffer()));
    return Response.json({ path: `/${dir}/${safeName}`, width, height });
  }
}
