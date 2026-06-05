import Link from "next/link";
import { introspect } from "@/lib/introspect";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let schema;
  let error: string | null = null;

  try {
    schema = await introspect();
  } catch (e) {
    error = String(e);
  }

  const dbType = process.env.DB_TYPE ?? "not configured";

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-[var(--foreground)] mb-2">Dashboard</h1>
      <p className="text-[var(--muted-foreground)] mb-8">
        Connected to <span className="font-mono text-[var(--foreground)]">{dbType}</span> database
      </p>

      {error ? (
        <div className="p-4 rounded-lg bg-[var(--destructive)]/10 border border-[var(--destructive)]/20 text-[var(--destructive)]">
          <p className="font-medium">Connection Error</p>
          <p className="text-sm mt-1 font-mono">{error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Tables" value={schema?.tables.length ?? 0} />
          <StatCard label="DB Type" value={dbType.toUpperCase()} />
          <StatCard label="Status" value="Connected" green />
        </div>
      )}

      {schema && schema.tables.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">Tables</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {schema.tables.map((t) => (
              <Link
                key={t.name}
                href={`/dashboard/tables/${t.name}`}
                className="block p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg hover:border-[var(--primary)] transition-colors group"
              >
                <p className="font-medium text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors font-mono text-sm">
                  {t.name}
                </p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  {t.columns.length} columns
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  green,
}: {
  label: string;
  value: string | number;
  green?: boolean;
}) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-5">
      <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${green ? "text-emerald-400" : "text-[var(--foreground)]"}`}>
        {value}
      </p>
    </div>
  );
}
