/**
 * What the browser is told about team roles.
 *
 * A viewer is never told they're one: their own role comes back as "member"
 * (the interface only ever singles out "owner", and leaves out controls for
 * view-only accounts on its own), and other people's roles aren't shown to
 * them at all. Owners and members see the real roles, viewers included.
 *
 * Pure, so it can be tested without a database; lib/access does the checks.
 */

/** The signed-in user's own role in an LLC, as the browser may see it. */
export function shownOwnRole(stored: string | null | undefined): "owner" | "member" {
  return stored === "owner" ? "owner" : "member";
}

/**
 * Someone else's role, as shown to a user whose own role is `mine`: the
 * stored role for an owner or member, "" for a viewer.
 */
export function shownOthersRole(theirs: string, mine: string | null | undefined): string {
  return mine === "owner" || mine === "member" ? theirs : "";
}
