import { TEXTISH_TYPES } from "./types";

/**
 * How a column participates in free-text search / substring filters.
 *
 * - `text`     — native string column, matched with a (case-insensitive) LIKE
 * - `cast`     — non-string but textual-looking value (uuid, macaddr, inet, enum,
 *                citext, unknown SQLite affinity…) — cast to text, then LIKE
 * - `integer`  — matched by equality, only when the term is an in-range integer
 * - `decimal`  — matched by equality, only when the term is numeric
 * - `temporal` — cast to an ISO-ish string and LIKE-matched, only for date-looking terms
 * - `none`     — never searched (json, binary, boolean, spatial, arrays…)
 *
 * Kept free of server-only imports so the client can use it to pick filter operators.
 */
export type SearchKind = "text" | "cast" | "integer" | "decimal" | "temporal" | "none";

const NONE_RE = /json|binary|blob|bytea|^image$|^bool|^bit\b|geometry|geography|^point$|^line|^lseg$|^box$|^path$|^polygon$|^circle$|hierarchyid|^xml$|tsvector|tsquery|^array$|^sql_variant$|^interval/;
const TEMPORAL_RE = /^(date|datetime|datetime2|smalldatetime|datetimeoffset|time|timestamp|timestamptz|year)\b/;
const INTEGER_RE = /^(tiny|small|medium|big)?int(eger)?\d*(\b|$)|^(small|big)?serial\d*\b/;
const DECIMAL_RE = /^(decimal|numeric|real|float\d*|double|money|smallmoney|number|dec)\b/;

export function isTextishType(colType: string): boolean {
  const t = colType.toLowerCase();
  return TEXTISH_TYPES.some((needle) => t.includes(needle));
}

export function columnSearchKind(col: { type: string; isJson?: boolean }, dbType?: string): SearchKind {
  const t = (col.type ?? "").trim().toLowerCase();
  if (col.isJson) return "none";
  // MSSQL `timestamp` is rowversion (binary), not a date.
  if (dbType === "mssql" && t === "timestamp") return "none";
  if (NONE_RE.test(t)) return "none";
  if (isTextishType(t)) return "text";
  if (TEMPORAL_RE.test(t)) return "temporal";
  if (INTEGER_RE.test(t)) return "integer";
  if (DECIMAL_RE.test(t)) return "decimal";
  return "cast";
}

/** True when LIKE-style operators (contains, starts with…) make sense for the column. */
export function supportsSubstringMatch(col: { type: string; isJson?: boolean }, dbType?: string): boolean {
  const kind = columnSearchKind(col, dbType);
  return kind === "text" || kind === "cast";
}

/**
 * Splits a search string into terms. Whitespace separates terms; double quotes
 * keep a phrase together (`"john smith"`). Every term must match somewhere in
 * the row (AND), each term may match any searchable column (OR).
 */
export function tokenizeSearch(input: string, maxTerms = 8): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const term = (m[1] ?? m[2] ?? "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= maxTerms) break;
  }
  return terms;
}

const MAC_GROUPS_RE = /^[0-9a-f]{2}([:-])[0-9a-f]{2}(\1[0-9a-f]{2}){1,4}$/i;
const MAC_BARE_RE = /^[0-9a-f]{12}$/i;
const MAC_CISCO_RE = /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i;

/**
 * Alternative spellings a term should also match. MAC addresses are stored in
 * many notations (80:f3:da…, 80-F3-DA…, 80f3da…, 80f3.da50.0e3c), so a
 * MAC-looking term (full, or a prefix of ≥3 groups) is expanded into the
 * colon, dash and bare-hex forms. Case is handled by the case-insensitive LIKE.
 */
