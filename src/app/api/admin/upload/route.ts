import { cookies } from "next/headers";
import { sessions } from "@/lib/store";
import { hashSessionToken } from "@/lib/auth";
import { ARTIST_BLOB_ID } from "@/lib/config";
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
  const origExt = (safeName.match(/\.([^.]+)$/) ?? ["", "bin"])[1].toLowerCase();
  const uuid = crypto.randomUUID();
  const webpName = `${uuid}.webp`;
  const origName = `${uuid}.${origExt}`;

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

  const artistDir = `artists/${ARTIST_BLOB_ID}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blobPrefix = process.env.BLOB_PATH_PREFIX ?? "";
    const [{ url: path }, { url: originalPath }] = await Promise.all([
      put(`${blobPrefix}${artistDir}/${dir}/${webpName}`, webpBuffer, {
        access: "public",
        allowOverwrite: true,
        contentType: "image/webp",
      }),
      put(`${blobPrefix}${artistDir}/${dir}/original/${origName}`, inputBuffer, {
        access: "public",
        allowOverwrite: true,
      }),
    ]);
    return Response.json({ path, originalPath, originalFilename: file.name, width: info.width, height: info.height });
  } else {
    const { mkdir, writeFile } = await import("fs/promises");
    const pathMod = await import("path");
    const webpDest = pathMod.join(process.cwd(), "public", artistDir, dir, webpName);
    const origDest = pathMod.join(process.cwd(), "public", artistDir, dir, "original", origName);
    await mkdir(pathMod.dirname(webpDest), { recursive: true });
    await mkdir(pathMod.dirname(origDest), { recursive: true });
    await Promise.all([
      writeFile(webpDest, webpBuffer),
      writeFile(origDest, inputBuffer),
    ]);
    return Response.json({
      path: `/${artistDir}/${dir}/${webpName}`,
      originalPath: `/${artistDir}/${dir}/original/${origName}`,
      originalFilename: file.name,
      width: info.width,
      height: info.height,
    });
  }
}
