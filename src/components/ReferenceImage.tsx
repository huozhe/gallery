"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
  index?: number;
  artworkImageUrl?: string;
};

type Rect = { x: number; y: number; w: number; h: number };
type NormPoint = { fx: number; fy: number };

function imageRectContain(boxW: number, boxH: number, imgW: number, imgH: number): Rect {
  const imgA = imgW / imgH;
  const boxA = boxW / boxH;
  if (imgA > boxA) {
    const w = boxW;
    const h = boxW / imgA;
    return { x: 0, y: (boxH - h) / 2, w, h };
  }
  const h = boxH;
  const w = boxH * imgA;
  return { x: (boxW - w) / 2, y: 0, w, h };
}

function imageRectCover(boxW: number, boxH: number, imgW: number, imgH: number): Rect {
  const imgA = imgW / imgH;
  const boxA = boxW / boxH;
  if (imgA > boxA) {
    const h = boxH;
    const w = boxH * imgA;
    return { x: (boxW - w) / 2, y: 0, w, h };
  }
  const w = boxW;
  const h = boxW / imgA;
  return { x: 0, y: (boxH - h) / 2, w, h };
}

function AlignMarker({ x, y, label, color }: { x: number; y: number; label: string; color: "amber" | "cyan" }) {
  const bg = color === "amber" ? "bg-amber-400" : "bg-cyan-400";
  return (
    <div
      className={`absolute w-5 h-5 rounded-full ${bg} border-2 border-white text-[10px] text-neutral-900 font-bold flex items-center justify-center pointer-events-none shadow-md`}
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
    >{label}</div>
  );
}

