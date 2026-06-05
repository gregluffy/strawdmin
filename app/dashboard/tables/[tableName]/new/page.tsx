import { notFound } from "next/navigation";
import { getTable } from "@/lib/introspect";
import { RecordForm } from "@/components/record/RecordForm";
import Link from "next/link";

export default async function NewRecordPage({
  params,
}: {
  params: Promise<{ tableName: string }>;
}) {
  const { tableName } = await params;
  const schema = await getTable(tableName);
  if (!schema) notFound();

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

      <RecordForm tableName={tableName} schema={schema} mode="create" />
    </div>
  );
}
