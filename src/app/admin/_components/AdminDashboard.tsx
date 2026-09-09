"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
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
  purgeArtwork,
  reorderArtworks,
  restoreArtwork,
  softDeleteArtwork,
} from "../actions";

type View = "all" | "trash";

type Props = {
  view: View;
  works: Artwork[];
  tags: Tag[];
  trashCount: number;
  liveCount: number;
};

export default function AdminDashboard({
  view,
  works: initialWorks,
  tags,
  trashCount,
  liveCount,
}: Props) {
  const [works, setWorks] = useState(initialWorks);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [pending, startTransition] = useTransition();

  // When the server revalidates and sends fresh data, sync it into local state.
  // This makes delete/restore/purge reflect immediately without a manual reload.
  // Drag-reorder still works optimistically because setWorks fires before the
  // server round-trip; when the server confirms, initialWorks arrives with the
  // same order and this is a no-op visually.
  // Adjusting during render rather than in an effect avoids a second commit:
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [syncedWorks, setSyncedWorks] = useState(initialWorks);
  if (initialWorks !== syncedWorks) {
    setSyncedWorks(initialWorks);
    setWorks(initialWorks);
  }

  const tagById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return works.filter((w) => {
      if (q && !w.title.toLowerCase().includes(q) && !w.slug.toLowerCase().includes(q)) {
        return false;
      }
      if (tagFilter && !w.tagIds.includes(tagFilter)) return false;
      if (statusFilter && w.status !== statusFilter) return false;
      return true;
    });
  }, [works, search, tagFilter, statusFilter]);

  const isFiltered = !!search || !!tagFilter || !!statusFilter;
  const dragEnabled = view === "all" && !isFiltered;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = works.findIndex((w) => w.id === active.id);
    const newIdx = works.findIndex((w) => w.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(works, oldIdx, newIdx);
    setWorks(next);
    startTransition(() => {
      reorderArtworks(next.map((w) => w.id));
    });
  }

  return (
    <main className="px-8 py-10 max-w-6xl mx-auto">
      <div className="flex items-center gap-6 border-b border-neutral-200 pb-2 mb-6">
        <Link
          href="/admin"
          className={`text-sm pb-2 border-b-2 -mb-px ${
            view === "all"
              ? "border-neutral-900 text-neutral-900 font-medium"
              : "border-transparent text-neutral-500 hover:text-neutral-900"
          }`}
        >
          All ({liveCount})
        </Link>
        <Link
          href="/admin?view=trash"
          className={`text-sm pb-2 border-b-2 -mb-px ${
            view === "trash"
              ? "border-neutral-900 text-neutral-900 font-medium"
              : "border-transparent text-neutral-500 hover:text-neutral-900"
          }`}
        >
          Trash ({trashCount})
        </Link>
        <div className="ml-auto">
          <Link
            href="/admin/works/new"
            className="text-sm bg-neutral-900 text-white px-3 py-1.5 hover:bg-neutral-700"
          >
            + New work
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or id…"
          className="border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 bg-white w-64 focus:outline-none focus:border-neutral-900"
        />
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900 bg-white"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        {view === "all" && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-neutral-300 px-2 py-1.5 text-sm text-neutral-900 bg-white"
          >
            <option value="">All status</option>
            <option value="live">Live</option>
            <option value="draft">Draft</option>
            <option value="hidden">Hidden</option>
          </select>
        )}
        {isFiltered && (
          <button
            onClick={() => {
              setSearch("");
              setTagFilter("");
              setStatusFilter("");
            }}
            className="text-xs text-neutral-500 underline hover:text-neutral-900"
          >
            Clear filters
          </button>
        )}
        {pending && <span className="text-xs text-neutral-400">Saving…</span>}
      </div>

      {!dragEnabled && view === "all" && (
        <p className="text-xs text-neutral-500 mb-3">
          Drag-reorder is disabled while filters are active.
        </p>
      )}

      <div className="overflow-x-auto">
      <div className="border border-neutral-200 min-w-[860px]">
        <div className="grid grid-cols-[24px_72px_1fr_120px_56px_160px_76px_160px] gap-3 px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-200 bg-neutral-50 [color-scheme:light]">
          <div></div>
          <div></div>
          <div>Title</div>
          <div>Medium</div>
          <div>Year</div>
          <div>Tags</div>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-3 py-12 text-center text-sm text-neutral-500">
            {view === "trash" ? "Trash is empty." : "No works match your filters."}
          </div>
        ) : dragEnabled ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={filtered.map((w) => w.id)} strategy={verticalListSortingStrategy}>
              {filtered.map((w) => (
                <SortableRow key={w.id} work={w} tagById={tagById} view={view} />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          filtered.map((w) => <Row key={w.id} work={w} tagById={tagById} view={view} />)
        )}
      </div>
      </div>

    </main>
  );
}

