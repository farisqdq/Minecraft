/** Shared shapes and rules for tenant portal access. */

export const INVITE_DAYS = 14;

export type PortalAccess = {
  /** An unredeemed, unexpired code the landlord can hand over, if one exists. */
  inviteCode: string;
  inviteExpires: string;
  /** Set once the tenant has actually signed up. */
  accountEmail: string;
  accountSince: string;
  lastLoginAt: string;
};

export const NO_ACCESS: PortalAccess = {
  inviteCode: "",
  inviteExpires: "",
  accountEmail: "",
  accountSince: "",
  lastLoginAt: "",
};

export function inviteExpiry(from = new Date()) {
  return new Date(from.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The same floor the landlord signup uses. Kept here rather than inlined so
 * the portal never drifts into being the weaker of the two doors.
 */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  return null;
}

export function emailProblem(email: unknown): string | null {
  if (typeof email !== "string" || !email.includes("@") || email.trim().length < 3) {
    return "Enter a valid email address.";
  }
  return null;
}
