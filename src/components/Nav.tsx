import Link from "next/link";

export default function Nav() {
  return (
    <nav className="flex items-center justify-between px-8 py-6 border-b border-neutral-200">
      <Link href="/" className="text-lg font-medium tracking-tight hover:opacity-70 transition-opacity">
        Gallery
      </Link>
      <div className="flex gap-8 text-sm text-neutral-600">
        <Link href="/" className="hover:text-neutral-900 transition-colors">
          Work
        </Link>
        <Link href="/about" className="hover:text-neutral-900 transition-colors">
          About
        </Link>
      </div>
    </nav>
  );
}
