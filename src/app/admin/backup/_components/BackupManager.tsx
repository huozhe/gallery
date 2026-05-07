"use client";

import { useState, useTransition } from "react";
import { triggerBackup, triggerRestore } from "../actions";

type BlobItem = {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: Date;
};

type Status = { ok: boolean; message: string } | null;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function backupDate(pathname: string): string {
  const m = pathname.match(/redis-(\d{4}-\d{2}-\d{2})\.json$/);
  return m ? m[1] : pathname.split("/").pop() ?? pathname;
}

export default function BackupManager({
  blobs,
  hasBlobToken,
  hasRedis,
}: {
  blobs: BlobItem[];
  hasBlobToken: boolean;
  hasRedis: boolean;
}) {
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();

  function handleBackup() {
    startTransition(async () => {
      setStatus(null);
      try {
        const result = await triggerBackup();
        setStatus({
          ok: true,
          message: result.url
            ? `Backed up ${result.keys} keys → ${result.url}`
            : `Backed up ${result.keys} keys (no Blob token — not persisted)`,
        });
      } catch (e) {
        setStatus({ ok: false, message: String(e) });
      }
    });
  }

  function handleRestore(blob: BlobItem) {
    const date = backupDate(blob.pathname);
    if (!window.confirm(`Restore from ${date}? This will overwrite all current data.`)) return;
    startTransition(async () => {
      setStatus(null);
      try {
        const result = await triggerRestore(blob.url);
        setStatus({ ok: true, message: `Restored ${result.keys} keys from ${date}.` });
      } catch (e) {
        setStatus({ ok: false, message: String(e) });
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Backup now */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleBackup}
          disabled={pending || !hasRedis}
          className="px-4 py-2 bg-neutral-900 text-white text-sm rounded hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Working…" : "Backup now"}
        </button>
        {!hasRedis && (
          <p className="text-sm text-neutral-500">Redis not configured — backup unavailable.</p>
        )}
        {hasRedis && !hasBlobToken && (
          <p className="text-sm text-neutral-500">
            Blob storage not configured — backup runs but is not persisted.
          </p>
        )}
      </div>

      {/* Status message */}
      {status && (
        <p
          className={`text-sm px-3 py-2 rounded ${
            status.ok
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {status.message}
        </p>
      )}

      {/* Backup list */}
      {blobs.length === 0 ? (
        <p className="text-sm text-neutral-500">No backups found.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 [color-scheme:light]">
              <th className="text-left py-2 pr-4 font-medium text-neutral-600">Date</th>
              <th className="text-left py-2 pr-4 font-medium text-neutral-600">Size</th>
              <th className="text-left py-2 font-medium text-neutral-600">Uploaded</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {blobs.map((blob) => (
              <tr key={blob.url} className="border-b border-neutral-100 hover:bg-neutral-50">
                <td className="py-2 pr-4 font-mono text-neutral-800">{backupDate(blob.pathname)}</td>
                <td className="py-2 pr-4 text-neutral-600">{formatBytes(blob.size)}</td>
                <td className="py-2 text-neutral-600">
                  {new Date(blob.uploadedAt).toLocaleString()}
                </td>
                <td className="py-2 pl-4 text-right">
                  <button
                    onClick={() => handleRestore(blob)}
                    disabled={pending || !hasRedis}
                    className="text-sm text-red-600 hover:text-red-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
