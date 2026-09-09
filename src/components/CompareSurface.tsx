"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  artworkUrl: string;
  referenceUrl: string;
  referenceWidth: number;
  referenceHeight: number;
  referenceCaption: string;
  alt?: string;
  onClose: () => void;
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

function AlignMarker({ x, y, label, color, counterScale = 1 }: { x: number; y: number; label: string; color: "amber" | "cyan"; counterScale?: number }) {
  const bg = color === "amber" ? "bg-amber-400" : "bg-cyan-400";
  return (
    <div
      className={`absolute w-5 h-5 rounded-full ${bg} border-2 border-white text-[10px] text-neutral-900 font-bold flex items-center justify-center pointer-events-none shadow-md`}
      style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${counterScale})` }}
    >{label}</div>
  );
}

export default function CompareSurface({
  artworkUrl,
  referenceUrl,
  referenceWidth,
  referenceHeight,
  referenceCaption,
  alt = "Artwork",
  onClose,
}: Props) {
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
  const isDraggingDivider = useRef(false);
  const isPanning = useRef(false);
  const panOrigin = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
  const compareContainerRef = useRef<HTMLDivElement>(null);

  // Per-side pan/zoom for the alignment view. `tx`/`ty` are translation in panel-px,
  // `scale` is a multiplier. Reset when align mode opens or closes.
  const [artView, setArtView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [refView, setRefView] = useState({ scale: 1, tx: 0, ty: 0 });
  const artPointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const refPointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Pinch-gesture origin per side: distance + midpoint + view at gesture start.
  const artPinch = useRef<{ d: number; mx: number; my: number; view: { scale: number; tx: number; ty: number } } | null>(null);
  const refPinch = useRef<{ d: number; mx: number; my: number; view: { scale: number; tx: number; ty: number } } | null>(null);
  // Track single-pointer down position so we can distinguish a tap (place point) from a drag.
  const artTap = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const refTap = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // If the artwork source changes (carousel switch on the artwork page), clear cached natural size + any in-progress alignment.
  // Tracked in state rather than a ref so the reset happens during render:
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevArtworkUrl, setPrevArtworkUrl] = useState(artworkUrl);
  if (prevArtworkUrl !== artworkUrl) {
    setPrevArtworkUrl(artworkUrl);
    setArtNaturalSize(null);
    setAlignStep(0);
    setAlignPoints({ p1: null, q1: null, p2: null });
    setAlignError(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (alignStep > 0) {
          setAlignStep(0);
          setAlignPoints({ p1: null, q1: null, p2: null });
          setAlignError(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [alignStep, onClose]);

  useEffect(() => {
    if (alignStep !== 0) return;
    if (!alignPoints.p1 && !alignPoints.q1 && !alignPoints.p2) return;
    const t = setTimeout(() => {
      setAlignPoints({ p1: null, q1: null, p2: null });
    }, 1000);
    return () => clearTimeout(t);
  }, [alignStep, alignPoints]);

  useLayoutEffect(() => {
    if (!compareContainerRef.current) return;
    const el = compareContainerRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    setArtView({ scale: 1, tx: 0, ty: 0 });
    setRefView({ scale: 1, tx: 0, ty: 0 });
    setAlignStep(1);
  }

  function cancelAlign() {
    setAlignStep(0);
    setAlignPoints({ p1: null, q1: null, p2: null });
    setAlignError(null);
    setArtView({ scale: 1, tx: 0, ty: 0 });
    setRefView({ scale: 1, tx: 0, ty: 0 });
  }

  function clickToNorm(
    rect: DOMRect,
    clientX: number,
    clientY: number,
    imgW: number,
    imgH: number,
    view: { scale: number; tx: number; ty: number },
  ): NormPoint {
    // Undo the pan/zoom applied to the image layer, then project to image-natural fractions.
    const px = (clientX - rect.left - view.tx) / view.scale;
    const py = (clientY - rect.top - view.ty) / view.scale;
    const imgRect = imageRectContain(rect.width, rect.height, imgW, imgH);
    return {
      fx: Math.max(0, Math.min(1, (px - imgRect.x) / imgRect.w)),
      fy: Math.max(0, Math.min(1, (py - imgRect.y) / imgRect.h)),
    };
  }

  function placeArtworkPoint(rect: DOMRect, clientX: number, clientY: number) {
    if (alignStep !== 1 && alignStep !== 3) return;
    if (!artNaturalSize) return;
    const norm = clickToNorm(rect, clientX, clientY, artNaturalSize.w, artNaturalSize.h, artView);
    if (alignStep === 1) {
      setAlignPoints((s) => ({ ...s, p1: norm }));
      setAlignError(null);
      setAlignStep(2);
    } else {
      setAlignPoints((s) => ({ ...s, p2: norm }));
      setAlignStep(4);
    }
  }

  function placeReferencePoint(rect: DOMRect, clientX: number, clientY: number) {
    if (alignStep !== 2 && alignStep !== 4) return;
    const norm = clickToNorm(rect, clientX, clientY, referenceWidth, referenceHeight, refView);
    if (alignStep === 2) {
      setAlignPoints((s) => ({ ...s, q1: norm }));
      setAlignStep(3);
    } else {
      applyAlign(norm);
    }
  }

  const TAP_THRESHOLD = 6;

  function makeAlignPointerHandlers(
    pointers: React.RefObject<Map<number, { x: number; y: number }>>,
    pinch: React.RefObject<{ d: number; mx: number; my: number; view: { scale: number; tx: number; ty: number } } | null>,
    tap: React.RefObject<{ x: number; y: number; moved: boolean } | null>,
    getView: () => { scale: number; tx: number; ty: number },
    setView: React.Dispatch<React.SetStateAction<{ scale: number; tx: number; ty: number }>>,
    place: (rect: DOMRect, clientX: number, clientY: number) => void,
  ) {
    function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      pointers.current!.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current!.size === 1) {
        tap.current = { x: e.clientX, y: e.clientY, moved: false };
        pinch.current = null;
      } else if (pointers.current!.size === 2) {
        const pts = Array.from(pointers.current!.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        pinch.current = {
          d: Math.hypot(dx, dy) || 1,
          mx: (pts[0].x + pts[1].x) / 2,
          my: (pts[0].y + pts[1].y) / 2,
          view: getView(),
        };
        tap.current = null;
      }
    }

    function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      if (!pointers.current!.has(e.pointerId)) return;
      pointers.current!.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current!.size === 2 && pinch.current) {
        const pts = Array.from(pointers.current!.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const d = Math.hypot(dx, dy) || 1;
        const mx = (pts[0].x + pts[1].x) / 2;
        const my = (pts[0].y + pts[1].y) / 2;
        const rect = e.currentTarget.getBoundingClientRect();
        const start = pinch.current;
        const nextScale = Math.max(1, Math.min(8, start.view.scale * (d / start.d)));
        const k = nextScale / start.view.scale;
        // Keep the start-midpoint's underlying image point pinned to the live midpoint.
        const sx = start.mx - rect.left;
        const sy = start.my - rect.top;
        const tx = (mx - rect.left) - (sx - start.view.tx) * k;
        const ty = (my - rect.top) - (sy - start.view.ty) * k;
        setView({ scale: nextScale, tx, ty });
        return;
      }
      if (pointers.current!.size === 1 && tap.current) {
        const dx = e.clientX - tap.current.x;
        const dy = e.clientY - tap.current.y;
        if (Math.hypot(dx, dy) > TAP_THRESHOLD) tap.current.moved = true;
      }
    }

    function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
      const wasSingle = pointers.current!.size === 1;
      pointers.current!.delete(e.pointerId);
      if (pointers.current!.size < 2) pinch.current = null;
      if (wasSingle && tap.current && !tap.current.moved) {
        const rect = e.currentTarget.getBoundingClientRect();
        place(rect, e.clientX, e.clientY);
      }
      tap.current = null;
    }

    function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
      pointers.current!.delete(e.pointerId);
      if (pointers.current!.size < 2) pinch.current = null;
      tap.current = null;
    }

    function onWheel(e: React.WheelEvent<HTMLDivElement>) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const view = getView();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY / 200);
      const nextScale = Math.max(1, Math.min(8, view.scale * factor));
      const k = nextScale / view.scale;
      setView({
        scale: nextScale,
        tx: px - (px - view.tx) * k,
        ty: py - (py - view.ty) * k,
      });
    }

    return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onWheel };
  }

  // makeAlignPointerHandlers only closes over these refs; it reads `.current`
  // inside the pointer/wheel handlers it returns, never at call time. The rule
  // cannot see that, so it flags every ref passed in.
  /* eslint-disable react-hooks/refs */
  const artHandlers = makeAlignPointerHandlers(
    artPointers,
    artPinch,
    artTap,
    () => artView,
    setArtView,
    placeArtworkPoint,
  );
  const refHandlers = makeAlignPointerHandlers(
    refPointers,
    refPinch,
    refTap,
    () => refView,
    setRefView,
    placeReferencePoint,
  );
  /* eslint-enable react-hooks/refs */

  function applyAlign(q2Norm: NormPoint) {
    const { p1, q1, p2 } = alignPoints;
    if (!p1 || !q1 || !p2 || !compareContainerRef.current || !artNaturalSize) return;
    const rect = compareContainerRef.current.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const artR = imageRectCover(W, H, artNaturalSize.w, artNaturalSize.h);
    const refR = imageRectCover(W, H, referenceWidth, referenceHeight);

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
    ? imageRectContain(panelW, panelH, referenceWidth, referenceHeight)
    : null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div
        ref={compareContainerRef}
        className="relative flex-1 min-h-0 overflow-hidden select-none"
      >
        {alignStep > 0 ? (
          // Alignment view — split panels, both images object-contain so user sees them fully.
          // Pinch-zoom + two-finger pan; single tap places a point.
          <div className="absolute inset-0 flex">
            {/* Left: artwork */}
            <div
              className="flex-1 relative bg-neutral-950 border-r border-neutral-700 cursor-crosshair touch-none overflow-hidden"
              onPointerDown={artHandlers.onPointerDown}
              onPointerMove={artHandlers.onPointerMove}
              onPointerUp={artHandlers.onPointerUp}
              onPointerCancel={artHandlers.onPointerCancel}
              onWheel={artHandlers.onWheel}
            >
              <div
                className="absolute inset-0"
                style={{
                  transform: `translate(${artView.tx}px, ${artView.ty}px) scale(${artView.scale})`,
                  transformOrigin: "0 0",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artworkUrl}
                  alt={alt}
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  onLoad={onArtworkLoad}
                />
                {alignPoints.p1 && artInPanel && (
                  <AlignMarker
                    x={artInPanel.x + alignPoints.p1.fx * artInPanel.w}
                    y={artInPanel.y + alignPoints.p1.fy * artInPanel.h}
                    label="1"
                    color="amber"
                    counterScale={1 / artView.scale}
                  />
                )}
                {alignPoints.p2 && artInPanel && (
                  <AlignMarker
                    x={artInPanel.x + alignPoints.p2.fx * artInPanel.w}
                    y={artInPanel.y + alignPoints.p2.fy * artInPanel.h}
                    label="2"
                    color="cyan"
                    counterScale={1 / artView.scale}
                  />
                )}
              </div>
              <span className="absolute top-3 left-3 text-xs text-white/80 bg-black/40 px-2 py-0.5 pointer-events-none">
                Artwork {artView.scale > 1.01 && `· ${artView.scale.toFixed(1)}×`}
              </span>
            </div>
            {/* Right: reference */}
            <div
              className="flex-1 relative bg-neutral-950 cursor-crosshair touch-none overflow-hidden"
              onPointerDown={refHandlers.onPointerDown}
              onPointerMove={refHandlers.onPointerMove}
              onPointerUp={refHandlers.onPointerUp}
              onPointerCancel={refHandlers.onPointerCancel}
              onWheel={refHandlers.onWheel}
            >
              <div
                className="absolute inset-0"
                style={{
                  transform: `translate(${refView.tx}px, ${refView.ty}px) scale(${refView.scale})`,
                  transformOrigin: "0 0",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={referenceUrl}
                  alt={`Reference: ${alt}`}
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                />
                {alignPoints.q1 && refInPanel && (
                  <AlignMarker
                    x={refInPanel.x + alignPoints.q1.fx * refInPanel.w}
                    y={refInPanel.y + alignPoints.q1.fy * refInPanel.h}
                    label="1"
                    color="amber"
                    counterScale={1 / refView.scale}
                  />
                )}
              </div>
              <span className="absolute top-3 left-3 text-xs text-white/80 bg-black/40 px-2 py-0.5 pointer-events-none">
                Reference {refView.scale > 1.01 && `· ${refView.scale.toFixed(1)}×`}
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* Artwork — object-cover so centers align */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artworkUrl}
              alt={alt}
              className="absolute inset-0 w-full h-full object-cover"
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={referenceUrl}
                  alt={`Reference: ${alt}`}
                  className="absolute inset-0 w-full h-full object-cover"
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
        <span className="text-xs text-neutral-400 truncate flex-1 min-w-0">Ref — {referenceCaption}</span>

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
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center text-neutral-500 hover:text-neutral-100 active:text-white transition-colors text-xl shrink-0"
          aria-label="Close comparison"
        >
          ×
        </button>
      </div>
    </div>
  );
}
