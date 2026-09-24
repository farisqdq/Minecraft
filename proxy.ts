import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { crossSiteMutation } from "./lib/origin";
import { buildCsp, makeNonce } from "./lib/csp";

/**
 * Runs in front of every page and API route. Three jobs, in this order:
 *
 *   1. Refuse changes that come from another website (forged requests).
 *   2. Keep each kind of session to its own half of the app: a tenant token
 *      never reaches landlord code and vice versa. Route handlers check
 *      again — this is the outer wall, not the only lock.
 *   3. Give each page a fresh random nonce and a Content-Security-Policy
 *      that only lets scripts carrying it run.
 */

const under = (path: string, bases: string[]) =>
  bases.some((base) => path === base || path.startsWith(`${base}/`));

/** Landlord pages and APIs. */
const LANDLORD_AREA = [
  "/dashboard",
  "/api/account",
  "/api/attachments",
  "/api/backup",
  "/api/companies",
  "/api/documents",
  "/api/export",
  "/api/invites",
  "/api/properties",
  "/api/recurring",
  "/api/requests",
  "/api/search",
  "/api/tenants",
  "/api/transactions",
  "/api/units",
  "/api/vendors",
];

/** The tenant portal. Its login and signup are carved out below. */
const TENANT_AREA = ["/portal", "/api/portal"];
const TENANT_PUBLIC = ["/portal/login", "/portal/signup", "/api/portal/signup"];

/** Files: either kind of session; the route decides who may see which file. */
const EITHER_AREA = ["/api/files"];

type Area = "landlord" | "tenant" | "either" | "public";

function areaOf(path: string): Area {
  if (under(path, TENANT_PUBLIC)) return "public";
  if (under(path, TENANT_AREA)) return "tenant";
  if (under(path, LANDLORD_AREA)) return "landlord";
  if (under(path, EITHER_AREA)) return "either";
  return "public";
}

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // 1. Anything that changes data must come from this site. The session
  // cookie is SameSite=Lax, which already keeps it off most cross-site
  // requests; this is the second lock, and it covers every route, the
  // sign-in ones included.
  if (
    path.startsWith("/api/") &&
    crossSiteMutation({
      method: req.method,
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      forwardedHost: req.headers.get("x-forwarded-host"),
    })
  ) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }

  // 2. The right kind of session for this part of the app.
  const area = areaOf(path);
  if (area !== "public") {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    // A token without a kind predates the field and was a landlord's.
    const kind = token ? (token.kind === "tenant" ? "tenant" : "user") : null;
    const allowed =
      kind !== null &&
      (area === "either" || (area === "tenant" ? kind === "tenant" : kind === "user"));
    if (!allowed) {
      if (path.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const login = new URL(area === "tenant" ? "/portal/login" : "/login", req.url);
      if (area !== "tenant") login.searchParams.set("callbackUrl", `${path}${req.nextUrl.search}`);
      return NextResponse.redirect(login);
    }
  }

  // 3. A nonce for this response only. Next.js reads the policy back off the
  // request headers and puts the nonce on every script it renders. API
  // routes render no HTML; /api/files sets a stricter policy of its own.
  if (path.startsWith("/api/")) return NextResponse.next();
  const nonce = makeNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-nonce", nonce);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Everything except the build's own static files and the app icons, which
  // are served as-is and need neither a session nor a nonce.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest).*)"],
};
