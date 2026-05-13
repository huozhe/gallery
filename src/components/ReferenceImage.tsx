"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import CompareSurface from "./CompareSurface";

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
  index?: number;
  artworkImageUrl?: string;
};

export default function ReferenceImage({ src, alt, width, height, caption, index = 0, artworkImageUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [comparing, setComparing] = useState(false);
  const [currentArtworkUrl, setCurrentArtworkUrl] = useState(artworkImageUrl);
  const dragging = useRef(false);
  const origin = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // Stagger panel position by index, clamped to the viewport. Re-runs on resize/orientation change.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const vw = window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const w = Math.min(380, vw - 16);
      // Stagger from top-right; clamp so the panel's top leaves at least 140px of vertical room for content.
      const desiredX = vw - 420 - index * 30;
      const desiredY = 88 + index * 30;
      setPos({
        x: Math.max(8, Math.min(vw - w - 8, desiredX)),
        y: Math.max(8, Math.min(Math.max(8, vh - 140), desiredY)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, index]);

  useEffect(() => {
    const handler = (e: Event) => {
      setCurrentArtworkUrl((e as CustomEvent<{ url: string }>).detail.url);
    };
    document.addEventListener("artworkimage:change", handler);
    return () => document.removeEventListener("artworkimage:change", handler);
  }, []);

  // Slim Escape handler — closes the floating panel only. CompareSurface owns its own Escape while mounted.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !comparing) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, comparing]);

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
          style={{
            left: pos.x,
            top: pos.y,
            width: "min(380px, calc(100vw - 16px))",
            minWidth: 180,
            maxHeight: `calc(100dvh - ${pos.y + 8}px)`,
          }}
          className="fixed z-50 flex flex-col bg-neutral-900 border border-neutral-700 shadow-2xl select-none overflow-hidden resize-x touch-none"
        >
          {/* Title bar — drag handle */}
          <div
            className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 bg-neutral-800 border-b border-neutral-700 cursor-grab active:cursor-grabbing touch-none"
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

          {/* Image: aspect-ratio is the natural target, but min-h-0 + flex-1 lets it shrink so the compare button stays visible. */}
          <div
            className="relative w-full min-h-0 flex-1 basis-auto"
            style={{ aspectRatio: `${width} / ${height}` }}
          >
            <Image
              src={src}
              alt={alt}
              fill
              className="object-contain"
              sizes="50vw"
            />
          </div>

          {currentArtworkUrl && (
            <div className="shrink-0 px-3 py-2 bg-neutral-800 border-t border-neutral-700">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setComparing(true)}
                className="w-full text-xs text-neutral-300 hover:text-white bg-neutral-700 hover:bg-neutral-600 transition-colors py-1.5 px-2"
              >
                Compare with artwork
              </button>
            </div>
          )}
        </div>
      )}

      {comparing && currentArtworkUrl && (
        <CompareSurface
          artworkUrl={currentArtworkUrl}
          referenceUrl={src}
          referenceWidth={width}
          referenceHeight={height}
          referenceCaption={caption}
          alt={alt}
          onClose={() => setComparing(false)}
        />
      )}
    </>
  );
}
