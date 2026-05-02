"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
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
import type { Artwork, Tag } from "@/data/types";
import {
  createTag,
  deleteTag,
  reorderArtworksByTag,
  updateTag,
} from "../../actions";

type Props = {
  tags: Tag[];
  artworks: Artwork[];
};

type Pane = { type: "tag"; id: string } | { type: "new" } | null;

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function TagsManager({ tags: initial, artworks }: Props) {
  const [tags, setTags] = useState(initial);
  const [pane, setPane] = useState<Pane>(null);

  const workCount = (tagId: string) =>
    artworks.filter((a) => a.tagIds.includes(tagId) && a.status !== "deleted").length;

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Left: tag list */}
      <div className="w-64 shrink-0 border-r border-neutral-200 flex flex-col">
        <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
          <span className="text-sm font-medium">Tags ({tags.length})</span>
          <button
            onClick={() => setPane({ type: "new" })}
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            + New
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {tags.map((t) => {
            const active = pane?.type === "tag" && pane.id === t.id;
            return (
              <li key={t.id}>
                <button
                  onClick={() => setPane({ type: "tag", id: t.id })}
                  className={`w-full text-left px-4 py-3 border-b border-neutral-100 hover:bg-neutral-50 transition-colors ${active ? "bg-neutral-100 font-medium" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm truncate">{t.title}</span>
                    {t.isPrimaryRoom && (
                      <span className="text-[10px] px-1 bg-neutral-800 text-white shrink-0">room</span>
                    )}
                    {!t.visible && (
                      <span className="text-[10px] text-neutral-400 shrink-0">hidden</span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-400 mt-0.5">{workCount(t.id)} works</div>
                </button>
              </li>
            );
          })}
          {tags.length === 0 && (
            <li className="px-4 py-6 text-sm text-neutral-400 text-center">No tags yet</li>
          )}
        </ul>
      </div>

      {/* Right: editor pane */}
      <div className="flex-1 overflow-y-auto">
        {pane === null && (
          <div className="flex items-center justify-center h-full text-sm text-neutral-400">
            Select a tag to edit, or create a new one.
          </div>
        )}
        {pane?.type === "new" && (
          <NewTagPane
            nextOrder={tags.length}
            onCreated={(tag) => {
              setTags((prev) => [...prev, tag]);
              setPane({ type: "tag", id: tag.id });
            }}
          />
        )}
        {pane?.type === "tag" && (
          <TagEditor
            key={pane.id}
            tag={tags.find((t) => t.id === pane.id)!}
            artworks={artworks}
            onSaved={(updated) => setTags((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))}
            onDeleted={() => {
              setTags((prev) => prev.filter((t) => t.id !== pane.id));
              setPane(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── New tag form ──────────────────────────────────────────────────────────────

function NewTagPane({ nextOrder, onCreated }: { nextOrder: number; onCreated: (t: Tag) => void }) {
  const [title, setTitle] = useState("");
  const [id, setId] = useState("");
  const [idManual, setIdManual] = useState(false);
  const [error, setError] = useState("");
  const [saving, start] = useTransition();

  function handleTitleChange(v: string) {
    setTitle(v);
    if (!idManual) setId(slugify(v));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const result = await createTag(title, id);
      if (result.success) {
        onCreated({ ...result.tag, order: nextOrder });
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="px-8 py-8 max-w-md">
      <h2 className="text-lg font-medium mb-6">New tag</h2>
      {error && <p className="mb-4 text-sm text-red-700 border border-red-200 bg-red-50 p-2">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Title" required>
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
        <Field label="ID / slug" required>
          <input
            value={id}
            onChange={(e) => { setIdManual(true); setId(e.target.value); }}
            className={inputCls}
            required
            pattern="[a-z0-9-]+"
            title="Lowercase letters, numbers, and hyphens only"
          />
        </Field>
        <button
          type="submit"
          disabled={saving || !title || !id}
          className="bg-neutral-900 text-white text-sm px-4 py-2 hover:bg-neutral-700 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create tag"}
        </button>
      </form>
    </div>
  );
}

// ── Tag editor ────────────────────────────────────────────────────────────────

function TagEditor({
  tag,
  artworks,
  onSaved,
  onDeleted,
}: {
  tag: Tag;
  artworks: Artwork[];
  onSaved: (t: Tag) => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState({
    title: tag.title,
    note: tag.note ?? "",
    visible: tag.visible,
    isPrimaryRoom: tag.isPrimaryRoom,
    order: tag.order,
  });
  const [error, setError] = useState("");
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  const tagWorks = artworks
    .filter((a) => a.tagIds.includes(tag.id) && a.status !== "deleted")
    .sort((a, b) => (a.orderByTag[tag.id] ?? 999) - (b.orderByTag[tag.id] ?? 999));

  const [localWorks, setLocalWorks] = useState(tagWorks);
  const [reordering, startReorder] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = localWorks.findIndex((w) => w.id === active.id);
    const newIdx = localWorks.findIndex((w) => w.id === over.id);
    const next = arrayMove(localWorks, oldIdx, newIdx);
    setLocalWorks(next);
    startReorder(() => reorderArtworksByTag(tag.id, next.map((w) => w.id)));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startSave(async () => {
      const result = await updateTag({ id: tag.id, ...form });
      if (result.success) {
        onSaved({ ...tag, ...form });
      } else {
        setError(result.error);
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Delete tag "${tag.title}"? Works will not be deleted but will lose this tag.`)) return;
    startDelete(async () => {
      await deleteTag(tag.id);
      onDeleted();
    });
  }

  return (
    <div className="flex gap-0 h-full">
      {/* Editor fields */}
      <div className="w-80 shrink-0 border-r border-neutral-200 px-6 py-8 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-medium truncate">{tag.title}</h2>
          <span className="text-xs text-neutral-400 font-mono ml-2">{tag.id}</span>
        </div>

        {error && <p className="mb-4 text-sm text-red-700 border border-red-200 bg-red-50 p-2">{error}</p>}

        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Title" required>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Curator note">
            <textarea
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              rows={3}
              className={inputCls + " resize-y"}
              placeholder="Shown beneath the room title on the public gallery"
            />
          </Field>
          <Field label="Display order">
            <input
              type="number"
              value={form.order}
              onChange={(e) => setForm((f) => ({ ...f, order: parseInt(e.target.value, 10) || 0 }))}
              className={inputCls}
              min={0}
            />
          </Field>

          <div className="space-y-3 pt-1">
            <Toggle
              label="Primary room"
              description="Creates a room section on the public gallery"
              checked={form.isPrimaryRoom}
              onChange={(v) => setForm((f) => ({ ...f, isPrimaryRoom: v }))}
            />
            <Toggle
              label="Visible"
              description="Hidden tags are excluded from the public gallery"
              checked={form.visible}
              onChange={(v) => setForm((f) => ({ ...f, visible: v }))}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-neutral-900 text-white text-sm px-4 py-2 hover:bg-neutral-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm text-red-700 hover:text-red-900 underline disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete tag"}
            </button>
          </div>
        </form>
      </div>

      {/* Works in this tag */}
      <div className="flex-1 px-6 py-8 overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-medium">Works in "{tag.title}" ({localWorks.length})</h3>
          {reordering && <span className="text-xs text-neutral-400">Saving order…</span>}
        </div>

        {localWorks.length === 0 ? (
          <p className="text-sm text-neutral-400">No works tagged with "{tag.title}".</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={localWorks.map((w) => w.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {localWorks.map((w) => (
                  <SortableWorkRow key={w.id} work={w} tagId={tag.id} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function SortableWorkRow({ work, tagId }: { work: Artwork; tagId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: work.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 border border-neutral-200 px-3 py-2 bg-white hover:bg-neutral-50"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-neutral-400 hover:text-neutral-700 text-sm"
        aria-label="Reorder"
      >
        ⋮⋮
      </button>
      <div className="relative w-10 h-10 bg-neutral-100 overflow-hidden shrink-0">
        <Image src={work.image} alt={work.title} fill sizes="40px" className="object-cover" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{work.title}</div>
        <div className="text-xs text-neutral-400">{work.medium} · {work.year} · pos {work.orderByTag[tagId] ?? "—"}</div>
      </div>
    </div>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function Toggle({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4"
        />
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-neutral-500">{description}</div>
      </div>
    </label>
  );
}

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

const inputCls =
  "w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900";
