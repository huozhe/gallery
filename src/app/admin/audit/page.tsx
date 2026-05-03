import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/store";
import type { AuditAction } from "@/data/types";

const ACTION_GROUPS: Record<string, AuditAction[]> = {
  Artwork: ["artwork.create", "artwork.update", "artwork.delete", "artwork.restore", "artwork.purge"],
  Tag: ["tag.create", "tag.update", "tag.delete"],
  About: ["about.update"],
  User: ["user.create", "user.delete"],
  Auth: ["auth.sign-in", "auth.sign-out", "auth.failed"],
};

const ACTION_COLOR: Partial<Record<AuditAction, string>> = {
  "artwork.create": "text-green-700 bg-green-50",
  "artwork.update": "text-blue-700 bg-blue-50",
  "artwork.delete": "text-red-700 bg-red-50",
  "artwork.restore": "text-yellow-700 bg-yellow-50",
  "artwork.purge": "text-red-900 bg-red-100",
  "tag.create": "text-green-700 bg-green-50",
  "tag.update": "text-blue-700 bg-blue-50",
  "tag.delete": "text-red-700 bg-red-50",
  "about.update": "text-blue-700 bg-blue-50",
  "auth.sign-in": "text-neutral-700 bg-neutral-100",
  "auth.sign-out": "text-neutral-500 bg-neutral-50",
  "auth.failed": "text-red-700 bg-red-50",
  "user.create": "text-green-700 bg-green-50",
  "user.delete": "text-red-700 bg-red-50",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const filterAction = params.action ?? "";
  const filterActor = params.actor?.toLowerCase() ?? "";

  let entries = await audit.list(500);

  if (filterAction) {
    entries = entries.filter((e) => e.action === filterAction);
  }
  if (filterActor) {
    entries = entries.filter((e) => e.actorEmail.toLowerCase().includes(filterActor));
  }

  return (
    <main className="px-8 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium">Audit log</h1>
        <span className="text-xs text-neutral-400">{entries.length} entries</span>
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-3 mb-6">
        <select
          name="action"
          defaultValue={filterAction}
          className="border border-neutral-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400 bg-white"
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_GROUPS).map(([group, actions]) => (
            <optgroup key={group} label={group}>
              {actions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <input
          type="text"
          name="actor"
          defaultValue={filterActor}
          placeholder="Filter by actor email"
          className="border border-neutral-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400 min-w-[200px]"
        />
        <button
          type="submit"
          className="px-3 py-1.5 bg-neutral-900 text-white text-sm rounded hover:bg-neutral-700"
        >
          Filter
        </button>
        {(filterAction || filterActor) && (
          <a
            href="/admin/audit"
            className="px-3 py-1.5 border border-neutral-300 text-sm rounded hover:bg-neutral-50"
          >
            Clear
          </a>
        )}
      </form>

      {/* Table */}
      {entries.length === 0 ? (
        <p className="text-sm text-neutral-400">No entries match the current filter.</p>
      ) : (
        <div className="border border-neutral-200 rounded overflow-hidden text-sm">
          <div
            style={{ colorScheme: "light" }}
            className="grid grid-cols-[180px_160px_120px_180px_1fr] gap-0 bg-neutral-50 border-b border-neutral-200"
          >
            {["Time (UTC)", "Action", "Target", "Actor", "IP"].map((h) => (
              <div key={h} className="px-3 py-2 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                {h}
              </div>
            ))}
          </div>
          {entries.map((entry, i) => (
            <div
              key={entry.id}
              className={`grid grid-cols-[180px_160px_120px_180px_1fr] gap-0 border-b border-neutral-100 last:border-0 ${
                i % 2 === 1 ? "bg-neutral-50/50" : ""
              }`}
            >
              <div className="px-3 py-2 text-xs text-neutral-500 font-mono tabular-nums whitespace-nowrap">
                {formatTime(entry.at)}
              </div>
              <div className="px-3 py-2">
                <span
                  className={`inline-block text-xs font-mono px-1.5 py-0.5 rounded ${
                    ACTION_COLOR[entry.action] ?? "text-neutral-600 bg-neutral-100"
                  }`}
                >
                  {entry.action}
                </span>
              </div>
              <div className="px-3 py-2 text-xs text-neutral-600 font-mono truncate">
                {entry.target ?? "—"}
              </div>
              <div className="px-3 py-2 text-xs text-neutral-600 truncate">
                {entry.actorEmail}
              </div>
              <div className="px-3 py-2 text-xs text-neutral-400 font-mono">
                {entry.ip ?? "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
