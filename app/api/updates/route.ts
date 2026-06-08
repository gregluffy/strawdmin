import { NextResponse } from "next/server";

// Update this when the repo is published
const GITHUB_REPO = "gfountopoulos/strawdmin";
const CURRENT = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

export const revalidate = 3600;

export async function GET() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) return NextResponse.json({ updateAvailable: false });

    const data = await res.json();
    const latest = (data.tag_name ?? "").replace(/^v/, "");

    return NextResponse.json({
      updateAvailable: isNewer(latest, CURRENT),
      currentVersion: CURRENT,
      latestVersion: latest,
      releaseUrl: data.html_url ?? null,
    });
  } catch {
    return NextResponse.json({ updateAvailable: false });
  }
}

function isNewer(a: string, b: string): boolean {
  const p = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = p(a);
  const [b1, b2, b3] = p(b);
  return a1 !== b1 ? a1 > b1 : a2 !== b2 ? a2 > b2 : a3 > b3;
}
