/**
 * Who runs the site, and the rules for what they may do to other accounts.
 *
 * An admin sees every account and every LLC, and can delete the one and
 * rewrite the other. That is the whole of the trust model, so it stays
 * small: the flag on the account, the address list that seeds it, and the
 * arithmetic of deleting an account without stranding anyone's books.
 *
 * Pure: no database. lib/admin-db.ts does the reading and writing.
 */

/** The site owner, who is admin whether or not the flag was ever set. */
const BUILT_IN_ADMINS = ["fariseqal3@gmail.com"];

/**
 * Addresses that are admins no matter what the database says: ADMIN_EMAILS,
 * comma-separated, or the built-in owner when it's unset. Belt and braces
 * for the flag — a restored database, or an account created after the
 * migration that set it, still gets in.
 */
export function adminEmails(env: Record<string, string | undefined> = process.env): Set<string> {
  const raw = env.ADMIN_EMAILS;
  const list = raw && raw.trim() ? raw.split(",") : BUILT_IN_ADMINS;
  return new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export function isAdminAccount(
  account: { email: string; isAdmin: boolean },
  env: Record<string, string | undefined> = process.env
): boolean {
  return account.isAdmin || adminEmails(env).has(account.email.trim().toLowerCase());
}

export type MemberRow = { userId: string; role: string; createdAt: string };
export type CompanyRow = { id: string; name: string; members: MemberRow[] };

export type DeletionPlan = {
  /** LLCs this account is the only member of: they go with it, or nobody could ever reach them. */
  deleteCompanies: { id: string; name: string }[];
  /** LLCs with other people on them: the account is taken off, and if it was the only owner the longest-standing member takes over. */
  leaveCompanies: { id: string; name: string; promote: string | null }[];
};

/**
 * What deleting an account does to the LLCs it's on. Deleting only the
 * account would leave a one-person LLC with no members at all — its
 * properties and ledger still in the database, reachable by nobody — so
 * those go too, and the panel says so before anyone confirms. An LLC with
 * teammates keeps them, and is never left without an owner.
 */
export function planAccountDeletion(userId: string, companies: CompanyRow[]): DeletionPlan {
  const plan: DeletionPlan = { deleteCompanies: [], leaveCompanies: [] };
  for (const c of companies) {
    const me = c.members.find((m) => m.userId === userId);
    if (!me) continue;
    const others = c.members.filter((m) => m.userId !== userId);
    if (others.length === 0) {
      plan.deleteCompanies.push({ id: c.id, name: c.name });
      continue;
    }
    const ownersLeft = others.some((m) => m.role === "owner");
    const promote = ownersLeft
      ? null
      : [...others].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0].userId;
    plan.leaveCompanies.push({ id: c.id, name: c.name, promote });
  }
  return plan;
}

export const ADMIN_ACTIONS = [
  "account.delete",
  "account.admin.grant",
  "account.admin.revoke",
  "account.signOutEverywhere",
  "account.twoFactor.off",
  "account.resetLink",
  "company.create",
  "company.delete",
  "company.rename",
  "company.member.add",
  "company.member.role",
  "company.member.remove",
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** A sentence for the audit log, from what an action row says. */
export function describeAction(a: { action: string; target: string; detail: string | null }): string {
  const d = a.detail ? ` — ${a.detail}` : "";
  switch (a.action) {
    case "account.delete":
      return `Deleted the account ${a.target}${d}`;
    case "account.admin.grant":
      return `Made ${a.target} an admin`;
    case "account.admin.revoke":
      return `Removed admin from ${a.target}`;
    case "account.signOutEverywhere":
      return `Signed ${a.target} out everywhere`;
    case "account.twoFactor.off":
      return `Turned off two-factor for ${a.target}`;
    case "account.resetLink":
      return `Made a password reset link for ${a.target}`;
    case "company.create":
      return `Created the LLC ${a.target}${d}`;
    case "company.delete":
      return `Deleted the LLC ${a.target}${d}`;
    case "company.rename":
      return `Renamed an LLC to ${a.target}${d}`;
    case "company.member.add":
      return `Added ${a.detail ?? "someone"} to ${a.target}`;
    case "company.member.role":
      return `Changed a role on ${a.target}${d}`;
    case "company.member.remove":
      return `Removed ${a.detail ?? "someone"} from ${a.target}`;
    default:
      return `${a.action} ${a.target}${d}`;
  }
}
