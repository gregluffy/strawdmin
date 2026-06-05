import { notFound, redirect } from "next/navigation";
import { getTable } from "@/lib/introspect";
import { RecordForm } from "@/components/record/RecordForm";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getUserTablePolicy, getUserColumnPolicies } from "@/lib/internal-db";
import Link from "next/link";

export default async function NewRecordPage({
  params,
}: {
  params: Promise<{ tableName: string }>;
}) {
  const { tableName } = await params;
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
    if (!policy.can_insert) redirect(`/dashboard/tables/${tableName}`);
    columnPolicies = await getUserColumnPolicies(userId, tableName);
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] mb-6">
        <Link href={`/dashboard/tables/${tableName}`} className="hover:text-[var(--foreground)] transition-colors font-mono">
          {tableName}
        </Link>
        <span>›</span>
        <span className="text-[var(--foreground)]">New Record</span>
      </div>

      <h1 className="text-xl font-bold text-[var(--foreground)] mb-6">
        Create New Record
      </h1>

      <RecordForm tableName={tableName} schema={schema} mode="create" columnPolicies={columnPolicies} />
    </div>
  );
}
