"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Schema } from "@/lib/types";
import { formatSize } from "@/lib/format";
import { basePath } from "@/lib/api-url";

export function Sidebar() {
  const pathname = usePathname();
  const [schema, setSchema] = useState<Schema | null>(null);
  const [user, setUser] = useState<{ role: string } | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    fetch(`${basePath}/api/schema`).then((r) => r.json()).then(setSchema).catch(() => {});
    fetch(`${basePath}/api/auth/me`).then((r) => r.json()).then(setUser).catch(() => {});
  }, []);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      className={`flex flex-col bg-[var(--card)] border-r border-[var(--border)] transition-all duration-200 ${
        open ? "w-60" : "w-14"
      } shrink-0`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-[var(--border)]">
        <button
          onClick={() => setOpen(!open)}
          className="w-6 h-6 flex flex-col justify-center gap-1 shrink-0"
          aria-label="Toggle sidebar"
        >
          <span className="block h-0.5 bg-[var(--muted-foreground)]" />
          <span className="block h-0.5 bg-[var(--muted-foreground)]" />
          <span className="block h-0.5 bg-[var(--muted-foreground)]" />
        </button>
        {open && (
          <Link href="/dashboard" className="text-lg font-bold text-[var(--foreground)] truncate">
            {schema?.dbName ?? "Strawdmin"}
          </Link>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {open && (
          <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
            Tables
          </p>
        )}
        {schema?.tables?.map((t) => (
          <NavLink
            key={t.name}
            href={`/dashboard/tables/${t.name}`}
            active={isActive(`/dashboard/tables/${t.name}`)}
            collapsed={!open}
            icon="⊞"
            subtitle={t.sizeBytes != null ? formatSize(t.sizeBytes) : undefined}
          >
            {t.name}
          </NavLink>
        ))}

        {!schema && open && (
          <p className="px-2 py-2 text-xs text-[var(--muted-foreground)]">Loading...</p>
        )}
      </nav>

      {/* Bottom links (admin only) */}
      {user?.role === "admin" && (
        <div className="border-t border-[var(--border)] py-3 px-2">
          <NavLink href="/dashboard/users" active={isActive("/dashboard/users")} collapsed={!open} icon="👥">
            Users
          </NavLink>
          <NavLink href="/dashboard/backups" active={isActive("/dashboard/backups")} collapsed={!open} icon="💾">
            Backups
          </NavLink>
          <NavLink href="/dashboard/audit" active={isActive("/dashboard/audit")} collapsed={!open} icon="📋">
            Audit Log
          </NavLink>
        </div>
      )}
    </aside>
  );
}

function NavLink({
  href,
  active,
  collapsed,
  icon,
  subtitle,
  children,
}: {
  href: string;
  active: boolean;
  collapsed: boolean;
  icon: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? String(children) : undefined}
      className={`flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors mb-0.5 ${
        active
          ? "bg-[var(--primary)] text-white"
          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
      }`}
    >
      <span className="shrink-0 text-base">{icon}</span>
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs">{children}</span>
          {subtitle && (
            <span className={`block truncate text-[10px] ${active ? "opacity-70" : "opacity-50"}`}>
              {subtitle}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
