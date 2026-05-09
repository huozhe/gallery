// Tenant configuration — edge-compatible (JSON.parse only, no Node.js APIs).
// Parses GALLERY_TENANTS env var once at module load.

export type Tenant = {
  id: string;
  hostnames: string[];
  name: string;
  redisPrefix: string; // e.g. "prod:roamingbrush:"
  blobPrefix: string;  // e.g. "prod/roamingbrush/"
  blobId: string;      // UUID for blob path (was ARTIST_BLOB_ID)
  adminEmail?: string; // seed credential for first-time setup (optional)
  adminPassword?: string;
};

function loadTenants(): Tenant[] | null {
  const raw = process.env.GALLERY_TENANTS;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tenant[];
  } catch {
    console.error("[tenant] Failed to parse GALLERY_TENANTS:", raw);
    return null;
  }
}

const TENANTS = loadTenants();

const HOSTNAME_MAP = new Map<string, Tenant>();
for (const tenant of TENANTS ?? []) {
  for (const h of tenant.hostnames) {
    HOSTNAME_MAP.set(h.toLowerCase(), tenant);
  }
}

function singleTenantFallback(): Tenant {
  return {
    id: "default",
    hostnames: [],
    name: "Gallery",
    redisPrefix: process.env.REDIS_KEY_PREFIX ?? "",
    blobPrefix: process.env.BLOB_PATH_PREFIX ?? "",
    blobId: process.env.ARTIST_BLOB_ID ?? "",
  };
}

/**
 * Resolve tenant from a Host header value (strips port, case-insensitive).
 * Returns null only in multi-tenant mode when the host is not registered.
 * Returns singleTenantFallback() when GALLERY_TENANTS is not configured.
 */
export function resolveTenant(hostHeader: string | null): Tenant | null {
  const host = (hostHeader ?? "").split(":")[0].toLowerCase();
  if (!TENANTS) return singleTenantFallback();
  return HOSTNAME_MAP.get(host) ?? null;
}

/**
 * Find a tenant by its Redis prefix. Used by ensureSeeded() to resolve
 * per-tenant admin credentials without needing request headers.
 */
export function getTenantByPrefix(prefix: string): Tenant | null {
  if (!TENANTS) return null;
  return TENANTS.find((t) => t.redisPrefix === prefix) ?? null;
}

/**
 * Read tenant config from x-tenant-* request headers stamped by middleware.
 * Falls back to single-tenant env vars when the headers are absent.
 * Safe to call from Node.js route handlers and server actions.
 */
export function getTenantFromHeaders(h: { get(k: string): string | null }): Tenant {
  const id = h.get("x-tenant-id");
  if (!id) return singleTenantFallback();
  return {
    id,
    hostnames: [],
    name: h.get("x-tenant-name") ?? id,
    redisPrefix: h.get("x-tenant-redis-prefix") ?? "",
    blobPrefix: h.get("x-tenant-blob-prefix") ?? "",
    blobId: h.get("x-tenant-blob-id") ?? singleTenantFallback().blobId,
  };
}
