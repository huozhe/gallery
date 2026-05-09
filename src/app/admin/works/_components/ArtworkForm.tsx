"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Artwork, ArtworkImage, ArtworkReference, Tag } from "@/data/types";
import { saveArtwork } from "../../actions";
import TagSelect from "./TagSelect";

type RefDraft = {
  caption: string;
  url: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  imageFilename: string;
};

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

async function uploadFile(file: File, dir: string): Promise<{ path: string; originalPath?: string; originalFilename?: string; width: number; height: number }> {
  const dims = await getImageDimensions(file);
  const fd = new FormData();
  fd.append("file", file);
  fd.append("width", String(dims.width));
  fd.append("height", String(dims.height));
  fd.append("dir", dir);
  const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  return res.json() as Promise<{ path: string; originalPath?: string; originalFilename?: string; width: number; height: number }>;
}

// ── Sortable image card ──────────────────────────────────────────────────────

function SortableImageCard({
  id,
  image,
  isPrimary,
  onRemove,
  removeDisabled,
}: {
  id: string;
  image: ArtworkImage;
  isPrimary: boolean;
  onRemove: () => void;
  removeDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 p-2 border border-neutral-200 bg-white">
      <button
        type="button"
        className="cursor-grab text-neutral-400 hover:text-neutral-600 shrink-0"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 4h2v2H9zm4 0h2v2h-2zM9 9h2v2H9zm4 0h2v2h-2zM9 14h2v2H9zm4 0h2v2h-2z" />
        </svg>
      </button>
      <div className="relative w-16 h-16 bg-neutral-100 overflow-hidden shrink-0">
        <Image src={image.url} alt="" fill sizes="64px" className="object-cover" />
      </div>
      <div className="flex-1 min-w-0">
        {isPrimary && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400 bg-neutral-100 px-1.5 py-0.5 mr-2">primary</span>
        )}
        <p className="text-xs font-mono text-neutral-400 truncate">{image.filename || image.url}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={removeDisabled}
        className="shrink-0 text-neutral-400 hover:text-red-600 transition-colors disabled:opacity-30"
        aria-label="Remove image"
      >
        ×
      </button>
    </div>
  );
}

// ── Sortable reference card ──────────────────────────────────────────────────

function SortableReferenceCard({
  id,
  draft,
  onUpdate,
  onRemove,
  onImageUpload,
  uploading,
  uploadError,
}: {
  id: string;
  draft: RefDraft;
  onUpdate: (patch: Partial<RefDraft>) => void;
  onRemove: () => void;
  onImageUpload: (file: File) => void;
  uploading: boolean;
  uploadError: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const refFileRef = useRef<HTMLInputElement>(null);

  return (
    <div ref={setNodeRef} style={style} className="border border-neutral-200 p-3 space-y-3 bg-white">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="cursor-grab text-neutral-400 hover:text-neutral-600"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 4h2v2H9zm4 0h2v2h-2zM9 9h2v2H9zm4 0h2v2h-2zM9 14h2v2H9zm4 0h2v2h-2z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-neutral-400 hover:text-red-600 transition-colors"
        >
          Remove
        </button>
      </div>
      <Field label="Caption" required>
        <input
          value={draft.caption}
          onChange={(e) => onUpdate({ caption: e.target.value })}
          className={inputCls}
          placeholder="e.g. After Harley Brown · etching · 1982"
        />
      </Field>
      <Field label="URL">
        <input
          type="url"
          value={draft.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          className={inputCls}
          placeholder="https://…"
        />
      </Field>
      <Field label="Reference image">
        <div className="flex gap-3 items-start">
          {draft.image && (
            <div className="relative w-16 h-16 bg-neutral-100 overflow-hidden shrink-0">
              <Image src={draft.image} alt="Reference" fill sizes="64px" className="object-cover" />
            </div>
          )}
          <div>
            <input
              ref={refFileRef}
              type="file"
              accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImageUpload(f); }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => refFileRef.current?.click()}
              disabled={uploading}
              className="border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900 disabled:opacity-40"
            >
              {uploading ? "Uploading…" : draft.image ? "Replace" : "Upload reference image"}
            </button>
            {uploadError && <p className="text-xs text-red-700 mt-1">Upload failed.</p>}
            {draft.image && <p className="text-xs text-neutral-400 mt-1 font-mono truncate max-w-[240px]">{draft.image}</p>}
          </div>
        </div>
      </Field>
    </div>
  );
}

