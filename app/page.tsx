import { redirect } from "next/navigation";
import { getCurrentTenantAccountId, getCurrentUserId } from "@/lib/session";

export default async function Home() {
  // Two kinds of person land here, and they belong in different halves of the
  // app. Anyone signed in as neither gets the landlord sign-in, which links
  // across to the tenant one.
  if (await getCurrentUserId()) redirect("/dashboard");
  if (await getCurrentTenantAccountId()) redirect("/portal");
  redirect("/login");
}
