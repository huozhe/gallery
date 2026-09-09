# Gallery

A self-hosted portfolio site for painters. Artists upload work through an admin panel; visitors
browse it as curated rooms. Includes a side-by-side compare tool for studying a painting against
its reference photo.

Running at [roamingbrush.art](https://roamingbrush.art).

## Features

- **Curatorial rooms** — artworks grouped by tag, ordered per room, with a full-screen slideshow
- **Compare tool** — overlay a painting on its reference in three modes (horizontal split, vertical
  split, opacity blend), with two-point alignment that solves scale, rotation and translation.
  Also available standalone at `/compare` for anyone, with no upload or account
- **Admin panel** — drag-to-reorder, soft delete and restore, tag management, audit log,
  backup and restore
- **Multi-tenant** — one deployment serves many artists, routed by host header, with isolated
  data and storage per artist

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Redis · Vercel Blob · Vitest

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. With no `REDIS_URL` set, the app uses a JSON file at
`.data/store.json` and writes uploads to `public/`, so it runs with no external services. Seed data
loads on first request.

Create an admin user:

```bash
npm run admin:create -- you@example.com yourpassword
```

To reset local state, `rm -rf .data` and restart.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build and type check |
| `npm test` | Vitest suite |
| `npm run lint` | ESLint |
| `npm run admin:create -- <email> <password>` | Create an admin user |

## Configuration

Copy `.env.example` to `.env.local`. Everything is optional for local development.

| Variable | Purpose |
| --- | --- |
| `REDIS_URL` | Switches storage from the local JSON file to Redis |
| `BLOB_READ_WRITE_TOKEN` | Switches uploads from `public/` to Vercel Blob |
| `GALLERY_TENANTS` | JSON array of artist configs; see below |
| `GALLERY_ADMIN_EMAIL` / `GALLERY_ADMIN_PASSWORD` | Seeds the first admin user |
| `REDIS_KEY_PREFIX` / `BLOB_PATH_PREFIX` | Single-tenant fallback namespacing |
| `RESEND_API_KEY` / `RESET_FROM_EMAIL` | Password reset and contact email. Without a key, emails print to the console |
| `CRON_SECRET` | Bearer token for the scheduled backup endpoint |

### Multi-tenancy

`GALLERY_TENANTS` maps hostnames to isolated Redis and Blob namespaces:

```json
[
  {
    "id": "example-artist",
    "hostnames": ["example.art", "www.example.art"],
    "name": "Example Artist",
    "redisPrefix": "prod:example:",
    "blobPrefix": "prod/example/",
    "blobId": "00000000-0000-0000-0000-000000000000",
    "adminEmail": "artist@example.com",
    "adminPassword": "initial-password"
  }
]
```

`src/proxy.ts` resolves the `Host` header to a tenant and stamps `x-tenant-*` headers on the
request. Every storage call reads its key prefix from those headers, so tenants cannot reach each
other's data. Adding an artist needs no code change: extend the array, point a domain at the
deployment, and the first request seeds them.

Leave `GALLERY_TENANTS` unset to run single-tenant with `REDIS_KEY_PREFIX` and `BLOB_PATH_PREFIX`.

## Architecture

```
src/
  app/(public)/    gallery, artwork detail, about, guest compare tool
  app/admin/       admin panel
  app/api/         upload, backup, restore
  components/      CompareSurface, carousels, slideshow
  lib/             store (Redis + file backends), auth, tenant, email
  data/            types and seed data
  proxy.ts         host to tenant routing
```

**Storage.** `src/lib/store.ts` picks a backend at runtime: Redis plus Vercel Blob when `REDIS_URL`
is set, otherwise a JSON file plus the local `public/` folder. Both expose the same surface, so
nothing above the storage layer knows which is in use.

**Images.** Uploads are resized to 2000px on the longest edge and converted to WebP with `sharp`,
which also strips EXIF. The original is kept alongside it.

**Auth.** argon2id password hashing, opaque session tokens stored hashed, session cookies. Password
reset tokens are single-use with a one-hour TTL.

`CLAUDE.md` carries the detailed architecture notes.

## Testing

```bash
npm test                    # 115 tests
npx vitest run --coverage   # coverage report
```

CI runs tests and a build on every push and pull request to `main`.

## Deployment

Built for Vercel. Set the environment variables above, point your domains at the project, and
`vercel.json` schedules a daily backup to Blob at 02:00 UTC. Backups keep the newest 30 per tenant
and can be restored from `/admin/backup`.
