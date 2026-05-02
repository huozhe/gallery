"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ulid } from "ulid";
import { z } from "zod";
import { artworks, audit, sessions, tags, users } from "@/lib/store";
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

// ---------- artwork save / create ----------

const SaveArtworkSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9-]+$/, "ID must contain only letters, numbers, and hyphens"),
  title: z.string().min(1, "Title required").max(120),
  year: z.number().int().min(1800).max(new Date().getFullYear() + 1),
  medium: z.string().min(1, "Medium required"),
  dimensions: z.string().optional(),
  description: z.string().optional(),
  image: z.string().min(1, "Image required"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  status: z.enum(["live", "draft", "hidden"]),
  tagIds: z.array(z.string()),
  orderGlobal: z.number().int().min(0),
  orderByTag: z.record(z.string(), z.number()),
  reference: z
    .object({
      caption: z.string().min(1),
      url: z.string().optional(),
      image: z.string().optional(),
      imageWidth: z.number().int().positive().optional(),
      imageHeight: z.number().int().positive().optional(),
    })
    .nullable()
    .optional(),
  isNew: z.boolean(),
});

export type SaveArtworkInput = z.input<typeof SaveArtworkSchema>;
export type SaveArtworkResult =
  | { success: true; id: string }
  | { success: false; error: string };

export async function saveArtwork(input: unknown): Promise<SaveArtworkResult> {
  await requireSession();
  const parsed = SaveArtworkSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Validation error" };
  }
  const d = parsed.data;

  if (d.isNew) {
    const existing = await artworks.get(d.id);
    if (existing) return { success: false, error: `ID "${d.id}" already exists` };
  }

  const now = new Date().toISOString();
  await artworks.upsert({
    id: d.id,
    title: d.title,
    year: d.year,
    medium: d.medium,
    dimensions: d.dimensions || undefined,
    description: d.description || undefined,
    image: d.image,
    width: d.width,
    height: d.height,
    status: d.status,
    tagIds: d.tagIds,
    orderGlobal: d.orderGlobal,
    orderByTag: d.orderByTag,
    reference: d.reference ?? undefined,
    createdAt: now,
    updatedAt: now,
  });

  await logAudit(d.isNew ? "artwork.create" : "artwork.update", d.id, {
    title: { from: null, to: d.title },
    status: { from: null, to: d.status },
  });
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/artwork/${d.id}`);
  return { success: true, id: d.id };
}

const CreateTagSchema = z.object({
  title: z.string().min(1).max(60),
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Tag ID must be lowercase with hyphens"),
});

export type CreateTagResult =
  | { success: true; tag: import("@/data/types").Tag }
  | { success: false; error: string };

export async function createTag(title: string, id: string): Promise<CreateTagResult> {
  await requireSession();
  const parsed = CreateTagSchema.safeParse({ title, id });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Validation error" };
  }
  const existing = await tags.get(parsed.data.id);
  if (existing) return { success: false, error: `Tag "${id}" already exists` };

  const allTags = await tags.list();
  const now = new Date().toISOString();
  const tag = await tags.upsert({
    id: parsed.data.id,
    title: parsed.data.title,
    order: allTags.length,
    visible: true,
    isPrimaryRoom: false,
    createdAt: now,
    updatedAt: now,
  });
  await logAudit("tag.create", tag.id, { title: { from: null, to: tag.title } });
  revalidatePath("/admin");
  return { success: true, tag };
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

// ---------- tag mutations ----------

const UpdateTagSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(60),
  note: z.string().optional(),
  visible: z.boolean(),
  isPrimaryRoom: z.boolean(),
  order: z.number().int().min(0),
});

export type UpdateTagResult = { success: true } | { success: false; error: string };

export async function updateTag(input: unknown): Promise<UpdateTagResult> {
  await requireSession();
  const parsed = UpdateTagSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Validation error" };
  const d = parsed.data;
  const existing = await tags.get(d.id);
  const now = new Date().toISOString();
  await tags.upsert({
    id: d.id,
    title: d.title,
    note: d.note || undefined,
    visible: d.visible,
    isPrimaryRoom: d.isPrimaryRoom,
    order: d.order,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  await logAudit("tag.update", d.id, { title: { from: existing?.title, to: d.title } });
  revalidatePath("/admin/tags");
  revalidatePath("/");
  return { success: true };
}

export async function deleteTag(id: string): Promise<void> {
  await requireSession();
  IdSchema.parse(id);
  await tags.delete(id);
  await logAudit("tag.delete", id);
  revalidatePath("/admin/tags");
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function reorderArtworksByTag(tagId: string, ids: string[]): Promise<void> {
  await requireSession();
  const parsed = IdsSchema.safeParse(ids);
  if (!parsed.success) throw new Error("invalid ids");
  for (let i = 0; i < parsed.data.length; i++) {
    const work = await artworks.get(parsed.data[i]);
    if (!work) continue;
    if ((work.orderByTag[tagId] ?? -1) !== i) {
      await artworks.upsert({ ...work, orderByTag: { ...work.orderByTag, [tagId]: i } });
    }
  }
  await logAudit("artwork.update", `tag:${tagId}:reorder`);
  revalidatePath("/admin/tags");
  revalidatePath("/");
}

// ---------- artwork mutations ----------

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
