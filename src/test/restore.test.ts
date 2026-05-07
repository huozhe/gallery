import { describe, it, expect, vi, beforeEach } from "vitest";
import { cookies } from "next/headers";

const mockSessionsGet = vi.fn();
const mockUsersGetById = vi.fn();
vi.mock("@/lib/store", () => ({
  sessions: { get: mockSessionsGet },
  users: { getById: mockUsersGetById },
  audit: { log: vi.fn() },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...original,
    getSession: vi.fn(async () => {
      const token = (await (cookies as ReturnType<typeof vi.fn>)()).get("gallery_session")?.value;
      if (!token) return null;
      const session = await mockSessionsGet(`hashed:${token}`);
      if (!session) return null;
      const user = await mockUsersGetById(session.userId);
      return user ? { user, session } : null;
    }),
    hashSessionToken: vi.fn((t: string) => `hashed:${t}`),
  };
});

const mockRestoreRedis = vi.fn();
vi.mock("@/lib/store.kv", () => ({
  restoreRedis: mockRestoreRedis,
}));

const MOCK_BACKUP = {
  timestamp: "2026-05-06T02:00:00.000Z",
  prefix: "prod:",
  data: {
    "artwork:1": { type: "string" as const, value: '{"id":1}' },
    "artworks:index": { type: "set" as const, value: ["1"] },
  },
};

const MOCK_USER = { id: "u1", email: "admin@example.com", passwordHash: "", createdAt: "" };
const MOCK_SESSION = {
  id: "s1",
  userId: "u1",
  createdAt: "",
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};

function makeRequest(body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function withSession() {
  (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "gallery_session" ? { value: "tok123" } : undefined
    ),
  });
  mockSessionsGet.mockResolvedValue(MOCK_SESSION);
  mockUsersGetById.mockResolvedValue(MOCK_USER);
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.REDIS_URL;
  (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: vi.fn(() => undefined),
  });
  mockRestoreRedis.mockResolvedValue({ keys: 2 });
});

const { POST } = await import("@/app/api/admin/restore/route");

describe("POST /api/admin/restore", () => {
  it("returns 401 when no session cookie", async () => {
    const res = await POST(makeRequest({ url: "https://example.com/backup.json" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when session is invalid", async () => {
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
      get: vi.fn((name: string) =>
        name === "gallery_session" ? { value: "bad-token" } : undefined
      ),
    });
    mockSessionsGet.mockResolvedValue(null);
    const res = await POST(makeRequest({ url: "https://example.com/backup.json" }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when REDIS_URL not set", async () => {
    withSession();
    const res = await POST(makeRequest({ url: "https://example.com/backup.json" }));
    expect(res.status).toBe(503);
  });

  it("returns 400 when url is missing", async () => {
    withSession();
    process.env.REDIS_URL = "redis://localhost";
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/url/i);
  });

  it("returns 400 when fetched JSON is invalid backup shape", async () => {
    withSession();
    process.env.REDIS_URL = "redis://localhost";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ notABackup: true }),
    }));
    const res = await POST(makeRequest({ url: "https://example.com/backup.json" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when fetch throws", async () => {
    withSession();
    process.env.REDIS_URL = "redis://localhost";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const res = await POST(makeRequest({ url: "https://example.com/backup.json" }));
    expect(res.status).toBe(400);
  });

  it("returns 200 and calls restoreRedis with parsed backup", async () => {
    withSession();
    process.env.REDIS_URL = "redis://localhost";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => MOCK_BACKUP,
    }));
    const res = await POST(makeRequest({ url: "https://example.com/backup.json" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, keys: 2 });
    expect(mockRestoreRedis).toHaveBeenCalledWith(MOCK_BACKUP);
  });
});
