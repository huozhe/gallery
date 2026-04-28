"use client";

import Image from "next/image";
import { useState, useEffect } from "react";

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

export default function ArtworkImage({ src, alt, width, height }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="block w-full cursor-zoom-in bg-neutral-100 overflow-hidden"
        aria-label="Expand image"
      >
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="w-full h-auto object-contain"
          priority
        />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 cursor-zoom-out"
          onClick={() => setOpen(false)}
        >
          <div className="relative max-w-[95vw] max-h-[95vh]">
            <Image
              src={src}
              alt={alt}
              width={width}
              height={height}
              className="max-w-[95vw] max-h-[95vh] w-auto h-auto object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