export function termVariants(term: string): string[] {
  let groups: string[] | null = null;
  if (MAC_GROUPS_RE.test(term)) groups = term.split(/[:-]/);
  else if (MAC_BARE_RE.test(term)) groups = term.match(/../g);
  else if (MAC_CISCO_RE.test(term)) groups = term.replace(/\./g, "").match(/../g);
  if (!groups) return [term];
  const variants = [term, groups.join(":"), groups.join("-"), groups.join("")];
  if (groups.length === 6) {
    const bare = groups.join("");
    variants.push(`${bare.slice(0, 4)}.${bare.slice(4, 8)}.${bare.slice(8)}`);
  }
  const seen = new Set<string>();
  return variants.filter((v) => {
    const k = v.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const LIKE_ESCAPE = "!";

/** Escapes LIKE metacharacters so user input is matched literally (paired with `ESCAPE '!'`). */
export function escapeLike(value: string, dbType: string): string {
  // MSSQL additionally treats [...] as a character class.
  const re = dbType === "mssql" ? /[!%_[]/g : /[!%_]/g;
  return value.replace(re, `${LIKE_ESCAPE}$&`);
}

/** SQL expression rendering `colSql` as text, for types that cannot be LIKE-matched directly. */
export function castToText(colSql: string, dbType: string, kind: SearchKind): string {
  switch (dbType) {
    case "postgres":
      return `CAST(${colSql} AS TEXT)`;
    case "mysql":
    case "mariadb":
      return `CAST(${colSql} AS CHAR)`;
    case "mssql":
      // Style 121 = ODBC canonical (yyyy-mm-dd hh:mi:ss.mmm), so dates search like they display.
      return kind === "temporal"
        ? `CONVERT(NVARCHAR(50), ${colSql}, 121)`
        : `CAST(${colSql} AS NVARCHAR(MAX))`;
    default:
      return `CAST(${colSql} AS TEXT)`;
  }
}

/**
 * Case-insensitive LIKE. Postgres needs ILIKE; MySQL/MariaDB/MSSQL use the
 * column collation (case-insensitive by default); SQLite LIKE is
 * case-insensitive for ASCII.
 */
export function likeSql(exprSql: string, placeholderSql: string, dbType: string, negate = false): string {
  const op = dbType === "postgres" ? "ILIKE" : "LIKE";
  return `${exprSql} ${negate ? "NOT " : ""}${op} ${placeholderSql} ESCAPE '${LIKE_ESCAPE}'`;
}

/** Expression to LIKE against for a column of the given kind (casting when needed). */
export function likeTarget(colSql: string, kind: SearchKind, dbType: string): string {
  return kind === "text" ? colSql : castToText(colSql, dbType, kind);
}

const INT_TERM_RE = /^[-+]?\d+$/;
const DECIMAL_TERM_RE = /^[-+]?(\d+\.?\d*|\.\d+)$/;
const DATE_TERM_RE = /^(\d{4}|(?=.*\d)(?=.*[-:/])[\d\-:/. T]+)$/;

const I8_MIN = -BigInt("9223372036854775808");
const I8_MAX = BigInt("9223372036854775807");
const U8_MAX = BigInt("18446744073709551615");
const I4_MIN = BigInt(-2147483648);
const I4_MAX = BigInt(2147483647);

/** Inclusive integer bounds per type, for DBs that error on out-of-range comparisons. */
function integerBounds(colType: string, dbType: string): [bigint, bigint] {
  // MySQL/MariaDB/SQLite compare out-of-range values without erroring.
  if (dbType !== "postgres" && dbType !== "mssql") return [I8_MIN, U8_MAX];
  const t = colType.toLowerCase();
  if (/^tinyint/.test(t)) return [BigInt(0), BigInt(255)];
  if (/^(smallint|int2|smallserial)/.test(t)) return [BigInt(-32768), BigInt(32767)];
  if (/^(bigint|int8|bigserial)/.test(t)) return [I8_MIN, I8_MAX];
  return [I4_MIN, I4_MAX];
}

export function parseIntegerTerm(term: string, colType: string, dbType: string): number | string | null {
  if (!INT_TERM_RE.test(term)) return null;
  const n = BigInt(term);
  const [min, max] = integerBounds(colType, dbType);
  if (n < min || n > max) return null;
  const asNum = Number(n);
  return Number.isSafeInteger(asNum) ? asNum : n.toString();
}

export function parseDecimalTerm(term: string): number | null {
  if (!DECIMAL_TERM_RE.test(term)) return null;
  const n = Number(term);
  return Number.isFinite(n) ? n : null;
}

export interface SearchTarget {
  /** Fully qualified SQL for the column, e.g. `"orders"."notes"` or `_fk0."name"`. */
  sql: string;
  type: string;
  isJson?: boolean;
}

/**
 * Builds `(t1 matches any column) AND (t2 matches any column) …`, appending
 * bound values to `queryParams`. Returns `1 = 0` when some term can match no
 * column at all (so an impossible search yields no rows instead of all rows),
 * or null when there is nothing to search for.
 */
export function buildSearchClause(opts: {
  dbType: string;
  placeholder: (i: number) => string;
  targets: SearchTarget[];
  search: string;
  queryParams: unknown[];
}): string | null {
  const { dbType, placeholder, targets, queryParams } = opts;
  let terms = tokenizeSearch(opts.search);
  if (terms.length === 0) return null;

  const classified = targets
    .map((t) => ({ ...t, kind: columnSearchKind(t, dbType) }))
    .filter((t) => t.kind !== "none");

  // MSSQL caps a request at 2100 parameters; keep well clear of it.
  const maxParams = 2000 - queryParams.length;
  if (classified.length > 0) {
    // Up to 5 LIKE variants per term (MAC notations) on each column.
    terms = terms.slice(0, Math.max(1, Math.floor(maxParams / (classified.length * 5))));
  }

  const termClauses: string[] = [];
  for (const term of terms) {
    const ors: string[] = [];
    for (const t of classified) {
      const push = (value: unknown) => {
        const idx = queryParams.length;
        queryParams.push(value);
        return placeholder(idx);
      };
      switch (t.kind) {
        case "text":
        case "cast":
          for (const variant of termVariants(term)) {
            ors.push(likeSql(likeTarget(t.sql, t.kind, dbType), push(`%${escapeLike(variant, dbType)}%`), dbType));
          }
          break;
        case "temporal":
          if (DATE_TERM_RE.test(term)) {
            ors.push(likeSql(likeTarget(t.sql, t.kind, dbType), push(`%${escapeLike(term, dbType)}%`), dbType));
          }
          break;
        case "integer": {
          const v = parseIntegerTerm(term, t.type, dbType);
          if (v !== null) ors.push(`${t.sql} = ${push(v)}`);
          break;
        }
        case "decimal": {
          const v = parseDecimalTerm(term);
          if (v !== null) ors.push(`${t.sql} = ${push(v)}`);
          break;
        }
      }
    }
    if (ors.length === 0) return "1 = 0";
    termClauses.push(ors.length === 1 ? ors[0] : `(${ors.join(" OR ")})`);
  }
  return termClauses.length === 1 ? termClauses[0] : `(${termClauses.join(" AND ")})`;
}
