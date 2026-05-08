# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start local dev server at http://localhost:3000
npm run build    # production build + type check
npm run lint     # ESLint
npm test         # Vitest (112 tests); npx vitest run --coverage for coverage report
npm run migrate:images  # one-shot: convert artwork images to WebP (run with env loaded for Redis+Blob)
```

## Architecture

Next.js 16 App Router, TypeScript, Tailwind CSS. Deployed on Vercel. Data and uploaded images are persisted in Redis + Vercel Blob in production; local dev uses a JSON file + the local `public/` folder. All types live in `src/data/types.ts`; all DB operations go through `src/lib/store.ts`.

### Multi-Tenancy

The app supports multiple artists via host-header routing. Each artist gets their own subdomain/domain with isolated Redis data and Vercel Blob storage.

**`src/lib/tenant.ts`** — `Tenant` type + `GALLERY_TENANTS` env-var registry (JSON array). Parsed once at module load (edge-compatible). `resolveTenant(host)` used by the proxy; `getTenantFromHeaders(h)` used by route handlers and server actions; `getTenantByPrefix(prefix)` used by `ensureSeeded()` to resolve per-tenant credentials without headers. Falls back to legacy `REDIS_KEY_PREFIX` / `BLOB_PATH_PREFIX` / `ARTIST_BLOB_ID` env vars when `GALLERY_TENANTS` is unset.

**`src/proxy.ts`** — Next.js 16 proxy (file must be `proxy.ts`, export must be `proxy`). Reads `Host` header, resolves tenant, stamps five `x-tenant-*` headers on the **request** object via `NextResponse.next({ request: { headers } })` so they are readable via `await headers()` in server components. Also handles `/admin` cookie-presence guard — `/admin/sign-in`, `/admin/forgot-password`, and `/admin/reset-password` are public (no cookie required).

**Tenant headers** (server-side only, never sent to browser):
- `x-tenant-id`, `x-tenant-name`
- `x-tenant-redis-prefix` — e.g. `prod:roamingbrush:`
- `x-tenant-blob-prefix` — e.g. `prod/roamingbrush/`
- `x-tenant-blob-id` — UUID for blob path (per-artist)

**`GALLERY_TENANTS` format:**
```json
[
  {
    "id": "roamingbrush",
    "hostnames": ["roamingbrush.art", "www.roamingbrush.art", "gallery-alpha-five.vercel.app"],
    "name": "Roaming Brush",
    "redisPrefix": "prod:roamingbrush:",
    "blobPrefix": "prod/roamingbrush/",
    "blobId": "00000000-0000-0000-0000-0000000000ff",
    "adminEmail": "artist@example.com",
    "adminPassword": "initial-password"
  }
]
```
`adminEmail`/`adminPassword` are optional — used only to seed the first admin user on first request when `users:index` is empty. Fall back to global `GALLERY_ADMIN_EMAIL`/`GALLERY_ADMIN_PASSWORD` env vars if absent. Change password via `/admin/users` after first login; `adminPassword` can then be removed from the config.

### Storage

`src/lib/store.ts` is a thin switch — picks `store.kv.ts` (Redis + Blob) when `REDIS_URL` is set, else `store.file.ts` (`.data/{tenantId}/store.json`). The exported surface (`artworks`, `tags`, `users`, `sessions`, `audit`, `about`, `blob`, `seed`) is identical across both.

**`store.kv.ts` highlights (+ `backupRedis()` / `restoreRedis()` exports):**
- Uses `ioredis` against the Vercel marketplace Redis (env var `REDIS_URL`).
- Raw `ioredis` connection is a global singleton (`_redisRaw`). `PrefixedRedis` wrapper is created per-call.
- `getRawConnection()` parses `REDIS_URL` with `new URL()` and passes structured options to ioredis — avoids ioredis's internal `url.parse()` deprecation warning (DEP0169).
- `getClient()` is async: reads `x-tenant-redis-prefix` from `await headers()`, falls back to `REDIS_KEY_PREFIX` env var (for scripts/tests outside request context).
- `PrefixedRedis` takes `prefix` as constructor arg and exposes `readonly prefix`. Every key is automatically prefixed — call sites cannot bypass it.
- `ensureSeeded()` is keyed by prefix (`seeded: Set<string>`); each tenant seeds independently on first request. Uses per-tenant `adminEmail`/`adminPassword` from `GALLERY_TENANTS` (via `getTenantByPrefix()`), falling back to global env vars.
- Sessions use Redis TTL via `setex`.
- Artwork keys: `artwork:{numericId}`; `artworks:index` (Set); `artworks:slugs` (Hash: slug→id); `artworks:counter`.
- `restoreRedis()` throws if backup prefix ≠ current tenant prefix (cross-tenant guard).

**`store.file.ts`** (local dev):
- `getDataFile()` reads tenant ID from headers, returns `.data/{tenantId}/store.json`; falls back to `.data/store.json`.
- Per-tenant write chains via `writeChains: Map<string, Promise<void>>`.
- `load()` seeds artworks, tags, and admin user (from `GALLERY_ADMIN_EMAIL`/`GALLERY_ADMIN_PASSWORD`) on first run.
- `users.*` calls `load()` (not `readFile()`) so user seeding triggers on first sign-in attempt.

Seed data lives in `src/data/seed.ts`. To reset local dev: `rm -rf .data && npm run dev`.

### Pages

**Public (route group `(public)`):**
- `/` — curatorial rooms view: live works grouped by visible primary-room tags, sorted by `orderByTag[tag.id]`. Slideshow button opens full-screen fade viewer.
- `/artwork/[slug]` — orientation-aware layout; lightbox; reference image draggable overlay; prev/next nav scoped to primary room.
- `/about` — bio + contact email read from store, edited at `/admin/about`.
- `not-found.tsx` — "Plate · 404" page.

**Admin (`/admin/*`):**
- `/admin` — dashboard: search, tag/status filters, drag-to-reorder, soft-delete, restore, purge.
- `/admin/works/new` and `/admin/works/[id]` — create/edit form with live preview, image + reference-image upload.
- `/admin/tags` — tag CRUD + per-tag artwork ordering.
- `/admin/about` — bio textarea + contact email.
- `/admin/audit` — audit log viewer, filterable by action and actor email.
- `/admin/backup` — Backup now / Restore / Delete UI; lists Blob backups newest-first.
- `/admin/users` — change own password; add admin users; delete users (guards: no self-delete, no last-user delete).
- `/admin/forgot-password` — request password reset link; always shows generic confirmation (no email-existence leak).
- `/admin/reset-password` — server validates 1hr token; renders new-password form or expired-link error.
- `/admin/sign-in` — argon2id password auth, opaque session tokens, in-memory rate limiter.

### Auth

Session cookie (`gallery_session`) holds a 32-byte random hex token; stored *hashed* in the store. `src/lib/auth.ts` handles hashing, verification, session lookup. `requireSession()` redirects to sign-in if unauthenticated. **Note:** the rate limiter is in-memory — fine for a single warm Vercel instance but resets per cold start.

Password reset tokens use the same `createSessionToken()`/`hashSessionToken()` primitives. Raw token goes in the email URL; SHA256 hash stored under `pwreset:{hash}` with 1hr TTL. `src/lib/email.ts` wraps Resend; falls back to `console.log` when `RESEND_API_KEY` is unset (local dev). Required env vars: `RESEND_API_KEY`, `RESET_FROM_EMAIL`.

### Images

`next/image` is used everywhere. Upload endpoint: `POST /api/admin/upload`.

Every upload is processed through `sharp`: resized to ≤2000px on the longest edge, converted to WebP (quality 85, metadata stripped). The original is preserved verbatim.
- `artistDir` and `blobPrefix` are read from tenant headers (not env vars or config constants).
- **Local dev** (no `BLOB_READ_WRITE_TOKEN`): WebP → `public/artists/{tenant.blobId}/{dir}/{uuid}.webp`.
- **Production**: WebP → Blob at `{tenant.blobPrefix}artists/{tenant.blobId}/{dir}/{uuid}.webp`. Full Blob URLs stored on the artwork record.
- **`Artwork.blobId`** is a stable UUID assigned at creation and used as the artwork's blob directory name.
- **Stale blobs** are deleted by `saveArtwork` when image URLs change on update; `purgeArtwork` deletes all artwork blobs.

`next.config.ts` allows `*.public.blob.vercel-storage.com` in `remotePatterns`.

### Backup & Restore

`GET /api/admin/backup` — dumps all Redis keys (excluding sessions) to Vercel Blob as `{tenant.blobPrefix}backup/redis-{datetime}Z.json`. Auth: valid session cookie OR `Authorization: Bearer {CRON_SECRET}`. Auto-purges to keep newest 30 per tenant. `vercel.json` schedules it daily at 02:00 UTC.

`POST /api/admin/restore` — session-auth only. Body: `{ url: string }`. Validates backup prefix matches current tenant (throws otherwise). Logs `backup.restore` audit entry.

### Tests

Vitest test suite lives in `src/test/`. Run with `npm test`. GitHub Actions CI runs tests + build on every push/PR to main.

**Mock pattern:** declare `const mockXxx = vi.fn()` at module top level before `vi.mock(factory)` — the factory closure captures them lazily.

**`next/headers` mock** — globally set in `src/test/setup.ts`. `headers` default returns `{ get: () => null }` which causes all store calls to fall back to env-var prefix. Tests that need tenant-specific behavior override it per-test.

### Environment isolation

Local dev `.env.local`:
```
REDIS_KEY_PREFIX=dev:
BLOB_PATH_PREFIX=dev/
```
Or with `GALLERY_TENANTS`:
```
GALLERY_TENANTS=[{"id":"roamingbrush","hostnames":["localhost","roamingbrush.localhost"],...}]
```
Production: set `GALLERY_TENANTS` in Vercel env vars; remove `REDIS_KEY_PREFIX`, `BLOB_PATH_PREFIX`, `ARTIST_BLOB_ID`.

### Admin dark mode

Admin is forced to light mode via `bg-white text-neutral-900` on the layout and `[color-scheme:light]` on table headers. Do not use Tailwind's `dark:` prefix in admin components.
