"use server";

import { revalidatePath } from "next/cache";
import { del, list, put } from "@vercel/blob";
import { ulid } from "ulid";
import { headers } from "next/headers";
import { getTenantFromHeaders } from "@/lib/tenant";

const BACKUP_RETENTION = 30;

async function purgeOldBackups(prefix: string): Promise<void> {
  const { blobs } = await list({ prefix: `${prefix}backup/` });
  const sorted = blobs.sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  );
  const stale = sorted.slice(BACKUP_RETENTION).map((b) => b.url);
  if (stale.length > 0) await del(stale);
}
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/store";
import type { BackupData } from "@/lib/store.kv";

export async function triggerBackup(): Promise<{ ok: boolean; url: string | null; keys: number }> {
  await requireSession("/admin/backup");

  if (!process.env.REDIS_URL) throw new Error("Backup requires Redis");

  const { backupRedis } = await import("@/lib/store.kv");
  const backup = await backupRedis();
  const keyCount = Object.keys(backup.data).length;
  const body = JSON.stringify(backup, null, 2);
  const date = new Date().toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
  const prefix = getTenantFromHeaders(await headers()).blobPrefix;
  const pathname = `${prefix}backup/redis-${date}.json`;

  let url: string | null = null;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const result = await put(pathname, body, {
      access: "public",
      contentType: "application/json",
      allowOverwrite: true,
    });
    url = result.url;
    await purgeOldBackups(prefix);
  }

  revalidatePath("/admin/backup");
  return { ok: true, url, keys: keyCount };
}

export async function triggerRestore(blobUrl: string): Promise<{ ok: boolean; keys: number }> {
  const { user } = await requireSession("/admin/backup");

  if (!process.env.REDIS_URL) throw new Error("Restore requires Redis");

  let data: BackupData;
  try {
    const res = await fetch(blobUrl);
    const parsed = (await res.json()) as BackupData;
    if (
      typeof parsed !== "object" ||
      !parsed.timestamp ||
      !parsed.prefix ||
      typeof parsed.data !== "object"
    ) {
      throw new Error("Invalid backup format");
    }
    data = parsed;
  } catch {
    throw new Error("Failed to fetch or parse backup");
  }

  const { restoreRedis } = await import("@/lib/store.kv");
  const { keys } = await restoreRedis(data);

  await audit.log({
    id: ulid(),
    at: new Date().toISOString(),
    actorId: user.id,
    actorEmail: user.email,
    action: "backup.restore",
    target: blobUrl,
  });

  revalidatePath("/admin/backup");
  return { ok: true, keys };
}

export async function deleteBackup(url: string): Promise<void> {
  await requireSession("/admin/backup");
  await del(url);
  revalidatePath("/admin/backup");
}
