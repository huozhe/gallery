import { describe, it, expect, vi, beforeEach } from "vitest";
import { cookies } from "next/headers";

const ARTIST_BLOB_ID = "00000000-0000-0000-0000-0000000000ff";
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

const mockSharpInstance = {
  metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  resize: vi.fn().mockReturnThis(),
  webp: vi.fn().mockReturnThis(),
  toBuffer: vi.fn().mockResolvedValue({ data: Buffer.from("webp"), info: { width: 800, height: 600 } }),
};
vi.mock("sharp", () => ({ default: vi.fn(() => mockSharpInstance) }));

const { POST } = await import("@/app/api/admin/upload/route");

function makeRequest(fields: Record<string, string | File>): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("http://localhost/api/admin/upload", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });
  mockSharpInstance.resize.mockReturnValue(mockSharpInstance);
  mockSharpInstance.webp.mockReturnValue(mockSharpInstance);
  mockSharpInstance.toBuffer.mockResolvedValue({ data: Buffer.from("webp"), info: { width: 800, height: 600 } });
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_PATH_PREFIX;
  process.env.ARTIST_BLOB_ID = ARTIST_BLOB_ID;
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

  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

  it("writes WebP and original to disk in local dev mode", async () => {
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(makeRequest({ file, dir: "artworks/3/images", width: "800", height: "600" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.path).toMatch(new RegExp(`^/artists/${ARTIST_BLOB_ID}/artworks/3/images/${UUID_RE.source}\\.webp$`));
    expect(body.originalPath).toMatch(new RegExp(`^/artists/${ARTIST_BLOB_ID}/artworks/3/images/original/${UUID_RE.source}\\.jpg$`));
    expect(body.originalFilename).toBe("photo.jpg");
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
  });

  it("uploads WebP and original to Blob in production mode", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "tok";
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(makeRequest({ file, dir: "artworks/3/images", width: "800", height: "600" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.path).toContain("blob.example.com");
    expect(body.originalPath).toContain("blob.example.com");
    expect(body.originalFilename).toBe("photo.jpg");
    expect(mockPut).toHaveBeenCalledTimes(2);
  });

  it("applies BLOB_PATH_PREFIX", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "tok";
    process.env.BLOB_PATH_PREFIX = "dev/";
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    await POST(makeRequest({ file, dir: "artworks/3/images" }));
    expect(mockPut).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^dev/artists/${ARTIST_BLOB_ID}/artworks/3/images/${UUID_RE.source}\\.webp$`)),
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
    expect(body.originalFilename).toBe("photo.jpg");
  });

  it("resizes image when longest edge exceeds 2000px", async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 4000, height: 3000 });
    mockSharpInstance.toBuffer.mockResolvedValue({ data: Buffer.from("webp"), info: { width: 2000, height: 1500 } });
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(makeRequest({ file, dir: "artwork" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockSharpInstance.resize).toHaveBeenCalledWith({ width: 2000 });
    expect(body.width).toBe(2000);
    expect(body.height).toBe(1500);
  });

  it("does not resize image within 2000px", async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 1200, height: 800 });
    mockSharpInstance.toBuffer.mockResolvedValue({ data: Buffer.from("webp"), info: { width: 1200, height: 800 } });
    mockSessionsGet.mockResolvedValue({ id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    await POST(makeRequest({ file, dir: "artwork" }));
    expect(mockSharpInstance.resize).toHaveBeenCalledWith(undefined);
  });
});
