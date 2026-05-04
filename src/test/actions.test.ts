import { describe, it, expect, beforeEach, vi } from "vitest";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";

const mockSessionsGet = vi.fn();
const mockSessionsUpsert = vi.fn();
const mockSessionsDelete = vi.fn();
const mockArtworksGet = vi.fn();
const mockArtworksUpsert = vi.fn();
const mockArtworksSoftDelete = vi.fn();
const mockArtworksRestore = vi.fn();
const mockArtworksPurge = vi.fn();
const mockArtworksList = vi.fn();
const mockTagsGet = vi.fn();
const mockTagsUpsert = vi.fn();
const mockTagsList = vi.fn();
const mockTagsDelete = vi.fn();
const mockUsersGetByEmail = vi.fn();
const mockUsersGetById = vi.fn();
const mockUsersUpsert = vi.fn();
const mockAuditLog = vi.fn();
const mockAboutGet = vi.fn();
const mockAboutSet = vi.fn();
const mockVerifyPassword = vi.fn();
const mockHashPassword = vi.fn();
const mockCheckRateLimit = vi.fn(() => true);

vi.mock("@/lib/store", () => ({
  artworks: {
    get: mockArtworksGet,
    upsert: mockArtworksUpsert,
    softDelete: mockArtworksSoftDelete,
    restore: mockArtworksRestore,
    purge: mockArtworksPurge,
    list: mockArtworksList,
  },
  tags: {
    get: mockTagsGet,
    upsert: mockTagsUpsert,
    list: mockTagsList,
    delete: mockTagsDelete,
  },
  users: {
    getByEmail: mockUsersGetByEmail,
    getById: mockUsersGetById,
    upsert: mockUsersUpsert,
  },
  sessions: {
    get: mockSessionsGet,
    upsert: mockSessionsUpsert,
    delete: mockSessionsDelete,
  },
  audit: {
    log: mockAuditLog,
  },
  about: {
    get: mockAboutGet,
    set: mockAboutSet,
  },
}));

vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "gallery_session",
  SESSION_TTL_SECONDS: 86400,
  hashPassword: mockHashPassword,
  verifyPassword: mockVerifyPassword,
  createSessionToken: vi.fn(() => "a".repeat(64)),
  hashSessionToken: vi.fn((t: string) => `hashed:${t}`),
  checkRateLimit: mockCheckRateLimit,
  recordAttempt: vi.fn(),
  getSession: vi.fn(),
  requireSession: vi.fn(async () => ({
    user: { id: "u1", email: "admin@test.com", passwordHash: "hash", createdAt: "2024-01-01T00:00:00Z" },
    session: { id: "s1", userId: "u1", createdAt: "2024-01-01T00:00:00Z", expiresAt: "2025-01-01T00:00:00Z" },
  })),
}));

const { signIn, signOut, saveArtwork, createTag, updateTag, deleteTag, softDeleteArtwork, restoreArtwork, purgeArtwork, reorderArtworks, reorderArtworksByTag, updateAbout } = await import("@/app/admin/actions");

let cookieJar: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockReturnValue(true);
  cookieJar = { get: vi.fn(() => undefined), set: vi.fn(), delete: vi.fn() };
  (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(cookieJar);
  (headers as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Map([["user-agent", "test"], ["x-forwarded-for", "127.0.0.1"]])
  );
});

