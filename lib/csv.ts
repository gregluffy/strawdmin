function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    s = Buffer.from(value).toString("base64");
  } else if (typeof value === "object") {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsvRow(values: unknown[]): string {
  return values.map(csvCell).join(",") + "\r\n";
}
