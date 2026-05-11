"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

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
  const [dividerPos, setDividerPos] = useState(50);
  const [refScale, setRefScale] = useState(100);
  const [refOffset, setRefOffset] = useState({ x: 0, y: 0 });
  const [currentArtworkUrl, setCurrentArtworkUrl] = useState(artworkImageUrl);
  const dragging = useRef(false);
  const origin = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const isDraggingDivider = useRef(false);
  const isPanning = useRef(false);
  const panOrigin = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
  const compareContainerRef = useRef<HTMLDivElement>(null);

  // Stagger panel position by index so multiple panels don't stack exactly.
  useEffect(() => {
    if (open) {
      setPos({
        x: Math.max(16, window.innerWidth - 420 - index * 30),
        y: 88 + index * 30,
      });
    }
  }, [open, index]);

  useEffect(() => {
    const handler = (e: Event) => {
      setCurrentArtworkUrl((e as CustomEvent<{ url: string }>).detail.url);
    };
    document.addEventListener("artworkimage:change", handler);
    return () => document.removeEventListener("artworkimage:change", handler);
  }, []);

  useEffect(() => {
    if (!open && !comparing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (comparing) setComparing(false);
        else setOpen(false);
      }
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

  function startDividerDrag(e: React.PointerEvent<HTMLDivElement>) {
    isDraggingDivider.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  function onDividerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingDivider.current || !compareContainerRef.current) return;
    const rect = compareContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setDividerPos((x / rect.width) * 100);
  }

  function stopDividerDrag() {
    isDraggingDivider.current = false;
  }

  function startPan(e: React.PointerEvent<HTMLDivElement>) {
    isPanning.current = true;
    panOrigin.current = { mx: e.clientX, my: e.clientY, ox: refOffset.x, oy: refOffset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPan(e: React.PointerEvent<HTMLDivElement>) {
    if (!isPanning.current) return;
    setRefOffset({
      x: panOrigin.current.ox + (e.clientX - panOrigin.current.mx),
      y: panOrigin.current.oy + (e.clientY - panOrigin.current.my),
    });
  }

  function stopPan() {
    isPanning.current = false;
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

      {/* Split-view comparison overlay */}
      {comparing && currentArtworkUrl && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black">
          {/* Image area — both images object-cover so centers always align */}
          <div
            ref={compareContainerRef}
            className="relative flex-1 min-h-0 overflow-hidden select-none"
          >
            {/* Left: artwork */}
            <Image
              src={currentArtworkUrl}
              alt={alt}
              fill
              className="object-cover"
              sizes="100vw"
              priority
            />

            {/* Right: reference, clipped to show only right of divider, then scaled */}
            <div
              className="absolute inset-0"
              style={{ clipPath: `inset(0 0 0 ${dividerPos}%)` }}
            >
              <div
                className="absolute inset-0"
                style={{ transform: `translate(${refOffset.x}px, ${refOffset.y}px) scale(${refScale / 100})`, transformOrigin: "center" }}
              >
                <Image
                  src={src}
                  alt={`Reference: ${alt}`}
                  fill
                  className="object-cover"
                  sizes="100vw"
                />
              </div>
            </div>

            {/* Corner labels */}
            <span className="absolute top-3 left-3 text-xs text-white/80 bg-black/40 px-2 py-0.5 pointer-events-none">
              Artwork
            </span>
            <span className="absolute top-3 right-3 text-xs text-white/80 bg-black/40 px-2 py-0.5 pointer-events-none">
              Reference
            </span>

            {/* Drag-to-pan overlay covering only the reference (right) side */}
            <div
              className="absolute top-0 bottom-0 cursor-grab active:cursor-grabbing"
              style={{ left: `${dividerPos}%`, right: 0 }}
              onPointerDown={startPan}
              onPointerMove={onPan}
              onPointerUp={stopPan}
              onPointerCancel={stopPan}
            />

            {/* Draggable divider */}
            <div
              className="absolute top-0 bottom-0 w-px bg-white/80 cursor-col-resize"
              style={{ left: `${dividerPos}%` }}
              onPointerDown={startDividerDrag}
              onPointerMove={onDividerMove}
              onPointerUp={stopDividerDrag}
              onPointerCancel={stopDividerDrag}
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 bg-white rounded-full flex items-center justify-center text-neutral-600 shadow-lg text-sm pointer-events-none">
                ↔
              </div>
            </div>
          </div>

          {/* Controls bar */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-1 bg-neutral-900 border-t border-neutral-700">
            <span className="text-xs text-neutral-400 truncate flex-1 min-w-0">Ref — {caption}</span>

            {/* Scale: − value + */}
            <div className="flex items-center shrink-0">
              <button
                onClick={() => setRefScale((s) => Math.max(50, s - 1))}
                className="w-10 h-10 flex items-center justify-center text-neutral-300 hover:text-white active:bg-neutral-700 transition-colors text-lg font-medium"
                aria-label="Decrease scale"
              >−</button>
              <span className="w-12 text-center text-xs text-neutral-300 tabular-nums shrink-0">{refScale}%</span>
              <button
                onClick={() => setRefScale((s) => Math.min(200, s + 5))}
                className="w-10 h-10 flex items-center justify-center text-neutral-300 hover:text-white active:bg-neutral-700 transition-colors text-lg font-medium"
                aria-label="Increase scale"
              >+</button>
            </div>

            {/* Reset scale + offset */}
            <button
              onClick={() => { setRefScale(100); setRefOffset({ x: 0, y: 0 }); }}
              className="h-10 px-3 text-xs text-neutral-500 hover:text-neutral-200 active:text-white transition-colors shrink-0"
              aria-label="Reset scale and position"
            >
              reset
            </button>

            {/* Close */}
            <button
              onClick={() => setComparing(false)}
              className="w-10 h-10 flex items-center justify-center text-neutral-500 hover:text-neutral-100 active:text-white transition-colors text-xl shrink-0"
              aria-label="Close comparison"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
