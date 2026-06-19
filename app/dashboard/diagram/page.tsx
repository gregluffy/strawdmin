import { getServerActiveConnection } from "@/lib/server-connection";
import { verifyToken } from "@/lib/auth";
import { cookies } from "next/headers";
import { introspect } from "@/lib/introspect";
import { SchemaDiagram } from "@/components/diagram/SchemaDiagram";
import { redirect, notFound } from "next/navigation";

export default async function DiagramPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) redirect("/login");

  const conn = await getServerActiveConnection();
  if (!conn) notFound();

  const schema = await introspect(conn);

  return (
    // Counteract the `p-6` applied by the dashboard layout's <main>, so the
    // diagram fills the entire content area edge-to-edge.
    <div className="-m-6 flex flex-col" style={{ height: "calc(100% + 3rem)" }}>
      <div className="px-6 py-3 border-b border-[var(--border)] shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-[var(--foreground)]">Database Diagram</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {schema.tables.length} table{schema.tables.length !== 1 ? "s" : ""}
            {schema.tables.length > 0 && " · drag to reposition · scroll to zoom · export PNG"}
          </p>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <SchemaDiagram schema={schema} />
      </div>
    </div>
  );
}
