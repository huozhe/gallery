"use client";

import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import type { ArtworkImage as ArtworkImageType } from "@/data/types";

type Props = {
  images: ArtworkImageType[];
  alt: string;
};

export default function ArtworkImage({ images, alt }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [open, setOpen] = useState(false);

  const current = images[currentIdx] ?? images[0];
  const multi = images.length > 1;

  const prev = useCallback(() => setCurrentIdx((i) => (i - 1 + images.length) % images.length), [images.length]);
  const next = useCallback(() => setCurrentIdx((i) => (i + 1) % images.length), [images.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, prev, next]);

  useEffect(() => {
    const img = images[currentIdx] ?? images[0];
    if (!img) return;
    document.dispatchEvent(
      new CustomEvent("artworkimage:change", { detail: { url: img.originalUrl ?? img.url } })
    );
  }, [currentIdx, images]);

  if (!current) return null;

  return (
    <>
      <div>
        <button
          onClick={() => setOpen(true)}
          className="block w-full cursor-zoom-in bg-neutral-100 overflow-hidden"
          aria-label="Expand image"
        >
          <Image
            src={current.url}
            alt={alt}
            width={current.width}
            height={current.height}
            className="w-full h-auto object-contain"
            priority
          />
        </button>

        {multi && (
          <div className="flex gap-2 mt-2 flex-wrap">
            {images.map((img, i) => (
              <button
                key={i}
                onClick={() => setCurrentIdx(i)}
                className={`w-14 h-14 bg-neutral-100 overflow-hidden shrink-0 transition-all ${
                  i === currentIdx ? "ring-2 ring-neutral-900" : "opacity-60 hover:opacity-100"
                }`}
                aria-label={`View image ${i + 1}`}
              >
                <Image
                  src={img.url}
                  alt={`${alt} — image ${i + 1}`}
                  width={img.width}
                  height={img.height}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 cursor-zoom-out"
          onClick={() => setOpen(false)}
        >
          {multi && (
            <span className="absolute top-4 right-4 text-white/50 text-xs tabular-nums">
              {currentIdx + 1} / {images.length}
            </span>
          )}

          <div
            className="relative max-w-[95vw] max-h-[95vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={current.url}
              alt={alt}
              width={current.width}
              height={current.height}
              className="max-w-[95vw] max-h-[95vh] w-auto h-auto object-contain cursor-default"
            />
          </div>

          {multi && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); prev(); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                aria-label="Previous image"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); next(); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                aria-label="Next image"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </>
          )}

          {!multi && (
            <button
              onClick={() => setOpen(false)}
              className="absolute inset-0 w-full h-full cursor-zoom-out"
              aria-label="Close"
            />
          )}
        </div>
      )}
    </>
  );
}
