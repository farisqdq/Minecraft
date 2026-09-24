import "next-auth";
import "next-auth/jwt";
import type { SessionKind } from "@/lib/auth";

declare module "next-auth" {
  interface Session {
    /** Which door this session came through. See SessionKind in lib/auth. */
    kind?: SessionKind;
    /** The account's sessionVersion when this session began; see lib/session. */
    sv?: number;
    user?: {
      id?: string;
      name?: string | null;
      email?: string | null;
    };
  }

  interface User {
    kind?: SessionKind;
    sv?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    kind?: SessionKind;
    sv?: number;
  }
}
