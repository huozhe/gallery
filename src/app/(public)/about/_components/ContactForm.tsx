"use client";

import { useState, useTransition } from "react";
import { sendContactMessage } from "../actions";

export function ContactForm() {
  const [isPending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      email: (form.elements.namedItem("email") as HTMLInputElement).value,
      message: (form.elements.namedItem("message") as HTMLTextAreaElement).value,
    };
    setError(null);
    startTransition(async () => {
      const result = await sendContactMessage(data);
      if (result.success) {
        setSent(true);
        form.reset();
      } else {
        setError(result.error);
      }
    });
  }

  if (sent) {
    return <p className="text-sm text-neutral-600">Message sent. Thank you.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="contact-name" className="block text-xs text-neutral-500 mb-1">
            Name
          </label>
          <input
            id="contact-name"
            name="name"
            type="text"
            required
            maxLength={100}
            className="w-full border border-neutral-200 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-400 transition-colors"
          />
        </div>
        <div>
          <label htmlFor="contact-email" className="block text-xs text-neutral-500 mb-1">
            Email
          </label>
          <input
            id="contact-email"
            name="email"
            type="email"
            required
            className="w-full border border-neutral-200 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-400 transition-colors"
          />
        </div>
      </div>
      <div>
        <label htmlFor="contact-message" className="block text-xs text-neutral-500 mb-1">
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          maxLength={2000}
          rows={5}
          className="w-full border border-neutral-200 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-400 transition-colors resize-y"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="px-5 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-700 transition-colors disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
