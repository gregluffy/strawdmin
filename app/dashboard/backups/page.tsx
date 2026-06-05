"use client";

import { useEffect, useState } from "react";
import type { BackupMeta } from "@/lib/types";
import { formatSize } from "@/lib/format";
import { basePath } from "@/lib/api-url";

export default function BackupsPage() {
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function loadBackups() {
    setLoading(true);
    try {
      const res = await fetch(`${basePath}/api/backups`);
      if (res.ok) setBackups(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBackups(); }, []);

  async function createBackup() {
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch(`${basePath}/api/backups`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error });
        return;
      }
      setMessage({ type: "success", text: `Backup created: ${data.name}` });
      loadBackups();
    } finally {
      setCreating(false);
    }
  }

  async function restore(name: string) {
    if (!confirm(`Restore from backup "${name}"? This will overwrite all current data.`)) return;
    setRestoring(name);
    setMessage(null);
    try {
      const res = await fetch(`${basePath}/api/backups/${name}/restore`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error });
        return;
      }
      setMessage({ type: "success", text: "Restore completed successfully" });
    } finally {
      setRestoring(null);
    }
  }

  async function deleteBackup(name: string) {
    if (!confirm(`Delete backup "${name}"?`)) return;
    const res = await fetch(`${basePath}/api/backups/${name}`, { method: "DELETE" });
    if (res.ok) loadBackups();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--foreground)]">Backups</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
            Create and restore database backups
          </p>
        </div>
        <button
          onClick={createBackup}
          disabled={creating}
          className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create Backup"}
        </button>
      </div>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm border ${
            message.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-[var(--destructive)]/10 border-[var(--destructive)]/20 text-[var(--destructive)]"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50">
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Name</th>
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Size</th>
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Created</th>
              <th className="text-right px-4 py-3 text-[var(--muted-foreground)] font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--muted-foreground)]">
                  Loading...
                </td>
              </tr>
            ) : backups.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--muted-foreground)]">
                  No backups yet. Create one using the button above.
                </td>
              </tr>
            ) : (
              backups.map((b) => (
                <tr key={b.name} className="border-t border-[var(--border)] hover:bg-[var(--accent)]/50">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--foreground)]">{b.name}</td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{formatSize(b.size)}</td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)] text-xs">
                    {new Date(b.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => restore(b.name)}
                        disabled={restoring === b.name}
                        className="px-2.5 py-1 text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded border border-amber-500/20 transition-colors disabled:opacity-50"
                      >
                        {restoring === b.name ? "Restoring..." : "Restore"}
                      </button>
                      <button
                        onClick={() => deleteBackup(b.name)}
                        className="px-2.5 py-1 text-xs bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20 text-[var(--destructive)] rounded border border-[var(--destructive)]/20 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-4 bg-[var(--card)] border border-[var(--border)] rounded-xl">
        <p className="text-xs text-[var(--muted-foreground)]">
          Backups are stored as JSON files and include all table data. Restoring will delete all current
          data and replace it with the backup. Use with caution.
        </p>
      </div>
    </div>
  );
}
