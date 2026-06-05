"use client";

import { useEffect, useRef, useState } from "react";
import type { BackupMeta } from "@/lib/types";
import { formatSize } from "@/lib/format";
import { basePath } from "@/lib/api-url";

export default function BackupsPage() {
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [settingsExporting, setSettingsExporting] = useState(false);
  const [settingsImporting, setSettingsImporting] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function exportSettings() {
    setSettingsExporting(true);
    setSettingsMessage(null);
    try {
      const res = await fetch(`${basePath}/api/settings-backup`);
      if (!res.ok) {
        setSettingsMessage({ type: "error", text: "Export failed" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `strawdmin-settings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setSettingsMessage({ type: "error", text: "Export failed" });
    } finally {
      setSettingsExporting(false);
    }
  }

  async function importSettings(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!confirm(`Restore settings from "${file.name}"? This will overwrite all current app settings (FK mappings, encryption, view settings, policies) for this database.`)) return;
    setSettingsImporting(true);
    setSettingsMessage(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch(`${basePath}/api/settings-backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) {
        setSettingsMessage({ type: "error", text: data.error ?? "Import failed" });
        return;
      }
      const skipped = data.skipped_users as string[] | undefined;
      let text2 = "Settings imported successfully.";
      if (skipped && skipped.length > 0) {
        text2 += ` Note: ${skipped.length} user(s) not found and skipped: ${skipped.join(", ")}`;
      }
      setSettingsMessage({ type: "success", text: text2 });
    } catch (err) {
      setSettingsMessage({ type: "error", text: String(err) });
    } finally {
      setSettingsImporting(false);
    }
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

      {/* Settings backup section */}
      <div className="mt-8">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-[var(--foreground)]">App Settings Backup</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
            Export or import all app settings for the current database: FK display mappings, encryption settings, column view preferences, and user access policies.
          </p>
        </div>

        {settingsMessage && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm border ${
              settingsMessage.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-[var(--destructive)]/10 border-[var(--destructive)]/20 text-[var(--destructive)]"
            }`}
          >
            {settingsMessage.text}
          </div>
        )}

        <div className="border border-[var(--border)] rounded-xl p-5 bg-[var(--card)] flex flex-col gap-5">
          {/* Export */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">Export Settings</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                Download a JSON file with all settings for the current connected database.
              </p>
            </div>
            <button
              onClick={exportSettings}
              disabled={settingsExporting}
              className="shrink-0 px-4 py-2 bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] rounded-lg text-sm font-medium transition-colors border border-[var(--border)] disabled:opacity-50"
            >
              {settingsExporting ? "Exporting…" : "↓ Export"}
            </button>
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Import */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">Import Settings</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                Restore settings from a previously exported JSON file. Policies are matched by username.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={importSettings}
                className="hidden"
                id="settings-import-input"
              />
              <label
                htmlFor="settings-import-input"
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border cursor-pointer select-none ${
                  settingsImporting
                    ? "opacity-50 pointer-events-none bg-[var(--secondary)] text-[var(--foreground)] border-[var(--border)]"
                    : "bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-[var(--primary)] border-[var(--primary)]/30"
                }`}
              >
                {settingsImporting ? "Importing…" : "↑ Import"}
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
