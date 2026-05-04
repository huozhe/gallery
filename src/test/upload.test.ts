import { describe, it, expect, vi, beforeEach } from "vitest";
import { cookies } from "next/headers";

const mockSessionsGet = vi.fn();
vi.mock("@/lib/store", () => ({
  sessions: { get: mockSessionsGet },
}));

vi.mock("@/lib/auth", () => ({
  hashSessionToken: vi.fn((t: string) => `hashed:${t}`),
}));

const mockPut = vi.fn(async (path: string) => ({ url: `https://blob.example.com/${path}` }));
vi.mock("@vercel/blob", () => ({ put: mockPut }));

const mockWriteFile = vi.fn(async () => {});
const mockMkdir = vi.fn(async () => {});
vi.mock("fs/promises", () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

const { POST } = await import("@/app/api/admin/upload/route");

function makeRequest(fields: Record<string, string | File>): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("http://localhost/api/admin/upload", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_PATH_PREFIX;
  (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: vi.fn((name: string) => name === "gallery_session" ? { value: "tok123" } : undefined),
  });
});

describe("POST /api/admin/upload", () => {
  it("returns 401 when no cookie", async () => {
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({ get: vi.fn(() => undefined) });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns 401 when session not found", async () => {
    mockSessionsGet.mockResolvedValue(null);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns 400 when no file", async () => {
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("writes to disk in local dev mode", async () => {
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(makeRequest({ file, dir: "artwork", width: "800", height: "600" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.path).toBe("/artwork/photo.jpg");
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it("uploads to Blob in production mode", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "tok";
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(makeRequest({ file, dir: "artwork", width: "800", height: "600" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.path).toContain("blob.example.com");
    expect(mockPut).toHaveBeenCalled();
  });

  it("applies BLOB_PATH_PREFIX", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "tok";
    process.env.BLOB_PATH_PREFIX = "dev/";
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    await POST(makeRequest({ file, dir: "artwork" }));
    expect(mockPut).toHaveBeenCalledWith(
      expect.stringContaining("dev/artwork/photo.jpg"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("strips unsafe characters from dir", async () => {
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(makeRequest({ file, dir: "../../etc/passwd" }));
    const body = await res.json();
    expect(body.path).not.toContain("..");
  });
});
