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
  is_pinned: boolean;
  ssh_enabled?: boolean;
  ssh_host?: string | null;
  ssh_port?: number;
  ssh_user?: string | null;
  ssh_auth_type?: "password" | "key";
  has_ssh_private_key?: boolean;
  has_ssh_password?: boolean;
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
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const autoOpenedRef = useRef(false);

  const fetchConnections = useCallback(() => {
    fetch(`${basePath}/api/db-connections`)
      .then((r) => r.json())
      .then((data) => {
        setConnections(data.connections ?? []);
        setActiveId(data.active_id ?? null);
        setConnectionsLoaded(true);
      })
      .catch(() => { setConnectionsLoaded(true); });
  }, []);

  // Auto-open "Add connection" modal on first load when there are no connections
  useEffect(() => {
    if (connectionsLoaded && user?.role === "admin" && connections.length === 0 && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setManageOpen(true);
    }
  }, [connectionsLoaded, user, connections.length]);

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

  async function togglePin(id: number) {
    await fetch(`${basePath}/api/db-connections/${id}/pin`, { method: "POST" });
    fetchConnections();
  }

  async function activateConnection(id: number) {
    setDbMenuOpen(false);
    await fetch(`${basePath}/api/db-connections/${id}/activate`, { method: "POST" });
    setActiveId(id);
    await fetch(`${basePath}/api/schema`, { method: "DELETE" });
    fetchConnections();
    window.dispatchEvent(new CustomEvent("db-switched"));
    router.push("/dashboard");
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
                    {c.is_pinned && (
                      <span title="Default on login" className="text-xs shrink-0 opacity-70">📌</span>
                    )}
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
          onPin={togglePin}
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
  onPin: (id: number) => void;
}

type FormMode = "list" | "add" | "edit";

interface FormState {
  name: string;
  db_type: DbType;
  connection_string: string;
  ssh_enabled: boolean;
  ssh_host: string;
  ssh_port: string;
  ssh_user: string;
  ssh_auth_type: "password" | "key";
  ssh_password: string;
  ssh_private_key: string;
  ssh_passphrase: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  db_type: "postgres",
  connection_string: "",
  ssh_enabled: false,
  ssh_host: "",
  ssh_port: "22",
  ssh_user: "",
  ssh_auth_type: "password",
  ssh_password: "",
  ssh_private_key: "",
  ssh_passphrase: "",
};

const INPUT_CLS = "w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40";