describe("saveArtwork", () => {
  it("creates a new artwork", async () => {
    mockArtworksGet.mockResolvedValue(null);
    mockArtworksUpsert.mockResolvedValue({ id: "w1" });
    const result = await saveArtwork({
      id: "w1",
      title: "Test",
      year: 2024,
      medium: "Oil",
      image: "/test.jpg",
      width: 800,
      height: 600,
      status: "live",
      tagIds: [],
      orderGlobal: 0,
      orderByTag: {},
      isNew: true,
    });
    expect(result.success).toBe(true);
    expect(mockArtworksUpsert).toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.create" }));
  });

  it("updates existing artwork", async () => {
    mockArtworksUpsert.mockResolvedValue({ id: "w1" });
    const result = await saveArtwork({
      id: "w1",
      title: "Updated",
      year: 2024,
      medium: "Oil",
      image: "/test.jpg",
      width: 800,
      height: 600,
      status: "live",
      tagIds: [],
      orderGlobal: 0,
      orderByTag: {},
      isNew: false,
    });
    expect(result.success).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.update" }));
  });

  it("rejects duplicate new artwork ID", async () => {
    mockArtworksGet.mockResolvedValue({ id: "w1", title: "Existing" });
    const result = await saveArtwork({
      id: "w1",
      title: "Test",
      year: 2024,
      medium: "Oil",
      image: "/test.jpg",
      width: 800,
      height: 600,
      status: "live",
      tagIds: [],
      orderGlobal: 0,
      orderByTag: {},
      isNew: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("validates required fields", async () => {
    const result = await saveArtwork({ id: "w1", title: "" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Title");
  });
});

describe("createTag", () => {
  it("creates a new tag", async () => {
    mockTagsGet.mockResolvedValue(null);
    mockTagsList.mockResolvedValue([]);
    mockTagsUpsert.mockResolvedValue({ id: "paintings", title: "Paintings" });
    const result = await createTag("Paintings", "paintings");
    expect(result.success).toBe(true);
    expect(mockTagsUpsert).toHaveBeenCalled();
  });

  it("rejects duplicate tag ID", async () => {
    mockTagsGet.mockResolvedValue({ id: "paintings", title: "Paintings" });
    const result = await createTag("Paintings", "paintings");
    expect(result.success).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("validates tag ID format", async () => {
    const result = await createTag("Bad ID", "BAD_ID");
    expect(result.success).toBe(false);
    expect(result.error).toContain("lowercase");
  });
});

describe("updateTag", () => {
  it("updates a tag", async () => {
    mockTagsGet.mockResolvedValue({ id: "paintings", title: "Old Title" });
    mockTagsUpsert.mockResolvedValue({ id: "paintings", title: "New Title" });
    const result = await updateTag({
      id: "paintings",
      title: "New Title",
      visible: true,
      isPrimaryRoom: false,
      order: 0,
    });
    expect(result.success).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "tag.update" }));
  });

  it("validates input", async () => {
    const result = await updateTag({ id: "paintings" });
    expect(result.success).toBe(false);
  });
});

describe("deleteTag", () => {
  it("deletes a tag", async () => {
    await deleteTag("paintings");
    expect(mockTagsDelete).toHaveBeenCalledWith("paintings");
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "tag.delete" }));
  });
});

describe("softDeleteArtwork", () => {
  it("soft-deletes an artwork", async () => {
    mockArtworksGet.mockResolvedValue({ id: "w1", status: "live" });
    await softDeleteArtwork("w1");
    expect(mockArtworksSoftDelete).toHaveBeenCalledWith("w1");
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.delete" }));
  });
});

describe("restoreArtwork", () => {
  it("restores a soft-deleted artwork", async () => {
    mockArtworksGet.mockResolvedValue({ id: "w1", status: "deleted" });
    await restoreArtwork("w1");
    expect(mockArtworksRestore).toHaveBeenCalledWith("w1");
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.restore" }));
  });
});

describe("purgeArtwork", () => {
  it("permanently deletes an artwork", async () => {
    mockArtworksGet.mockResolvedValue({ id: "w1", title: "Test" });
    await purgeArtwork("w1");
    expect(mockArtworksPurge).toHaveBeenCalledWith("w1");
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.purge" }));
  });
});

describe("reorderArtworks", () => {
  it("reorders artworks globally", async () => {
    mockArtworksList.mockResolvedValue([
      { id: "w1", orderGlobal: 0 },
      { id: "w2", orderGlobal: 1 },
    ]);
    mockArtworksGet.mockImplementation(async (id) => ({
      id,
      orderGlobal: id === "w1" ? 0 : 1,
    }));
    await reorderArtworks(["w2", "w1"]);
    expect(mockArtworksUpsert).toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.update" }));
  });
});

describe("reorderArtworksByTag", () => {
  it("reorders artworks within a tag", async () => {
    mockArtworksGet.mockImplementation(async (id) => ({
      id,
      orderByTag: {},
    }));
    await reorderArtworksByTag("paintings", ["w1", "w2"]);
    expect(mockArtworksUpsert).toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.update" }));
  });
});

describe("updateAbout", () => {
  it("updates about content", async () => {
    mockAboutSet.mockResolvedValue({ bio: "Test bio", email: "a@b.com" });
    const result = await updateAbout({ bio: "Test bio", email: "a@b.com" });
    expect(result.success).toBe(true);
    expect(mockAboutSet).toHaveBeenCalled();
  });

  it("validates email", async () => {
    const result = await updateAbout({ bio: "Test", email: "invalid" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("email");
  });
});

// ---------- signIn ----------

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("signIn", () => {
  it("redirects with error on invalid email", async () => {
    await expect(signIn(makeFormData({ email: "not-an-email", password: "x" })))
      .rejects.toThrow("REDIRECT:/admin/sign-in?error=invalid");
  });

  it("redirects with error when rate-limited", async () => {
    mockCheckRateLimit.mockReturnValueOnce(false);
    await expect(signIn(makeFormData({ email: "a@b.com", password: "x" })))
      .rejects.toThrow("REDIRECT:/admin/sign-in?error=rate-limited");
  });

  it("logs auth.failed and redirects when user not found", async () => {
    mockUsersGetByEmail.mockResolvedValue(null);
    await expect(signIn(makeFormData({ email: "nobody@b.com", password: "x" })))
      .rejects.toThrow("REDIRECT:/admin/sign-in?error=invalid");
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.failed" }));
  });

  it("logs auth.failed and redirects on wrong password", async () => {
    mockUsersGetByEmail.mockResolvedValue({ id: "u1", email: "a@b.com", passwordHash: "hash" });
    mockVerifyPassword.mockResolvedValue(false);
    await expect(signIn(makeFormData({ email: "a@b.com", password: "wrong" })))
      .rejects.toThrow("REDIRECT:/admin/sign-in?error=invalid");
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.failed" }));
  });

  it("creates session, sets cookie, and redirects on success", async () => {
    mockUsersGetByEmail.mockResolvedValue({ id: "u1", email: "a@b.com", passwordHash: "hash" });
    mockVerifyPassword.mockResolvedValue(true);
    mockSessionsUpsert.mockResolvedValue({});
    mockUsersUpsert.mockResolvedValue({});
    await expect(signIn(makeFormData({ email: "a@b.com", password: "correct" })))
      .rejects.toThrow("REDIRECT:/admin");
    expect(mockSessionsUpsert).toHaveBeenCalled();
    expect(cookieJar.set).toHaveBeenCalledWith(
      "gallery_session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.sign-in" }));
  });

  it("respects the next param on success", async () => {
    mockUsersGetByEmail.mockResolvedValue({ id: "u1", email: "a@b.com", passwordHash: "hash" });
    mockVerifyPassword.mockResolvedValue(true);
    mockSessionsUpsert.mockResolvedValue({});
    mockUsersUpsert.mockResolvedValue({});
    await expect(signIn(makeFormData({ email: "a@b.com", password: "correct", next: "/admin/tags" })))
      .rejects.toThrow("REDIRECT:/admin/tags");
  });
});

// ---------- signOut ----------

describe("signOut", () => {
  it("clears the cookie and redirects when no session exists", async () => {
    await expect(signOut()).rejects.toThrow("REDIRECT:/admin/sign-in");
    expect(cookieJar.delete).toHaveBeenCalledWith("gallery_session");
    expect(mockSessionsDelete).not.toHaveBeenCalled();
  });

  it("deletes session, logs audit, and redirects when signed in", async () => {
    cookieJar.get.mockImplementation((name: string) =>
      name === "gallery_session" ? { value: "tok123" } : undefined
    );
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1" });
    mockUsersGetById.mockResolvedValue({ id: "u1", email: "a@b.com" });
    await expect(signOut()).rejects.toThrow("REDIRECT:/admin/sign-in");
    expect(mockSessionsDelete).toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.sign-out" }));
    expect(cookieJar.delete).toHaveBeenCalledWith("gallery_session");
  });

  it("clears cookie even when session lookup returns null", async () => {
    cookieJar.get.mockImplementation((name: string) =>
      name === "gallery_session" ? { value: "tok123" } : undefined
    );
    mockSessionsGet.mockResolvedValue(null);
    await expect(signOut()).rejects.toThrow("REDIRECT:/admin/sign-in");
    expect(mockSessionsDelete).not.toHaveBeenCalled();
    expect(cookieJar.delete).toHaveBeenCalledWith("gallery_session");
  });
});
