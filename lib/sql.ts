import { TEXTISH_TYPES, type FilterCondition, type FilterLogic, type FilterOperator } from "./types";

export function isTextishType(colType: string): boolean {
  const t = colType.toLowerCase();
  return TEXTISH_TYPES.some((needle) => t.includes(needle));
}

const NO_VALUE_OPERATORS = new Set<FilterOperator>(["is_null", "is_not_null"]);

/**
 * Builds a parenthesized WHERE fragment from a flat list of column conditions
 * joined by a single AND/OR logic operator. Columns not present in
 * `validColumns` are silently dropped (defense against stale/forged input).
 */
export function buildFilterClause(
  quote: (s: string) => string,
  placeholder: (i: number) => string,
  conditions: FilterCondition[],
  logic: FilterLogic,
  validColumns: Set<string>,
  queryParams: unknown[],
  tableRef = ""
): string | null {
  const parts: string[] = [];
  for (const cond of conditions) {
    if (!validColumns.has(cond.column)) continue;
    const colSql = `${tableRef}${quote(cond.column)}`;

    if (cond.operator === "is_null") { parts.push(`${colSql} IS NULL`); continue; }
    if (cond.operator === "is_not_null") { parts.push(`${colSql} IS NOT NULL`); continue; }
    if (NO_VALUE_OPERATORS.has(cond.operator)) continue;
    if (!cond.value) continue;

    let opSql: string;
    let value: unknown = cond.value;
    switch (cond.operator) {
      case "eq": opSql = "="; break;
      case "neq": opSql = "!="; break;
      case "gt": opSql = ">"; break;
      case "gte": opSql = ">="; break;
      case "lt": opSql = "<"; break;
      case "lte": opSql = "<="; break;
      case "contains": opSql = "LIKE"; value = `%${cond.value}%`; break;
      case "not_contains": opSql = "NOT LIKE"; value = `%${cond.value}%`; break;
      case "starts_with": opSql = "LIKE"; value = `${cond.value}%`; break;
      case "ends_with": opSql = "LIKE"; value = `%${cond.value}`; break;
      default: continue;
    }
    const idx = queryParams.length;
    queryParams.push(value);
    parts.push(`${colSql} ${opSql} ${placeholder(idx)}`);
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
