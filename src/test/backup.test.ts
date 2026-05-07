import { describe, it, expect, vi, beforeEach } from "vitest";
import { cookies } from "next/headers";

const mockSessionsGet = vi.fn();
vi.mock("@/lib/store", () => ({
  sessions: { get: mockSessionsGet },
}));

vi.mock("@/lib/auth", () => ({
  hashSessionToken: vi.fn((t: string) => `hashed:${t}`),
}));

const mockBackupRedis = vi.fn();
vi.mock("@/lib/store.kv", () => ({
  backupRedis: mockBackupRedis,
}));

const mockPut = vi.fn(async (path: string) => ({ url: `https://blob.example.com/${path}` }));
vi.mock("@vercel/blob", () => ({ put: mockPut }));

const { GET } = await import("@/app/api/admin/backup/route");

const MOCK_BACKUP = {
  timestamp: "2026-05-06T02:00:00.000Z",
  prefix: "test:",
  data: {
    "artwork:1": { type: "string" as const, value: '{"id":1}' },
    "artworks:index": { type: "set" as const, value: ["1"] },
  },
};

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/backup", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.REDIS_URL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_PATH_PREFIX;
  (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: vi.fn(() => undefined),
  });
  mockBackupRedis.mockResolvedValue(MOCK_BACKUP);
});

describe("GET /api/admin/backup", () => {
  it("returns 401 when no auth", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong bearer token", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const res = await GET(makeRequest({ authorization: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when REDIS_URL not set", async () => {
    process.env.CRON_SECRET = "secret";
    const res = await GET(makeRequest({ authorization: "Bearer secret" }));
    expect(res.status).toBe(503);
  });

  it("accepts valid cron secret and returns backup summary", async () => {
    process.env.CRON_SECRET = "secret";
    process.env.REDIS_URL = "redis://localhost";
    const res = await GET(makeRequest({ authorization: "Bearer secret" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, url: null, keys: 2 });
  });

  it("accepts valid session cookie", async () => {
    process.env.REDIS_URL = "redis://localhost";
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
      get: vi.fn((name: string) =>
        name === "gallery_session" ? { value: "tok123" } : undefined
      ),
    });
    mockSessionsGet.mockResolvedValue({
      id: "s1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });

  it("returns 401 when session cookie is invalid", async () => {
    process.env.REDIS_URL = "redis://localhost";
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
      get: vi.fn((name: string) =>
        name === "gallery_session" ? { value: "bad-tok" } : undefined
      ),
    });
    mockSessionsGet.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("skips Blob upload when BLOB_READ_WRITE_TOKEN absent", async () => {
    process.env.CRON_SECRET = "secret";
    process.env.REDIS_URL = "redis://localhost";
    const res = await GET(makeRequest({ authorization: "Bearer secret" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockPut).not.toHaveBeenCalled();
    expect(body.url).toBeNull();
    expect(body.keys).toBe(2);
  });

  it("uploads to Blob and returns url when BLOB_READ_WRITE_TOKEN is set", async () => {
    process.env.CRON_SECRET = "secret";
    process.env.REDIS_URL = "redis://localhost";
    process.env.BLOB_READ_WRITE_TOKEN = "tok";
    const res = await GET(makeRequest({ authorization: "Bearer secret" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockPut).toHaveBeenCalledOnce();
    expect(body.url).toContain("blob.example.com");
    expect(body.ok).toBe(true);
  });

  it("applies BLOB_PATH_PREFIX to upload pathname", async () => {
    process.env.CRON_SECRET = "secret";
    process.env.REDIS_URL = "redis://localhost";
    process.env.BLOB_READ_WRITE_TOKEN = "tok";
    process.env.BLOB_PATH_PREFIX = "prod/";
    await GET(makeRequest({ authorization: "Bearer secret" }));
    expect(mockPut).toHaveBeenCalledWith(
      expect.stringMatching(/^prod\/backup\/redis-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/),
      expect.any(String),
      expect.objectContaining({ contentType: "application/json" }),
    );
  });
});
