export default function About() {
  return (
    <main className="px-8 py-12 max-w-xl">
      <h1 className="text-2xl font-medium mb-6">About</h1>
      <div className="space-y-4 text-sm leading-relaxed text-neutral-700">
        <p>
          I paint and draw for the pleasure of looking closely at things.
        </p>
        <p>
          Based in the Bay Area, Northern California. Available for commissions and inquiries.
        </p>
      </div>
      <div className="mt-8 text-sm text-neutral-500">
        <a href="mailto:artist@example.com" className="hover:text-neutral-900 transition-colors">
          artist@example.com
        </a>
      </div>
    </main>
  );
}
