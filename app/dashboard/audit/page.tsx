"use client";

import { useEffect, useState, useCallback } from "react";
import { basePath } from "@/lib/api-url";
import { formatRelativeTime } from "@/lib/format";
import type { AuditLog } from "@/lib/types";

const ACTION_STYLES: Record<string, string> = {
  INSERT: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  UPDATE: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  DELETE: "bg-[var(--destructive)]/15 text-[var(--destructive)] border border-[var(--destructive)]/20",
  LOGIN: "bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/20",
  LOGIN_FAILED: "bg-orange-500/15 text-orange-400 border border-orange-500/20",
};

const PAGE_SIZE = 50;

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [filters, setFilters] = useState({
    action: "",
    table: "",
    username: "",
    from: "",
    to: "",
  });
  const [applied, setApplied] = useState(filters);

  const load = useCallback(async (p: number, f: typeof filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      if (f.action) params.set("action", f.action);
      if (f.table) params.set("table", f.table);
      if (f.username) params.set("username", f.username);
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      const res = await fetch(`${basePath}/api/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page, applied); }, [load, page, applied]);

  function applyFilters() {
    setPage(1);
    setApplied(filters);
  }

  function clearFilters() {
    const empty = { action: "", table: "", username: "", from: "", to: "" };
    setFilters(empty);
    setPage(1);
    setApplied(empty);
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasActiveFilters = Object.values(applied).some(Boolean);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--foreground)]">Audit Log</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
          {total > 0 ? `${total.toLocaleString()} events recorded` : "All actions performed in this database"}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 p-4 bg-[var(--card)] border border-[var(--border)] rounded-xl">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">Action</label>
            <select
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              <option value="">All actions</option>
              <option value="INSERT">INSERT</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
              <option value="LOGIN">LOGIN</option>
              <option value="LOGIN_FAILED">LOGIN_FAILED</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">Table</label>
            <input
              type="text"
              value={filters.table}
              onChange={(e) => setFilters({ ...filters, table: e.target.value })}
              placeholder="table name"
              className="px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">Username</label>
            <input
              type="text"
              value={filters.username}
              onChange={(e) => setFilters({ ...filters, username: e.target.value })}
              placeholder="username"
              className="px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm w-36 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={applyFilters}
              className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Filter
            </button>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="px-4 py-2 bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] rounded-lg text-sm border border-[var(--border)] transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50">
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium w-8" />
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Action</th>
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">User</th>
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Table</th>
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Record</th>
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">IP</th>
              <th className="text-right px-4 py-3 text-[var(--muted-foreground)] font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--muted-foreground)]">
                  Loading...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--muted-foreground)]">
                  No audit events found
                </td>
              </tr>
            ) : logs.map((log) => {
              const isOpen = expanded.has(log.id);
              const hasChanges = log.changes && (log.changes.before || log.changes.after);
              return [
                <tr
                  key={log.id}
                  className={`border-t border-[var(--border)] ${hasChanges ? "cursor-pointer hover:bg-[var(--accent)]/50" : ""} ${isOpen ? "bg-[var(--accent)]/30" : ""}`}
                  onClick={() => hasChanges && toggleExpand(log.id)}
                >
                  <td className="px-4 py-3 text-center text-[var(--muted-foreground)]">
                    {hasChanges && (
                      <span className="text-xs">{isOpen ? "▼" : "▶"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium font-mono ${ACTION_STYLES[log.action] ?? ""}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--foreground)] font-medium">{log.username}</td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)] font-mono text-xs">
                    {log.table_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)] font-mono text-xs">
                    {log.record_id ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)] text-xs">
                    {log.ip ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--muted-foreground)] text-xs" title={new Date(log.created_at).toLocaleString()}>
                    {formatRelativeTime(log.created_at)}
                  </td>
                </tr>,
                isOpen && hasChanges && (
                  <tr key={`${log.id}-detail`} className="border-t border-[var(--border)] bg-[var(--accent)]/20">
                    <td colSpan={7} className="px-4 py-3">
                      <div className="flex gap-4 flex-wrap">
                        {log.changes?.before && (
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-[var(--destructive)] mb-1.5">Before</p>
                            <pre className="text-xs bg-[var(--card)] border border-[var(--border)] rounded-lg p-3 overflow-auto max-h-48 text-[var(--foreground)] whitespace-pre-wrap break-all">
                              {JSON.stringify(log.changes.before, null, 2)}
                            </pre>
                          </div>
                        )}
                        {log.changes?.after && (
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-emerald-400 mb-1.5">After</p>
                            <pre className="text-xs bg-[var(--card)] border border-[var(--border)] rounded-lg p-3 overflow-auto max-h-48 text-[var(--foreground)] whitespace-pre-wrap break-all">
                              {JSON.stringify(log.changes.after, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-[var(--muted-foreground)]">
            Page {page} of {totalPages} &mdash; {total.toLocaleString()} events
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1.5 text-sm bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] rounded border border-[var(--border)] disabled:opacity-40 transition-colors"
            >
              ← Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 text-sm bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] rounded border border-[var(--border)] disabled:opacity-40 transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
