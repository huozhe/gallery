"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { Artwork, Tag } from "@/data/types";
import { saveArtwork } from "../../actions";
import TagSelect from "./TagSelect";

type Props =
  | { mode: "edit"; artwork: Artwork; allTags: Tag[] }
  | { mode: "create"; allTags: Tag[]; nextOrder: number };

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = reject;
    img.src = url;
  });
}

export default function ArtworkForm(props: Props) {
  const router = useRouter();
  const isEdit = props.mode === "edit";
  const src = isEdit ? props.artwork : null;

  const [form, setForm] = useState({
    id: src?.id ?? "",
    title: src?.title ?? "",
    year: src?.year?.toString() ?? new Date().getFullYear().toString(),
    medium: src?.medium ?? "",
    dimensions: src?.dimensions ?? "",
    description: src?.description ?? "",
    image: src?.image ?? "",
    width: src?.width ?? 0,
    height: src?.height ?? 0,
    status: (src?.status ?? "live") as "live" | "draft" | "hidden",
    tagIds: src?.tagIds ?? [],
    referenceCaption: src?.reference?.caption ?? "",
    referenceUrl: src?.reference?.url ?? "",
    orderGlobal: src?.orderGlobal ?? (props.mode === "create" ? props.nextOrder : 0),
    orderByTag: src?.orderByTag ?? {},
  });

  const [referenceImage, setReferenceImage] = useState({
    path: src?.reference?.image ?? "",
    width: src?.reference?.imageWidth ?? 0,
    height: src?.reference?.imageHeight ?? 0,
  });

  const [idManuallySet, setIdManuallySet] = useState(isEdit);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [refUploadStatus, setRefUploadStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string>("");
  const [saving, startSave] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const refFileRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "title" && !idManuallySet) {
        next.id = slugify(value as string);
      }
      return next;
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus("uploading");
    try {
      const dims = await getImageDimensions(file);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("width", String(dims.width));
      fd.append("height", String(dims.height));
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json() as { path: string; width: number; height: number };
      setForm((f) => ({ ...f, image: data.path, width: data.width, height: data.height }));
      setUploadStatus("done");
    } catch {
      setUploadStatus("error");
    }
  }

  async function handleRefFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !form.id) return;
    setRefUploadStatus("uploading");
    try {
      const dims = await getImageDimensions(file);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("width", String(dims.width));
      fd.append("height", String(dims.height));
      fd.append("dir", `reference/${form.id}`);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json() as { path: string; width: number; height: number };
      setReferenceImage({ path: data.path, width: data.width, height: data.height });
      setRefUploadStatus("done");
    } catch {
      setRefUploadStatus("error");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startSave(async () => {
      const reference =
        form.referenceCaption.trim()
          ? {
              caption: form.referenceCaption.trim(),
              url: form.referenceUrl.trim() || undefined,
              image: referenceImage.path || undefined,
              imageWidth: referenceImage.width || undefined,
              imageHeight: referenceImage.height || undefined,
            }
          : null;

      const result = await saveArtwork({
        id: form.id,
        title: form.title,
        year: parseInt(form.year, 10),
        medium: form.medium,
        dimensions: form.dimensions || undefined,
        description: form.description || undefined,
        image: form.image,
        width: form.width,
        height: form.height,
        status: form.status,
        tagIds: form.tagIds,
        orderGlobal: form.orderGlobal,
        orderByTag: form.orderByTag,
        reference,
        isNew: !isEdit,
      });
      if (result.success) {
        router.push("/admin");
      } else {
        setError(result.error);
      }
    });
  }

  const isLandscape = form.width > 0 && form.height > 0 && form.width > form.height;

  return (
    <form onSubmit={handleSubmit} className="flex gap-0 min-h-screen">
      {/* ── Form pane ── */}
      <div className="w-[55%] border-r border-neutral-200 px-8 py-10 overflow-y-auto">
        <div className="flex items-center justify-between mb-8">
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            ← Back
          </button>
          <h1 className="text-lg font-medium">
            {isEdit ? `Edit — ${src?.title}` : "New work"}
          </h1>
          <button
            type="submit"
            disabled={saving}
            className="bg-neutral-900 text-white text-sm px-4 py-2 hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-700 border border-red-200 bg-red-50 p-3">{error}</div>
        )}

        {/* Image */}
        <section className="mb-6">
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Image</label>
          <div className="flex gap-4 items-start">
            {form.image && (
              <div className="relative w-24 h-24 bg-neutral-100 overflow-hidden shrink-0">
                <Image src={form.image} alt="Current" fill className="object-cover" />
              </div>
            )}
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900"
              >
                {form.image ? "Replace image" : "Upload image"}
              </button>
              {uploadStatus === "uploading" && <p className="text-xs text-neutral-500 mt-1">Uploading…</p>}
              {uploadStatus === "done" && <p className="text-xs text-green-700 mt-1">Uploaded ✓</p>}
              {uploadStatus === "error" && <p className="text-xs text-red-700 mt-1">Upload failed. Try again.</p>}
              {form.image && (
                <p className="text-xs text-neutral-400 mt-1 font-mono">{form.image}</p>
              )}
            </div>
          </div>
        </section>

        {/* Title + ID */}
        <section className="mb-4 space-y-3">
          <Field label="Title" required>
            <input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              className={inputCls}
              required
            />
          </Field>

          <Field label={isEdit ? "ID (slug)" : "ID / slug"} required>
            <input
              value={form.id}
              onChange={(e) => { setIdManuallySet(true); set("id", e.target.value); }}
              className={inputCls + (isEdit ? " bg-neutral-50 text-neutral-500 cursor-not-allowed" : "")}
              readOnly={isEdit}
              required
              pattern="[a-zA-Z0-9-]+"
              title="Letters, numbers, and hyphens only"
            />
          </Field>
        </section>

        {/* Core metadata */}
        <section className="mb-4 grid grid-cols-2 gap-3">
          <Field label="Year" required>
            <input
              type="number"
              value={form.year}
              onChange={(e) => set("year", e.target.value)}
              className={inputCls}
              required
              min={1800}
              max={new Date().getFullYear() + 1}
            />
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value as "live" | "draft" | "hidden")}
              className={inputCls + " bg-white"}
            >
              <option value="live">Live</option>
              <option value="draft">Draft</option>
              <option value="hidden">Hidden</option>
            </select>
          </Field>
          <Field label="Medium" required>
            <input
              value={form.medium}
              onChange={(e) => set("medium", e.target.value)}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Dimensions">
            <input
              value={form.dimensions}
              onChange={(e) => set("dimensions", e.target.value)}
              className={inputCls}
              placeholder="e.g. 24 × 36 in"
            />
          </Field>
        </section>

        {/* Tags */}
        <section className="mb-4">
          <Field label="Tags">
            <TagSelect
              selected={form.tagIds}
              allTags={props.allTags}
              onChange={(ids) => set("tagIds", ids)}
            />
          </Field>
        </section>

        {/* Description */}
        <section className="mb-4">
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={4}
              className={inputCls + " resize-y"}
              placeholder="Newlines become paragraph breaks. URLs become links automatically."
            />
          </Field>
        </section>

        {/* Reference */}
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Reference / Source</p>
          <div className="space-y-3 border border-neutral-200 p-3">
            <Field label="Caption">
              <input
                value={form.referenceCaption}
                onChange={(e) => set("referenceCaption", e.target.value)}
                className={inputCls}
                placeholder="e.g. After Harley Brown · etching · 1982"
              />
            </Field>
            <Field label="URL">
              <input
                type="url"
                value={form.referenceUrl}
                onChange={(e) => set("referenceUrl", e.target.value)}
                className={inputCls}
                placeholder="https://…"
              />
            </Field>
            <Field label="Reference image">
              <div className="flex gap-4 items-start">
                {referenceImage.path && (
                  <div className="relative w-20 h-20 bg-neutral-100 overflow-hidden shrink-0">
                    <Image src={referenceImage.path} alt="Reference" fill className="object-cover" />
                  </div>
                )}
                <div>
                  <input
                    ref={refFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleRefFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => refFileRef.current?.click()}
                    disabled={!form.id}
                    className="border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900 disabled:opacity-40"
                    title={!form.id ? "Set an ID/slug first" : undefined}
                  >
                    {referenceImage.path ? "Replace" : "Upload reference image"}
                  </button>
                  {refUploadStatus === "uploading" && <p className="text-xs text-neutral-500 mt-1">Uploading…</p>}
                  {refUploadStatus === "done" && <p className="text-xs text-green-700 mt-1">Uploaded ✓</p>}
                  {refUploadStatus === "error" && <p className="text-xs text-red-700 mt-1">Upload failed.</p>}
                  {referenceImage.path && (
                    <p className="text-xs text-neutral-400 mt-1 font-mono">{referenceImage.path}</p>
                  )}
                </div>
              </div>
            </Field>
          </div>
        </section>
      </div>

      {/* ── Preview pane ── */}
      <div className="w-[45%] px-8 py-10 bg-neutral-50 overflow-y-auto">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-6">Preview</p>

        {form.image ? (
          <div className={`bg-neutral-100 overflow-hidden mb-6 ${isLandscape ? "w-full" : "max-w-xs"}`}>
            <Image
              src={form.image}
              alt={form.title || "preview"}
              width={form.width || 800}
              height={form.height || 600}
              className="w-full h-auto object-contain"
            />
          </div>
        ) : (
          <div className="w-full h-48 bg-neutral-200 flex items-center justify-center mb-6">
            <span className="text-xs text-neutral-400">No image yet</span>
          </div>
        )}

        <div>
          <h2 className="text-2xl font-medium">{form.title || <span className="text-neutral-400">Untitled</span>}</h2>
          {(form.medium || form.year) && (
            <dl className="mt-3 space-y-1 text-sm text-neutral-600">
              {form.year && <div className="flex gap-2"><dt className="w-24 shrink-0">Year</dt><dd>{form.year}</dd></div>}
              {form.medium && <div className="flex gap-2"><dt className="w-24 shrink-0">Medium</dt><dd>{form.medium}</dd></div>}
              {form.dimensions && <div className="flex gap-2"><dt className="w-24 shrink-0">Dimensions</dt><dd>{form.dimensions}</dd></div>}
            </dl>
          )}
          {form.description && (
            <div className="mt-4 space-y-2 text-sm leading-relaxed text-neutral-700">
              {form.description.split("\n").map((line, i) => <p key={i}>{line || <>&nbsp;</>}</p>)}
            </div>
          )}
          {form.referenceCaption && (
            <div className="mt-4 pt-4 border-t border-neutral-200 text-sm text-neutral-600">
              {referenceImage.path && (
                <div className="max-w-[160px] mb-2 bg-neutral-100 overflow-hidden">
                  <Image
                    src={referenceImage.path}
                    alt="Reference"
                    width={referenceImage.width || 400}
                    height={referenceImage.height || 300}
                    className="w-full h-auto object-contain"
                  />
                </div>
              )}
              <p>{form.referenceCaption}</p>
              {form.referenceUrl && <span className="underline text-neutral-500">link</span>}
            </div>
          )}
        </div>
      </div>
    </form>
  );
}

const inputCls =
  "w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-neutral-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
