"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import type { PaginatedResult, SchemaTable, Column, TablePolicy } from "@/lib/types";
import { basePath } from "@/lib/api-url";

interface FkModal {
  refTable: string;
  refId: string;
  row: Record<string, unknown> | null;
  loading: boolean;
}

interface FkConfigState {
  col: Column;
  refTableCols: string[];
  selectedField: string;
  saving: boolean;
}

interface EncConfigState {
  column: string;
  algorithm: string;
  saltColumn: string;
  saving: boolean;
}

interface ColConfigDraft {
  cols: Set<string>;
  sort: string;
  dir: "asc" | "desc";
}

interface PolicyUser {
  id: number;
  username: string;
  table: { can_view: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean };
  columns: Record<string, { hidden: boolean; read_only: boolean }>;
}

interface Props {
  tableName: string;
  schema: SchemaTable;
  isAdmin: boolean;
  tablePolicy?: TablePolicy;
  columnPolicies?: Record<string, { hidden: boolean; read_only: boolean }>;
}

export function DataTable({ tableName, schema, isAdmin, tablePolicy, columnPolicies = {} }: Props) {
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [result, setResult] = useState<PaginatedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(schema.primaryKey);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [fkModal, setFkModal] = useState<FkModal | null>(null);
  const [pinnedRows, setPinnedRows] = useState<Set<string>>(new Set());

  const [fkSettings, setFkSettings] = useState<Record<string, string>>({});
  const [fkDisplayValues, setFkDisplayValues] = useState<Record<string, Record<string, string>>>({});
  const [fkConfig, setFkConfig] = useState<FkConfigState | null>(null);

  const [encSettings, setEncSettings] = useState<Record<string, { algorithm: string; saltColumn: string | null }>>({});
  const [encConfig, setEncConfig] = useState<EncConfigState | null>(null);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => new Set(schema.columns.map((c) => c.name))
  );
  const [colConfigDraft, setColConfigDraft] = useState<ColConfigDraft | null>(null);

  // Policies modal (admin only)
  const [policyUsers, setPolicyUsers] = useState<PolicyUser[] | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);

  // Effective permissions for current user
  const canInsert = isAdmin || (tablePolicy?.can_insert ?? true);
  const canUpdate = isAdmin || (tablePolicy?.can_update ?? true);
  const canDelete = isAdmin || (tablePolicy?.can_delete ?? true);

  const pageSize = 50;

  // Load column visibility + sort prefs from the internal DB
  useEffect(() => {
    fetch(`${basePath}/api/view-settings?table=${encodeURIComponent(tableName)}`)
      .then((r) => r.json())
      .then((data: { visible_cols?: string[]; sort_col?: string; sort_dir?: string } | null) => {
        if (!data) return;
        if (Array.isArray(data.visible_cols) && data.visible_cols.length > 0) {
          setVisibleCols(new Set(data.visible_cols));
        }
        if (typeof data.sort_col === "string" && schema.columns.some((c) => c.name === data.sort_col)) {
          setSort(data.sort_col);
        }
        if (data.sort_dir === "asc" || data.sort_dir === "desc") {
          setDir(data.sort_dir);
        }
      })
      .catch(() => {});
  }, [tableName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch(`${basePath}/api/fk-settings?table=${encodeURIComponent(tableName)}`)
      .then((r) => r.json())
      .then((data: { column_name: string; display_field: string }[]) => {
        if (!Array.isArray(data)) return;
        const map: Record<string, string> = {};
        for (const s of data) map[s.column_name] = s.display_field;
        setFkSettings(map);
      })
      .catch(() => {});
  }, [tableName]);

  useEffect(() => {
    fetch(`${basePath}/api/encryption-settings?table=${encodeURIComponent(tableName)}`)
      .then((r) => r.json())
      .then((data: { column_name: string; algorithm: string; salt_column: string | null }[]) => {
        if (!Array.isArray(data)) return;
        const map: Record<string, { algorithm: string; saltColumn: string | null }> = {};
        for (const s of data) map[s.column_name] = { algorithm: s.algorithm, saltColumn: s.salt_column };
        setEncSettings(map);
      })
      .catch(() => {});
  }, [tableName]);

  useEffect(() => {
    if (!result) return;
    const fkCols = schema.columns.filter((c) => c.fk && fkSettings[c.name]);
    if (fkCols.length === 0) return;
    for (const col of fkCols) {
      const displayField = fkSettings[col.name];
      const uniqueIds = [
        ...new Set(
          result.rows
            .map((r) => r[col.name])
            .filter((v) => v !== null && v !== undefined)
            .map(String)
        ),
      ];
      if (uniqueIds.length === 0) continue;
      const refTable = col.fk!.table;
      fetch(`${basePath}/api/fk-display?refTable=${encodeURIComponent(refTable)}&field=${encodeURIComponent(displayField)}&ids=${uniqueIds.join(",")}`)
        .then((r) => r.json())
        .then((data: Record<string, string>) => {
          setFkDisplayValues((prev) => ({ ...prev, [col.name]: { ...prev[col.name], ...data } }));
        })
        .catch(() => {});
    }
  }, [result, fkSettings, schema.columns]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        search,
        sort,
        dir,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`${basePath}/api/tables/${tableName}?${params}`);
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [tableName, search, sort, dir, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useLayoutEffect(() => {
    const el = stickyHeaderRef.current;
    if (!el) return;
    setHeaderHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function handleSort(col: string) {
    if (sort === col) {
      setDir(dir === "asc" ? "desc" : "asc");
    } else {
      setSort(col);
      setDir("asc");
    }
    setPage(1);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  async function confirmDelete(id: string) {
    setDeleting(id);
    setDeleteConfirm(null);
    try {
      const res = await fetch(`${basePath}/api/tables/${tableName}/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(`Delete failed: ${data.error}`);
        return;
      }
      fetchData();
    } finally {
      setDeleting(null);
    }
  }

  async function handleFkClick(refTable: string, refId: unknown) {
    const id = String(refId);
    setFkModal({ refTable, refId: id, row: null, loading: true });
    try {
      const res = await fetch(`${basePath}/api/tables/${refTable}/${id}`);
      const data = await res.json();
      setFkModal((prev) => prev ? { ...prev, row: res.ok ? data : null, loading: false } : null);
    } catch {
      setFkModal((prev) => prev ? { ...prev, loading: false } : null);
    }
  }

  async function openFkConfig(col: Column) {
    const refTable = col.fk!.table;
    try {
      const res = await fetch(`${basePath}/api/schema`);
      const data = await res.json();
      const tableSchema = data.tables?.find((t: SchemaTable) => t.name === refTable);
      const cols: string[] = tableSchema?.columns.map((c: Column) => c.name) ?? [];
      setFkConfig({
        col,
        refTableCols: cols,
        selectedField: fkSettings[col.name] ?? cols[0] ?? "",
        saving: false,
      });
    } catch {
      setFkConfig({ col, refTableCols: [], selectedField: fkSettings[col.name] ?? "", saving: false });
    }
  }

  async function saveFkConfig() {
    if (!fkConfig) return;
    setFkConfig((prev) => prev ? { ...prev, saving: true } : null);
    try {
      await fetch(`${basePath}/api/fk-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: tableName, column: fkConfig.col.name, displayField: fkConfig.selectedField }),
      });
      setFkSettings((prev) => ({ ...prev, [fkConfig.col.name]: fkConfig.selectedField }));
      if (result) {
        const uniqueIds = [...new Set(result.rows.map((r) => r[fkConfig.col.name]).filter((v) => v !== null && v !== undefined).map(String))];
        if (uniqueIds.length > 0) {
          fetch(`${basePath}/api/fk-display?refTable=${encodeURIComponent(fkConfig.col.fk!.table)}&field=${encodeURIComponent(fkConfig.selectedField)}&ids=${uniqueIds.join(",")}`)
            .then((r) => r.json())
            .then((data: Record<string, string>) => {
              setFkDisplayValues((prev) => ({ ...prev, [fkConfig.col.name]: data }));
            })
            .catch(() => {});
        }
      }
      setFkConfig(null);
    } catch {
      setFkConfig((prev) => prev ? { ...prev, saving: false } : null);
    }
  }

  function togglePin(id: string) {
    setPinnedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openColConfig() {
    setColConfigDraft({ cols: new Set(visibleCols), sort, dir });
  }

  function saveColConfig() {
    if (!colConfigDraft || colConfigDraft.cols.size === 0) return;
    setVisibleCols(colConfigDraft.cols);
    setSort(colConfigDraft.sort);
    setDir(colConfigDraft.dir);
    setPage(1);
    fetch(`${basePath}/api/view-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        table: tableName,
        visible_cols: [...colConfigDraft.cols],
        sort_col: colConfigDraft.sort,
        sort_dir: colConfigDraft.dir,
      }),
    }).catch(() => {});
    setColConfigDraft(null);
  }

  async function openPolicyModal() {
    setPolicyLoading(true);
    setPolicyUsers(null);
    try {
      const res = await fetch(`${basePath}/api/policies?table=${encodeURIComponent(tableName)}`);
      const data = await res.json();
      setPolicyUsers(data.users ?? []);
    } catch {
      setPolicyUsers([]);
    } finally {
      setPolicyLoading(false);
    }
  }

  async function savePolicyTable(userId: number, field: keyof PolicyUser["table"], value: boolean) {
    if (!policyUsers) return;
    const user = policyUsers.find((u) => u.id === userId);
    if (!user) return;
    const updated = { ...user.table, [field]: value };
    setPolicyUsers((prev) => prev?.map((u) => u.id === userId ? { ...u, table: updated } : u) ?? null);
    setPolicySaving(true);
    try {
      await fetch(`${basePath}/api/policies`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "table", userId, table: tableName, ...updated }),
      });
    } finally {
      setPolicySaving(false);
    }
  }

  async function savePolicyColumn(userId: number, column: string, field: "hidden" | "read_only", value: boolean) {
    if (!policyUsers) return;
    const user = policyUsers.find((u) => u.id === userId);
    if (!user) return;
    const existing = user.columns[column] ?? { hidden: false, read_only: false };
    const updated = { ...existing, [field]: value };
    setPolicyUsers((prev) => prev?.map((u) => u.id === userId ? { ...u, columns: { ...u.columns, [column]: updated } } : u) ?? null);
    setPolicySaving(true);
    try {
      await fetch(`${basePath}/api/policies`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "column", userId, table: tableName, column, ...updated }),
      });
    } finally {
      setPolicySaving(false);
    }
  }

  function openEncConfig(colName?: string) {
    const nonPkCols = schema.columns.filter((c) => !c.isPrimary);
    const defaultCol = colName ?? nonPkCols[0]?.name ?? "";
    const existing = encSettings[defaultCol];
    setEncConfig({
      column: defaultCol,
      algorithm: existing?.algorithm ?? "SHA256",
      saltColumn: existing?.saltColumn ?? "",
      saving: false,
    });
  }

  async function saveEncConfig() {
    if (!encConfig || !encConfig.column) return;
    setEncConfig((prev) => prev ? { ...prev, saving: true } : null);
    try {
      await fetch(`${basePath}/api/encryption-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: tableName,
          column: encConfig.column,
          algorithm: encConfig.algorithm,
          saltColumn: encConfig.saltColumn || undefined,
        }),
      });
      setEncSettings((prev) => ({
        ...prev,
        [encConfig.column]: { algorithm: encConfig.algorithm, saltColumn: encConfig.saltColumn || null },
      }));
      setEncConfig(null);
    } catch {
      setEncConfig((prev) => prev ? { ...prev, saving: false } : null);
    }
  }

  async function removeEncConfig() {
    if (!encConfig || !encConfig.column) return;
    setEncConfig((prev) => prev ? { ...prev, saving: true } : null);
    try {
      await fetch(`${basePath}/api/encryption-settings`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: tableName, column: encConfig.column }),
      });
      setEncSettings((prev) => {
        const next = { ...prev };
        delete next[encConfig.column];
        return next;
      });
      setEncConfig(null);
    } catch {
      setEncConfig((prev) => prev ? { ...prev, saving: false } : null);
    }
  }

  const totalPages = result ? Math.ceil(result.total / pageSize) : 0;
  const visibleColsList = schema.columns.filter((c) => visibleCols.has(c.name));
  const hiddenCount = schema.columns.length - visibleColsList.length;

  function formatCell(value: unknown, isJson: boolean): string {
    if (value === null || value === undefined) return "";
    if (isJson || typeof value === "object") {
      try { return JSON.stringify(value); }
      catch { return String(value); }
    }
    return String(value);
  }

  function renderExpandedValue(col: Column, val: unknown) {
    if (val === null || val === undefined) {
      return <span className="italic text-[var(--muted-foreground)] text-xs">null</span>;
    }
    if (col.isJson) {
      const jsonStr = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
      return (
        <pre className="font-mono text-xs text-emerald-400 whitespace-pre-wrap break-all max-h-40 overflow-y-auto leading-relaxed">
          {jsonStr}
        </pre>
      );
    }
    if (col.fk) {
      const displayVal = fkSettings[col.name]
        ? (fkDisplayValues[col.name]?.[String(val)] ?? String(val))
        : String(val);
      return (
        <button
          type="button"
          onClick={() => handleFkClick(col.fk!.table, val)}
          className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 font-mono text-xs transition-colors"
        >
          {displayVal}
          <span className="opacity-60">↗</span>
        </button>
      );
    }
    return (
      <span className={`text-sm break-all ${col.isPrimary ? "font-mono text-[var(--primary)]" : "text-[var(--foreground)]"}`}>
        {String(val)}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="font-semibold text-[var(--foreground)] text-lg mb-1">Delete record?</h2>
              <p className="text-sm text-[var(--muted-foreground)]">
                This will permanently delete record <span className="font-mono text-[var(--foreground)]">{deleteConfirm}</span>. This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] border border-[var(--border)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDelete(deleteConfirm)}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--destructive)] hover:bg-[var(--destructive)]/90 text-white font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FK record modal */}
      {fkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setFkModal(null)}
        >
          <div
            className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div>
                <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-0.5">Related record</p>
                <h2 className="font-semibold text-[var(--foreground)] font-mono">{fkModal.refTable}</h2>
              </div>
              <div className="flex items-center gap-2">
                {!fkModal.loading && fkModal.row && (
                  <Link
                    href={`/dashboard/tables/${fkModal.refTable}/${fkModal.refId}`}
                    className="px-3 py-1.5 text-xs bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white rounded-lg transition-colors font-medium"
                    onClick={() => setFkModal(null)}
                  >
                    Open →
                  </Link>
                )}
                <button
                  onClick={() => setFkModal(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-5">
              {fkModal.loading ? (
                <p className="text-center text-[var(--muted-foreground)] py-6">Loading...</p>
              ) : !fkModal.row ? (
                <p className="text-center text-[var(--destructive)] py-6">Record not found</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                  {Object.entries(fkModal.row).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-xs font-mono text-[var(--muted-foreground)] pt-0.5 whitespace-nowrap">{k}</dt>
                      <dd className={`text-sm break-all ${v === null ? "italic text-[var(--muted-foreground)]" : "text-[var(--foreground)]"}`}>
                        {v === null
                          ? "null"
                          : typeof v === "object"
                          ? <span className="font-mono text-emerald-400 text-xs">{JSON.stringify(v)}</span>
                          : String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FK display field configure modal */}
      {fkConfig && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setFkConfig(null)}
        >
          <div
            className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">FK display field</p>
              <h2 className="font-semibold text-[var(--foreground)] font-mono">{fkConfig.col.name}</h2>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                Choose which field from <span className="font-mono text-amber-400">{fkConfig.col.fk!.table}</span> to show inline in this column.
              </p>
            </div>
            {fkConfig.refTableCols.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">Could not load columns for this table.</p>
            ) : (
              <select
                value={fkConfig.selectedField}
                onChange={(e) => setFkConfig((prev) => prev ? { ...prev, selectedField: e.target.value } : null)}
                className="w-full px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                {fkConfig.refTableCols.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setFkConfig(null)}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] border border-[var(--border)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveFkConfig}
                disabled={fkConfig.saving || !fkConfig.selectedField}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white font-medium transition-colors disabled:opacity-50"
              >
                {fkConfig.saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Encryption config modal */}
      {encConfig && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setEncConfig(null)}
        >
          <div
            className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">Field encryption</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                Configure how a column&apos;s value is hashed when editing records.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Column</label>
                <select
                  value={encConfig.column}
                  onChange={(e) => {
                    const col = e.target.value;
                    const existing = encSettings[col];
                    setEncConfig((prev) => prev ? { ...prev, column: col, algorithm: existing?.algorithm ?? "SHA256", saltColumn: existing?.saltColumn ?? "" } : null);
                  }}
                  className="w-full px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                >
                  {schema.columns.filter((c) => !c.isPrimary).map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Algorithm</label>
                <select
                  value={encConfig.algorithm}
                  onChange={(e) => setEncConfig((prev) => prev ? { ...prev, algorithm: e.target.value } : null)}
                  className="w-full px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                >
                  <option value="SHA256">SHA256</option>
                  <option value="SHA512">SHA512</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Salt column <span className="opacity-50">(optional)</span></label>
                <select
                  value={encConfig.saltColumn}
                  onChange={(e) => setEncConfig((prev) => prev ? { ...prev, saltColumn: e.target.value } : null)}
                  className="w-full px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                >
                  <option value="">(none)</option>
                  {schema.columns.filter((c) => !c.isPrimary && c.name !== encConfig.column).map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              {encSettings[encConfig.column] && (
                <button
                  onClick={removeEncConfig}
                  disabled={encConfig.saving}
                  className="px-3 py-2 text-sm rounded-lg bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20 text-[var(--destructive)] border border-[var(--destructive)]/20 transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              )}
              <div className="flex items-center gap-3 ml-auto">
                <button
                  onClick={() => setEncConfig(null)}
                  className="px-4 py-2 text-sm rounded-lg bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] border border-[var(--border)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEncConfig}
                  disabled={encConfig.saving || !encConfig.column}
                  className="px-4 py-2 text-sm rounded-lg bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {encConfig.saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column visibility + sort config modal */}
      {colConfigDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setColConfigDraft(null)}
        >
          <div
            className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">View settings</p>
                <h2 className="font-semibold text-[var(--foreground)]">Columns &amp; default sort</h2>
              </div>
              <button
                onClick={() => setColConfigDraft(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors text-lg leading-none mt-0.5"
              >
                ×
              </button>
            </div>

            {/* Column checkboxes */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                  Visible columns
                  <span className="ml-1.5 text-[var(--primary)] font-mono normal-case">
                    ({colConfigDraft.cols.size}/{schema.columns.length})
                  </span>
                </span>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setColConfigDraft((prev) => prev ? { ...prev, cols: new Set(schema.columns.map((c) => c.name)) } : null)}
                    className="text-[var(--primary)] hover:underline"
                  >
                    All
                  </button>
                  <span className="text-[var(--border)]">·</span>
                  <button
                    type="button"
                    onClick={() => setColConfigDraft((prev) => prev ? { ...prev, cols: new Set([schema.primaryKey]) } : null)}
                    className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline transition-colors"
                  >
                    PK only
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 max-h-52 overflow-y-auto pr-1">
                {schema.columns.map((col) => {
                  const checked = colConfigDraft.cols.has(col.name);
                  const isLast = colConfigDraft.cols.size === 1 && checked;
                  return (
                    <label
                      key={col.name}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                        checked ? "bg-[var(--primary)]/8 hover:bg-[var(--primary)]/12" : "hover:bg-[var(--accent)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isLast}
                        onChange={(e) => {
                          setColConfigDraft((prev) => {
                            if (!prev) return null;
                            const next = new Set(prev.cols);
                            if (e.target.checked) {
                              next.add(col.name);
                            } else if (next.size > 1) {
                              next.delete(col.name);
                            }
                            return { ...prev, cols: next };
                          });
                        }}
                        className="w-3.5 h-3.5 rounded accent-[var(--primary)] cursor-pointer disabled:cursor-not-allowed"
                      />
                      <span className="font-mono text-xs text-[var(--foreground)] truncate flex-1">{col.name}</span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        {col.isPrimary && <span className="text-[9px] text-[var(--primary)] font-bold">PK</span>}
                        {col.fk && <span className="text-[9px] text-amber-400 font-bold">FK</span>}
                        {col.isJson && <span className="text-[9px] text-emerald-400 font-bold">JS</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Default sort */}
            <div>
              <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider block mb-2.5">Default sort</span>
              <div className="flex items-center gap-2">
                <select
                  value={colConfigDraft.sort}
                  onChange={(e) => setColConfigDraft((prev) => prev ? { ...prev, sort: e.target.value } : null)}
                  className="flex-1 px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                >
                  {schema.columns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setColConfigDraft((prev) => prev ? { ...prev, dir: prev.dir === "asc" ? "desc" : "asc" } : null)}
                  className="px-3 py-2 bg-[var(--secondary)] hover:bg-[var(--accent)] border border-[var(--border)] rounded-lg text-sm font-mono font-medium text-[var(--foreground)] transition-colors min-w-[72px] text-center"
                >
                  {colConfigDraft.dir === "asc" ? "ASC ↑" : "DESC ↓"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={() => setColConfigDraft({
                  cols: new Set(schema.columns.map((c) => c.name)),
                  sort: schema.primaryKey,
                  dir: "asc",
                })}
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                Reset to defaults
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setColConfigDraft(null)}
                  className="px-4 py-2 text-sm rounded-lg bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] border border-[var(--border)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveColConfig}
                  disabled={colConfigDraft.cols.size === 0}
                  className="px-4 py-2 text-sm rounded-lg bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white font-medium transition-colors disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Policies modal */}
      {(policyLoading || policyUsers !== null) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPolicyUsers(null)}
        >
          <div
            className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
              <div>
                <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-0.5">Access policies</p>
                <h2 className="font-semibold text-[var(--foreground)] font-mono">{tableName}</h2>
              </div>
              <div className="flex items-center gap-3">
                {policySaving && <span className="text-xs text-[var(--muted-foreground)] animate-pulse">Saving…</span>}
                <button
                  onClick={() => setPolicyUsers(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-6">
              {policyLoading ? (
                <p className="text-center text-[var(--muted-foreground)] py-10">Loading…</p>
              ) : !policyUsers || policyUsers.length === 0 ? (
                <p className="text-center text-[var(--muted-foreground)] py-10">No non-admin users found.</p>
              ) : (
                <>
                  {/* Table-level permissions */}
                  <div>
                    <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">Table access</p>
                    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-[var(--secondary)]">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-wider">User</th>
                            {(["can_view", "can_insert", "can_update", "can_delete"] as const).map((f) => (
                              <th key={f} className="px-4 py-2.5 text-center font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-wider">
                                {f.replace("can_", "")}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {policyUsers.map((u) => (
                            <tr key={u.id} className="border-t border-[var(--border)] even:bg-[var(--muted)]/20">
                              <td className="px-4 py-2.5 font-mono text-xs text-[var(--foreground)]">{u.username}</td>
                              {(["can_view", "can_insert", "can_update", "can_delete"] as const).map((f) => (
                                <td key={f} className="px-4 py-2.5 text-center">
                                  <input
                                    type="checkbox"
                                    checked={u.table[f]}
                                    onChange={(e) => savePolicyTable(u.id, f, e.target.checked)}
                                    className="w-4 h-4 rounded accent-[var(--primary)] cursor-pointer"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Column-level permissions */}
                  {schema.columns.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">Column access</p>
                      <div className="flex flex-col gap-3">
                        {policyUsers.map((u) => {
                          const hiddenCount = Object.values(u.columns).filter((c) => c.hidden).length;
                          const roCount = Object.values(u.columns).filter((c) => c.read_only).length;
                          return (
                            <div key={u.id} className="border border-[var(--border)] rounded-lg overflow-hidden">
                              <div className="bg-[var(--secondary)] px-4 py-2 flex items-center gap-3">
                                <span className="font-mono text-xs font-semibold text-[var(--foreground)]">{u.username}</span>
                                <span className="text-xs text-[var(--muted-foreground)]">
                                  {hiddenCount > 0 || roCount > 0
                                    ? [hiddenCount > 0 && `${hiddenCount} hidden`, roCount > 0 && `${roCount} read-only`].filter(Boolean).join(" · ")
                                    : "Full column access"}
                                </span>
                              </div>
                              <div className="p-3">
                                <div className="grid gap-x-3 gap-y-0.5 items-center" style={{ gridTemplateColumns: "1fr auto auto" }}>
                                  <div className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider pb-1.5">Column</div>
                                  <div className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider text-center pb-1.5 w-16">Hidden</div>
                                  <div className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider text-center pb-1.5 w-20">Read-only</div>
                                  {schema.columns.map((col) => {
                                    const cp = u.columns[col.name] ?? { hidden: false, read_only: false };
                                    return (
                                      <Fragment key={col.name}>
                                        <span className="font-mono text-xs text-[var(--foreground)] py-1 flex items-center gap-1">
                                          {col.name}
                                          {col.isPrimary && <span className="text-[8px] text-[var(--primary)] font-bold">PK</span>}
                                          {col.fk && <span className="text-[8px] text-amber-400 font-bold">FK</span>}
                                        </span>
                                        <div className="flex justify-center">
                                          <input
                                            type="checkbox"
                                            checked={cp.hidden}
                                            onChange={(e) => savePolicyColumn(u.id, col.name, "hidden", e.target.checked)}
                                            className="w-3.5 h-3.5 rounded accent-[var(--primary)] cursor-pointer"
                                          />
                                        </div>
                                        <div className="flex justify-center">
                                          <input
                                            type="checkbox"
                                            checked={cp.read_only}
                                            onChange={(e) => savePolicyColumn(u.id, col.name, "read_only", e.target.checked)}
                                            className="w-3.5 h-3.5 rounded accent-[var(--primary)] cursor-pointer"
                                          />
                                        </div>
                                      </Fragment>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sticky header: title + toolbar */}
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-20 bg-[var(--background)] -mx-6 px-6 -mt-6 pt-6 pb-5 flex flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)] font-mono">{tableName}</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              {schema.columns.length} columns &middot; PK: <span className="font-mono">{schema.primaryKey}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openColConfig}
              title="Configure visible columns and default sort"
              className={`px-3 py-2 rounded-lg text-sm transition-colors border ${
                hiddenCount > 0
                  ? "bg-[var(--primary)]/10 border-[var(--primary)]/30 text-[var(--primary)] hover:bg-[var(--primary)]/20"
                  : "bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] border-[var(--border)]"
              }`}
            >
              ⚙ Columns{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
            </button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={openPolicyModal}
                  title="Manage per-user access policies"
                  className="px-3 py-2 bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg text-sm transition-colors border border-[var(--border)]"
                >
                  👥 Policies
                </button>
                <button
                  type="button"
                  onClick={() => openEncConfig()}
                  title="Configure field encryption"
                  className="px-3 py-2 bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg text-sm transition-colors border border-[var(--border)]"
                >
                  🔒 Encryption
                </button>
              </>
            )}
            {canInsert && (
              <Link
                href={`/dashboard/tables/${tableName}/new`}
                className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white rounded-lg text-sm font-medium transition-colors"
              >
                + New Record
              </Link>
            )}
          </div>
        </div>
        {pinnedRows.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-amber-400 font-medium">
              {pinnedRows.size} row{pinnedRows.size !== 1 ? "s" : ""} selected
            </span>
            <button
              type="button"
              onClick={() => setPinnedRows(new Set())}
              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              Clear
            </button>
          </div>
        )}
        <form onSubmit={handleSearch} className="flex items-center gap-2 max-w-sm">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search..."
            className="flex-1 px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
          <button
            type="submit"
            className="px-3 py-2 bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] rounded-lg text-sm transition-colors border border-[var(--border)]"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
              className="px-3 py-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-sm"
            >
              ✕ Clear
            </button>
          )}
        </form>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[var(--destructive)]/10 border border-[var(--destructive)]/20 text-[var(--destructive)] text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="border border-[var(--border)] rounded-xl overflow-hidden shadow-sm mt-4">
        <div
          className="overflow-auto"
          style={{ maxHeight: `calc(100vh - ${headerHeight}px - 12rem)` }}
        >
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#1a1415]" style={{ boxShadow: '0 2px 0 0 rgba(191,107,113,0.3)' }}>
              <tr>
                <th className="px-4 py-3.5 text-left align-middle font-semibold text-[var(--muted-foreground)] text-[11px] uppercase tracking-widest whitespace-nowrap w-px">
                  {isAdmin ? "Actions" : "View"}
                </th>
                {visibleColsList.map((col) => (
                  <th
                    key={col.name}
                    className="text-left px-4 py-3.5 align-middle font-semibold text-[var(--muted-foreground)] text-[11px] uppercase tracking-widest whitespace-nowrap cursor-pointer hover:text-[var(--foreground)] transition-colors select-none"
                    onClick={() => handleSort(col.name)}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono">{col.name}</span>
                      {sort === col.name && (
                        <span className="text-[var(--primary)]">{dir === "asc" ? "↑" : "↓"}</span>
                      )}
                      {col.isPrimary && (
                        <span className="px-1 py-0.5 bg-[var(--primary)]/15 text-[var(--primary)] text-[9px] rounded font-sans font-semibold">PK</span>
                      )}
                      {col.fk && (
                        <span className="px-1 py-0.5 bg-amber-500/15 text-amber-400 text-[9px] rounded font-sans font-semibold">FK</span>
                      )}
                      {col.isJson && (
                        <span className="px-1 py-0.5 bg-emerald-500/15 text-emerald-400 text-[9px] rounded font-sans font-semibold">JSON</span>
                      )}
                      {encSettings[col.name] && (
                        <span className="px-1 py-0.5 bg-violet-500/15 text-violet-400 text-[9px] rounded font-sans font-semibold" title={`Encrypted: ${encSettings[col.name].algorithm}`}>🔒</span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={visibleColsList.length + 1} className="px-4 py-8 text-center text-[var(--muted-foreground)]">
                    Loading...
                  </td>
                </tr>
              ) : result?.rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColsList.length + 1} className="px-4 py-8 text-center text-[var(--muted-foreground)]">
                    No records found
                  </td>
                </tr>
              ) : (
                result?.rows.map((row, ri) => {
                  const id = String(row[schema.primaryKey]);
                  const isPinned = pinnedRows.has(id);
                  const isExpanded = expandedRows.has(id);
                  return (
                    <Fragment key={ri}>
                      <tr
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a, button")) return;
                          togglePin(id);
                        }}
                        className={`border-t border-[var(--border)] transition-colors cursor-pointer ${
                          isPinned
                            ? "bg-amber-400/20 hover:bg-amber-400/25"
                            : ri % 2 === 0
                            ? "bg-[var(--card)] hover:bg-[var(--primary)]/5"
                            : "bg-[var(--muted)]/30 hover:bg-[var(--primary)]/5"
                        }`}
                      >
                        {/* Actions + expand column */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {/* Expand toggle */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleExpand(id); }}
                              title={isExpanded ? "Collapse row" : "Expand all fields"}
                              className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                                isExpanded
                                  ? "text-[var(--primary)] bg-[var(--primary)]/10"
                                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)]"
                              }`}
                            >
                              <svg
                                className={`w-3 h-3 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                                viewBox="0 0 24 24"
                                fill="currentColor"
                              >
                                <path d="M8 5l8 7-8 7V5z" />
                              </svg>
                            </button>
                            <Link
                              href={`/dashboard/tables/${tableName}/${id}`}
                              className="px-2.5 py-1 text-xs bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] rounded transition-colors border border-[var(--border)]"
                            >
                              {canUpdate ? "Edit" : "View"}
                            </Link>
                            {canDelete && (
                              <button
                                onClick={() => setDeleteConfirm(id)}
                                disabled={deleting === id}
                                className="px-2.5 py-1 text-xs bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20 text-[var(--destructive)] rounded transition-colors border border-[var(--destructive)]/20 disabled:opacity-50"
                              >
                                {deleting === id ? "..." : "Delete"}
                              </button>
                            )}
                          </div>
                        </td>

                        {visibleColsList.map((col) => {
                          const val = row[col.name];
                          const text = formatCell(val, col.isJson);
                          const isFk = !!col.fk && val !== null && val !== undefined;

                          if (isFk) {
                            const displayVal = fkSettings[col.name]
                              ? (fkDisplayValues[col.name]?.[String(val)] ?? text)
                              : text;
                            return (
                              <td key={col.name} className="px-4 py-3">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleFkClick(col.fk!.table, val)}
                                    className="inline-flex items-center gap-1.5 max-w-[160px] px-2.5 py-1 rounded-lg border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20 hover:border-amber-400/70 text-amber-400 font-mono text-xs transition-colors"
                                    title={`View related ${col.fk!.table} record (id: ${text})`}
                                  >
                                    <span className="truncate">{displayVal}</span>
                                    <span className="shrink-0 opacity-60">↗</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openFkConfig(col)}
                                    title="Configure display field"
                                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-amber-400/40 hover:text-amber-400 hover:bg-amber-400/10 transition-colors text-xs"
                                  >
                                    ✎
                                  </button>
                                </div>
                              </td>
                            );
                          }

                          return (
                            <td key={col.name} className="px-4 py-3 text-[var(--foreground)]">
                              <span
                                className={`block max-w-xs truncate ${
                                  col.isJson
                                    ? "font-mono text-emerald-400 text-xs"
                                    : col.isPrimary
                                    ? "font-mono text-[var(--primary)]"
                                    : ""
                                }`}
                                title={text}
                              >
                                {val === null ? (
                                  <span className="text-[var(--muted-foreground)] italic text-xs">null</span>
                                ) : (
                                  text
                                )}
                              </span>
                            </td>
                          );
                        })}
                      </tr>

                      {/* Expanded row */}
                      {isExpanded && (
                        <tr className="border-t-0">
                          <td colSpan={visibleColsList.length + 1} className="px-4 pt-0 pb-3">
                            <div className="rounded-lg border border-[var(--primary)]/20 bg-[var(--primary)]/4 p-4">
                              <p className="text-[9px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-3 flex items-center gap-2">
                                <span>All fields</span>
                                <span className="text-[var(--border)]">·</span>
                                <span>{schema.columns.length} columns</span>
                                {hiddenCount > 0 && (
                                  <>
                                    <span className="text-[var(--border)]">·</span>
                                    <span className="text-[var(--primary)]">{hiddenCount} hidden in table</span>
                                  </>
                                )}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {schema.columns.map((col) => {
                                  const val = row[col.name];
                                  const isHidden = !visibleCols.has(col.name);
                                  return (
                                    <div
                                      key={col.name}
                                      className={`min-w-[140px] flex-1 basis-[140px] max-w-xs rounded-lg px-3 py-2.5 border transition-colors ${
                                        isHidden
                                          ? "bg-[var(--primary)]/6 border-[var(--primary)]/25"
                                          : "bg-[var(--background)] border-[var(--border)]"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1 mb-1.5">
                                        <span className="text-[10px] font-mono text-[var(--muted-foreground)] truncate">{col.name}</span>
                                        {col.isPrimary && <span className="text-[8px] text-[var(--primary)] font-bold shrink-0">PK</span>}
                                        {col.fk && <span className="text-[8px] text-amber-400 font-bold shrink-0">FK</span>}
                                        {col.isJson && <span className="text-[8px] text-emerald-400 font-bold shrink-0">JSON</span>}
                                        {encSettings[col.name] && <span className="text-[8px] text-violet-400 shrink-0">🔒</span>}
                                        {isHidden && <span className="text-[8px] text-[var(--primary)]/60 shrink-0 ml-auto">hidden</span>}
                                      </div>
                                      {renderExpandedValue(col, val)}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {result && (
        <div className="flex items-center justify-between text-sm text-[var(--muted-foreground)]">
          <span>
            {result.total} records &middot; Page {page} of {Math.max(1, totalPages)}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded bg-[var(--secondary)] hover:bg-[var(--accent)] border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[var(--foreground)]"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded bg-[var(--secondary)] hover:bg-[var(--accent)] border border-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[var(--foreground)]"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
