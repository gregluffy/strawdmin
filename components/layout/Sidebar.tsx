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

  const [refreshing, setRefreshing] = useState(false);

  function loadSchema() {
    fetch(`${basePath}/api/schema`).then((r) => r.json()).then(setSchema).catch(() => {});
  }

  async function refreshSchema() {
    setRefreshing(true);
    try {
      await fetch(`${basePath}/api/schema`, { method: "DELETE" });
      const data = await fetch(`${basePath}/api/schema`).then((r) => r.json());
      setSchema(data);
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadSchema();
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
      <button
        onClick={() => setOpen(!open)}
        title={open ? "Collapse sidebar" : "Expand sidebar"}
        className={`flex items-center border-b border-[var(--border)] hover:bg-[var(--accent)] transition-colors shrink-0 ${
          open ? "gap-3 px-4 py-3 w-full" : "justify-center px-0 py-3 w-full"
        }`}
      >
        <img src={`${basePath}/logo.svg`} alt="Strawdmin" className="w-9 h-8 shrink-0" />
        {open && (
          <span className="text-base font-bold text-[var(--foreground)] truncate">
            {schema?.dbName ?? "Strawdmin"}
          </span>
        )}
      </button>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {open && (
          <div className="flex items-center justify-between px-2 mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
              Tables
            </p>
            <button
              onClick={refreshSchema}
              disabled={refreshing}
              title="Refresh schema"
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={refreshing ? "animate-spin" : ""}
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </button>
          </div>
        )}
        {schema?.tables?.map((t) => (
          <NavLink
            key={t.name}
            href={`${basePath}/dashboard/tables/${t.name}`}
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
          <NavLink href={`${basePath}/dashboard/users`} active={isActive("/dashboard/users")} collapsed={!open} icon="👥">
            Users
          </NavLink>
          <NavLink href={`${basePath}/dashboard/backups`} active={isActive("/dashboard/backups")} collapsed={!open} icon="💾">
            Backups
          </NavLink>
          <NavLink href={`${basePath}/dashboard/audit`} active={isActive("/dashboard/audit")} collapsed={!open} icon="📋">
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
