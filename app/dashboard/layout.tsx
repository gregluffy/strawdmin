import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-[var(--background)] overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
      <span className="fixed bottom-2 right-3 text-xs text-[var(--muted-foreground)] select-none pointer-events-none">
        v{process.env.NEXT_PUBLIC_APP_VERSION}
      </span>
    </div>
  );
}
