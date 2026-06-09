"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { basePath } from "@/lib/api-url";

interface User {
  id: number;
  username: string;
  role: string;
}

interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion?: string;
  latestVersion?: string;
  releaseUrl?: string;
}

export function Header() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetch(`${basePath}/api/auth/me`).then((r) => r.json()).then(setUser).catch(() => {});
    fetch(`${basePath}/api/updates`).then((r) => r.json()).then(setUpdate).catch(() => {});
  }, []);

  function toggleMenu() {
    if (!menuOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setMenuOpen((o) => !o);
  }

  async function logout() {
    await fetch(`${basePath}/api/auth/logout`, { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-[var(--border)] bg-[var(--card)] shrink-0">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] hover:bg-[var(--accent)] text-[var(--foreground)] text-sm font-medium transition-colors">
          🏠 Dashboard
        </Link>
        {update?.updateAvailable && (
          <a
            href={update.releaseUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 text-xs font-medium hover:bg-yellow-500/25 transition-colors"
          >
            <span>↑</span>
            <span>v{update.latestVersion} available</span>
          </a>
        )}
      </div>

      <div>
        <button
          ref={buttonRef}
          onClick={toggleMenu}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--accent)] transition-colors text-sm"
        >
          <span className="w-7 h-7 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-xs font-bold">
            {user?.username?.[0]?.toUpperCase() ?? "?"}
          </span>
          <span className="text-[var(--foreground)]">{user?.username ?? "..."}</span>
          {user?.role === "admin" && (
            <span className="px-1.5 py-0.5 bg-[var(--primary)]/20 text-[var(--primary)] text-[10px] rounded font-medium">
              admin
            </span>
          )}
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div
              className="fixed w-48 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl z-40"
              style={{ top: menuPos.top, right: menuPos.right }}
            >
              <div className="px-3 py-2 border-b border-[var(--border)]">
                <p className="text-xs text-[var(--muted-foreground)]">Signed in as</p>
                <p className="text-sm font-medium text-[var(--foreground)]">{user?.username}</p>
              </div>
              <button
                onClick={logout}
                className="w-full text-left px-3 py-2 text-sm text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors rounded-b-lg"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
