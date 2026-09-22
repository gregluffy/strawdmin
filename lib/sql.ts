import type { Column, FilterCondition, FilterLogic } from "./types";
import { columnSearchKind, escapeLike, likeSql, likeTarget, parseDecimalTerm, parseIntegerTerm } from "./search";

export { isTextishType } from "./search";

/** Thrown for user-supplied filter values that cannot apply to the column's type. */
export class FilterValidationError extends Error {}

/**
 * Builds a parenthesized WHERE fragment from a flat list of column conditions
 * joined by a single AND/OR logic operator. Columns not present in `columns`
 * are silently dropped (defense against stale/forged/hidden input).
 *
 * Substring operators cast non-text columns to text (Postgres has no implicit
 * `integer LIKE text`), are case-insensitive, and match user input literally.
 * Comparison operators on numeric columns reject non-numeric values up front
 * instead of letting the database error out.
 */
export function buildFilterClause(opts: {
  dbType: string;
  quote: (s: string) => string;
  placeholder: (i: number) => string;
  conditions: FilterCondition[];
  logic: FilterLogic;
  columns: Map<string, Pick<Column, "name" | "type" | "isJson">>;
  queryParams: unknown[];
  tableRef?: string;
}): string | null {
  const { dbType, quote, placeholder, conditions, logic, columns, queryParams, tableRef = "" } = opts;
  const parts: string[] = [];
  const push = (value: unknown) => {
    const idx = queryParams.length;
    queryParams.push(value);
    return placeholder(idx);
  };

  for (const cond of conditions) {
    const col = columns.get(cond.column);
    if (!col) continue;
    const colSql = `${tableRef}${quote(cond.column)}`;

    if (cond.operator === "is_null") { parts.push(`${colSql} IS NULL`); continue; }
    if (cond.operator === "is_not_null") { parts.push(`${colSql} IS NOT NULL`); continue; }
    if (!cond.value) continue;

    const kind = columnSearchKind(col, dbType);
    const escaped = escapeLike(cond.value, dbType);
    switch (cond.operator) {
      case "contains":
      case "not_contains":
      case "starts_with":
      case "ends_with": {
        const pattern =
          cond.operator === "starts_with" ? `${escaped}%`
          : cond.operator === "ends_with" ? `%${escaped}`
          : `%${escaped}%`;
        const target = likeTarget(colSql, kind === "none" ? "cast" : kind, dbType);
        parts.push(likeSql(target, push(pattern), dbType, cond.operator === "not_contains"));
        continue;
      }
      case "eq": case "neq": case "gt": case "gte": case "lt": case "lte": {
        const opSql = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[cond.operator];
        let value: unknown = cond.value;
        let target = colSql;
        if (kind === "integer" || kind === "decimal") {
          const n = kind === "integer" ? parseIntegerTerm(cond.value.trim(), col.type, dbType) : parseDecimalTerm(cond.value.trim());
          if (n === null) {
            throw new FilterValidationError(`"${cond.value}" is not a valid ${kind === "integer" ? "integer" : "number"} for column ${cond.column}`);
          }
          value = n;
        } else if (kind === "cast" && dbType === "postgres") {
          // uuid/enum/inet… reject malformed literals in Postgres; compare as text instead.
          target = likeTarget(colSql, kind, dbType);
        }
        parts.push(`${target} ${opSql} ${push(value)}`);
        continue;
      }
      default:
        continue;
    }
  }
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `(${parts.join(` ${logic} `)})`;
}

export function quoteIdentifier(dbType: string): (s: string) => string {
  const t = dbType.trim().toLowerCase();
  if (t === "mssql") return (s) => `[${s.replace(/]/g, "]]")}]`;
  if (t === "mysql" || t === "mariadb") return (s) => `\`${s.replace(/`/g, "``")}\``;
  return (s) => `"${s.replace(/"/g, '""')}"`;
}

export function placeholder(dbType: string, i: number): string {
  const t = dbType.trim().toLowerCase();
  if (t === "postgres") return `$${i + 1}`;
  if (t === "mssql") return `@p${i}`;
  return "?";
}

export function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
      out[k] = Buffer.from(v).toString("base64");
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function isBinaryType(colType: string): boolean {
  const t = colType.toLowerCase();
  return t.includes("binary") || t === "image";
}

export function deserializeBinary(value: unknown, colType: string): unknown {
  if (typeof value === "string" && isBinaryType(colType)) {
    return Buffer.from(value, "base64");
  }
  return value;
}
