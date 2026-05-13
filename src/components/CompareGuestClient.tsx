"use client";

import { useEffect, useRef, useState } from "react";
import CompareSurface from "./CompareSurface";

type PickedImage = { url: string; width: number; height: number };
type Stage = "pick-painting" | "pick-reference" | "comparing";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SOFT_SIZE_LIMIT = 25 * 1024 * 1024;

export default function CompareGuestClient() {
  const [stage, setStage] = useState<Stage>("pick-painting");
  const [painting, setPainting] = useState<PickedImage | null>(null);
  const [reference, setReference] = useState<PickedImage | null>(null);

  // Track the most recent picks so the unmount cleanup can revoke them without re-running on every state change.
  const latest = useRef({ painting, reference });
  useEffect(() => { latest.current = { painting, reference }; }, [painting, reference]);

  // Final cleanup — revoke any object URLs still in play when the page unmounts.
  useEffect(() => {
    return () => {
      if (latest.current.painting) URL.revokeObjectURL(latest.current.painting.url);
      if (latest.current.reference) URL.revokeObjectURL(latest.current.reference.url);
    };
  }, []);

  function resetAll() {
    if (painting) URL.revokeObjectURL(painting.url);
    if (reference) URL.revokeObjectURL(reference.url);
    setPainting(null);
    setReference(null);
    setStage("pick-painting");
  }

  function replacePainting(next: PickedImage | null) {
    if (painting) URL.revokeObjectURL(painting.url);
    setPainting(next);
  }

  function replaceReference(next: PickedImage | null) {
    if (reference) URL.revokeObjectURL(reference.url);
    setReference(next);
  }

  if (stage === "comparing" && painting && reference) {
    return (
      <CompareSurface
        artworkUrl={painting.url}
        referenceUrl={reference.url}
        referenceWidth={reference.width}
        referenceHeight={reference.height}
        referenceCaption="Reference"
        alt="Your painting"
        onClose={resetAll}
      />
    );
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-neutral-950 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold text-neutral-100 mb-1">Compare paintings</h1>
        <p className="text-sm text-neutral-400 mb-6">
          Drop in your painting and a reference photo. Both stay in your browser — nothing is uploaded.
        </p>

        <Breadcrumb
          stage={stage}
          onGoTo={(s) => {
            if (s === "pick-painting") setStage("pick-painting");
            if (s === "pick-reference" && painting) setStage("pick-reference");
          }}
          hasPainting={!!painting}
          hasReference={!!reference}
        />

        {stage === "pick-painting" && (
          <PickStep
            label="Your painting"
            hint="A photo or scan of your work-in-progress."
            picked={painting}
            onPick={replacePainting}
            onContinue={() => setStage("pick-reference")}
          />
        )}

        {stage === "pick-reference" && (
          <PickStep
            label="Reference photo"
            hint="The image you’re painting from."
            picked={reference}
            onPick={replaceReference}
            onContinue={() => setStage("comparing")}
            onBack={() => setStage("pick-painting")}
          />
        )}
      </div>
    </div>
  );
}

function Breadcrumb({
  stage,
  onGoTo,
  hasPainting,
  hasReference,
}: {
  stage: Stage;
  onGoTo: (s: Stage) => void;
  hasPainting: boolean;
  hasReference: boolean;
}) {
  const steps: { key: Stage; label: string; reachable: boolean }[] = [
    { key: "pick-painting", label: "1. Painting", reachable: true },
    { key: "pick-reference", label: "2. Reference", reachable: hasPainting },
    { key: "comparing", label: "3. Compare", reachable: hasPainting && hasReference },
  ];
  return (
    <ol className="flex items-center gap-2 text-xs text-neutral-500 mb-6">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden>·</span>}
          {s.reachable && s.key !== "comparing" ? (
            <button
              onClick={() => onGoTo(s.key)}
              className={`underline-offset-2 hover:underline ${stage === s.key ? "text-neutral-100 font-medium" : ""}`}
            >
              {s.label}
            </button>
          ) : (
            <span className={stage === s.key ? "text-neutral-100 font-medium" : ""}>{s.label}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function PickStep({
  label,
  hint,
  picked,
  onPick,
  onContinue,
  onBack,
}: {
  label: string;
  hint: string;
  picked: PickedImage | null;
  onPick: (next: PickedImage | null) => void;
  onContinue: () => void;
  onBack?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [sizeWarning, setSizeWarning] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFile(file: File) {
    setError(null);
    setSizeWarning(false);
    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Please pick a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > SOFT_SIZE_LIMIT) setSizeWarning(true);
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      onPick({ url, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Could not read that image.");
    };
    img.src = url;
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-6 shadow-lg">
      <div className="mb-4">
        <h2 className="text-base font-medium text-neutral-100">{label}</h2>
        <p className="text-xs text-neutral-400 mt-0.5">{hint}</p>
      </div>

      {picked ? (
        <div className="flex items-center gap-4 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={picked.url}
            alt=""
            className="w-28 h-28 object-contain bg-neutral-950 border border-neutral-800"
          />
          <div className="flex flex-col gap-1 text-xs text-neutral-400">
            <span>{picked.width} × {picked.height}</span>
            <button
              onClick={() => { onPick(null); setSizeWarning(false); }}
              className="self-start text-neutral-400 hover:text-neutral-100 underline"
            >
              Change
            </button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`border-2 border-dashed ${dragOver ? "border-neutral-400 bg-neutral-800" : "border-neutral-700"} px-6 py-10 flex flex-col items-center text-center mb-4 transition-colors`}
        >
          <p className="text-sm text-neutral-400 mb-3">Drop an image here, or</p>
          <button
            onClick={() => inputRef.current?.click()}
            className="text-sm bg-neutral-100 text-neutral-900 px-4 py-2 hover:bg-white transition-colors"
          >
            Choose file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onInputChange}
          />
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      {sizeWarning && picked && (
        <p className="text-xs text-amber-400 mb-3">Large image — performance may suffer in the compare view.</p>
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-800">
        {onBack ? (
          <button
            onClick={onBack}
            className="text-xs text-neutral-400 hover:text-neutral-100"
          >
            ← Back
          </button>
        ) : <span />}
        <button
          onClick={onContinue}
          disabled={!picked}
          className="text-sm bg-neutral-100 text-neutral-900 px-4 py-2 disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed hover:bg-white transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
