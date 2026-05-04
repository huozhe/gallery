# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start local dev server at http://localhost:3000
npm run build    # production build + type check
npm run lint     # ESLint
```

## Architecture

Next.js 14 App Router, TypeScript, Tailwind CSS. Deployed on Vercel. Data and uploaded images are persisted in Redis + Vercel Blob in production; local dev uses a JSON file + the local `public/` folder. All types live in `src/data/types.ts`; all DB operations go through `src/lib/store.ts`.

### Storage

`src/lib/store.ts` is a thin switch — picks `store.kv.ts` (Redis + Blob) when `REDIS_URL` is set, else `store.file.ts` (`.data/store.json`). The exported surface (`artworks`, `tags`, `users`, `sessions`, `audit`, `about`, `blob`, `seed`) is identical across both.

**`store.kv.ts` highlights:**
- Uses `ioredis` against the Vercel marketplace Redis (env var `REDIS_URL`).
- Wraps the raw client in a `PrefixedRedis` class. Every key is automatically prefixed with `REDIS_KEY_PREFIX` (e.g. `dev:`) — call sites cannot bypass it.
- `ensureSeeded()` runs lazily on the first read of artworks/tags/users/sessions; seeds artworks/tags/about from `src/data/seed.ts`, then independently seeds the admin user from `GALLERY_ADMIN_EMAIL` + `GALLERY_ADMIN_PASSWORD` (the user check is *outside* the artwork check — important so an empty user index still gets seeded after a partial bootstrap).
- Sessions use Redis TTL via `setex`.

Seed data lives in `src/data/seed.ts`. To reset local dev: `rm .data/store.json && npm run dev`.

### Pages

**Public (route group `(public)`):**
- `/` — curatorial rooms view: live works grouped by visible primary-room tags, sorted by `orderByTag[tag.id]`. Filter pills are anchor links to `#room-{id}` sections. First image gets `priority` for LCP.
- `/artwork/[id]` — orientation-aware layout (portrait: 2-col, landscape: stacked); lightbox; reference image is a draggable/resizable floating overlay; prev/next nav is scoped to the artwork's primary room with a center index link.
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
- **Local dev** (no `BLOB_READ_WRITE_TOKEN`): writes to `public/{dir}/{safeName}`.
- **Production / dev with Blob**: uploads to Vercel Blob at `{BLOB_PATH_PREFIX}{dir}/{safeName}`. The full Blob URL is stored on the artwork record. `BLOB_PATH_PREFIX` (e.g. `dev/`) isolates dev uploads from prod within a shared Blob store.

`next.config.ts` allows `*.public.blob.vercel-storage.com` in `remotePatterns`. To add another external image host, extend that list.

### Environment isolation

When the same Redis + Blob is shared between local dev and production, set both prefixes locally to keep them separate:
```
REDIS_KEY_PREFIX=dev:
BLOB_PATH_PREFIX=dev/
```
Production leaves both unset.

### Admin dark mode

Admin is forced to light mode via `bg-white text-neutral-900` on the layout and `[color-scheme:light]` on table headers. Do not use Tailwind's `dark:` prefix in admin components.
