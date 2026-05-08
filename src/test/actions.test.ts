import { describe, it, expect, beforeEach, vi } from "vitest";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";

const mockSessionsGet = vi.fn();
const mockSessionsUpsert = vi.fn();
const mockSessionsDelete = vi.fn();
const mockArtworksGet = vi.fn();
const mockArtworksGetBySlug = vi.fn();
const mockArtworksNextId = vi.fn(() => Promise.resolve(1));
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
const mockUsersList = vi.fn();
const mockUsersDelete = vi.fn();
const mockAuditLog = vi.fn();
const mockAboutGet = vi.fn();
const mockAboutSet = vi.fn();
const mockVerifyPassword = vi.fn();
const mockHashPassword = vi.fn();
const mockCheckRateLimit = vi.fn(() => true);

vi.mock("@/lib/store", () => ({
  artworks: {
    get: mockArtworksGet,
    getBySlug: mockArtworksGetBySlug,
    nextId: mockArtworksNextId,
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
    list: mockUsersList,
    delete: mockUsersDelete,
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

const { signIn, signOut, saveArtwork, createTag, updateTag, deleteTag, softDeleteArtwork, restoreArtwork, purgeArtwork, reorderArtworks, reorderArtworksByTag, updateAbout, changePassword, createAdminUser, deleteAdminUser } = await import("@/app/admin/actions");

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
    mockArtworksGetBySlug.mockResolvedValue(null);
    mockArtworksUpsert.mockResolvedValue({ id: 1, slug: "w1" });
    const result = await saveArtwork({
      id: 0,
      blobId: "aaaaaaaa-0000-0000-0000-000000000001",
      slug: "w1",
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
    mockArtworksGetBySlug.mockResolvedValue(null);
    mockArtworksUpsert.mockResolvedValue({ id: 1, slug: "w1" });
    mockArtworksGet.mockResolvedValue(null);
    const result = await saveArtwork({
      id: 1,
      blobId: "aaaaaaaa-0000-0000-0000-000000000002",
      slug: "w1",
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

  it("rejects duplicate slug on create", async () => {
    mockArtworksGetBySlug.mockResolvedValue({ id: 1, slug: "w1", title: "Existing" });
    const result = await saveArtwork({
      id: 0,
      blobId: "aaaaaaaa-0000-0000-0000-000000000001",
      slug: "w1",
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
    const result = await saveArtwork({ id: 0, slug: "w1", title: "" });
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
    mockArtworksGet.mockResolvedValue({ id: 1, slug: "w1", status: "live" });
    await softDeleteArtwork(1);
    expect(mockArtworksSoftDelete).toHaveBeenCalledWith(1);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.delete" }));
  });
});

describe("restoreArtwork", () => {
  it("restores a soft-deleted artwork", async () => {
    mockArtworksGet.mockResolvedValue({ id: 1, slug: "w1", status: "deleted" });
    await restoreArtwork(1);
    expect(mockArtworksRestore).toHaveBeenCalledWith(1);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.restore" }));
  });
});

describe("purgeArtwork", () => {
  it("permanently deletes an artwork", async () => {
    mockArtworksGet.mockResolvedValue({ id: 1, slug: "w1", title: "Test" });
    await purgeArtwork(1);
    expect(mockArtworksPurge).toHaveBeenCalledWith(1);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.purge" }));
  });
});

describe("reorderArtworks", () => {
  it("reorders artworks globally", async () => {
    mockArtworksList.mockResolvedValue([
      { id: 1, slug: "w1", orderGlobal: 0 },
      { id: 2, slug: "w2", orderGlobal: 1 },
    ]);
    mockArtworksGet.mockImplementation(async (id: number) => ({
      id,
      slug: id === 1 ? "w1" : "w2",
      orderGlobal: id === 1 ? 0 : 1,
    }));
    await reorderArtworks([2, 1]);
    expect(mockArtworksUpsert).toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "artwork.update" }));
  });
});

describe("reorderArtworksByTag", () => {
  it("reorders artworks within a tag", async () => {
    mockArtworksGet.mockImplementation(async (id: number) => ({
      id,
      slug: `w${id}`,
      orderByTag: {},
    }));
    await reorderArtworksByTag("paintings", [1, 2]);
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

describe("user management", () => {
  const currentUser = { id: "u1", email: "admin@test.com", passwordHash: "hash", createdAt: "2024-01-01T00:00:00Z" };

  describe("changePassword", () => {
    it("returns error when current password is wrong", async () => {
      mockVerifyPassword.mockResolvedValue(false);
      const result = await changePassword({ currentPassword: "wrong", newPassword: "newpassword1" });
      expect(result).toEqual({ success: false, error: "Current password is incorrect." });
      expect(mockUsersUpsert).not.toHaveBeenCalled();
    });

    it("changes password and logs audit on success", async () => {
      mockVerifyPassword.mockResolvedValue(true);
      mockHashPassword.mockResolvedValue("newhash");
      mockUsersUpsert.mockResolvedValue({ ...currentUser, passwordHash: "newhash" });
      const result = await changePassword({ currentPassword: "correct", newPassword: "newpassword1" });
      expect(result).toEqual({ success: true });
      expect(mockUsersUpsert).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: "newhash" }));
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "user.password-change" }));
    });

    it("returns error when new password is too short", async () => {
      const result = await changePassword({ currentPassword: "correct", newPassword: "short" });
      expect(result).toEqual({ success: false, error: expect.stringContaining("8") });
      expect(mockUsersUpsert).not.toHaveBeenCalled();
    });
  });

  describe("createAdminUser", () => {
    it("returns error when email already exists", async () => {
      mockUsersGetByEmail.mockResolvedValue({ id: "u2", email: "other@test.com", passwordHash: "h", createdAt: "" });
      const result = await createAdminUser({ email: "other@test.com", password: "password123" });
      expect(result).toEqual({ success: false, error: expect.stringContaining("already exists") });
      expect(mockUsersUpsert).not.toHaveBeenCalled();
    });

    it("creates user and logs audit on success", async () => {
      mockUsersGetByEmail.mockResolvedValue(null);
      mockHashPassword.mockResolvedValue("hashed");
      mockUsersUpsert.mockResolvedValue({});
      const result = await createAdminUser({ email: "New@Test.com", password: "password123" });
      expect(result).toEqual({ success: true });
      expect(mockUsersUpsert).toHaveBeenCalledWith(expect.objectContaining({ email: "new@test.com" }));
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "user.create" }));
    });

    it("returns error when password is too short", async () => {
      const result = await createAdminUser({ email: "x@y.com", password: "short" });
      expect(result).toEqual({ success: false, error: expect.stringContaining("8") });
    });
  });

  describe("deleteAdminUser", () => {
    it("returns error when deleting yourself", async () => {
      mockUsersList.mockResolvedValue([currentUser, { id: "u2", email: "other@test.com", passwordHash: "", createdAt: "" }]);
      const result = await deleteAdminUser({ email: "admin@test.com" });
      expect(result).toEqual({ success: false, error: expect.stringContaining("your own") });
      expect(mockUsersDelete).not.toHaveBeenCalled();
    });

    it("returns error when deleting the last user", async () => {
      mockUsersList.mockResolvedValue([currentUser]);
      const result = await deleteAdminUser({ email: "other@test.com" });
      expect(result).toEqual({ success: false, error: expect.stringContaining("last admin") });
      expect(mockUsersDelete).not.toHaveBeenCalled();
    });

    it("deletes user and logs audit on success", async () => {
      mockUsersList.mockResolvedValue([
        currentUser,
        { id: "u2", email: "other@test.com", passwordHash: "", createdAt: "" },
      ]);
      mockUsersDelete.mockResolvedValue(undefined);
      const result = await deleteAdminUser({ email: "other@test.com" });
      expect(result).toEqual({ success: true });
      expect(mockUsersDelete).toHaveBeenCalledWith("other@test.com");
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "user.delete" }));
    });
  });
});
