"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { SchemaTable } from "@/lib/types";
import { basePath } from "@/lib/api-url";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface Props {
  tableName: string;
  schema: SchemaTable;
  initialData?: Record<string, unknown>;
  mode: "create" | "edit";
  recordId?: string;
}

interface EncModal {
  column: string;
  algorithm: string;
  saltColumn: string | null;
  rawValue: string;
  salt: string;
  loading: boolean;
}

export function RecordForm({ tableName, schema, initialData, mode, recordId }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    if (initialData) return initialData;
    const defaults: Record<string, unknown> = {};
    for (const col of schema.columns) {
      if (!col.isAutoIncrement) {
        defaults[col.name] = col.isJson ? "{}" : "";
      }
    }
    return defaults;
  });
  const [fkOptions, setFkOptions] = useState<Record<string, Record<string, unknown>[]>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [encSettings, setEncSettings] = useState<Record<string, { algorithm: string; saltColumn: string | null }>>({});
  const [encModal, setEncModal] = useState<EncModal | null>(null);

  const loadFkOptions = useCallback(async () => {
    const fkCols = schema.columns.filter((c) => c.fk);
    for (const col of fkCols) {
      if (!col.fk) continue;
      try {
        const res = await fetch(`${basePath}/api/fk-options/${col.fk.table}`);
        if (res.ok) {
          const rows = await res.json();
          setFkOptions((prev) => ({ ...prev, [col.name]: rows }));
        }
      } catch {}
    }
  }, [schema]);

  useEffect(() => { loadFkOptions(); }, [loadFkOptions]);

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

  function setValue(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function openEncModal(colName: string) {
    const cfg = encSettings[colName];
    if (!cfg) return;
    const currentSalt = cfg.saltColumn ? String(values[cfg.saltColumn] ?? "") : "";
    setEncModal({ column: colName, algorithm: cfg.algorithm, saltColumn: cfg.saltColumn, rawValue: "", salt: currentSalt, loading: false });
  }

  async function applyEncryption() {
    if (!encModal) return;
    setEncModal((prev) => prev ? { ...prev, loading: true } : null);
    try {
      const res = await fetch(`${basePath}/api/encrypt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ algorithm: encModal.algorithm, value: encModal.rawValue, salt: encModal.salt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setValues((prev) => {
        const next = { ...prev, [encModal.column]: data.hash };
        if (encModal.saltColumn) next[encModal.saltColumn] = encModal.salt;
        return next;
      });
      setEncModal(null);
    } catch (e) {
      setEncModal((prev) => prev ? { ...prev, loading: false } : null);
      setError(String(e));
    }
  }

  function generateSalt() {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    const salt = String(array[0] % 100_000_000).padStart(8, "0");
    setEncModal((prev) => prev ? { ...prev, salt } : null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    const payload: Record<string, unknown> = {};
    for (const col of schema.columns) {
      if (col.isAutoIncrement && mode === "create") continue;
      if (col.isPrimary && mode === "edit") continue;
      const v = values[col.name];
      if (col.isJson && typeof v === "string") {
        try { payload[col.name] = JSON.parse(v); }
        catch { payload[col.name] = v; }
      } else {
        payload[col.name] = v === "" ? null : v;
      }
    }

    try {
      const url = mode === "create"
        ? `${basePath}/api/tables/${tableName}`
        : `${basePath}/api/tables/${tableName}/${recordId}`;
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      router.push(`/dashboard/tables/${tableName}`);
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {/* Encrypt value modal */}
      {encModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setEncModal(null)}
        >
          <div
            className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">Encrypt value</p>
              <h2 className="font-semibold text-[var(--foreground)] font-mono">{encModal.column}</h2>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">Algorithm: <span className="text-violet-400">{encModal.algorithm}</span></p>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Raw value</label>
                <input
                  type="text"
                  value={encModal.rawValue}
                  onChange={(e) => setEncModal((prev) => prev ? { ...prev, rawValue: e.target.value } : null)}
                  placeholder="Enter plaintext…"
                  className="w-full px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  autoFocus
                />
              </div>
              {encModal.saltColumn && (
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">
                    Salt <span className="opacity-50">(column: {encModal.saltColumn})</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={encModal.salt}
                      onChange={(e) => setEncModal((prev) => prev ? { ...prev, salt: e.target.value } : null)}
                      placeholder="Salt value…"
                      className="flex-1 px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] font-mono"
                    />
                    <button
                      type="button"
                      onClick={generateSalt}
                      title="Auto-generate salt"
                      className="px-3 py-2 bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] rounded-lg text-sm transition-colors border border-[var(--border)]"
                    >
                      ↺
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEncModal(null)}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] border border-[var(--border)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyEncryption}
                disabled={encModal.loading || !encModal.rawValue}
                className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors disabled:opacity-50"
              >
                {encModal.loading ? "Encrypting…" : "Encrypt →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {schema.columns.map((col) => {
        const isDisabled = col.isPrimary || (col.isAutoIncrement && mode === "create");
        const value = values[col.name];

        if (isDisabled && mode === "create") return null;

        return (
          <div key={col.name}>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
              <span className="font-mono">{col.name}</span>
              <span className="ml-2 text-[10px] text-[var(--muted-foreground)] font-sans">
                {col.type}
                {col.isPrimary && " · PK"}
                {col.fk && ` · FK → ${col.fk.table}`}
                {!col.nullable && !col.isPrimary && " · required"}
              </span>
            </label>

            {col.isJson ? (
              <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                <MonacoEditor
                  height="200px"
                  language="json"
                  theme="vs-dark"
                  value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                  onChange={(v) => setValue(col.name, v ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: "off",
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    formatOnPaste: true,
                    readOnly: isDisabled,
                  }}
                />
              </div>
            ) : col.fk && fkOptions[col.name] ? (
              <select
                value={String(value ?? "")}
                onChange={(e) => setValue(col.name, e.target.value)}
                disabled={isDisabled}
                className="w-full px-3 py-2.5 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] text-sm disabled:opacity-60"
              >
                <option value="">— select —</option>
                {fkOptions[col.name].map((row, i) => {
                  const entries = Object.entries(row);
                  const [, pkVal] = entries[0];
                  const labelVal = entries[1]?.[1] ?? pkVal;
                  return (
                    <option key={i} value={String(pkVal)}>
                      {String(pkVal)} — {String(labelVal)}
                    </option>
                  );
                })}
              </select>
            ) : col.type.toLowerCase().includes("bool") ? (
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id={`cb-${col.name}`}
                  checked={Boolean(value)}
                  onChange={(e) => setValue(col.name, e.target.checked)}
                  disabled={isDisabled}
                  className="w-4 h-4 accent-[var(--primary)]"
                />
                <label htmlFor={`cb-${col.name}`} className="text-sm text-[var(--foreground)]">
                  {value ? "true" : "false"}
                </label>
              </div>
            ) : col.type.toLowerCase().includes("date") || col.type.toLowerCase().includes("timestamp") ? (
              <input
                type="datetime-local"
                value={typeof value === "string" ? value.slice(0, 16) : ""}
                onChange={(e) => setValue(col.name, e.target.value)}
                disabled={isDisabled}
                className="w-full px-3 py-2.5 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] text-sm disabled:opacity-60"
              />
            ) : col.type.toLowerCase().includes("int") || col.type.toLowerCase().includes("float") || col.type.toLowerCase().includes("decimal") || col.type.toLowerCase().includes("numeric") || col.type.toLowerCase().includes("real") || col.type.toLowerCase().includes("double") ? (
              <input
                type="number"
                value={value === null || value === undefined ? "" : String(value)}
                onChange={(e) => setValue(col.name, e.target.value ? Number(e.target.value) : null)}
                disabled={isDisabled}
                className="w-full px-3 py-2.5 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] text-sm disabled:opacity-60 font-mono"
              />
            ) : col.type.toLowerCase().includes("text") || col.type.toLowerCase().includes("ntext") || (col.type.toLowerCase().includes("varchar") && !col.isJson) ? (
              <textarea
                value={value === null || value === undefined ? "" : String(value)}
                onChange={(e) => setValue(col.name, e.target.value)}
                disabled={isDisabled}
                rows={3}
                className="w-full px-3 py-2.5 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] text-sm disabled:opacity-60 resize-y"
              />
            ) : (
              <input
                type="text"
                value={value === null || value === undefined ? "" : String(value)}
                onChange={(e) => setValue(col.name, e.target.value)}
                disabled={isDisabled}
                className="w-full px-3 py-2.5 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] text-sm disabled:opacity-60 font-mono"
              />
            )}
            {encSettings[col.name] && !isDisabled && (
              <button
                type="button"
                onClick={() => openEncModal(col.name)}
                className="mt-1.5 text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 transition-colors"
              >
                🔐 Set encrypted value
              </button>
            )}
          </div>
        );
      })}

      {error && (
        <div className="p-3 rounded-lg bg-[var(--destructive)]/10 border border-[var(--destructive)]/20 text-[var(--destructive)] text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : mode === "create" ? "Create Record" : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-5 py-2.5 bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] rounded-lg font-medium text-sm transition-colors border border-[var(--border)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
