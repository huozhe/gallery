import { describe, it, expect, beforeEach, vi } from "vitest";
import { cookies } from "next/headers";

// These must be declared before vi.mock so the factory closure captures them.
// vi.mock is hoisted but its factory runs lazily on first import — by then these are initialized.
const mockSessionsGet = vi.fn();
const mockUsersGetById = vi.fn();

vi.mock("@/lib/store", () => ({
  sessions: { get: mockSessionsGet },
  users: { getById: mockUsersGetById },
}));

const { getSession, requireSession } = await import("@/lib/auth");

const SESSION = { id: "s1", userId: "u1", createdAt: "2024-01-01T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z" };
const USER = { id: "u1", email: "test@example.com", passwordHash: "h", createdAt: "2024-01-01T00:00:00Z" };

function withCookie(value: string) {
  (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: (name: string) => (name === "gallery_session" ? { value } : undefined),
  });
}

function withNoCookie() {
  (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: () => undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSession", () => {
  it("returns null when no cookie present", async () => {
    withNoCookie();
    expect(await getSession()).toBeNull();
  });

  it("returns null when session not found in store", async () => {
    withCookie("tok");
    mockSessionsGet.mockResolvedValue(null);
    expect(await getSession()).toBeNull();
  });

  it("returns null when user not found for session", async () => {
    withCookie("tok");
    mockSessionsGet.mockResolvedValue(SESSION);
    mockUsersGetById.mockResolvedValue(null);
    expect(await getSession()).toBeNull();
  });

  it("returns { session, user } when everything is valid", async () => {
    withCookie("tok");
    mockSessionsGet.mockResolvedValue(SESSION);
    mockUsersGetById.mockResolvedValue(USER);
    expect(await getSession()).toEqual({ session: SESSION, user: USER });
  });
});

describe("requireSession", () => {
  it("redirects to sign-in when unauthenticated", async () => {
    withNoCookie();
    await expect(requireSession()).rejects.toThrow("REDIRECT:/admin/sign-in");
  });

  it("redirects with custom nextPath", async () => {
    withNoCookie();
    await expect(requireSession("/admin/tags")).rejects.toThrow("next=%2Fadmin%2Ftags");
  });

  it("returns session when authenticated", async () => {
    withCookie("tok");
    mockSessionsGet.mockResolvedValue(SESSION);
    mockUsersGetById.mockResolvedValue(USER);
    expect(await requireSession()).toEqual({ session: SESSION, user: USER });
  });
});
