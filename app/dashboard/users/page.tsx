"use client";

import { useEffect, useState } from "react";
import { basePath } from "@/lib/api-url";

interface User {
  id: number;
  username: string;
  role: "admin" | "user";
  created_at: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", role: "user" as "admin" | "user" });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ password: "", role: "user" as "admin" | "user" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
              <th className="text-left px-4 py-3 text-[var(--muted-foreground)] font-medium">Created</th>
              <th className="text-right px-4 py-3 text-[var(--muted-foreground)] font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[var(--muted-foreground)]">Loading...</td></tr>
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
                <td className="px-4 py-3 text-[var(--muted-foreground)] text-xs">
                  {new Date(u.created_at).toLocaleString()}
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
    </div>
  );
}