function Row({
  work,
  tagById,
  view,
  dragHandle,
  setNodeRef,
  style,
}: {
  work: Artwork;
  tagById: Map<string, Tag>;
  view: View;
  dragHandle?: React.ReactNode;
  setNodeRef?: (el: HTMLElement | null) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="grid grid-cols-[24px_72px_1fr_120px_56px_160px_76px_160px] gap-3 px-3 py-2 items-center text-sm text-neutral-900 border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50 bg-white"
    >
      <div className="text-neutral-400">{dragHandle}</div>
      <div className="relative w-[60px] h-[60px] bg-neutral-100 overflow-hidden">
        <Image
          src={work.images[0]?.url ?? ""}
          alt={work.title}
          fill
          sizes="60px"
          className="object-cover"
        />
      </div>
      <div className="min-w-0">
        <div className="font-medium truncate">{work.title}</div>
        <div className="text-xs text-neutral-500 truncate">{work.slug}</div>
      </div>
      <div className="text-neutral-700 truncate min-w-0">{work.medium}</div>
      <div className="text-neutral-700">{work.year}</div>
      <div className="flex flex-wrap gap-1">
        {work.tagIds.length === 0 ? (
          <span className="text-xs text-neutral-400 italic">untagged</span>
        ) : (
          <>
            {work.tagIds.slice(0, 2).map((tid) => {
              const t = tagById.get(tid);
              return (
                <span
                  key={tid}
                  className="text-xs px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 text-neutral-700 whitespace-nowrap"
                >
                  {t?.title ?? tid}
                </span>
              );
            })}
            {work.tagIds.length > 2 && (
              <span className="text-xs text-neutral-400">+{work.tagIds.length - 2}</span>
            )}
          </>
        )}
      </div>
      <div>
        <StatusPill status={work.status} />
      </div>
      <div className="flex justify-end gap-3 text-xs">
        {view === "all" ? (
          <>
            <Link
              href={`/admin/works/${work.id}`}
              className="text-neutral-700 hover:text-neutral-900 underline"
            >
              Edit
            </Link>
            <DeleteButton id={work.id} title={work.title} />
          </>
        ) : (
          <>
            <RestoreButton id={work.id} />
            <PurgeButton id={work.id} title={work.title} />
          </>
        )}
      </div>
    </div>
  );
}

function SortableRow({
  work,
  tagById,
  view,
}: {
  work: Artwork;
  tagById: Map<string, Tag>;
  view: View;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: work.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: isDragging ? "#fafafa" : undefined,
  };
  const handle = (
    <button
      {...attributes}
      {...listeners}
      suppressHydrationWarning
      className="cursor-grab active:cursor-grabbing text-neutral-400 hover:text-neutral-700"
      aria-label="Reorder"
    >
      ⋮⋮
    </button>
  );
  return (
    <Row
      work={work}
      tagById={tagById}
      view={view}
      dragHandle={handle}
      setNodeRef={setNodeRef}
      style={style}
    />
  );
}

function StatusPill({ status }: { status: Artwork["status"] }) {
  const cls =
    status === "live"
      ? "bg-green-50 text-green-800 border-green-200"
      : status === "draft"
        ? "bg-yellow-50 text-yellow-800 border-yellow-200"
        : status === "hidden"
          ? "bg-neutral-100 text-neutral-700 border-neutral-200"
          : "bg-red-50 text-red-700 border-red-200";
  return <span className={`text-xs px-1.5 py-0.5 border ${cls}`}>{status}</span>;
}

function DeleteButton({ id, title }: { id: number; title: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm(`Move "${title}" to trash?`)) return;
        start(() => {
          softDeleteArtwork(id);
        });
      }}
      disabled={pending}
      className="text-red-700 hover:text-red-900 underline disabled:opacity-50"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}

function RestoreButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => { restoreArtwork(id); })}
      disabled={pending}
      className="text-neutral-700 hover:text-neutral-900 underline disabled:opacity-50"
    >
      {pending ? "…" : "Restore"}
    </button>
  );
}

function PurgeButton({ id, title }: { id: number; title: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => {
        if (!confirm(`Permanently delete "${title}"? This cannot be undone.`)) return;
        start(() => { purgeArtwork(id); });
      }}
      disabled={pending}
      className="text-red-700 hover:text-red-900 underline disabled:opacity-50"
    >
      {pending ? "…" : "Purge"}
    </button>
  );
}
