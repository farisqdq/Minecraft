import "next-auth";
import "next-auth/jwt";
import type { SessionKind } from "@/lib/auth";

declare module "next-auth" {
  interface Session {
    /** Which door this session came through. See SessionKind in lib/auth. */
    kind?: SessionKind;
    user?: {
      id?: string;
      name?: string | null;
      email?: string | null;
    };
  }

  interface User {
    kind?: SessionKind;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    kind?: SessionKind;
  }
}
