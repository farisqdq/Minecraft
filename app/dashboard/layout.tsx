import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/session";
import { ShellProvider } from "../components/ShellContext";

/**
 * Tells the shell whether the person is a site admin, so the Admin tab can
 * appear for them and nobody else. The user lookup is cached per request,
 * so pages that ask again don't pay for it twice.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getCurrentUser();
  return <ShellProvider admin={Boolean(me?.isAdmin)}>{children}</ShellProvider>;
}
