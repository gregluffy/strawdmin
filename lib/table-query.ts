import type { DbDriver } from "./drivers";
import { getTable } from "./introspect";
import { getFkSettings } from "./internal-db";
import { buildFilterClause } from "./sql";
import { buildSearchClause, columnSearchKind, type SearchTarget } from "./search";
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
 * the CSV export, so both stay in sync: free-text `search` is split into
 * terms, each of which must match at least one searchable column (native or
 * FK-joined display column), ANDed with the column-scoped `filters` (which
 * are combined with each other via `filterLogic`). `hiddenColumns` are
 * excluded from both, so column policies can't be probed through search.
 */
export async function buildSearchAndFilterClause(opts: {
  driver: DbDriver;
  table: string;
  schema: SchemaTable;
  conn: DbConnection;
  search: string;
  filters: FilterCondition[];
  filterLogic: FilterLogic;
  hiddenColumns?: Set<string>;
}): Promise<SearchAndFilterResult> {
  const { driver, table, schema, conn, filters, filterLogic } = opts;
  const hidden = opts.hiddenColumns ?? new Set<string>();
  const search = opts.search.trim();
  const dbType = driver.dbType;
  const queryParams: unknown[] = [];
  const fkJoins: string[] = [];
  const fkTargets: SearchTarget[] = [];
  const visibleColumns = schema.columns.filter((c) => !hidden.has(c.name));

  if (search) {
    const fkSettings = await getFkSettings(table, conn.id);
    let joinIdx = 0;
    for (const setting of fkSettings) {
      const col = visibleColumns.find((c) => c.name === setting.column_name);
      if (!col?.fk) continue;
      const refSchema = await getTable(col.fk.table, conn);
      if (!refSchema) continue;

      if (setting.display_path.length === 1) {
        const [displayField] = setting.display_path;
        const displayCol = refSchema.columns.find((c) => c.name === displayField);
        if (!displayCol || columnSearchKind(displayCol, dbType) === "none") continue;
        const alias = `_fk${joinIdx++}`;
        fkJoins.push(
          `LEFT JOIN ${driver.quote(col.fk.table)} ${alias} ON ${driver.quote(table)}.${driver.quote(col.name)} = ${alias}.${driver.quote(col.fk.column)}`
        );
        fkTargets.push({ sql: `${alias}.${driver.quote(displayField)}`, type: displayCol.type, isJson: displayCol.isJson });
      } else if (setting.display_path.length === 2) {
        const [hopCol, displayField] = setting.display_path;
        const hopColDef = refSchema.columns.find((c) => c.name === hopCol);
        if (!hopColDef?.fk) continue;
        const hop2Schema = await getTable(hopColDef.fk.table, conn);
        const displayCol = hop2Schema?.columns.find((c) => c.name === displayField);
        if (!displayCol || columnSearchKind(displayCol, dbType) === "none") continue;
        const alias1 = `_fk${joinIdx++}`;
        fkJoins.push(
          `LEFT JOIN ${driver.quote(col.fk.table)} ${alias1} ON ${driver.quote(table)}.${driver.quote(col.name)} = ${alias1}.${driver.quote(col.fk.column)}`
        );
        const alias2 = `_fk${joinIdx++}`;
        fkJoins.push(
          `LEFT JOIN ${driver.quote(hopColDef.fk.table)} ${alias2} ON ${alias1}.${driver.quote(hopCol)} = ${alias2}.${driver.quote(hopColDef.fk.column)}`
        );
        fkTargets.push({ sql: `${alias2}.${driver.quote(displayField)}`, type: displayCol.type, isJson: displayCol.isJson });
      }
    }
  }

  const joinClause = fkJoins.length > 0 ? ` ${fkJoins.join(" ")}` : "";
  const tableRef = fkJoins.length > 0 ? `${driver.quote(table)}.` : "";

  const whereClauses: string[] = [];

  if (search) {
    const targets: SearchTarget[] = [
      ...visibleColumns.map((c) => ({ sql: `${tableRef}${driver.quote(c.name)}`, type: c.type, isJson: c.isJson })),
      ...fkTargets,
    ];
    const searchClause = buildSearchClause({ dbType, placeholder: driver.placeholder, targets, search, queryParams });
    if (searchClause) whereClauses.push(searchClause);
  }

  const filterClause = buildFilterClause({
    dbType,
    quote: driver.quote,
    placeholder: driver.placeholder,
    conditions: filters,
    logic: filterLogic,
    columns: new Map(visibleColumns.map((c) => [c.name, c])),
    queryParams,
    tableRef,
  });
  if (filterClause) whereClauses.push(filterClause);

  const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";

  return { joinClause, tableRef, whereSql, queryParams };
}