function DbConnectionsModal({ connections, activeId, onClose, onChanged, onActivate, onPin }: ModalProps) {
  const [mode, setMode] = useState<FormMode>("list");
  const [editId, setEditId] = useState<number | null>(null);
  const [editHasSavedKey, setEditHasSavedKey] = useState(false);
  const [editHasSavedPassword, setEditHasSavedPassword] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  function setF(patch: Partial<FormState>) {
    setForm((f) => ({ ...f, ...patch }));
    setTestResult(null);
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setEditHasSavedKey(false);
    setEditHasSavedPassword(false);
    setTestResult(null);
    setError(null);
    setMode("add");
  }

  function openEdit(c: DbConn) {
    setForm({
      name: c.name,
      db_type: c.db_type as DbType,
      connection_string: c.connection_string ?? "",
      ssh_enabled: c.ssh_enabled ?? false,
      ssh_host: c.ssh_host ?? "",
      ssh_port: String(c.ssh_port ?? 22),
      ssh_user: c.ssh_user ?? "",
      ssh_auth_type: c.ssh_auth_type ?? "password",
      ssh_password: "",
      ssh_private_key: "",
      ssh_passphrase: "",
    });
    setEditId(c.id);
    setEditHasSavedKey(c.has_ssh_private_key ?? false);
    setEditHasSavedPassword(c.has_ssh_password ?? false);
    setTestResult(null);
    setError(null);
    setMode("edit");
  }

  function buildTestBody() {
    const body: Record<string, unknown> = { db_type: form.db_type, connection_string: form.connection_string };
    if (editId !== null) body.conn_id = editId;
    if (form.ssh_enabled) {
      body.ssh = {
        enabled: true,
        host: form.ssh_host,
        port: parseInt(form.ssh_port, 10) || 22,
        user: form.ssh_user,
        auth_type: form.ssh_auth_type,
        password: form.ssh_password || undefined,
        private_key: form.ssh_private_key || undefined,
        passphrase: form.ssh_passphrase || undefined,
      };
    }
    return body;
  }

  function buildSaveBody() {
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      db_type: form.db_type,
      connection_string: form.connection_string.trim(),
      ssh_enabled: form.ssh_enabled,
      ssh_host: form.ssh_host.trim() || null,
      ssh_port: parseInt(form.ssh_port, 10) || 22,
      ssh_user: form.ssh_user.trim() || null,
      ssh_auth_type: form.ssh_auth_type,
    };
    // Only send credentials if filled — empty = keep existing on edit, clear on add
    if (form.ssh_password) body.ssh_password = form.ssh_password;
    if (form.ssh_private_key) body.ssh_private_key = form.ssh_private_key;
    if (form.ssh_passphrase) body.ssh_passphrase = form.ssh_passphrase;
    return body;
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${basePath}/api/db-connections/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTestBody()),
      });
      setTestResult(await res.json());
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
    if (form.ssh_enabled && (!form.ssh_host.trim() || !form.ssh_user.trim())) {
      setError("SSH host and username are required when SSH tunnel is enabled.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = mode === "add" ? `${basePath}/api/db-connections` : `${basePath}/api/db-connections/${editId}`;
      const res = await fetch(url, {
        method: mode === "add" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSaveBody()),
      });
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
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {DB_TYPE_LABELS[c.db_type] ?? c.db_type}
                          {c.ssh_enabled && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-medium">SSH</span>}
                        </p>
                      </div>
                      {c.id === activeId && (
                        <span className="px-2 py-0.5 bg-[var(--primary)]/15 text-[var(--primary)] text-xs rounded-full font-medium shrink-0">Active</span>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        {c.id !== activeId && (
                          <button onClick={() => onActivate(c.id)} className="px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors">Use</button>
                        )}
                        <button
                          onClick={() => { onPin(c.id); onChanged(); }}
                          title={c.is_pinned ? "Unpin — remove as login default" : "Pin — auto-select on login"}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            c.is_pinned
                              ? "border-[var(--primary)]/50 bg-[var(--primary)]/10 text-[var(--primary)]"
                              : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                          }`}
                        >
                          📌
                        </button>
                        <button onClick={() => openEdit(c)} className="px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors">Edit</button>
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
                <button onClick={openAdd} className="w-full py-2 px-4 rounded-lg border-2 border-dashed border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)] text-sm transition-colors">
                  + Add new connection
                </button>
              </div>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Name</label>
                <input value={form.name} onChange={(e) => setF({ name: e.target.value })} placeholder="e.g. Production DB" className={INPUT_CLS} />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Database type</label>
                <select value={form.db_type} onChange={(e) => setF({ db_type: e.target.value as DbType })} className={INPUT_CLS}>
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
                  onChange={(e) => setF({ connection_string: e.target.value })}
                  placeholder={DB_TYPE_EXAMPLES[form.db_type]}
                  rows={3}
                  className={`${INPUT_CLS} font-mono resize-none`}
                />
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {form.ssh_enabled
                    ? "Use the database host/port as seen from the SSH server (e.g. localhost:5432 if DB is on the same machine)."
                    : <>Example: <code className="font-mono">{DB_TYPE_EXAMPLES[form.db_type]}</code></>}
                </p>
              </div>

              {/* SSH Tunnel section */}
              {form.db_type !== "sqlite" && (
                <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setF({ ssh_enabled: !form.ssh_enabled })}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[var(--accent)] transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base leading-none">🔒</span>
                      <span className="text-sm font-medium text-[var(--foreground)]">SSH Tunnel</span>
                    </div>
                    <div className={`relative w-9 h-5 rounded-full transition-colors ${form.ssh_enabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/30"}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.ssh_enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                    </div>
                  </button>

                  {form.ssh_enabled && (
                    <div className="px-3 pb-4 pt-3 space-y-3 border-t border-[var(--border)]">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">SSH Host</label>
                          <input value={form.ssh_host} onChange={(e) => setF({ ssh_host: e.target.value })} placeholder="bastion.example.com" className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Port</label>
                          <input value={form.ssh_port} onChange={(e) => setF({ ssh_port: e.target.value })} placeholder="22" className={INPUT_CLS} />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">SSH Username</label>
                        <input value={form.ssh_user} onChange={(e) => setF({ ssh_user: e.target.value })} placeholder="ubuntu" className={INPUT_CLS} />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Authentication</label>
                        <div className="flex gap-4">
                          {(["password", "key"] as const).map((t) => (
                            <label key={t} className="flex items-center gap-1.5 text-sm text-[var(--foreground)] cursor-pointer">
                              <input type="radio" name="ssh_auth_type" value={t} checked={form.ssh_auth_type === t} onChange={() => setF({ ssh_auth_type: t })} className="accent-[var(--primary)]" />
                              {t === "password" ? "Password" : "Private key"}
                            </label>
                          ))}
                        </div>
                      </div>

                      {form.ssh_auth_type === "password" ? (
                        <div>
                          <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] mb-1">
                            SSH Password
                            {editHasSavedPassword && !form.ssh_password && (
                              <span className="px-1 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 font-medium" style={{ fontSize: "10px" }}>saved</span>
                            )}
                          </label>
                          <input
                            type="password"
                            value={form.ssh_password}
                            onChange={(e) => setF({ ssh_password: e.target.value })}
                            placeholder={editHasSavedPassword && !form.ssh_password ? "(password saved — leave blank to keep)" : ""}
                            autoComplete="new-password"
                            className={INPUT_CLS}
                          />
                        </div>
                      ) : (
                        <>
                          <div>
                            <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] mb-1">
                              Private Key (PEM)
                              {editHasSavedKey && !form.ssh_private_key && (
                                <span className="px-1 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 font-medium" style={{ fontSize: "10px" }}>saved</span>
                              )}
                            </label>
                            <textarea
                              value={form.ssh_private_key}
                              onChange={(e) => setF({ ssh_private_key: e.target.value })}
                              placeholder={editHasSavedKey && !form.ssh_private_key ? "(SSH key saved — leave blank to keep existing)" : "-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
                              rows={4}
                              className={`${INPUT_CLS} font-mono resize-none`}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Passphrase (optional)</label>
                            <input type="password" value={form.ssh_passphrase} onChange={(e) => setF({ ssh_passphrase: e.target.value })} autoComplete="new-password" className={INPUT_CLS} />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

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
