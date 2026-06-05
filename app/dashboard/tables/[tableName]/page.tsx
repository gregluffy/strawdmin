import { notFound } from "next/navigation";
import { getTable } from "@/lib/introspect";
import { DataTable } from "@/components/table/DataTable";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";

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
  try {
    const payload = await verifyToken(token);
    isAdmin = payload.role === "admin";
  } catch {}

  return <DataTable tableName={tableName} schema={schema} isAdmin={isAdmin} />;
}
