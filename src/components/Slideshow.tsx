"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Artwork } from "@/data/types";

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const INTERVAL_MS = 6000;
const FADE_MS = 600;

export default function Slideshow({ artworks, onClose }: { artworks: Artwork[]; onClose: () => void }) {
  const [order] = useState(() => shuffle(artworks));
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const goTo = useCallback((next: number) => {
    clearTimeout(fadeTimer.current);
    setVisible(false);
    fadeTimer.current = setTimeout(() => {
      setIndex(next);
      setVisible(true);
    }, FADE_MS);
  }, []);

  // Auto-advance; resets timer whenever index changes
  useEffect(() => {
    const t = setTimeout(
      () => goTo((index + 1) % order.length),
      INTERVAL_MS,
    );
    return () => clearTimeout(t);
  }, [index, goTo, order.length]);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goTo((index + 1) % order.length);
      else if (e.key === "ArrowLeft") goTo((index - 1 + order.length) % order.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, onClose, goTo, order.length]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const artwork = order[index];
  if (!artwork) return null;

  const prev = () => goTo((index - 1 + order.length) % order.length);
  const next = () => goTo((index + 1) % order.length);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 text-white/50 hover:text-white transition-colors"
        aria-label="Close slideshow"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      {/* Image */}
      <div
        className="relative w-[90vw] h-[78vh] transition-opacity"
        style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      >
        <Image
          src={artwork.images[0].url}
          alt={artwork.title}
          fill
          className="object-contain"
          sizes="90vw"
          priority
        />
      </div>

      {/* Bottom: metadata + progress */}
      <div
        className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-3 transition-opacity"
        style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      >
        <div className="text-center">
          <p className="text-white/90 text-sm font-medium">{artwork.title}</p>
          <p className="text-white/50 text-xs mt-0.5">{artwork.medium}, {artwork.year}</p>
        </div>
        {order.length <= 20 ? (
          <div className="flex items-center gap-1">
            {order.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === index ? "w-3 bg-white/70" : "w-1 bg-white/30"
                }`}
              />
            ))}
          </div>
        ) : (
          <p className="text-white/30 text-xs">{index + 1} · {order.length}</p>
        )}
      </div>

      {/* Prev */}
      <button
        onClick={prev}
        className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
        aria-label="Previous artwork"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {/* Next */}
      <button
        onClick={next}
        className="absolute right-5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
        aria-label="Next artwork"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}
