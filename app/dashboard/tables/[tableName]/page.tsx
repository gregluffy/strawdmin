import { notFound } from "next/navigation";
import { getTable } from "@/lib/introspect";
import { DataTable } from "@/components/table/DataTable";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getUserTablePolicy, getUserColumnPolicies } from "@/lib/internal-db";
import type { TablePolicy } from "@/lib/types";

export default async function TablePage({
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

  let tablePolicy: TablePolicy = { can_view: true, can_insert: true, can_update: true, can_delete: true };
  let columnPolicies: Record<string, { hidden: boolean; read_only: boolean }> = {};

  if (!isAdmin && userId !== null) {
    tablePolicy = await getUserTablePolicy(userId, tableName);
    if (!tablePolicy.can_view) notFound();
    columnPolicies = await getUserColumnPolicies(userId, tableName);
  }

  return <DataTable tableName={tableName} schema={schema} isAdmin={isAdmin} tablePolicy={tablePolicy} columnPolicies={columnPolicies} />;
}
