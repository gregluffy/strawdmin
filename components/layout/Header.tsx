"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { basePath } from "@/lib/api-url";

interface User {
  id: number;
  username: string;
  role: string;
}

interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion?: string;
  latestVersion?: string;
  releaseUrl?: string;
}

interface DbConn {
  id: number;
  name: string;
  db_type: string;
  connection_string?: string;
  is_active: boolean;
}

type DbType = "postgres" | "mysql" | "mariadb" | "mssql" | "sqlite";

const DB_TYPE_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mssql: "SQL Server",
  sqlite: "SQLite",
};

const DB_TYPE_ICONS: Record<string, string> = {
  postgres: "🐘",
  mysql: "🐬",
  mariadb: "🦭",
  mssql: "🪟",
  sqlite: "🗄️",
};

function DbTypeIcon({ type }: { type: string }) {
  return <span title={DB_TYPE_LABELS[type] ?? type}>{DB_TYPE_ICONS[type] ?? "🗄️"}</span>;
}

export function Header() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // DB connections state
  const [connections, setConnections] = useState<DbConn[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [dbMenuOpen, setDbMenuOpen] = useState(false);
  const [dbMenuPos, setDbMenuPos] = useState({ top: 0, left: 0 });
  const dbButtonRef = useRef<HTMLButtonElement>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const fetchConnections = useCallback(() => {
    fetch(`${basePath}/api/db-connections`)
      .then((r) => r.json())
      .then((data) => {
        setConnections(data.connections ?? []);
        setActiveId(data.active_id ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${basePath}/api/auth/me`).then((r) => r.json()).then(setUser).catch(() => {});
    fetch(`${basePath}/api/updates`).then((r) => r.json()).then(setUpdate).catch(() => {});
    fetchConnections();
  }, [fetchConnections]);

  function toggleMenu() {
    if (!menuOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setMenuOpen((o) => !o);
  }

  function toggleDbMenu() {
    if (!dbMenuOpen && dbButtonRef.current) {
      const rect = dbButtonRef.current.getBoundingClientRect();
      setDbMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setDbMenuOpen((o) => !o);
  }

  async function activateConnection(id: number) {
    setDbMenuOpen(false);
    await fetch(`${basePath}/api/db-connections/${id}/activate`, { method: "POST" });
    setActiveId(id);
    // Clear schema cache and reload
    await fetch(`${basePath}/api/schema`, { method: "DELETE" });
    router.refresh();
    fetchConnections();
  }

  async function logout() {
    await fetch(`${basePath}/api/auth/logout`, { method: "POST" });
    router.push("/login");
  }

  const activeConn = connections.find((c) => c.id === activeId);

  return (
    <>
      <header className="h-14 flex items-center justify-between px-6 border-b border-[var(--border)] bg-[var(--card)] shrink-0">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] text-sm font-medium transition-colors">
            🏠 Dashboard
          </Link>

          {/* DB switcher button */}
          <button
            ref={dbButtonRef}
            onClick={toggleDbMenu}
            title="Switch database"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] text-sm font-medium transition-colors max-w-[200px]"
          >
            {activeConn ? (
              <>
                <DbTypeIcon type={activeConn.db_type} />
                <span className="truncate">{activeConn.name}</span>
                <span className="text-[var(--muted-foreground)] text-xs shrink-0">({DB_TYPE_LABELS[activeConn.db_type] ?? activeConn.db_type})</span>
              </>
            ) : (
              <>
                <span>🗄️</span>
                <span className="text-[var(--muted-foreground)]">No DB selected</span>
              </>
            )}
            <span className="text-[var(--muted-foreground)] text-xs ml-0.5">▾</span>
          </button>

          {/* Manage connections button */}
          {user?.role === "admin" && (
            <button
              onClick={() => setManageOpen(true)}
              title="Manage database connections"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] text-sm transition-colors"
            >
              ⚙️
            </button>
          )}

          {update?.updateAvailable && (
            <a
              href={update.releaseUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 text-xs font-medium hover:bg-yellow-500/25 transition-colors"
            >
              <span>↑</span>
              <span>v{update.latestVersion} available</span>
            </a>
          )}
        </div>

        <div>
          <button
            ref={buttonRef}
            onClick={toggleMenu}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--accent)] transition-colors text-sm"
          >
            <span className="w-7 h-7 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-xs font-bold">
              {user?.username?.[0]?.toUpperCase() ?? "?"}
            </span>
            <span className="text-[var(--foreground)]">{user?.username ?? "..."}</span>
            {user?.role === "admin" && (
              <span className="px-1.5 py-0.5 bg-[var(--primary)]/20 text-[var(--primary)] text-[10px] rounded font-medium">
                admin
              </span>
            )}
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div
                className="fixed w-48 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl z-40"
                style={{ top: menuPos.top, right: menuPos.right }}
              >
                <div className="px-3 py-2 border-b border-[var(--border)]">
                  <p className="text-xs text-[var(--muted-foreground)]">Signed in as</p>
                  <p className="text-sm font-medium text-[var(--foreground)]">{user?.username}</p>
                </div>
                <button
                  onClick={logout}
                  className="w-full text-left px-3 py-2 text-sm text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors rounded-b-lg"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* DB switcher dropdown */}
      {dbMenuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setDbMenuOpen(false)} />
          <div
            className="fixed min-w-[220px] max-w-[320px] bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl z-40"
            style={{ top: dbMenuPos.top, left: dbMenuPos.left }}
          >
            <div className="px-3 py-2 border-b border-[var(--border)]">
              <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">Database connections</p>
            </div>
            {connections.length === 0 ? (
              <div className="px-3 py-3 text-sm text-[var(--muted-foreground)]">
                No connections configured.
                {user?.role === "admin" && (
                  <button onClick={() => { setDbMenuOpen(false); setManageOpen(true); }} className="block mt-1 text-[var(--primary)] hover:underline text-xs">Add one →</button>
                )}
              </div>
            ) : (
              <div className="py-1">
                {connections.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => activateConnection(c.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left ${
                      c.is_active
                        ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                        : "text-[var(--foreground)] hover:bg-[var(--accent)]"
                    }`}
                  >
                    <DbTypeIcon type={c.db_type} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-[var(--muted-foreground)] shrink-0">{DB_TYPE_LABELS[c.db_type] ?? c.db_type}</span>
                    {c.is_active && <span className="text-[var(--primary)] text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
            {user?.role === "admin" && (
              <div className="border-t border-[var(--border)] px-3 py-2">
                <button
                  onClick={() => { setDbMenuOpen(false); setManageOpen(true); }}
                  className="text-xs text-[var(--primary)] hover:underline"
                >
                  + Add / manage connections
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Manage connections modal */}
      {manageOpen && (
        <DbConnectionsModal
          connections={connections}
          activeId={activeId}
          onClose={() => setManageOpen(false)}
          onChanged={() => { fetchConnections(); }}
          onActivate={activateConnection}
        />
      )}
    </>
  );
}

// ── Manage Connections Modal ─────────────────────────────────────────────────

interface ModalProps {
  connections: DbConn[];
  activeId: number | null;
  onClose: () => void;
  onChanged: () => void;
  onActivate: (id: number) => void;
}

type FormMode = "list" | "add" | "edit";

interface FormState {
  name: string;
  db_type: DbType;
  connection_string: string;
}

const EMPTY_FORM: FormState = { name: "", db_type: "postgres", connection_string: "" };

function DbConnectionsModal({ connections, activeId, onClose, onChanged, onActivate }: ModalProps) {
  const [mode, setMode] = useState<FormMode>("list");
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setTestResult(null);
    setError(null);
    setMode("add");
  }

  function openEdit(c: DbConn) {
    setForm({ name: c.name, db_type: c.db_type as DbType, connection_string: c.connection_string ?? "" });
    setEditId(c.id);
    setTestResult(null);
    setError(null);
    setMode("edit");
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${basePath}/api/db-connections/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ db_type: form.db_type, connection_string: form.connection_string }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, error: "Request failed" });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!form.name.trim() || !form.connection_string.trim()) {
      setError("Name and connection string are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let res: Response;
      if (mode === "add") {
        res = await fetch(`${basePath}/api/db-connections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      } else {
        res = await fetch(`${basePath}/api/db-connections/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to save.");
        return;
      }
      onChanged();
      setMode("list");
    } catch {
      setError("Request failed.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteConn(id: number) {
    setDeleting(id);
    try {
      await fetch(`${basePath}/api/db-connections/${id}`, { method: "DELETE" });
      onChanged();
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  }

  const DB_TYPE_EXAMPLES: Record<DbType, string> = {
    postgres: "postgresql://user:password@localhost:5432/mydb",
    mysql: "mysql://user:password@localhost:3306/mydb",
    mariadb: "mariadb://user:password@localhost:3306/mydb",
    mssql: "Server=localhost,1433;Database=mydb;User Id=user;Password=pass",
    sqlite: "/path/to/database.db",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            {mode !== "list" && (
              <button onClick={() => { setMode("list"); setError(null); setTestResult(null); }} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-sm mr-1">← Back</button>
            )}
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {mode === "list" ? "Database Connections" : mode === "add" ? "Add Connection" : "Edit Connection"}
            </h2>
          </div>
          <button onClick={onClose} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {mode === "list" ? (
            <div>
              {connections.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[var(--muted-foreground)] text-center">No database connections yet.</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {connections.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-5 py-3">
                      <DbTypeIcon type={c.db_type} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--foreground)] truncate">{c.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{DB_TYPE_LABELS[c.db_type] ?? c.db_type}</p>
                      </div>
                      {c.id === activeId && (
                        <span className="px-2 py-0.5 bg-[var(--primary)]/15 text-[var(--primary)] text-xs rounded-full font-medium shrink-0">Active</span>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        {c.id !== activeId && (
                          <button
                            onClick={() => onActivate(c.id)}
                            className="px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors"
                          >
                            Use
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(c)}
                          className="px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteConn(c.id)}
                          disabled={deleting === c.id}
                          className="px-2 py-1 text-xs rounded border border-[var(--destructive)]/30 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors disabled:opacity-40"
                        >
                          {deleting === c.id ? "…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="px-5 py-4 border-t border-[var(--border)]">
                <button
                  onClick={openAdd}
                  className="w-full py-2 px-4 rounded-lg border-2 border-dashed border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)] text-sm transition-colors"
                >
                  + Add new connection
                </button>
              </div>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Production DB"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Database type</label>
                <select
                  value={form.db_type}
                  onChange={(e) => { setForm((f) => ({ ...f, db_type: e.target.value as DbType })); setTestResult(null); }}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="mariadb">MariaDB</option>
                  <option value="mssql">SQL Server</option>
                  <option value="sqlite">SQLite</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Connection string</label>
                <textarea
                  value={form.connection_string}
                  onChange={(e) => { setForm((f) => ({ ...f, connection_string: e.target.value })); setTestResult(null); }}
                  placeholder={DB_TYPE_EXAMPLES[form.db_type]}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 resize-none"
                />
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Example: <code className="font-mono">{DB_TYPE_EXAMPLES[form.db_type]}</code>
                </p>
              </div>

              {error && (
                <p className="text-sm text-[var(--destructive)] bg-[var(--destructive)]/10 px-3 py-2 rounded-lg">{error}</p>
              )}

              {testResult && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${testResult.ok ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-[var(--destructive)]/10 text-[var(--destructive)]"}`}>
                  <span>{testResult.ok ? "✓" : "✗"}</span>
                  <span>{testResult.ok ? "Connection successful!" : (testResult.error ?? "Connection failed")}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {mode !== "list" && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border)]">
            <button
              onClick={testConnection}
              disabled={testing || !form.connection_string.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] text-sm font-medium transition-colors disabled:opacity-40"
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setMode("list"); setError(null); setTestResult(null); }}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] text-sm hover:bg-[var(--accent)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-40"
              >
                {saving ? "Saving…" : mode === "add" ? "Add connection" : "Save changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
