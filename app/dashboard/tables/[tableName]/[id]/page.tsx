import { notFound } from "next/navigation";
import { getTable } from "@/lib/introspect";
import { getDriver } from "@/lib/drivers";
import { serializeRow } from "@/lib/sql";
import { RecordForm } from "@/components/record/RecordForm";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import Link from "next/link";

export default async function RecordPage({
  params,
}: {
  params: Promise<{ tableName: string; id: string }>;
}) {
  const { tableName, id } = await params;
  const schema = await getTable(tableName);
  if (!schema) notFound();

  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value ?? "";
  let isAdmin = false;
  try {
    const payload = await verifyToken(token);
    isAdmin = payload.role === "admin";
  } catch {}

  let row: Record<string, unknown> | null = null;
  let fetchError = "";
  try {
    const driver = getDriver();
    const rows = await driver.query(
      `SELECT * FROM ${driver.quote(tableName)} WHERE ${driver.quote(schema.primaryKey)} = ${driver.placeholder(0)}`,
      [id]
    );
    row = (rows[0] as Record<string, unknown>) ?? null;
    if (row) row = serializeRow(row);
  } catch (e) {
    fetchError = String(e);
  }

  if (!row && !fetchError) notFound();

  if (row) {
    for (const col of schema.columns) {
      if (col.isJson && row[col.name] && typeof row[col.name] !== "string") {
        row[col.name] = JSON.stringify(row[col.name], null, 2);
      }
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] mb-6">
        <Link href={`/dashboard/tables/${tableName}`} className="hover:text-[var(--foreground)] transition-colors font-mono">
          {tableName}
        </Link>
        <span>›</span>
        <span className="text-[var(--foreground)] font-mono">{id}</span>
      </div>

      <h1 className="text-xl font-bold text-[var(--foreground)] mb-6">
        {isAdmin ? "Edit Record" : "View Record"}
      </h1>

      {fetchError ? (
        <div className="p-4 rounded-lg bg-[var(--destructive)]/10 border border-[var(--destructive)]/20 text-[var(--destructive)]">
          {fetchError}
        </div>
      ) : row ? (
        <RecordForm
          tableName={tableName}
          schema={schema}
          initialData={row}
          mode={isAdmin ? "edit" : "edit"}
          recordId={id}
        />
      ) : null}
    </div>
  );
}
