"use client";

import { useEffect, useState } from "react";
import { basePath } from "@/lib/api-url";
import { formatDateTime } from "@/lib/format";

type DbAccessMode = "all" | "restricted";

interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  created_at: string;
  mode: DbAccessMode;
  conn_ids: number[];
}

interface DbConnOption {
  id: number;
  name: string;
  db_type: string;
}

const DB_TYPE_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mssql: "SQL Server",
  sqlite: "SQLite",
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", role: "user" as "admin" | "user" });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ password: "", role: "user" as "admin" | "user" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [connections, setConnections] = useState<DbConnOption[]>([]);
  const [accessUser, setAccessUser] = useState<User | null>(null);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch(`${basePath}/api/users`);
      if (res.ok) setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  // `all=1` — the full list, including connections this admin has hidden from themselves
  useEffect(() => {
    fetch(`${basePath}/api/db-connections?all=1`)
      .then((r) => r.json())
      .then((data) => setConnections(data.connections ?? []))
      .catch(() => {});
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`${basePath}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setShowCreate(false);
      setForm({ username: "", password: "", role: "user" });
      loadUsers();
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(id: number) {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`${basePath}/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setEditId(null);
      loadUsers();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this user?")) return;
    await fetch(`${basePath}/api/users/${id}`, { method: "DELETE" });
    loadUsers();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--foreground)]">User Management</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">Manage admin and user accounts</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New User
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
          <h2 className="font-semibold text-[var(--foreground)] mb-4">Create User</h2>
          <form onSubmit={handleCreate} className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted-foreground)] mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "user" })}
                className="px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </form>
          {error && <p className="text-[var(--destructive)] text-sm mt-2">{error}</p>}
        </div>
      )}

      <div className="border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50">
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Username</th>
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Role</th>
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Databases</th>
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Created</th>
              <th className="text-right px-4 py-3 text-[var(--muted-foreground)] font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--muted-foreground)]">Loading...</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--border)] hover:bg-[var(--accent)]/50">
                <td className="px-4 py-3 font-medium text-[var(--foreground)]">{u.username}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    u.role === "admin"
                      ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                      : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                  }`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setAccessUser(u)}
                    title="Choose which database connections this account can see"
                    className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                      u.mode === "restricted"
                        ? "bg-amber-500/15 text-amber-500 border-amber-500/25 hover:bg-amber-500/25"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)] border-transparent hover:bg-[var(--accent)]"
                    }`}
                  >
                    {u.mode === "restricted"
                      ? `${u.conn_ids.length} of ${connections.length}`
                      : "All databases"}
                  </button>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)] text-xs">
                  {formatDateTime(u.created_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  {editId === u.id ? (
                    <div className="flex items-center gap-2 justify-end flex-wrap">
                      <input
                        type="password"
                        value={editForm.password}
                        onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                        placeholder="New password"
                        className="px-2 py-1 bg-[var(--input)] border border-[var(--border)] rounded text-[var(--foreground)] text-xs w-32 focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                      />
                      <select
                        value={editForm.role}
                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value as "admin" | "user" })}
                        className="px-2 py-1 bg-[var(--input)] border border-[var(--border)] rounded text-[var(--foreground)] text-xs focus:outline-none"
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                      <button onClick={() => handleEdit(u.id)} disabled={saving} className="px-2.5 py-1 bg-[var(--primary)] text-white rounded text-xs disabled:opacity-50">Save</button>
                      <button onClick={() => setEditId(null)} className="px-2.5 py-1 bg-[var(--secondary)] text-[var(--foreground)] rounded text-xs border border-[var(--border)]">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => { setEditId(u.id); setEditForm({ password: "", role: u.role }); }}
                        className="px-2.5 py-1 text-xs bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] rounded transition-colors border border-[var(--border)]"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(u.id)}
                        className="px-2.5 py-1 text-xs bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20 text-[var(--destructive)] rounded border border-[var(--destructive)]/20 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {accessUser && (
        <DbAccessModal
          user={accessUser}
          connections={connections}
          onClose={() => setAccessUser(null)}
          onSaved={() => { setAccessUser(null); loadUsers(); }}
        />
      )}
    </div>
  );
}

// ── Database access modal ───────────────────────────────────────────────────

interface DbAccessModalProps {
  user: User;
  connections: DbConnOption[];
  onClose: () => void;
  onSaved: () => void;
}

function DbAccessModal({ user, connections, onClose, onSaved }: DbAccessModalProps) {
  const [mode, setMode] = useState<DbAccessMode>(user.mode);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(user.conn_ids));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${basePath}/api/users/${user.id}/db-access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, conn_ids: [...selected] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save.");
        return;
      }
      onSaved();
    } catch {
      setError("Request failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-0.5">Database access</p>
            <h2 className="font-semibold text-[var(--foreground)]">{user.username}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            Controls which connections this account can switch to and read from. Admins are
            restricted the same way as regular users — including themselves.
          </p>

          <div className="flex flex-col gap-2">
            {(["all", "restricted"] as DbAccessMode[]).map((m) => (
              <label
                key={m}
                className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  mode === m
                    ? "border-[var(--primary)]/50 bg-[var(--primary)]/10"
                    : "border-[var(--border)] hover:bg-[var(--accent)]"
                }`}
              >
                <input
                  type="radio"
                  name="db_access_mode"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-sm text-[var(--foreground)]">
                    {m === "all" ? "All databases" : "Only selected databases"}
                  </span>
                  <span className="block text-xs text-[var(--muted-foreground)]">
                    {m === "all"
                      ? "Sees every connection, including ones added later."
                      : "Sees only what you tick below."}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {mode === "restricted" && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  Connections
                  <span className="ml-1.5 text-[var(--primary)] font-mono normal-case">
                    ({selected.size}/{connections.length})
                  </span>
                </span>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(connections.map((c) => c.id)))}
                    className="text-[var(--primary)] hover:underline"
                  >
                    All
                  </button>
                  <span className="text-[var(--border)]">·</span>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline transition-colors"
                  >
                    None
                  </button>
                </div>
              </div>
              {connections.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)] py-2">No database connections configured yet.</p>
              ) : (
                connections.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-[var(--accent)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="w-3.5 h-3.5 rounded accent-[var(--primary)] cursor-pointer"
                    />
                    <span className="text-sm text-[var(--foreground)] flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-[var(--muted-foreground)] shrink-0">
                      {DB_TYPE_LABELS[c.db_type] ?? c.db_type}
                    </span>
                  </label>
                ))
              )}
              {selected.size === 0 && connections.length > 0 && (
                <p className="text-xs text-amber-500 mt-1">
                  With nothing selected this account will see no databases at all.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] border border-[var(--border)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white font-medium transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
