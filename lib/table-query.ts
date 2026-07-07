import type { DbDriver } from "./drivers";
import { getTable } from "./introspect";
import { getFkSettings } from "./internal-db";
import { buildFilterClause, isTextishType } from "./sql";
import type { DbConnection, FilterCondition, FilterLogic, FilterOperator, SchemaTable } from "./types";

const VALID_OPERATORS = new Set<FilterOperator>([
  "eq", "neq", "gt", "gte", "lt", "lte",
  "contains", "not_contains", "starts_with", "ends_with",
  "is_null", "is_not_null",
]);

export function parseFilters(raw: string | null, validColumns: Set<string>): FilterCondition[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: FilterCondition[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const c = item as Record<string, unknown>;
      if (typeof c.column !== "string" || !validColumns.has(c.column)) continue;
      if (typeof c.operator !== "string" || !VALID_OPERATORS.has(c.operator as FilterOperator)) continue;
      result.push({
        column: c.column,
        operator: c.operator as FilterOperator,
        value: typeof c.value === "string" ? c.value : "",
      });
    }
    return result;
  } catch {
    return [];
  }
}

export interface SearchAndFilterResult {
  joinClause: string;
  tableRef: string;
  whereSql: string;
  queryParams: unknown[];
}

/**
 * Builds the JOIN + WHERE fragments shared by the paginated table view and
 * the CSV export, so both stay in sync: free-text `search` OR-matches across
 * textish columns (and FK-joined display columns), ANDed with the
 * column-scoped `filters` (which are combined with each other via `filterLogic`).
 */
export async function buildSearchAndFilterClause(opts: {
  driver: DbDriver;
  table: string;
  schema: SchemaTable;
  conn: DbConnection;
  search: string;
  filters: FilterCondition[];
  filterLogic: FilterLogic;
}): Promise<SearchAndFilterResult> {
  const { driver, table, schema, conn, search, filters, filterLogic } = opts;
  const queryParams: unknown[] = [];
  const fkJoins: string[] = [];
  const fkConditions: Array<{ alias: string; field: string }> = [];

  if (search) {
    const fkSettings = await getFkSettings(table, conn.id);
    let joinIdx = 0;
    for (const setting of fkSettings) {
      const col = schema.columns.find((c) => c.name === setting.column_name);
      if (!col?.fk) continue;
      const refSchema = await getTable(col.fk.table, conn);
      if (!refSchema) continue;

      if (setting.display_path.length === 1) {
        const [displayField] = setting.display_path;
        if (!refSchema.columns.some((c) => c.name === displayField)) continue;
        const alias = `_fk${joinIdx++}`;
        fkJoins.push(
          `LEFT JOIN ${driver.quote(col.fk.table)} ${alias} ON ${driver.quote(table)}.${driver.quote(col.name)} = ${alias}.${driver.quote(col.fk.column)}`
        );
        fkConditions.push({ alias, field: displayField });
      } else if (setting.display_path.length === 2) {
        const [hopCol, displayField] = setting.display_path;
        const hopColDef = refSchema.columns.find((c) => c.name === hopCol);
        if (!hopColDef?.fk) continue;
        const hop2Schema = await getTable(hopColDef.fk.table, conn);
        if (!hop2Schema?.columns.some((c) => c.name === displayField)) continue;
        const alias1 = `_fk${joinIdx++}`;
        fkJoins.push(
          `LEFT JOIN ${driver.quote(col.fk.table)} ${alias1} ON ${driver.quote(table)}.${driver.quote(col.name)} = ${alias1}.${driver.quote(col.fk.column)}`
        );
        const alias2 = `_fk${joinIdx++}`;
        fkJoins.push(
          `LEFT JOIN ${driver.quote(hopColDef.fk.table)} ${alias2} ON ${alias1}.${driver.quote(hopCol)} = ${alias2}.${driver.quote(hopColDef.fk.column)}`
        );
        fkConditions.push({ alias: alias2, field: displayField });
      }
    }
  }

  const joinClause = fkJoins.length > 0 ? ` ${fkJoins.join(" ")}` : "";
  const tableRef = fkJoins.length > 0 ? `${driver.quote(table)}.` : "";

  const whereClauses: string[] = [];

  if (search) {
    const textCols = schema.columns.filter((c) => !c.isJson && isTextishType(c.type));
    const searchConditions: string[] = [];
    for (const c of textCols) {
      const idx = queryParams.length;
      queryParams.push(`%${search}%`);
      searchConditions.push(`${tableRef}${driver.quote(c.name)} LIKE ${driver.placeholder(idx)}`);
    }
    for (const { alias, field } of fkConditions) {
      const idx = queryParams.length;
      queryParams.push(`%${search}%`);
      searchConditions.push(`${alias}.${driver.quote(field)} LIKE ${driver.placeholder(idx)}`);
    }
    if (searchConditions.length > 0) whereClauses.push(`(${searchConditions.join(" OR ")})`);
  }

  const validColumns = new Set(schema.columns.map((c) => c.name));
  const filterClause = buildFilterClause(driver.quote, driver.placeholder, filters, filterLogic, validColumns, queryParams, tableRef);
  if (filterClause) whereClauses.push(filterClause);

  const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";

  return { joinClause, tableRef, whereSql, queryParams };
}
