"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
};

export default function ReferenceImage({ src, alt, width, height, caption }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const origin = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // Place the panel near the top-right of the viewport on first open.
  useEffect(() => {
    if (open) {
      setPos({
        x: Math.max(16, window.innerWidth - 420),
        y: 88,
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    dragging.current = true;
    origin.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    setPos({
      x: origin.current.px + (e.clientX - origin.current.mx),
      y: origin.current.py + (e.clientY - origin.current.my),
    });
  }

  function stopDrag() {
    dragging.current = false;
  }

  return (
    <>
      {/* Thumbnail — click to open the floating panel */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="block max-w-[220px] cursor-zoom-in bg-neutral-100 overflow-hidden hover:opacity-90 transition-opacity"
        aria-label={open ? "Close reference panel" : "Open reference panel to compare"}
      >
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="w-full h-auto object-contain"
        />
      </button>

      {/* Draggable, resizable floating panel */}
      {open && (
        <div
          style={{ left: pos.x, top: pos.y, width: 380, minWidth: 180 }}
          className="fixed z-50 flex flex-col bg-neutral-900 border border-neutral-700 shadow-2xl select-none overflow-hidden resize-x"
        >
          {/* Title bar — drag handle */}
          <div
            className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 bg-neutral-800 border-b border-neutral-700 cursor-grab active:cursor-grabbing"
            onPointerDown={startDrag}
            onPointerMove={onDrag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
          >
            <span className="text-xs text-neutral-400 truncate">Reference — {caption}</span>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setOpen(false)}
              className="shrink-0 text-neutral-500 hover:text-neutral-100 text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Image: height auto-derives from width via aspect-ratio — no empty edges */}
          <div className="relative w-full" style={{ aspectRatio: `${width} / ${height}` }}>
            <Image
              src={src}
              alt={alt}
              fill
              className="object-contain"
              sizes="50vw"
            />
          </div>
        </div>
      )}
    </>
  );
}
