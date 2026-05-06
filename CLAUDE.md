# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start local dev server at http://localhost:3000
npm run build    # production build + type check
npm run lint     # ESLint
npm test         # Vitest (82 tests); npx vitest run --coverage for coverage report
npm run migrate:images  # one-shot: convert artwork images to WebP (run with env loaded for Redis+Blob)
```

## Architecture

Next.js 14 App Router, TypeScript, Tailwind CSS. Deployed on Vercel. Data and uploaded images are persisted in Redis + Vercel Blob in production; local dev uses a JSON file + the local `public/` folder. All types live in `src/data/types.ts`; all DB operations go through `src/lib/store.ts`.

### Storage

`src/lib/store.ts` is a thin switch — picks `store.kv.ts` (Redis + Blob) when `REDIS_URL` is set, else `store.file.ts` (`.data/store.json`). The exported surface (`artworks`, `tags`, `users`, `sessions`, `audit`, `about`, `blob`, `seed`) is identical across both.

**`store.kv.ts` highlights (+ `backupRedis()` export):**
- Uses `ioredis` against the Vercel marketplace Redis (env var `REDIS_URL`).
- Wraps the raw client in a `PrefixedRedis` class. Every key is automatically prefixed with `REDIS_KEY_PREFIX` (e.g. `dev:`) — call sites cannot bypass it.
- `ensureSeeded()` runs lazily on the first read of artworks/tags/users/sessions; seeds artworks/tags/about from `src/data/seed.ts`, then independently seeds the admin user from `GALLERY_ADMIN_EMAIL` + `GALLERY_ADMIN_PASSWORD` (the user check is *outside* the artwork check — important so an empty user index still gets seeded after a partial bootstrap).
- Sessions use Redis TTL via `setex`.
- Artwork keys: `artwork:{numericId}` (integer); `artworks:index` (Set of stringified IDs); `artworks:slugs` (Hash: slug → numericId); `artworks:counter` (auto-increment integer). `Artwork.id` is a number; `Artwork.slug` is the URL-friendly string used in public routes.
- Prod uses `REDIS_KEY_PREFIX=prod:` and `BLOB_PATH_PREFIX=prod/`; dev uses `dev:` / `dev/`. Both isolate from each other on the shared Vercel Redis + Blob instance.

Seed data lives in `src/data/seed.ts`. To reset local dev: `rm .data/store.json && npm run dev`.

### Pages

**Public (route group `(public)`):**
- `/` — curatorial rooms view: live works grouped by visible primary-room tags, sorted by `orderByTag[tag.id]`. Filter pills are anchor links to `#room-{id}` sections. First image gets `priority` for LCP.
- `/artwork/[slug]` — orientation-aware layout (portrait: 2-col, landscape: stacked); lightbox; reference image is a draggable/resizable floating overlay; prev/next nav is scoped to the artwork's primary room with a center index link.
- `/about` — bio + contact email read from store, edited at `/admin/about`.
- `not-found.tsx` — "Plate · 404" page (no own `<Nav />`; layout supplies it).

**Admin (`/admin/*`):**
- `/admin` — dashboard: search, tag/status filters, drag-to-reorder, soft-delete to trash, restore, purge. Table cells use `min-w-0` for grid truncation; outer wrapper uses `overflow-x-auto`.
- `/admin/works/new` and `/admin/works/[id]` — create/edit form with live preview, image + reference-image upload.
- `/admin/tags` — tag CRUD + per-tag artwork ordering.
- `/admin/about` — bio textarea + contact email.
- `/admin/audit` — audit log viewer, filterable by action and actor email.
- `/admin/sign-in` — argon2id password auth, opaque session tokens, in-memory rate limiter. Header nav is hidden until signed in.

### Auth

Session cookie (`gallery_session`) holds a 32-byte random hex token; stored *hashed* in the store. `src/lib/auth.ts` handles hashing, verification, session lookup. `requireSession()` redirects to sign-in if unauthenticated. **Note:** the rate limiter is in-memory — fine for a single warm Vercel instance but resets per cold start.

### Images

`next/image` is used everywhere. Upload endpoint: `POST /api/admin/upload`.

Every upload is processed through `sharp`: resized to ≤2000px on the longest edge, converted to WebP (quality 85, metadata stripped). The original is preserved verbatim.
- **Local dev** (no `BLOB_READ_WRITE_TOKEN`): WebP → `public/artists/{ARTIST_BLOB_ID}/{dir}/{uuid}.webp`; original → `public/artists/{ARTIST_BLOB_ID}/{dir}/original/{uuid}.{ext}`.
- **Production / dev with Blob**: WebP → Blob at `{BLOB_PATH_PREFIX}artists/{ARTIST_BLOB_ID}/{dir}/{uuid}.webp`; original → `{BLOB_PATH_PREFIX}artists/{ARTIST_BLOB_ID}/{dir}/original/{uuid}.{ext}`. Full Blob URLs stored on the artwork record.
- **`ARTIST_BLOB_ID`** is a fixed UUID in `src/lib/config.ts` used exclusively in blob paths (opaque, not the numeric `ARTIST_ID`).
- **`Artwork.blobId`** is a stable UUID assigned at creation and used as the artwork's blob directory name. `ArtworkForm` generates a `pendingId` UUID client-side; this becomes the permanent `blobId` on first save.
- **Artwork images** use `dir=artworks/{blobId}/images`; **reference images** use `dir=artworks/{blobId}/references`. Reference upload requires a saved artwork (guard: `!form.blobId`).
- **`Artwork.imageFilename`** and **`ArtworkReference.imageFilename`** store the original upload filename as metadata in Redis (never exposed to visitors).
- **Stale blobs** are deleted by `saveArtwork` when image URLs change on update; `purgeArtwork` deletes all artwork blobs.

Response: `{ path, originalPath, originalFilename, width, height }` — dimensions come from sharp output.
`Artwork.originalImage` stores the original URL alongside `Artwork.image`.
`Artwork.imageFilename` and `ArtworkReference.imageFilename` store the original upload filename (metadata only, not exposed).

`next.config.ts` allows `*.public.blob.vercel-storage.com` in `remotePatterns`. To add another external image host, extend that list.

### Backup

`GET /api/admin/backup` — dumps all Redis keys (excluding sessions) to Vercel Blob as `{BLOB_PATH_PREFIX}backup/redis-YYYY-MM-DD.json`. Auth: valid session cookie OR `Authorization: Bearer {CRON_SECRET}`. Returns `{ ok, url, keys }`. `vercel.json` schedules it daily at 02:00 UTC. `CRON_SECRET` must be set manually in the Vercel dashboard (not auto-injected).

### Tests

Vitest test suite lives in `src/test/`. Run with `npm test`. GitHub Actions CI (`.github/workflows/ci.yml`) runs tests + build on every push/PR to main. Mock pattern: declare `const mockXxx = vi.fn()` at module top level before `vi.mock(factory)` — the factory closure captures them lazily and they are initialized by the time it runs.

### Environment isolation

When the same Redis + Blob is shared between local dev and production, set both prefixes locally to keep them separate:
```
REDIS_KEY_PREFIX=dev:
BLOB_PATH_PREFIX=dev/
```
Production uses `REDIS_KEY_PREFIX=prod:` and `BLOB_PATH_PREFIX=prod/` (set in Vercel env vars).

### Admin dark mode

Admin is forced to light mode via `bg-white text-neutral-900` on the layout and `[color-scheme:light]` on table headers. Do not use Tailwind's `dark:` prefix in admin components.
