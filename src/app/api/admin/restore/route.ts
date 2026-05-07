import { ulid } from "ulid";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/store";
import type { BackupData } from "@/lib/store.kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sessionData = await getSession();
  if (!sessionData) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.REDIS_URL) {
    return Response.json({ ok: false, error: "Restore requires Redis" }, { status: 503 });
  }

  let url: string;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.url !== "string" || !body.url) throw new Error();
    url = body.url;
  } catch {
    return Response.json({ ok: false, error: "url is required" }, { status: 400 });
  }

  let data: BackupData;
  try {
    const res = await fetch(url);
    const parsed = (await res.json()) as BackupData;
    if (
      typeof parsed !== "object" ||
      !parsed.timestamp ||
      !parsed.prefix ||
      typeof parsed.data !== "object"
    ) {
      throw new Error("Invalid backup shape");
    }
    data = parsed;
  } catch {
    return Response.json({ ok: false, error: "Failed to fetch or parse backup" }, { status: 400 });
  }

  const { restoreRedis } = await import("@/lib/store.kv");
  const { keys } = await restoreRedis(data);

  await audit.log({
    id: ulid(),
    at: new Date().toISOString(),
    actorId: sessionData.user.id,
    actorEmail: sessionData.user.email,
    action: "backup.restore",
    target: url,
  });

  return Response.json({ ok: true, keys });
}