export default function ReferenceImage({ src, alt, width, height, caption, index = 0, artworkImageUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [comparing, setComparing] = useState(false);
  const [dividerPos, setDividerPos] = useState(50);
  const [compareMode, setCompareMode] = useState<"horizontal" | "vertical" | "overlay">("horizontal");
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [refScale, setRefScale] = useState(100);
  const [refOffset, setRefOffset] = useState({ x: 0, y: 0 });
  const [refRotation, setRefRotation] = useState(0);
  const [alignStep, setAlignStep] = useState(0);
  const [alignPoints, setAlignPoints] = useState<{
    p1: NormPoint | null;
    q1: NormPoint | null;
    p2: NormPoint | null;
  }>({ p1: null, q1: null, p2: null });
  const [alignError, setAlignError] = useState<string | null>(null);
  const [artNaturalSize, setArtNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  const [currentArtworkUrl, setCurrentArtworkUrl] = useState(artworkImageUrl);
  const dragging = useRef(false);
  const origin = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const isDraggingDivider = useRef(false);
  const isPanning = useRef(false);
  const panOrigin = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
  const compareContainerRef = useRef<HTMLDivElement>(null);

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
      setArtNaturalSize(null);
      setAlignStep(0);
      setAlignPoints({ p1: null, q1: null, p2: null });
      setAlignError(null);
    };
    document.addEventListener("artworkimage:change", handler);
    return () => document.removeEventListener("artworkimage:change", handler);
  }, []);

  useEffect(() => {
    if (!open && !comparing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (alignStep > 0) {
          setAlignStep(0);
          setAlignPoints({ p1: null, q1: null, p2: null });
          setAlignError(null);
        } else if (comparing) setComparing(false);
        else setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, comparing, alignStep]);

  useEffect(() => {
    if (alignStep !== 0) return;
    if (!alignPoints.p1 && !alignPoints.q1 && !alignPoints.p2) return;
    const t = setTimeout(() => {
      setAlignPoints({ p1: null, q1: null, p2: null });
    }, 1000);
    return () => clearTimeout(t);
  }, [alignStep, alignPoints]);

  useLayoutEffect(() => {
    if (!comparing || !compareContainerRef.current) return;
    const el = compareContainerRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [comparing]);

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
    if (compareMode === "vertical") {
      const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      setDividerPos((y / rect.height) * 100);
    } else {
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      setDividerPos((x / rect.width) * 100);
    }
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

  function startAlign() {
    setRefScale(100);
    setRefOffset({ x: 0, y: 0 });
    setRefRotation(0);
    setDividerPos(50);
    setAlignPoints({ p1: null, q1: null, p2: null });
    setAlignError(null);
    setAlignStep(1);
  }

  function cancelAlign() {
    setAlignStep(0);
    setAlignPoints({ p1: null, q1: null, p2: null });
    setAlignError(null);
  }

  function clickToNorm(e: React.PointerEvent<HTMLDivElement>, imgW: number, imgH: number): NormPoint {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const imgRect = imageRectContain(rect.width, rect.height, imgW, imgH);
    return {
      fx: Math.max(0, Math.min(1, (cx - imgRect.x) / imgRect.w)),
      fy: Math.max(0, Math.min(1, (cy - imgRect.y) / imgRect.h)),
    };
  }

  function handleArtworkClick(e: React.PointerEvent<HTMLDivElement>) {
    if (alignStep !== 1 && alignStep !== 3) return;
    if (!artNaturalSize) return;
    const norm = clickToNorm(e, artNaturalSize.w, artNaturalSize.h);
    if (alignStep === 1) {
      setAlignPoints((s) => ({ ...s, p1: norm }));
      setAlignError(null);
      setAlignStep(2);
    } else {
      setAlignPoints((s) => ({ ...s, p2: norm }));
      setAlignStep(4);
    }
  }

  function handleReferenceClick(e: React.PointerEvent<HTMLDivElement>) {
    if (alignStep !== 2 && alignStep !== 4) return;
    const norm = clickToNorm(e, width, height);
    if (alignStep === 2) {
      setAlignPoints((s) => ({ ...s, q1: norm }));
      setAlignStep(3);
    } else {
      applyAlign(norm);
    }
  }

  function applyAlign(q2Norm: NormPoint) {
    const { p1, q1, p2 } = alignPoints;
    if (!p1 || !q1 || !p2 || !compareContainerRef.current || !artNaturalSize) return;
    const rect = compareContainerRef.current.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const artR = imageRectCover(W, H, artNaturalSize.w, artNaturalSize.h);
    const refR = imageRectCover(W, H, width, height);

    const P1 = { x: artR.x + p1.fx * artR.w, y: artR.y + p1.fy * artR.h };
    const P2 = { x: artR.x + p2.fx * artR.w, y: artR.y + p2.fy * artR.h };
    const Q1 = { x: refR.x + q1.fx * refR.w, y: refR.y + q1.fy * refR.h };
    const Q2 = { x: refR.x + q2Norm.fx * refR.w, y: refR.y + q2Norm.fy * refR.h };

    const vpx = P2.x - P1.x;
    const vpy = P2.y - P1.y;
    const vqx = Q2.x - Q1.x;
    const vqy = Q2.y - Q1.y;
    const vpLen = Math.hypot(vpx, vpy);
    const vqLen = Math.hypot(vqx, vqy);

    if (vpLen < 2 || vqLen < 2) {
      setAlignError("Points too close — pick a different feature #2");
      setAlignPoints((s) => ({ ...s, p2: null }));
      setAlignStep(3);
      return;
    }

    const scale = vpLen / vqLen;
    const theta = Math.atan2(vpy, vpx) - Math.atan2(vqy, vqx);

    const cx = W / 2;
    const cy = H / 2;
    const dx = Q1.x - cx;
    const dy = Q1.y - cy;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const rotScaledX = scale * (cosT * dx - sinT * dy);
    const rotScaledY = scale * (sinT * dx + cosT * dy);

    setRefScale(Math.max(10, Math.min(1000, scale * 100)));
    setRefRotation((theta * 180) / Math.PI);
    setRefOffset({ x: P1.x - cx - rotScaledX, y: P1.y - cy - rotScaledY });
    setAlignError(null);
    setAlignStep(0);
  }

  function alignInstruction(step: number): string {
    switch (step) {
      case 1: return "Click feature #1 on the artwork";
      case 2: return "Click the same feature #1 on the reference";
      case 3: return "Click feature #2 on the artwork";
      case 4: return "Click the same feature #2 on the reference";
      default: return "";
    }
  }

  function onArtworkLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setArtNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }

  // Precompute panel positions for markers during align mode.
  const panelW = containerSize ? containerSize.w / 2 : 0;
  const panelH = containerSize ? containerSize.h : 0;
  const artInPanel = artNaturalSize && containerSize
    ? imageRectContain(panelW, panelH, artNaturalSize.w, artNaturalSize.h)
    : null;
  const refInPanel = containerSize
    ? imageRectContain(panelW, panelH, width, height)
    : null;

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

      {/* Split-view comparison overlay */}
      {comparing && currentArtworkUrl && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black">
          <div
            ref={compareContainerRef}
            className="relative flex-1 min-h-0 overflow-hidden select-none"
          >
            {alignStep > 0 ? (
              // Alignment view — split panels, both images object-contain so user sees them fully
              <div className="absolute inset-0 flex">
                {/* Left: artwork */}
                <div
                  className="flex-1 relative bg-neutral-950 border-r border-neutral-700 cursor-crosshair"
                  onPointerDown={handleArtworkClick}
                >
                  <Image
                    src={currentArtworkUrl}
                    alt={alt}
                    fill
                    className="object-contain pointer-events-none"
                    sizes="50vw"
                    priority
                    onLoad={onArtworkLoad}
                  />
                  <span className="absolute top-3 left-3 text-xs text-white/80 bg-black/40 px-2 py-0.5 pointer-events-none">
                    Artwork
                  </span>
                  {alignPoints.p1 && artInPanel && (
                    <AlignMarker
                      x={artInPanel.x + alignPoints.p1.fx * artInPanel.w}
                      y={artInPanel.y + alignPoints.p1.fy * artInPanel.h}
                      label="1"
                      color="amber"
                    />
                  )}
                  {alignPoints.p2 && artInPanel && (
                    <AlignMarker
                      x={artInPanel.x + alignPoints.p2.fx * artInPanel.w}
                      y={artInPanel.y + alignPoints.p2.fy * artInPanel.h}
                      label="2"
                      color="cyan"
                    />
                  )}
                </div>
                {/* Right: reference */}
                <div
                  className="flex-1 relative bg-neutral-950 cursor-crosshair"
                  onPointerDown={handleReferenceClick}
                >
                  <Image
                    src={src}
                    alt={`Reference: ${alt}`}
                    fill
                    className="object-contain pointer-events-none"
                    sizes="50vw"
                  />
                  <span className="absolute top-3 left-3 text-xs text-white/80 bg-black/40 px-2 py-0.5 pointer-events-none">
                    Reference
                  </span>
                  {alignPoints.q1 && refInPanel && (
                    <AlignMarker
                      x={refInPanel.x + alignPoints.q1.fx * refInPanel.w}
                      y={refInPanel.y + alignPoints.q1.fy * refInPanel.h}
                      label="1"
                      color="amber"
                    />
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Artwork — object-cover so centers align */}
                <Image
                  src={currentArtworkUrl}
                  alt={alt}
                  fill
                  className="object-cover"
                  sizes="100vw"
                  priority
                  onLoad={onArtworkLoad}
                />

                {/* Reference layer — clipped (split modes) or full with opacity (overlay) */}
                <div
                  className="absolute inset-0"
                  style={
                    compareMode === "horizontal"
                      ? { clipPath: `inset(0 0 0 ${dividerPos}%)` }
                      : compareMode === "vertical"
                        ? { clipPath: `inset(${dividerPos}% 0 0 0)` }
                        : { opacity: overlayOpacity / 100, pointerEvents: "none" }
                  }
                >
                  <div
                    className="absolute inset-0"
                    style={{ transform: `translate(${refOffset.x}px, ${refOffset.y}px) rotate(${refRotation}deg) scale(${refScale / 100})`, transformOrigin: "center" }}
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
                  {compareMode === "overlay" ? "Reference (overlay)" : "Reference"}
                </span>

                {compareMode === "horizontal" && (
                  <>
                    {/* Pan overlay on the reference side */}
                    <div
                      className="absolute top-0 bottom-0 cursor-grab active:cursor-grabbing"
                      style={{ left: `${dividerPos}%`, right: 0 }}
                      onPointerDown={startPan}
                      onPointerMove={onPan}
                      onPointerUp={stopPan}
                      onPointerCancel={stopPan}
                    />

                    {/* Draggable divider — vertical line */}
                    <div
                      className="absolute top-0 bottom-0 w-px bg-white/80 cursor-col-resize"
                      style={{ left: `${dividerPos}%` }}
                      onPointerDown={startDividerDrag}
                      onPointerMove={onDividerMove}
                      onPointerUp={stopDividerDrag}
                      onPointerCancel={stopDividerDrag}
                    >
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 bg-white rounded-full flex items-center justify-center text-neutral-600 shadow-lg text-sm cursor-col-resize touch-none"
                        onPointerDown={startDividerDrag}
                        onPointerMove={onDividerMove}
                        onPointerUp={stopDividerDrag}
                        onPointerCancel={stopDividerDrag}
                      >
                        ↔
                      </div>
                    </div>
                  </>
                )}

                {compareMode === "vertical" && (
                  <>
                    {/* Pan overlay on the reference side (below divider) */}
                    <div
                      className="absolute left-0 right-0 cursor-grab active:cursor-grabbing"
                      style={{ top: `${dividerPos}%`, bottom: 0 }}
                      onPointerDown={startPan}
                      onPointerMove={onPan}
                      onPointerUp={stopPan}
                      onPointerCancel={stopPan}
                    />

                    {/* Draggable divider — horizontal line */}
                    <div
                      className="absolute left-0 right-0 h-px bg-white/80 cursor-row-resize"
                      style={{ top: `${dividerPos}%` }}
                      onPointerDown={startDividerDrag}
                      onPointerMove={onDividerMove}
                      onPointerUp={stopDividerDrag}
                      onPointerCancel={stopDividerDrag}
                    >
                      <div
                        className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full flex items-center justify-center text-neutral-600 shadow-lg text-sm cursor-row-resize touch-none"
                        onPointerDown={startDividerDrag}
                        onPointerMove={onDividerMove}
                        onPointerUp={stopDividerDrag}
                        onPointerCancel={stopDividerDrag}
                      >
                        ↕
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* Instruction banner — only while aligning */}
            {alignStep > 0 && (
              <div className="absolute top-0 left-0 right-0 flex items-center gap-3 px-4 py-2 bg-black/70 pointer-events-none">
                <span className="text-xs text-white flex-1">
                  {alignError ? (
                    <span className="text-amber-300">{alignError}</span>
                  ) : (
                    <>
                      <span className="text-neutral-400">Step {alignStep}/4 — </span>
                      {alignInstruction(alignStep)}
                    </>
                  )}
                </span>
                <button
                  onClick={cancelAlign}
                  className="text-xs text-neutral-300 hover:text-white px-2 py-1 shrink-0 pointer-events-auto"
                  aria-label="Cancel alignment"
                >
                  cancel
                </button>
              </div>
            )}
          </div>

          {/* Controls bar */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-1 bg-neutral-900 border-t border-neutral-700">
            <span className="text-xs text-neutral-400 truncate flex-1 min-w-0">Ref — {caption}</span>

            {alignStep === 0 && (
              <>
                {/* Mode switcher */}
                <div className="flex items-center shrink-0 border border-neutral-700">
                  {(["horizontal", "vertical", "overlay"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setCompareMode(m)}
                      className={`w-10 h-10 flex items-center justify-center text-sm transition-colors ${
                        compareMode === m
                          ? "bg-neutral-700 text-white"
                          : "text-neutral-400 hover:text-white"
                      }`}
                      aria-label={`${m} compare mode`}
                      aria-pressed={compareMode === m}
                    >
                      {m === "horizontal" ? "↔" : m === "vertical" ? "↕" : "⧉"}
                    </button>
                  ))}
                </div>

                {compareMode === "overlay" ? (
                  /* Opacity: − value + */
                  <div className="flex items-center shrink-0">
                    <button
                      onClick={() => setOverlayOpacity((o) => Math.max(0, o - 5))}
                      className="w-10 h-10 flex items-center justify-center text-neutral-300 hover:text-white active:bg-neutral-700 transition-colors text-lg font-medium"
                      aria-label="Decrease overlay opacity"
                    >−</button>
                    <span className="w-12 text-center text-xs text-neutral-300 tabular-nums shrink-0">{overlayOpacity}%</span>
                    <button
                      onClick={() => setOverlayOpacity((o) => Math.min(100, o + 5))}
                      className="w-10 h-10 flex items-center justify-center text-neutral-300 hover:text-white active:bg-neutral-700 transition-colors text-lg font-medium"
                      aria-label="Increase overlay opacity"
                    >+</button>
                  </div>
                ) : (
                  <>
                    {/* Scale: − value + */}
                    <div className="flex items-center shrink-0">
                      <button
                        onClick={() => setRefScale((s) => Math.max(50, s - 1))}
                        className="w-10 h-10 flex items-center justify-center text-neutral-300 hover:text-white active:bg-neutral-700 transition-colors text-lg font-medium"
                        aria-label="Decrease scale"
                      >−</button>
                      <span className="w-12 text-center text-xs text-neutral-300 tabular-nums shrink-0">{Math.round(refScale)}%</span>
                      <button
                        onClick={() => setRefScale((s) => Math.min(200, s + 5))}
                        className="w-10 h-10 flex items-center justify-center text-neutral-300 hover:text-white active:bg-neutral-700 transition-colors text-lg font-medium"
                        aria-label="Increase scale"
                      >+</button>
                    </div>

                    {/* Align via two click pairs */}
                    <button
                      onClick={startAlign}
                      className="h-10 px-3 text-xs text-neutral-300 hover:text-white active:text-white transition-colors shrink-0"
                      aria-label="Align by clicking two corresponding points on each image"
                    >
                      align
                    </button>

                    {/* Reset scale + offset + rotation */}
                    <button
                      onClick={() => { setRefScale(100); setRefOffset({ x: 0, y: 0 }); setRefRotation(0); }}
                      className="h-10 px-3 text-xs text-neutral-500 hover:text-neutral-200 active:text-white transition-colors shrink-0"
                      aria-label="Reset scale, position, and rotation"
                    >
                      reset
                    </button>
                  </>
                )}
              </>
            )}

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
