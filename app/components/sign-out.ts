import { signOut } from "next-auth/react";

/**
 * Sign out and land on `path` on the site the person is already using.
 *
 * NextAuth's own redirect builds a full URL from NEXTAUTH_URL, so a stale
 * value there (an old preview address, say) would send a tenant who signs
 * out to a Vercel login page. Ending the session without its redirect and
 * navigating here keeps them on this site whatever that setting says.
 */
export async function signOutTo(path: "/login" | "/portal/login") {
  await signOut({ redirect: false });
  window.location.assign(path);
}
