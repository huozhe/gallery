"use client";

import { useState, useTransition } from "react";
import type { AboutContent } from "@/data/types";
import { updateAbout } from "@/app/admin/actions";

export default function AboutForm({ initial }: { initial: AboutContent }) {
  const [bio, setBio] = useState(initial.bio);
  const [email, setEmail] = useState(initial.email);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await updateAbout({ bio, email });
        if (result.success) {
          setSaved(true);
        } else {
          setError(result.error);
        }
      } catch {
        setError("Unexpected error — please try again.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Bio</label>
        <p className="text-xs text-neutral-500 mb-2">Separate paragraphs with a blank line.</p>
        <textarea
          value={bio}
          onChange={(e) => { setBio(e.target.value); setSaved(false); }}
          rows={8}
          className="w-full border border-neutral-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400 resize-y"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Contact email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setSaved(false); }}
          className="w-full border border-neutral-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 bg-neutral-900 text-white text-sm rounded hover:bg-neutral-700 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-neutral-500">Saved.</span>}
      </div>
    </form>
  );
}
