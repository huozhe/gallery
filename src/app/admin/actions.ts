"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ulid } from "ulid";
import { z } from "zod";
import { about, artworks, audit, sessions, tags, users } from "@/lib/store";
import type { AuditAction, Artwork } from "@/data/types";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  checkRateLimit,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  recordAttempt,
  requireSession,
  verifyPassword,
} from "@/lib/auth";

// ---------- blob cleanup ----------

function isBlobUrl(url: string | undefined): url is string {
  return !!url && url.startsWith("https://") && url.includes("blob.vercel-storage.com");
}

async function deleteBlobs(urls: (string | undefined)[]): Promise<void> {
  const toDelete = urls.filter(isBlobUrl);
  if (!toDelete.length || !process.env.BLOB_READ_WRITE_TOKEN) return;
  const { del } = await import("@vercel/blob");
  await del(toDelete);
}

async function deleteArtworkBlobs(artwork: Artwork): Promise<void> {
  await deleteBlobs([artwork.image, artwork.originalImage, artwork.reference?.image]);
}

// ---------- helpers ----------

const SignInSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1),
  next: z.string().optional(),
});

const IdSchema = z.string().min(1).max(80);
const NumericIdSchema = z.number().int().positive();
const NumericIdsSchema = z.array(NumericIdSchema).min(1);

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
  id: z.number().int().min(0),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9-]+$/, "Slug must contain only letters, numbers, and hyphens"),
  title: z.string().min(1, "Title required").max(120),
  year: z.number().int().min(1800).max(new Date().getFullYear() + 1),
  medium: z.string().min(1, "Medium required"),
  dimensions: z.string().optional(),
  description: z.string().optional(),
  blobId: z.string().min(1),
  image: z.string().min(1, "Image required"),
  originalImage: z.string().optional(),
  imageFilename: z.string().optional(),
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
      imageFilename: z.string().optional(),
    })
    .nullable()
    .optional(),
  isNew: z.boolean(),
});

export type SaveArtworkInput = z.input<typeof SaveArtworkSchema>;
export type SaveArtworkResult =
  | { success: true; id: number; slug: string }
  | { success: false; error: string };

