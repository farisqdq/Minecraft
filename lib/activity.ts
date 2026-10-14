/**
 * The activity log (a34): what each signed-in person does on the site —
 * landlords and their team, tenants and owners alike. proxy.ts records one
 * row per page they open and per change they make; the admin's Activity
 * page lists everyone and reads each person's history back in plain words.
 *
 * Pure rules only (no database) so they can be tested: which requests are
 * worth a row, and how a stored request reads as a sentence.
 */

export type ActorKind = "user" | "tenant" | "owner";

export const KIND_LABEL: Record<ActorKind, string> = { user: "Landlord / team", tenant: "Tenant", owner: "Owner" };

/** How long rows are kept. */
export const KEEP_DAYS = 365;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Reads (GETs) of the API that are actions in their own right, not page plumbing. */
const LOGGED_READS = [/^\/api\/files\//, /^\/api\/export(\/|$)/, /^\/api\/backup(\/|$|\?)/, /^\/api\/tenants\/[^/]+\/statement$/, /^\/api\/account\/files$/];

/** Paths never logged: page plumbing, and anything that only says "still here". */
const NEVER = [/^\/api\/auth\//, /^\/api\/health/, /^\/api\/cron\//, /\.(?:png|jpg|jpeg|svg|ico|webmanifest|js|css|map|txt|xml)$/i];

export type RequestFacts = {
  method: string;
  path: string;
  /** Next.js marks prefetches and RSC data requests with headers; a prefetch is the browser guessing, not the person. */
  prefetch: boolean;
};

/** Whether this request gets a row. Only called for a request that already passed the session check. */
export function shouldLog({ method, path, prefetch }: RequestFacts): boolean {
  if (prefetch) return false;
  if (NEVER.some((r) => r.test(path))) return false;
  const m = method.toUpperCase();
  if (path.startsWith("/api/")) return MUTATING.has(m) || (m === "GET" && LOGGED_READS.some((r) => r.test(path)));
  return m === "GET";
}

/** Query strings can carry secrets (reset tokens, invite codes); keep only harmless keys, and not too much. */
const SAFE_QUERY = new Set(["tab", "view", "month", "year", "q", "property", "propertyId", "tenant", "unit", "filter", "status", "from", "to", "type", "kind", "page"]);
export function safeQuery(search: string): string {
  const p = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const [k, v] of p) if (SAFE_QUERY.has(k)) kept.append(k, v.slice(0, 80));
  const s = kept.toString();
  return s ? s.slice(0, 300) : "";
}

/** "iPhone · Safari", "Windows · Chrome" — enough to tell devices apart, nothing more. */
export function deviceLabel(ua: string | null | undefined): string {
  const u = ua || "";
  if (!u) return "";
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android"
    : /Windows/.test(u) ? "Windows" : /Mac OS X|Macintosh/.test(u) ? "Mac" : /Linux/.test(u) ? "Linux" : "Other";
  const br = /Edg\//.test(u) ? "Edge" : /OPR\//.test(u) ? "Opera" : /SamsungBrowser/.test(u) ? "Samsung" : /Firefox|FxiOS/.test(u) ? "Firefox"
    : /CriOS|Chrome\//.test(u) ? "Chrome" : /Safari/.test(u) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

// ---------------------------------------------------------------- describing

/** Record kinds whose ids appear in paths, and which table names them. */
export type RefKind = "property" | "tenant" | "unit" | "company" | "vendor";
export type Ref = { kind: RefKind; id: string };

/** A sentence with {placeholders} filled from the path's ids, plus those ids for name lookup. */
export type Described = { text: string; refs: Ref[]; change: boolean };

type Rule = [method: string, pattern: RegExp, text: string, refs?: RefKind[]];

// Order matters: the first match wins, so specific paths go before general ones.
// "$1", "$2" in text are the regex groups, shown by name once looked up.
const RULES: Rule[] = [
  // Sign-ins and sign-outs, recorded by lib/auth.ts rather than the proxy.
  ["EVENT", /^sign-in$/, "Signed in"],
  ["EVENT", /^sign-out$/, "Signed out"],

  // Pages — landlord
  ["GET", /^\/dashboard$/, "Opened the dashboard"],
  ["GET", /^\/dashboard\/properties\/([^/]+)\/files$/, "Opened files for $1", ["property"]],
  ["GET", /^\/dashboard\/properties\/([^/]+)$/, "Opened property $1", ["property"]],
  ["GET", /^\/dashboard\/messages\/([^/]+)$/, "Opened messages with $1", ["tenant"]],
  ["GET", /^\/dashboard\/inspections\/[^/]+\/report$/, "Opened an inspection report"],
  ["GET", /^\/dashboard\/inspections\/[^/]+$/, "Opened an inspection"],
  ["GET", /^\/dashboard\/move-outs\/[^/]+$/, "Opened a move-out"],
  ["GET", /^\/dashboard\/renewals\/[^/]+$/, "Opened a lease renewal"],
  ["GET", /^\/dashboard\/admin\/activity$/, "Opened the activity log"],
  ["GET", /^\/dashboard\/settings\/appearance$/, "Opened appearance settings"],
  ["GET", /^\/dashboard\/repairs\/vendors$/, "Opened vendors"],
  ["GET", /^\/dashboard\/([a-z-]+)$/, "Opened the $1 page"],
  // Pages — portals
  ["GET", /^\/portal$/, "Opened the tenant portal"],
  ["GET", /^\/portal\/inspections\/[^/]+$/, "Opened an inspection"],
  ["GET", /^\/owners$/, "Opened the owner portal"],
  ["GET", /^\/owners\/([a-z-]+)$/, "Opened the owner $1 page"],

  // Files and downloads
  ["GET", /^\/api\/files\/([a-z-]+)\//, "Opened a file ($1)"],
  ["GET", /^\/api\/export/, "Downloaded an export"],
  ["GET", /^\/api\/backup/, "Downloaded a backup"],
  ["GET", /^\/api\/tenants\/([^/]+)\/statement$/, "Downloaded a statement for $1", ["tenant"]],
  ["GET", /^\/api\/account\/files$/, "Downloaded their files"],

  // Account
  ["POST", /^\/api\/account\/password$/, "Changed their password"],
  ["POST", /^\/api\/account\/2fa\/enable$/, "Turned on two-factor sign-in"],
  ["POST", /^\/api\/account\/2fa\/disable$/, "Turned off two-factor sign-in"],
  ["POST", /^\/api\/account\/2fa\/setup$/, "Started two-factor setup"],
  ["POST", /^\/api\/account\/2fa\/recovery$/, "Made new backup codes"],
  ["POST", /^\/api\/(?:account|owners)\/sign-out-everywhere$/, "Signed out everywhere"],
  ["PATCH", /^\/api\/(?:account|portal|owners)\/appearance$/, "Changed appearance settings"],
  ["PATCH", /^\/api\/(?:portal|owners)\/preferences$/, "Changed notification preferences"],
  ["POST", /^\/api\/push\/subscribe$/, "Turned on notifications on a device"],
  ["DELETE", /^\/api\/push\/subscribe$/, "Turned off notifications on a device"],
  ["POST", /^\/api\/push\/test$/, "Sent a test notification"],

  // Admin
  ["POST", /^\/api\/admin\/push$/, "Sent a push notification (admin)"],
  ["DELETE", /^\/api\/admin\/push\/[^/]+$/, "Removed a device (admin)"],
  ["POST", /^\/api\/admin\/accounts\/[^/]+\/reset-link/, "Made a password reset link (admin)"],
  ["PATCH", /^\/api\/admin\/accounts\/[^/]+$/, "Changed an account (admin)"],
  ["DELETE", /^\/api\/admin\/accounts\/[^/]+$/, "Deleted an account (admin)"],
  ["POST", /^\/api\/admin\/companies$/, "Created an LLC (admin)"],
  ["PATCH", /^\/api\/admin\/companies\/([^/]+)$/, "Changed LLC $1 (admin)", ["company"]],
  ["DELETE", /^\/api\/admin\/companies\/([^/]+)$/, "Deleted LLC $1 (admin)", ["company"]],
  ["*", /^\/api\/admin\/companies\/([^/]+)\/members/, "Changed members of $1 (admin)", ["company"]],

  // LLCs, team, owners
  ["POST", /^\/api\/companies$/, "Created an LLC"],
  ["PATCH", /^\/api\/companies\/([^/]+)$/, "Changed LLC $1", ["company"]],
  ["DELETE", /^\/api\/companies\/([^/]+)$/, "Deleted LLC $1", ["company"]],
  ["POST", /^\/api\/companies\/([^/]+)\/invites$/, "Invited someone to $1", ["company"]],
  ["DELETE", /^\/api\/companies\/([^/]+)\/invites\//, "Cancelled an invite to $1", ["company"]],
  ["PATCH", /^\/api\/companies\/([^/]+)\/members\//, "Changed a team member's role in $1", ["company"]],
  ["DELETE", /^\/api\/companies\/([^/]+)\/members\//, "Removed a team member from $1", ["company"]],
  ["PUT", /^\/api\/companies\/([^/]+)\/late-fees$/, "Changed late-fee settings for $1", ["company"]],
  ["POST", /^\/api\/companies\/([^/]+)\/late-fees\/run$/, "Ran late fees for $1", ["company"]],
  ["PUT", /^\/api\/companies\/([^/]+)\/reminders$/, "Changed reminder settings for $1", ["company"]],
  ["POST", /^\/api\/companies\/([^/]+)\/reminders\/test$/, "Sent a test reminder for $1", ["company"]],
  ["POST", /^\/api\/companies\/([^/]+)\/owners\/invites$/, "Invited an owner to $1", ["company"]],
  ["*", /^\/api\/companies\/([^/]+)\/owners\/invites\//, "Changed an owner invite for $1", ["company"]],
  ["POST", /^\/api\/companies\/([^/]+)\/owners\/[^/]+\/reset$/, "Sent an owner a password reset for $1", ["company"]],
  ["PATCH", /^\/api\/companies\/([^/]+)\/owners\/[^/]+$/, "Changed an owner's access to $1", ["company"]],
  ["DELETE", /^\/api\/companies\/([^/]+)\/owners\/[^/]+$/, "Removed an owner from $1", ["company"]],
  ["POST", /^\/api\/invites\/join$/, "Joined an LLC with a code"],

  // Properties
  ["POST", /^\/api\/properties$/, "Added a property"],
  ["PATCH", /^\/api\/properties\/([^/]+)$/, "Edited property $1", ["property"]],
  ["DELETE", /^\/api\/properties\/([^/]+)$/, "Deleted property $1", ["property"]],
  ["POST", /^\/api\/properties\/([^/]+)\/units$/, "Added a unit at $1", ["property"]],
  ["POST", /^\/api\/properties\/([^/]+)\/tenants$/, "Added a tenant at $1", ["property"]],
  ["POST", /^\/api\/properties\/([^/]+)\/listings$/, "Listed $1 for rent", ["property"]],
  ["POST", /^\/api\/properties\/([^/]+)\/loans$/, "Added a loan on $1", ["property"]],
  ["PUT", /^\/api\/properties\/([^/]+)\/purchase$/, "Edited purchase details for $1", ["property"]],
  ["POST", /^\/api\/properties\/([^/]+)\/recurring$/, "Added a recurring expense at $1", ["property"]],
  ["POST", /^\/api\/properties\/([^/]+)\/trips$/, "Logged a trip to $1", ["property"]],
  ["POST", /^\/api\/properties\/([^/]+)\/valuations$/, "Added a valuation for $1", ["property"]],
  ["POST", /^\/api\/properties\/([^/]+)\/assets$/, "Added an asset at $1", ["property"]],
  ["PATCH", /^\/api\/units\/([^/]+)$/, "Edited unit $1", ["unit"]],
  ["DELETE", /^\/api\/units\/([^/]+)$/, "Deleted unit $1", ["unit"]],

  // Tenants
  ["PATCH", /^\/api\/tenants\/([^/]+)$/, "Edited tenant $1", ["tenant"]],
  ["DELETE", /^\/api\/tenants\/([^/]+)$/, "Deleted tenant $1", ["tenant"]],
  ["POST", /^\/api\/tenants\/([^/]+)\/charges$/, "Added a charge for $1", ["tenant"]],
  ["DELETE", /^\/api\/tenants\/([^/]+)\/charges$/, "Removed a charge for $1", ["tenant"]],
  ["POST", /^\/api\/tenants\/([^/]+)\/late-fee-waivers$/, "Waived a late fee for $1", ["tenant"]],
  ["DELETE", /^\/api\/tenants\/([^/]+)\/late-fee-waivers$/, "Undid a late-fee waiver for $1", ["tenant"]],
  ["POST", /^\/api\/tenants\/([^/]+)\/move-out$/, "Started a move-out for $1", ["tenant"]],
  ["PATCH", /^\/api\/tenants\/([^/]+)\/move-out$/, "Updated the move-out for $1", ["tenant"]],
  ["DELETE", /^\/api\/tenants\/([^/]+)\/move-out$/, "Cancelled the move-out for $1", ["tenant"]],
  ["POST", /^\/api\/tenants\/([^/]+)\/notices$/, "Sent a notice to $1", ["tenant"]],
  ["*", /^\/api\/tenants\/([^/]+)\/portal$/, "Changed portal access for $1", ["tenant"]],
  ["POST", /^\/api\/tenants\/([^/]+)\/renew$/, "Started a lease renewal for $1", ["tenant"]],
  ["*", /^\/api\/tenants\/([^/]+)\/rules$/, "Changed charge rules for $1", ["tenant"]],
  ["PATCH", /^\/api\/tenants\/([^/]+)\/statement$/, "Edited the statement for $1", ["tenant"]],
  ["POST", /^\/api\/tenants\/([^/]+)\/inspections$/, "Started an inspection for $1", ["tenant"]],
  ["POST", /^\/api\/renewals\/[^/]+\/send$/, "Sent a lease renewal"],
  ["DELETE", /^\/api\/renewals\/[^/]+$/, "Deleted a lease renewal"],

  // Money
  ["POST", /^\/api\/transactions$/, "Recorded a payment or expense"],
  ["PATCH", /^\/api\/transactions\/[^/]+$/, "Edited a payment or expense"],
  ["DELETE", /^\/api\/transactions\/[^/]+$/, "Deleted a payment or expense"],
  ["POST", /^\/api\/transactions\/[^/]+\/attachments$/, "Attached proof to a payment or expense"],
  ["POST", /^\/api\/late-fees\/status$/, "Changed a late fee's status"],
  ["POST", /^\/api\/free-rent$/, "Gave a free month of rent"],
  ["POST", /^\/api\/loans\/[^/]+\/payments$/, "Recorded a loan payment"],
  ["DELETE", /^\/api\/loans\/[^/]+\/payments\//, "Deleted a loan payment"],
  ["PATCH", /^\/api\/loans\/[^/]+$/, "Edited a loan"],
  ["DELETE", /^\/api\/loans\/[^/]+$/, "Deleted a loan"],
  ["POST", /^\/api\/recurring\/[^/]+\/log$/, "Logged a recurring expense"],
  ["PATCH", /^\/api\/recurring\/[^/]+$/, "Edited a recurring expense"],
  ["DELETE", /^\/api\/recurring\/[^/]+$/, "Deleted a recurring expense"],
  ["*", /^\/api\/assets\/[^/]+$/, "Changed an asset"],
  ["*", /^\/api\/valuations\/[^/]+$/, "Changed a valuation"],
  ["*", /^\/api\/trips\/[^/]+$/, "Changed a trip"],
  ["POST", /^\/api\/import\/preview$/, "Previewed a bank import"],
  ["POST", /^\/api\/import$/, "Imported bank transactions"],
  ["POST", /^\/api\/backup\/import$/, "Restored a backup"],

  // Repairs and vendors
  ["POST", /^\/api\/vendors$/, "Added a vendor"],
  ["PATCH", /^\/api\/vendors\/([^/]+)$/, "Edited vendor $1", ["vendor"]],
  ["DELETE", /^\/api\/vendors\/([^/]+)$/, "Deleted vendor $1", ["vendor"]],
  ["POST", /^\/api\/requests\/[^/]+\/updates$/, "Posted an update on a repair"],
  ["DELETE", /^\/api\/requests\/[^/]+\/updates\//, "Deleted a repair update"],
  ["POST", /^\/api\/requests\/[^/]+\/expense$/, "Recorded a repair expense"],
  ["PATCH", /^\/api\/requests\/[^/]+\/vendor$/, "Assigned a vendor to a repair"],
  ["PATCH", /^\/api\/requests\/[^/]+$/, "Updated a repair request"],
  ["DELETE", /^\/api\/requests\/[^/]+$/, "Deleted a repair request"],

  // Documents, inspections, listings, applications
  ["POST", /^\/api\/documents$/, "Uploaded a document"],
  ["PATCH", /^\/api\/documents\/[^/]+$/, "Edited a document"],
  ["DELETE", /^\/api\/documents\/[^/]+$/, "Deleted a document"],
  ["DELETE", /^\/api\/attachments\/[^/]+$/, "Deleted an attachment"],
  ["POST", /^\/api\/inspections\/[^/]+\/share$/, "Shared an inspection"],
  ["*", /^\/api\/inspections\//, "Edited an inspection"],
  ["PATCH", /^\/api\/listings\/[^/]+$/, "Edited a listing"],
  ["DELETE", /^\/api\/listings\/[^/]+$/, "Took down a listing"],
  ["POST", /^\/api\/applications\/[^/]+\/approve$/, "Approved a rental application"],
  ["PATCH", /^\/api\/applications\/[^/]+$/, "Updated a rental application"],
  ["DELETE", /^\/api\/applications\/[^/]+$/, "Deleted a rental application"],

  // Messages (landlord side)
  ["POST", /^\/api\/messages\/([^/]+)\/read$/, "Read messages from $1", ["tenant"]],
  ["POST", /^\/api\/messages\/([^/]+)\/attachments$/, "Sent a file to $1", ["tenant"]],
  ["POST", /^\/api\/messages\/([^/]+)$/, "Sent a message to $1", ["tenant"]],

  // Tenant portal
  ["POST", /^\/api\/portal\/messages\/read$/, "Read their messages"],
  ["POST", /^\/api\/portal\/messages\/attachments$/, "Sent a file to the landlord"],
  ["POST", /^\/api\/portal\/messages$/, "Sent a message to the landlord"],
  ["POST", /^\/api\/portal\/requests$/, "Submitted a repair request"],
  ["POST", /^\/api\/portal\/requests\/[^/]+\/updates$/, "Posted an update on their repair request"],
  ["POST", /^\/api\/portal\/requests\/[^/]+\/photos$/, "Added photos to their repair request"],
  ["POST", /^\/api\/portal\/notices$/, "Sent a notice to the landlord"],
  ["POST", /^\/api\/portal\/inspections\/[^/]+\/acknowledge$/, "Signed off on an inspection"],
];

const HUMAN_PAGE: Record<string, string> = { "move-outs": "move-outs", "repairs": "repairs", returns: "returns", money: "money" };

export function describe(method: string, path: string): Described {
  const m = method.toUpperCase();
  const change = MUTATING.has(m);
  for (const [rm, re, text, kinds] of RULES) {
    if (rm !== "*" ? rm !== m : !change) continue;
    const hit = re.exec(path);
    if (!hit) continue;
    const refs: Ref[] = [];
    const out = text.replace(/\$(\d)/g, (_, n: string) => {
      const v = hit[Number(n)] ?? "";
      const kind = kinds?.[Number(n) - 1];
      if (kind) { refs.push({ kind, id: v }); return `{${kind}:${v}}` }
      return HUMAN_PAGE[v] ?? v.replace(/-/g, " ");
    });
    return { text: out, refs, change };
  }
  // Anything not covered above still shows, in plain terms.
  if (!path.startsWith("/api/")) return { text: `Opened ${path}`, refs: [], change: false };
  const verb = { POST: "Saved", PUT: "Saved", PATCH: "Changed", DELETE: "Deleted" }[m] ?? "Opened";
  return { text: `${verb} something (${path.replace(/^\/api\//, "")})`, refs: [], change };
}

/** Fills {kind:id} placeholders with names, or a neutral word when the record is gone. */
export function fillNames(text: string, names: Map<string, string>): string {
  return text.replace(/\{(\w+):([^}]+)\}/g, (_, kind: string, id: string) => names.get(`${kind}:${id}`) ?? `a deleted ${kind}`);
}
