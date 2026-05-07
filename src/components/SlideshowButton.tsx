"use client";

import { useState } from "react";
import type { Artwork } from "@/data/types";
import Slideshow from "./Slideshow";

export default function SlideshowButton({ artworks }: { artworks: Artwork[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21" />
        </svg>
        Slideshow
      </button>
      {open && <Slideshow artworks={artworks} onClose={() => setOpen(false)} />}
    </>
  );
}
