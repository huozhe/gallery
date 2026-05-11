import { cookies, headers } from "next/headers";
import { del, list, put } from "@vercel/blob";
import { getAllTenants, getTenantFromHeaders, type Tenant } from "@/lib/tenant";

const BACKUP_RETENTION = 30;
const TAG = "[backup]";
import { sessions } from "@/lib/store";
import { hashSessionToken } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function runBackup(
  tenant: { id: string; redisPrefix: string; blobPrefix: string },
  backupRedis: (prefix?: string) => Promise<{ data: Record<string, unknown>; timestamp: string; prefix: string }>,
): Promise<{ ok: true; keys: number; url: string | null } | { ok: false; error: string }> {
  try {
    const backup = await backupRedis(tenant.redisPrefix);
    const keyCount = Object.keys(backup.data).length;
    const body = JSON.stringify(backup, null, 2);
    const date = new Date().toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
    const pathname = `${tenant.blobPrefix}backup/redis-${date}.json`;

    let url: string | null = null;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const result = await put(pathname, body, {
        access: "public",
        contentType: "application/json",
        allowOverwrite: true,
      });
      url = result.url;

      const { blobs } = await list({ prefix: `${tenant.blobPrefix}backup/` });
      const stale = blobs
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
        .slice(BACKUP_RETENTION)
        .map((b) => b.url);
      if (stale.length > 0) {
        await del(stale);
        console.log(`${TAG} [${tenant.id}] Pruned ${stale.length} old backup(s)`);
      }
    } else {
      console.warn(`${TAG} [${tenant.id}] BLOB_READ_WRITE_TOKEN not set — backup not persisted`);
    }

    console.log(`${TAG} [${tenant.id}] Done: ${keyCount} keys → ${url ?? "(no blob)"}`);
    return { ok: true, keys: keyCount, url };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`${TAG} [${tenant.id}] Failed:`, e);
    return { ok: false, error };
  }
}

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const sessionOk = token ? !!(await sessions.get(hashSessionToken(token))) : false;
  const cronOk =
    process.env.CRON_SECRET !== undefined &&
    req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  if (!sessionOk && !cronOk) {
    console.warn(`${TAG} Unauthorized — no valid session or cron secret`);
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.REDIS_URL) {
    console.error(`${TAG} REDIS_URL not set`);
    return Response.json({ ok: false, error: "Backup requires Redis" }, { status: 503 });
  }

  const { backupRedis } = await import("@/lib/store.kv");

  if (cronOk) {
    const tenants = getAllTenants();
    if (tenants && tenants.length > 0) {
      console.log(`${TAG} Cron triggered — backing up ${tenants.length} tenant(s): ${tenants.map((t: Tenant) => t.id).join(", ")}`);
      const results: Array<{ tenant: string } & Awaited<ReturnType<typeof runBackup>>> = [];
      for (const tenant of tenants) {
        console.log(`${TAG} [${tenant.id}] Starting (prefix: ${tenant.redisPrefix})`);
        const result = await runBackup(tenant, backupRedis);
        results.push({ tenant: tenant.id, ...result });
      }
      const failed = results.filter((r) => !r.ok).length;
      console.log(`${TAG} Cron complete: ${results.length - failed}/${results.length} succeeded`);
      return Response.json({ ok: failed === 0, results });
    }
    console.log(`${TAG} Cron triggered — no GALLERY_TENANTS configured, using single-tenant fallback`);
  }

  // Session-auth path (or cron in legacy single-tenant mode): back up current tenant only.
  const tenant = getTenantFromHeaders(await headers());
  console.log(`${TAG} [${tenant.id}] Starting (prefix: ${tenant.redisPrefix})`);
  const result = await runBackup(tenant, backupRedis);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 500 });
  }
  return Response.json({ ok: true, url: result.url, keys: result.keys });
}
