import { notFound, redirect } from "next/navigation";
import { getTable } from "@/lib/introspect";
import { getDriver } from "@/lib/drivers";
import { serializeRow } from "@/lib/sql";
import { RecordForm } from "@/components/record/RecordForm";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getUserTablePolicy, getUserColumnPolicies } from "@/lib/internal-db";
import Link from "next/link";
import { basePath } from "@/lib/api-url";

export default async function NewRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ tableName: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { tableName } = await params;
  const { from } = await searchParams;
  const schema = await getTable(tableName);
  if (!schema) notFound();

  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value ?? "";
  let isAdmin = false;
  let userId: number | null = null;
  try {
    const payload = await verifyToken(token);
    isAdmin = payload.role === "admin";
    userId = payload.sub;
  } catch {}

  let columnPolicies: Record<string, { hidden: boolean; read_only: boolean }> = {};

  if (!isAdmin && userId !== null) {
    const policy = await getUserTablePolicy(userId, tableName);
    if (!policy.can_insert) redirect(`${basePath}/dashboard/tables/${tableName}`);
    columnPolicies = await getUserColumnPolicies(userId, tableName);
  }

  // If duplicating, fetch source row and strip PK + hidden columns
  let initialData: Record<string, unknown> | undefined;
  if (from) {
    try {
      const driver = getDriver();
      const rows = await driver.query(
        `SELECT * FROM ${driver.quote(tableName)} WHERE ${driver.quote(schema.primaryKey)} = ${driver.placeholder(0)}`,
        [from]
      );
      if (rows[0]) {
        const row = serializeRow(rows[0] as Record<string, unknown>);
        // Serialize JSON columns to string (same as edit page)
        for (const col of schema.columns) {
          if (col.isJson && row[col.name] && typeof row[col.name] !== "string") {
            row[col.name] = JSON.stringify(row[col.name], null, 2);
          }
        }
        // Clear PK — the new record must have its own unique key
        delete row[schema.primaryKey];
        // Clear hidden columns the current user can't see
        for (const [col, p] of Object.entries(columnPolicies)) {
          if (p.hidden) delete row[col];
        }
        initialData = row;
      }
    } catch {
      // If source row fetch fails, fall through to empty form
    }
  }

  const isDuplicate = !!initialData;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] mb-6">
        <Link href={`${basePath}/dashboard/tables/${tableName}`} className="hover:text-[var(--foreground)] transition-colors font-mono">
          {tableName}
        </Link>
        <span>›</span>
        <span className="text-[var(--foreground)]">{isDuplicate ? `Duplicate of #${from}` : "New Record"}</span>
      </div>

      <h1 className="text-xl font-bold text-[var(--foreground)] mb-6">
        {isDuplicate ? "Duplicate Record" : "Create New Record"}
      </h1>

      {isDuplicate && (
        <div className="mb-5 px-4 py-3 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/8 text-sm text-[var(--muted-foreground)]">
          Pre-filled from record <span className="font-mono text-[var(--foreground)]">#{from}</span>. Fill in a new primary key and review all fields before saving.
        </div>
      )}

      <RecordForm tableName={tableName} schema={schema} mode="create" initialData={initialData} columnPolicies={columnPolicies} />
    </div>
  );
}
