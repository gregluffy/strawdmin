export function quoteIdentifier(dbType: string): (s: string) => string {
  const t = dbType.trim().toLowerCase();
  if (t === "mssql") return (s) => `[${s}]`;
  if (t === "mysql" || t === "mariadb") return (s) => `\`${s}\``;
  return (s) => `"${s}"`;
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
