"use client";

import { useEffect, useState } from "react";
import type { TemporalKind } from "@/lib/datetime";
import { toDateInputValue } from "@/lib/datetime";

interface Props {
  kind: Exclude<TemporalKind, null>;
  /** Canonical value: "YYYY-MM-DDTHH:mm:ss" (datetime) or "YYYY-MM-DD" (date), or "". */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

const PATTERN = {
  datetime: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
} as const;

/** Canonical value -> what the user sees. */
function toText(value: string): string {
  return value.replace("T", " ");
}

/**
 * A plain text date field on a 24-hour clock. The native <input type="datetime-local"> renders
 * its clock from the browser's own locale, which no attribute reliably overrides — so we render
 * the value ourselves in the same ISO-ish shape the database stores.
 */
export function DateTimeField({ kind, value, onChange, disabled, id }: Props) {
  const [text, setText] = useState(() => toText(value));

  // Resync when the value changes from outside (e.g. the hash modal writing a salt column).
  useEffect(() => {
    setText((prev) => (prev.replace("T", " ") === toText(value) ? prev : toText(value)));
  }, [value]);

  const invalid = text.trim() !== "" && !PATTERN[kind].test(text.trim());

  function commit(next: string) {
    setText(next);
    onChange(next.trim());
  }

  function setNow() {
    const now = toDateInputValue(new Date(), kind);
    commit(toText(now));
  }

  const placeholder = kind === "date" ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss";

  return (
    <div>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => commit(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={invalid}
          className={`w-full px-3 py-2.5 pr-16 bg-[var(--input)] border rounded-lg text-[var(--foreground)] focus:outline-none focus:ring-2 text-sm disabled:opacity-60 font-mono ${
            invalid
              ? "border-[var(--destructive)] focus:ring-[var(--destructive)]"
              : "border-[var(--border)] focus:ring-[var(--ring)]"
          }`}
        />
        {!disabled && (
          <button
            type="button"
            onClick={setNow}
            title={`Set to the current ${kind === "date" ? "date" : "date and time"}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded-md bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-[var(--border)] transition-colors"
          >
            now
          </button>
        )}
      </div>
      {invalid && (
        <p className="mt-1 text-xs text-[var(--destructive)]">Expected {placeholder}</p>
      )}
    </div>
  );
}
