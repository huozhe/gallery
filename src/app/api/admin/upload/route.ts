import { cookies } from "next/headers";
import { sessions } from "@/lib/store";
import { hashSessionToken } from "@/lib/auth";
import sharp from "sharp";

const MAX_EDGE = 2000;

export async function POST(req: Request) {
  const token = (await cookies()).get("gallery_session")?.value;
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const session = await sessions.get(hashSessionToken(token));
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const rawDir = (formData.get("dir") as string | null) || "artwork";
  const dir = rawDir.replace(/[^a-zA-Z0-9-/]/g, "");

  if (!file?.name) return Response.json({ error: "No file" }, { status: 400 });

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const baseName = safeName.replace(/\.[^.]+$/, "");
  const webpName = `${baseName}.webp`;

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const img = sharp(inputBuffer);
  const { width: origW = 0, height: origH = 0 } = await img.metadata();
  const longestEdge = Math.max(origW, origH);
  const resize =
    longestEdge > MAX_EDGE
      ? origW >= origH
        ? { width: MAX_EDGE }
        : { height: MAX_EDGE }
      : undefined;
  const { data: webpBuffer, info } = await img
    .resize(resize)
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blobPrefix = process.env.BLOB_PATH_PREFIX ?? "";
    const [{ url: path }, { url: originalPath }] = await Promise.all([
      put(`${blobPrefix}${dir}/${webpName}`, webpBuffer, {
        access: "public",
        allowOverwrite: true,
        contentType: "image/webp",
      }),
      put(`${blobPrefix}original/${dir}/${safeName}`, inputBuffer, {
        access: "public",
        allowOverwrite: true,
      }),
    ]);
    return Response.json({ path, originalPath, width: info.width, height: info.height });
  } else {
    const { mkdir, writeFile } = await import("fs/promises");
    const pathMod = await import("path");
    const webpDest = pathMod.join(process.cwd(), "public", dir, webpName);
    const origDest = pathMod.join(process.cwd(), "public", "original", dir, safeName);
    await mkdir(pathMod.dirname(webpDest), { recursive: true });
    await mkdir(pathMod.dirname(origDest), { recursive: true });
    await Promise.all([
      writeFile(webpDest, webpBuffer),
      writeFile(origDest, inputBuffer),
    ]);
    return Response.json({
      path: `/${dir}/${webpName}`,
      originalPath: `/original/${dir}/${safeName}`,
      width: info.width,
      height: info.height,
    });
  }
}
