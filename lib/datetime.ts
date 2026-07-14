export type TemporalKind = "datetime" | "date" | null;

/**
 * Which HTML date input a column maps to, or null for columns we render as plain text
 * (TIME, INTERVAL, YEAR — none of which round-trip cleanly through a date input).
 */
export function temporalKind(sqlType: string): TemporalKind {
  const t = sqlType.toLowerCase();
  if (t.includes("timestamp") || t.includes("datetime")) return "datetime";
  if (t.includes("date")) return "date";
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localParts(d: Date): { date: string; time: string } {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

/**
 * Render a value coming out of any driver into what an <input type="date"|"datetime-local">
 * expects. Drivers are inconsistent: pg/mysql2 return Date objects, libsql/mssql may return
 * "2026-07-14 12:00:00" or ISO strings, and some schemas store epoch millis.
 *
 * Strings that already carry a wall-clock reading are reformatted textually rather than parsed,
 * so an untouched value is written back exactly as it was stored.
 */
export function toDateInputValue(value: unknown, kind: TemporalKind): string {
  if (kind === null || value === null || value === undefined || value === "") return "";

  let datePart = "";
  let timePart = "";

  if (value instanceof Date || typeof value === "number") {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    ({ date: datePart, time: timePart } = localParts(d));
  } else if (typeof value === "string") {
    const s = value.trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/);
    if (m) {
      datePart = m[1];
      timePart = m[2] ?? "";
    } else if (/\d{4}/.test(s)) {
      // Only attempt a loose parse when there's at least a plausible year. Date's parser is far
      // too eager otherwise — new Date("2") is 2001-02-01, which would rewrite half-typed input.
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return "";
      ({ date: datePart, time: timePart } = localParts(d));
    } else {
      return "";
    }
  } else {
    return "";
  }

  if (kind === "date") return datePart;
  if (!datePart) return "";
  if (timePart.length === 5) timePart += ":00";
  return `${datePart}T${timePart || "00:00:00"}`;
}

/** Turn an input's value back into a literal every driver accepts, or null for an empty field. */
export function fromDateInputValue(input: string, kind: TemporalKind): string | null {
  if (kind === null) return input === "" ? null : input;
  const s = input.trim();
  if (!s) return null;
  return kind === "datetime" ? s.replace("T", " ") : s;
}
