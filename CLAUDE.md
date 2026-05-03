# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start local dev server at http://localhost:3000
npm run build    # production build + type check
npm run lint     # ESLint
```

## Architecture

Next.js 14 App Router, TypeScript, Tailwind CSS. Data is managed via an admin panel and persisted to `.data/store.json` (local dev). All types are in `src/data/types.ts`; all DB operations go through `src/lib/store.ts`.

### Data flow
Content lives in `.data/store.json`, read/written by `src/lib/store.ts`. The store exports namespaced objects (`artworks`, `tags`, `users`, `sessions`, `audit`) — every mutation goes through these. To swap to Vercel KV + Blob for production, replace the internals of `store.ts` without changing the exported surface.

Seed data is in `src/data/seed.ts`. Delete `.data/store.json` and restart dev to reset to seed state.

### Pages

**Public (route group `(public)`):**
- `/` — gallery grid, filters by live status and visible tags, sorted by `orderGlobal`
- `/artwork/[id]` — detail view; orientation-aware layout (portrait: 2-col, landscape: stacked); lightbox on image click; reference image as draggable floating overlay
- `/about` — static bio/contact page (copy currently hardcoded; no admin editing yet)

**Admin (`/admin/*`):**
- `/admin` — dashboard: search, tag/status filters, drag-to-reorder, soft-delete/trash/purge
- `/admin/works/new` and `/admin/works/[id]` — create/edit form with live preview and image upload
- `/admin/tags` — tag CRUD with per-tag artwork ordering
- `/admin/sign-in` — argon2id password auth, opaque session tokens, in-memory rate limiter

### Auth
Session cookie (`gallery_session`) holds a random 32-byte hex token. The token is stored hashed in the store. `src/lib/auth.ts` handles hashing, verification, and session lookup. `requireSession()` redirects to sign-in if unauthenticated.

### Images
`next/image` is used throughout. Uploaded images land in `public/artwork/` (main) and `public/artwork/reference/[id]/` (reference images). Upload endpoint: `POST /api/admin/upload`. External domains must be added to `remotePatterns` in `next.config.ts`.

### Admin dark mode
Admin is forced to light mode via explicit `bg-white text-neutral-900` classes on the layout and `[color-scheme:light]` on table headers. Do not rely on Tailwind's `dark:` prefix in admin components.
