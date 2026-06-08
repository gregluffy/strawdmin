import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { isFirstRun } from "@/lib/internal-db";
import { basePath } from "@/lib/api-url";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  const firstRun = await isFirstRun();
  if (firstRun) redirect(`${basePath}/setup`);

  const token = cookieStore.get("auth_token")?.value;
  if (!token) redirect(`${basePath}/login`);

  try {
    await verifyToken(token);
    redirect(`${basePath}/dashboard`);
  } catch {
    redirect(`${basePath}/login`);
  }
}
