# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start local dev server at http://localhost:3000
npm run build    # production build + type check
npm run lint     # ESLint
```

## Architecture

Next.js 14 App Router, TypeScript, Tailwind CSS. No external CMS — artwork content lives in `src/data/artwork.ts`.

### Data flow
Artwork entries are defined in `src/data/artwork.ts` as a typed array of `Artwork` objects. Adding a new piece means adding an entry to that array and dropping the image file in `public/artwork/`. The `id` field drives the URL slug at `/artwork/[id]`.

### Pages
- `/` — gallery grid (`GalleryGrid` → `ArtworkCard` per piece)
- `/artwork/[id]` — full detail view; uses `generateStaticParams` so all pages are statically generated at build
- `/about` — static bio/contact page

### Images
`next/image` is used throughout for optimization. Local images go in `public/artwork/` and are referenced as `"/artwork/filename.jpg"`. External domains must be added to `remotePatterns` in `next.config.ts` (currently `picsum.photos` is allowed for placeholder images — remove when real artwork is added).