// ── Main form ────────────────────────────────────────────────────────────────

export default function ArtworkForm(props: Props) {
  const router = useRouter();
  const isEdit = props.mode === "edit";
  const src = isEdit ? props.artwork : null;

  const [pendingId] = useState(() => crypto.randomUUID());

  const [form, setForm] = useState({
    id: src?.id ?? 0,
    slug: src?.slug ?? "",
    title: src?.title ?? "",
    year: src?.year?.toString() ?? new Date().getFullYear().toString(),
    medium: src?.medium ?? "",
    dimensions: src?.dimensions ?? "",
    description: src?.description ?? "",
    blobId: src?.blobId ?? "",
    status: (src?.status ?? "live") as "live" | "draft" | "hidden",
    tagIds: src?.tagIds ?? [],
    orderGlobal: src?.orderGlobal ?? (props.mode === "create" ? props.nextOrder : 0),
    orderByTag: src?.orderByTag ?? {},
  });

  const [images, setImages] = useState<ArtworkImage[]>(src?.images ?? []);
  const [references, setReferences] = useState<RefDraft[]>(
    (src?.references ?? []).map((r) => ({
      caption: r.caption,
      url: r.url ?? "",
      image: r.image ?? "",
      imageWidth: r.imageWidth ?? 0,
      imageHeight: r.imageHeight ?? 0,
      imageFilename: r.imageFilename ?? "",
    })),
  );

  const [slugManuallySet, setSlugManuallySet] = useState(isEdit);
  const [uploadingImageIdx, setUploadingImageIdx] = useState<number | null>(null);
  const [imageUploadError, setImageUploadError] = useState(false);
  const [uploadingRefIdx, setUploadingRefIdx] = useState<number | null>(null);
  const [refUploadErrors, setRefUploadErrors] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string>("");
  const [saving, startSave] = useTransition();
  const addImageRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "title" && !slugManuallySet) {
        next.slug = slugify(value as string);
      }
      return next;
    });
  }

  async function handleAddImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const blobId = form.blobId || pendingId;
    const idx = images.length;
    setUploadingImageIdx(idx);
    setImageUploadError(false);
    try {
      const data = await uploadFile(file, `artworks/${blobId}/images`);
      setImages((prev) => [...prev, {
        url: data.path,
        originalUrl: data.originalPath,
        filename: data.originalFilename,
        width: data.width,
        height: data.height,
      }]);
    } catch {
      setImageUploadError(true);
    } finally {
      setUploadingImageIdx(null);
    }
  }

  function handleImageDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setImages((prev) => arrayMove(prev, Number(active.id), Number(over.id)));
    }
  }

  function addReference() {
    setReferences((prev) => [...prev, { caption: "", url: "", image: "", imageWidth: 0, imageHeight: 0, imageFilename: "" }]);
  }

  function updateReference(i: number, patch: Partial<RefDraft>) {
    setReferences((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function removeReference(i: number) {
    setReferences((prev) => prev.filter((_, j) => j !== i));
  }

  async function handleRefImageUpload(i: number, file: File) {
    const blobId = form.blobId || pendingId;
    setUploadingRefIdx(i);
    setRefUploadErrors((prev) => ({ ...prev, [i]: false }));
    try {
      const data = await uploadFile(file, `artworks/${blobId}/references`);
      updateReference(i, {
        image: data.path,
        imageWidth: data.width,
        imageHeight: data.height,
        imageFilename: data.originalFilename ?? "",
      });
    } catch {
      setRefUploadErrors((prev) => ({ ...prev, [i]: true }));
    } finally {
      setUploadingRefIdx(null);
    }
  }

  function handleRefDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setReferences((prev) => arrayMove(prev, Number(active.id), Number(over.id)));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (images.length === 0) {
      setError("At least one image is required.");
      return;
    }
    setError("");
    startSave(async () => {
      const refs: ArtworkReference[] = references
        .filter((r) => r.caption.trim())
        .map((r) => ({
          caption: r.caption.trim(),
          url: r.url.trim() || undefined,
          image: r.image || undefined,
          imageWidth: r.imageWidth || undefined,
          imageHeight: r.imageHeight || undefined,
          imageFilename: r.imageFilename || undefined,
        }));

      const result = await saveArtwork({
        id: form.id,
        blobId: form.blobId || pendingId,
        slug: form.slug,
        title: form.title,
        year: parseInt(form.year, 10),
        medium: form.medium,
        dimensions: form.dimensions || undefined,
        description: form.description || undefined,
        images,
        references: refs,
        status: form.status,
        tagIds: form.tagIds,
        orderGlobal: form.orderGlobal,
        orderByTag: form.orderByTag,
        isNew: !isEdit,
      });
      if (result.success) {
        router.push("/admin");
      } else {
        setError(result.error);
      }
    });
  }

  const primaryImage = images[0];
  const isLandscape = primaryImage && primaryImage.width > primaryImage.height;

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

        {/* Images */}
        <section className="mb-6">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Images</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleImageDragEnd}>
            <SortableContext items={images.map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
              <div className="space-y-2 mb-3">
                {images.map((img, i) => (
                  <SortableImageCard
                    key={img.url + i}
                    id={String(i)}
                    image={img}
                    isPrimary={i === 0}
                    onRemove={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    removeDisabled={images.length === 1}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <input
            ref={addImageRef}
            type="file"
            accept="image/*"
            onChange={handleAddImage}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => addImageRef.current?.click()}
            disabled={uploadingImageIdx !== null}
            className="border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900 disabled:opacity-40"
          >
            {uploadingImageIdx !== null ? "Uploading…" : images.length === 0 ? "Upload image" : "Add another image"}
          </button>
          {imageUploadError && <p className="text-xs text-red-700 mt-1">Upload failed. Try again.</p>}
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

          <Field label="Slug" required>
            <input
              value={form.slug}
              onChange={(e) => { setSlugManuallySet(true); set("slug", e.target.value); }}
              className={inputCls}
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
        <section className="mb-6">
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

        {/* References */}
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">References / Sources</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRefDragEnd}>
            <SortableContext items={references.map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
              <div className="space-y-3 mb-3">
                {references.map((ref, i) => (
                  <SortableReferenceCard
                    key={i}
                    id={String(i)}
                    draft={ref}
                    onUpdate={(patch) => updateReference(i, patch)}
                    onRemove={() => removeReference(i)}
                    onImageUpload={(file) => handleRefImageUpload(i, file)}
                    uploading={uploadingRefIdx === i}
                    uploadError={!!refUploadErrors[i]}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <button
            type="button"
            onClick={addReference}
            className="border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900"
          >
            Add reference
          </button>
        </section>
      </div>

      {/* ── Preview pane ── */}
      <div className="w-[45%] px-8 py-10 bg-neutral-50 overflow-y-auto">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-6">Preview</p>

        {primaryImage ? (
          <div className={`bg-neutral-100 overflow-hidden mb-2 ${isLandscape ? "w-full" : "max-w-xs"}`}>
            <Image
              src={primaryImage.url}
              alt={form.title || "preview"}
              width={primaryImage.width || 800}
              height={primaryImage.height || 600}
              className="w-full h-auto object-contain"
            />
          </div>
        ) : (
          <div className="w-full h-48 bg-neutral-200 flex items-center justify-center mb-6">
            <span className="text-xs text-neutral-400">No image yet</span>
          </div>
        )}
        {images.length > 1 && (
          <p className="text-xs text-neutral-400 mb-6">{images.length} images total</p>
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
          {references.filter((r) => r.caption).map((ref, i) => (
            <div key={i} className="mt-4 pt-4 border-t border-neutral-200 text-sm text-neutral-600">
              {ref.image && (
                <div className="max-w-[160px] mb-2 bg-neutral-100 overflow-hidden">
                  <Image
                    src={ref.image}
                    alt="Reference"
                    width={ref.imageWidth || 400}
                    height={ref.imageHeight || 300}
                    className="w-full h-auto object-contain"
                  />
                </div>
              )}
              <p>{ref.caption}</p>
              {ref.url && <span className="underline text-neutral-500">link</span>}
            </div>
          ))}
        </div>
      </div>
    </form>
  );
}

const inputCls =
  "w-full border border-neutral-300 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-900";

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