export async function saveArtwork(input: unknown): Promise<SaveArtworkResult> {
  await requireSession();
  const parsed = SaveArtworkSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Validation error" };
  }
  const d = parsed.data;

  let artworkId: number;
  if (d.isNew) {
    const existing = await artworks.getBySlug(d.slug);
    if (existing) return { success: false, error: `Slug "${d.slug}" already exists` };
    artworkId = await artworks.nextId();
  } else {
    artworkId = d.id;
    const existing = await artworks.getBySlug(d.slug);
    if (existing && existing.id !== artworkId) {
      return { success: false, error: `Slug "${d.slug}" already exists` };
    }
    const stored = await artworks.get(artworkId);
    if (stored) {
      await deleteBlobs([
        stored.image !== d.image ? stored.image : undefined,
        stored.originalImage !== d.originalImage ? stored.originalImage : undefined,
        stored.reference?.image !== d.reference?.image ? stored.reference?.image : undefined,
      ]);
    }
  }

  const now = new Date().toISOString();
  await artworks.upsert({
    id: artworkId,
    slug: d.slug,
    title: d.title,
    year: d.year,
    medium: d.medium,
    dimensions: d.dimensions || undefined,
    description: d.description || undefined,
    blobId: d.blobId,
    image: d.image,
    originalImage: d.originalImage,
    imageFilename: d.imageFilename,
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

  await logAudit(d.isNew ? "artwork.create" : "artwork.update", d.slug, {
    title: { from: null, to: d.title },
    status: { from: null, to: d.status },
  });
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/artwork/${d.slug}`);
  return { success: true, id: artworkId, slug: d.slug };
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
export async function reorderArtworks(ids: number[]): Promise<void> {
  await requireSession();
  const parsed = NumericIdsSchema.safeParse(ids);
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

export async function reorderArtworksByTag(tagId: string, ids: number[]): Promise<void> {
  await requireSession();
  const parsed = NumericIdsSchema.safeParse(ids);
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

export async function softDeleteArtwork(id: number): Promise<void> {
  await requireSession();
  NumericIdSchema.parse(id);
  const before = await artworks.get(id);
  if (!before) return;
  await artworks.softDelete(id);
  await logAudit("artwork.delete", before.slug, {
    status: { from: before.status, to: "deleted" },
  });
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function restoreArtwork(id: number): Promise<void> {
  await requireSession();
  NumericIdSchema.parse(id);
  const before = await artworks.get(id);
  if (!before) return;
  await artworks.restore(id);
  await logAudit("artwork.restore", before.slug, {
    status: { from: before.status, to: "live" },
  });
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function purgeArtwork(id: number): Promise<void> {
  await requireSession();
  NumericIdSchema.parse(id);
  const before = await artworks.get(id);
  if (!before) return;
  await Promise.all([artworks.purge(id), deleteArtworkBlobs(before)]);
  await logAudit("artwork.purge", before.slug, {
    deleted: { from: { id: before.id, title: before.title }, to: null },
  });
  revalidatePath("/admin");
  revalidatePath("/");
}

// ---------- about ----------

const UpdateAboutSchema = z.object({
  bio: z.string().max(5000),
  email: z.string().email().max(120),
});

export type UpdateAboutResult = { success: true } | { success: false; error: string };

export async function updateAbout(input: unknown): Promise<UpdateAboutResult> {
  await requireSession();
  const parsed = UpdateAboutSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Validation error" };
  const d = parsed.data;
  await about.set({ bio: d.bio, email: d.email, updatedAt: new Date().toISOString() });
  await logAudit("about.update", "about", { email: { from: null, to: d.email } });
  revalidatePath("/about");
  revalidatePath("/admin/about");
  return { success: true };
}

// ---------- user management ----------

const PasswordField = z.string().min(8, "Password must be at least 8 characters").max(128);

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password required"),
  newPassword: PasswordField,
});

export type UserActionResult = { success: true } | { success: false; error: string };

export async function changePassword(input: unknown): Promise<UserActionResult> {
  const { user } = await requireSession();
  const parsed = ChangePasswordSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Validation error" };
  const { currentPassword, newPassword } = parsed.data;
  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) return { success: false, error: "Current password is incorrect." };
  const passwordHash = await hashPassword(newPassword);
  await users.upsert({ ...user, passwordHash });
  await logAudit("user.password-change", user.email);
  revalidatePath("/admin/users");
  return { success: true };
}

const CreateAdminUserSchema = z.object({
  email: z.string().email("Invalid email").transform((s) => s.toLowerCase()),
  password: PasswordField,
});

export async function createAdminUser(input: unknown): Promise<UserActionResult> {
  await requireSession();
  const parsed = CreateAdminUserSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Validation error" };
  const { email, password } = parsed.data;
  const existing = await users.getByEmail(email);
  if (existing) return { success: false, error: `User "${email}" already exists.` };
  const passwordHash = await hashPassword(password);
  const newUser = { id: ulid(), email, passwordHash, createdAt: new Date().toISOString() };
  await users.upsert(newUser);
  await logAudit("user.create", email, { email: { from: null, to: email } });
  revalidatePath("/admin/users");
  return { success: true };
}

const DeleteAdminUserSchema = z.object({
  email: z.string().email(),
});

export async function deleteAdminUser(input: unknown): Promise<UserActionResult> {
  const { user: currentUser } = await requireSession();
  const parsed = DeleteAdminUserSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Validation error" };
  const { email } = parsed.data;
  if (email === currentUser.email) return { success: false, error: "You cannot delete your own account." };
  const all = await users.list();
  if (all.length <= 1) return { success: false, error: "Cannot delete the last admin user." };
  await users.delete(email);
  await logAudit("user.delete", email, { email: { from: email, to: null } });
  revalidatePath("/admin/users");
  return { success: true };
}
