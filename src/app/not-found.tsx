import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-col items-center justify-center px-8 py-24 text-center">
        <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest mb-5">
          Plate · 404
        </p>
        <p className="text-2xl text-neutral-800" style={{ fontVariant: "normal" }}>
          This plate is not in the catalog.
        </p>
        <div className="flex gap-6 mt-10 text-xs font-mono uppercase tracking-widest">
          <Link
            href="/"
            className="border-b border-neutral-800 pb-0.5 hover:text-neutral-500 hover:border-neutral-500 transition-colors"
          >
            ← Back to index
          </Link>
          <Link href="/about" className="text-neutral-400 hover:text-neutral-600 transition-colors">
            About
          </Link>
        </div>
      </main>
  );
}
