"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-url";

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${basePath}/api/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Setup failed");
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[var(--foreground)]">Strawdmin</h1>
          <p className="text-[var(--muted-foreground)] mt-1">
            Welcome! Create your admin account to get started.
          </p>
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-6">
            Initial Setup
          </h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                Admin Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] text-sm"
                placeholder="Enter admin username"
                required
                autoFocus
                autoComplete="username"
                suppressHydrationWarning
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] text-sm"
                placeholder="Minimum 8 characters"
                required
                autoComplete="new-password"
                suppressHydrationWarning
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2.5 bg-[var(--input)] border border-[var(--border)] rounded-lg text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] text-sm"
                placeholder="Repeat your password"
                required
                autoComplete="new-password"
                suppressHydrationWarning
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-[var(--destructive)]/10 border border-[var(--destructive)]/20 text-[var(--destructive)] text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-[var(--primary-foreground)] rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating account..." : "Create Admin Account"}
            </button>
          </form>
        </div>

        <div className="mt-6 p-4 bg-[var(--card)] border border-[var(--border)] rounded-xl">
          <p className="text-xs text-[var(--muted-foreground)]">
            <span className="font-medium text-[var(--foreground)]">Database:</span>{" "}
            {process.env.NEXT_PUBLIC_DB_TYPE ?? "Configured via environment"}
          </p>
        </div>
      </div>
    </div>
  );
}
