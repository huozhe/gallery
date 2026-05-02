"use client";

import { useRef, useState, useTransition } from "react";
import type { Tag } from "@/data/types";
import { createTag } from "../../actions";

type Props = {
  selected: string[];
  allTags: Tag[];
  onChange: (ids: string[]) => void;
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function TagSelect({ selected, allTags, onChange }: Props) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [localTags, setLocalTags] = useState(allTags);
  const [creating, startCreate] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const q = input.trim().toLowerCase();
  const available = localTags.filter(
    (t) => !selected.includes(t.id) && (!q || t.title.toLowerCase().includes(q))
  );
  const exactMatch = localTags.some((t) => t.title.toLowerCase() === q);
  const showCreate = q.length > 0 && !exactMatch;

  function add(id: string) {
    onChange([...selected, id]);
    setInput("");
    inputRef.current?.focus();
  }

  function remove(id: string) {
    onChange(selected.filter((s) => s !== id));
  }

  function handleCreate() {
    const title = input.trim();
    const id = slugify(title);
    if (!id) return;
    startCreate(async () => {
      const result = await createTag(title, id);
      if (result.success) {
        setLocalTags((prev) => [...prev, result.tag]);
        add(result.tag.id);
      }
    });
  }

  return (
    <div className="relative">
      <div
        className="flex flex-wrap gap-1.5 items-center border border-neutral-300 px-2 py-1.5 min-h-[38px] cursor-text"
        onClick={() => { inputRef.current?.focus(); setOpen(true); }}
      >
        {selected.map((id) => {
          const tag = localTags.find((t) => t.id === id);
          return (
            <span
              key={id}
              className="flex items-center gap-1 text-xs bg-neutral-100 border border-neutral-200 px-2 py-0.5"
            >
              {tag?.title ?? id}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); remove(id); }}
                className="text-neutral-400 hover:text-neutral-700 leading-none"
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") { e.preventDefault(); if (available[0]) add(available[0].id); else if (showCreate) handleCreate(); }
          }}
          placeholder={selected.length === 0 ? "Add tag…" : ""}
          className="outline-none text-sm flex-1 min-w-[80px] bg-transparent"
          disabled={creating}
        />
      </div>

      {open && (available.length > 0 || showCreate) && (
        <div className="absolute z-10 left-0 right-0 top-full border border-neutral-200 bg-white shadow-sm max-h-48 overflow-y-auto">
          {available.map((t) => (
            <button
              key={t.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); add(t.id); }}
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-neutral-50"
            >
              {t.title}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleCreate(); }}
              className="block w-full text-left px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-50 border-t border-neutral-100"
            >
              {creating ? "Creating…" : `+ Create "${input.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
