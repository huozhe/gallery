"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ulid } from "ulid";
import { z } from "zod";
import { artworks, audit, sessions, users } from "@/lib/store";
import type { AuditAction } from "@/data/types";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  checkRateLimit,
  createSessionToken,
  hashSessionToken,
  recordAttempt,
  requireSession,
  verifyPassword,
} from "@/lib/auth";

// ---------- helpers ----------

const SignInSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1),
  next: z.string().optional(),
});

const IdSchema = z.string().min(1).max(80);
const IdsSchema = z.array(IdSchema).min(1);

function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/admin") || next.startsWith("/admin/sign-in")) {
    return "/admin";
  }
  return next;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

async function logAudit(
  action: AuditAction,
  target: string,
  diff?: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  const { user } = await requireSession();
  await audit.log({
    id: ulid(),
    at: new Date().toISOString(),
    actorId: user.id,
    actorEmail: user.email,
    action,
    target,
    diff,
    ip: await clientIp(),
  });
}

// ---------- auth ----------

export async function signIn(formData: FormData): Promise<void> {
  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  const next = safeNext((formData.get("next") as string) ?? undefined);

  if (!parsed.success) {
    redirect(`/admin/sign-in?error=invalid&next=${encodeURIComponent(next)}`);
  }

  const ip = await clientIp();
  const rateKey = `signin:${ip}`;
  if (!checkRateLimit(rateKey)) {
    redirect(`/admin/sign-in?error=rate-limited&next=${encodeURIComponent(next)}`);
  }

  const { email, password } = parsed.data;
  const user = await users.getByEmail(email);
  const ok = user ? await verifyPassword(user.passwordHash, password) : false;

  if (!user || !ok) {
    recordAttempt(rateKey);
    await audit.log({
      id: ulid(),
      at: new Date().toISOString(),
      actorId: user?.id ?? "anonymous",
      actorEmail: email,
      action: "auth.failed",
      ip,
    });
    redirect(`/admin/sign-in?error=invalid&next=${encodeURIComponent(next)}`);
  }

  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const session = {
    id: ulid(),
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    userAgent: (await headers()).get("user-agent") ?? undefined,
    ip,
  };
  await sessions.upsert(tokenHash, session);
  await users.upsert({ ...user, lastSignInAt: now.toISOString() });
  await audit.log({
    id: ulid(),
    at: now.toISOString(),
    actorId: user.id,
    actorEmail: user.email,
    action: "auth.sign-in",
    ip,
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  redirect(next);
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = hashSessionToken(token);
    const session = await sessions.get(tokenHash);
    if (session) {
      const user = await users.getById(session.userId);
      await sessions.delete(tokenHash);
      if (user) {
        await audit.log({
          id: ulid(),
          at: new Date().toISOString(),
          actorId: user.id,
          actorEmail: user.email,
          action: "auth.sign-out",
          ip: await clientIp(),
        });
      }
    }
  }
  jar.delete(SESSION_COOKIE);
  redirect("/admin/sign-in");
}

// ---------- artwork mutations ----------

/**
 * Reassign orderGlobal across all artworks in `ids` so the new order matches
 * the order they appear in the array.
 */
export async function reorderArtworks(ids: string[]): Promise<void> {
  await requireSession();
  const parsed = IdsSchema.safeParse(ids);
  if (!parsed.success) throw new Error("invalid ids");

  const before = await artworks.list();
  const beforeOrder = before.map((a) => a.id);
  const afterOrder = parsed.data;

  for (let i = 0; i < afterOrder.length; i++) {
    const id = afterOrder[i];
    const work = await artworks.get(id);
    if (!work) continue;
    if (work.orderGlobal !== i) {
      await artworks.upsert({ ...work, orderGlobal: i });
    }
  }

  await logAudit("artwork.update", "reorder", {
    orderGlobal: { from: beforeOrder, to: afterOrder },
  });
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function softDeleteArtwork(id: string): Promise<void> {
  await requireSession();
  IdSchema.parse(id);
  const before = await artworks.get(id);
  if (!before) return;
  await artworks.softDelete(id);
  await logAudit("artwork.delete", id, {
    status: { from: before.status, to: "deleted" },
  });
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function restoreArtwork(id: string): Promise<void> {
  await requireSession();
  IdSchema.parse(id);
  const before = await artworks.get(id);
  if (!before) return;
  await artworks.restore(id);
  await logAudit("artwork.restore", id, {
    status: { from: before.status, to: "live" },
  });
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function purgeArtwork(id: string): Promise<void> {
  await requireSession();
  IdSchema.parse(id);
  const before = await artworks.get(id);
  if (!before) return;
  await artworks.purge(id);
  await logAudit("artwork.purge", id, {
    deleted: { from: { id: before.id, title: before.title }, to: null },
  });
  revalidatePath("/admin");
  revalidatePath("/");
}
