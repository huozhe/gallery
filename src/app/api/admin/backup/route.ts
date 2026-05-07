import { cookies } from "next/headers";
import { del, list, put } from "@vercel/blob";

const BACKUP_RETENTION = 30;
import { sessions } from "@/lib/store";
import { hashSessionToken } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const sessionOk = token ? !!(await sessions.get(hashSessionToken(token))) : false;
  const cronOk =
    process.env.CRON_SECRET !== undefined &&
    req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  if (!sessionOk && !cronOk) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.REDIS_URL) {
    return Response.json({ ok: false, error: "Backup requires Redis" }, { status: 503 });
  }

  const { backupRedis } = await import("@/lib/store.kv");
  const backup = await backupRedis();
  const keyCount = Object.keys(backup.data).length;
  const body = JSON.stringify(backup, null, 2);
  const date = new Date().toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
  const prefix = process.env.BLOB_PATH_PREFIX ?? "";
  const pathname = `${prefix}backup/redis-${date}.json`;

  let url: string | null = null;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const result = await put(pathname, body, {
      access: "public",
      contentType: "application/json",
      allowOverwrite: true,
    });
    url = result.url;

    const { blobs } = await list({ prefix: `${prefix}backup/` });
    const stale = blobs
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(BACKUP_RETENTION)
      .map((b) => b.url);
    if (stale.length > 0) await del(stale);
  }

  return Response.json({ ok: true, url, keys: keyCount });
}
