import { requireSession } from "@/lib/auth";
import BackupManager from "./_components/BackupManager";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  await requireSession("/admin/backup");

  const prefix = process.env.BLOB_PATH_PREFIX ?? "";
  const hasBlobToken = !!process.env.BLOB_READ_WRITE_TOKEN;
  const hasRedis = !!process.env.REDIS_URL;

  type BlobItem = { url: string; pathname: string; size: number; uploadedAt: Date };
  let blobs: BlobItem[] = [];

  if (hasBlobToken) {
    const { list } = await import("@vercel/blob");
    try {
      const result = await list({ prefix: `${prefix}backup/` });
      blobs = result.blobs
        .map((b) => ({
          url: b.url,
          pathname: b.pathname,
          size: b.size,
          uploadedAt: new Date(b.uploadedAt),
        }))
        .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
    } catch {
      // blob list failure is non-fatal
    }
  }

  return (
    <div className="px-8 py-8 max-w-3xl">
      <h1 className="text-lg font-semibold mb-6">Backup &amp; Restore</h1>
      <BackupManager blobs={blobs} hasBlobToken={hasBlobToken} hasRedis={hasRedis} />
    </div>
  );
}
