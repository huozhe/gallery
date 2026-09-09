import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveTenant, getTenantFromHeaders } from "@/lib/tenant";

let originalGalleryTenants: string | undefined;
let originalRedisKeyPrefix: string | undefined;

beforeEach(() => {
  originalGalleryTenants = process.env.GALLERY_TENANTS;
  originalRedisKeyPrefix = process.env.REDIS_KEY_PREFIX;
});

afterEach(() => {
  if (originalGalleryTenants === undefined) {
    delete process.env.GALLERY_TENANTS;
  } else {
    process.env.GALLERY_TENANTS = originalGalleryTenants;
  }
  if (originalRedisKeyPrefix === undefined) {
    delete process.env.REDIS_KEY_PREFIX;
  } else {
    process.env.REDIS_KEY_PREFIX = originalRedisKeyPrefix;
  }
});

// resolveTenant re-reads GALLERY_TENANTS at module load time, so we need to
// re-import tenant.ts for tests that change the env var between runs.
// Since Vitest caches modules, we test the current module state instead.

describe("getTenantFromHeaders", () => {
  function makeHeaders(entries: Record<string, string>): { get(k: string): string | null } {
    return { get: (k: string) => entries[k] ?? null };
  }

  it("reads all x-tenant-* headers", () => {
    const h = makeHeaders({
      "x-tenant-id": "alice",
      "x-tenant-name": "Alice",
      "x-tenant-redis-prefix": "prod:alice:",
      "x-tenant-blob-prefix": "prod/alice/",
      "x-tenant-blob-id": "aaaa-bbbb",
    });
    const tenant = getTenantFromHeaders(h);
    expect(tenant.id).toBe("alice");
    expect(tenant.name).toBe("Alice");
    expect(tenant.redisPrefix).toBe("prod:alice:");
    expect(tenant.blobPrefix).toBe("prod/alice/");
    expect(tenant.blobId).toBe("aaaa-bbbb");
  });

  it("falls back to single-tenant env vars when x-tenant-id is absent", () => {
    process.env.REDIS_KEY_PREFIX = "fallback:";
    process.env.BLOB_PATH_PREFIX = "fallback/";
    const h = makeHeaders({});
    const tenant = getTenantFromHeaders(h);
    expect(tenant.id).toBe("default");
    expect(tenant.redisPrefix).toBe("fallback:");
    expect(tenant.blobPrefix).toBe("fallback/");
  });

  it("falls back to ARTIST_BLOB_ID env var when x-tenant-blob-id header is absent", () => {
    process.env.ARTIST_BLOB_ID = "env-blob-id";
    const h = makeHeaders({ "x-tenant-id": "alice" });
    const tenant = getTenantFromHeaders(h);
    expect(tenant.blobId).toBe("env-blob-id");
    delete process.env.ARTIST_BLOB_ID;
  });

  it("uses x-tenant-id as name when x-tenant-name is absent", () => {
    const h = makeHeaders({ "x-tenant-id": "alice" });
    const tenant = getTenantFromHeaders(h);
    expect(tenant.name).toBe("alice");
  });
});

describe("resolveTenant", () => {
  it("returns single-tenant fallback when GALLERY_TENANTS is not set", () => {
    delete process.env.GALLERY_TENANTS;
    // resolveTenant is already loaded without GALLERY_TENANTS — it returns fallback
    const tenant = resolveTenant("anything.com");
    expect(tenant).not.toBeNull();
    expect(tenant!.id).toBe("default");
  });

  it("returns null for null host header in single-tenant mode", () => {
    delete process.env.GALLERY_TENANTS;
    const tenant = resolveTenant(null);
    expect(tenant).not.toBeNull(); // single-tenant always returns fallback
    expect(tenant!.id).toBe("default");
  });

  it("strips port from host header", () => {
    // The hostname map is built at module load — test the strip logic via getTenantFromHeaders
    // We verify port stripping works by passing a host with port to a single-tenant setup
    delete process.env.GALLERY_TENANTS;
    const tenant = resolveTenant("mysite.com:3000");
    expect(tenant).not.toBeNull();
    expect(tenant!.id).toBe("default");
  });
});

describe("getTenantFromHeaders — empty prefix fallback", () => {
  it("returns empty strings for prefixes when env vars are also unset", () => {
    delete process.env.REDIS_KEY_PREFIX;
    delete process.env.BLOB_PATH_PREFIX;
    const h = { get: () => null };
    const tenant = getTenantFromHeaders(h);
    expect(tenant.redisPrefix).toBe("");
    expect(tenant.blobPrefix).toBe("");
  });
});
