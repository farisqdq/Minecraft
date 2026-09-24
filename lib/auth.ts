import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { clearFailures, clientIp, isThrottled, recordFailure } from "@/lib/throttle";
import { loginThrottleKeys } from "@/lib/login-rules";
import { cookieFrom, readTrustToken, trustCookieName } from "@/lib/device-trust";
import { open } from "@/lib/sealed";
import { hashRecoveryCode, looksLikeRecoveryCode, verifyTotp } from "@/lib/totp";
import { TWO_FACTOR_INVALID, TWO_FACTOR_REQUIRED } from "@/lib/auth-messages";

/**
 * Who a session belongs to. Two different kinds of person sign in here and
 * they must never be mistaken for one another:
 *
 *   "user"   — a landlord or someone on their team. Reaches data by walking
 *              user -> company -> property, which is the whole ledger.
 *   "tenant" — someone renting one unit. Reaches exactly their own tenant row
 *              and nothing that hangs off a company.
 *
 * Every token carries this, and `getCurrentUserId` refuses anything that
 * isn't "user". A role column on a shared table would put the two one missed
 * `if` apart; this keeps them in separate tables with separate providers.
 */
export type SessionKind = "user" | "tenant";

/**
 * A real bcrypt hash of a random string, compared against when an email has
 * no account. Without it, a wrong password for a real account takes a
 * quarter of a second (bcrypt) and one for a made-up email takes none, and
 * that difference is enough to learn which emails are customers. Cost 12,
 * the same as every account the signup routes create.
 */
const DUMMY_HASH = bcrypt.hashSync(`no-account-${Math.random()}`, 12);

type RawHeaders = Record<string, unknown> | undefined;

function header(headers: RawHeaders, name: string): string | null {
  const v = headers?.[name] ?? headers?.[name.toLowerCase()];
  return typeof v === "string" ? v : null;
}

/** When this device was trusted for this account, or null. */
function trustedSince(kind: SessionKind, email: string, sessionVersion: number, headers: RawHeaders) {
  return readTrustToken({
    secret: process.env.NEXTAUTH_SECRET ?? "",
    token: cookieFrom(header(headers, "cookie"), trustCookieName(kind)),
    kind,
    email,
    sessionVersion,
  });
}

export const authOptions: AuthOptions = {
  session: {
    strategy: "jwt",
    // A week, renewed on each day of use. Someone signed in every day stays
    // signed in; a session nobody has touched for a week ends by itself.
    maxAge: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        code: { label: "Authenticator code", type: "text" },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        const code = credentials?.code?.trim() ?? "";
        if (!email || !password || email.length > 200 || password.length > 200) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        const keys = loginThrottleKeys({
          kind: "user",
          email,
          ip: clientIp(req?.headers),
          trustedSince: user ? trustedSince("user", email, user.sessionVersion, req?.headers) : null,
        });

        // Paused accounts and addresses get the same answer as a wrong
        // password. The login page asks separately whether it's a pause, so
        // the person sees "try again in 12 minutes" rather than being told
        // their right password is wrong.
        if (await isThrottled(keys.map((k) => k.key))) return null;

        // A miss on an unknown email counts too, and costs the same time, so
        // neither can be used to learn which emails have accounts.
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) {
          await recordFailure(keys);
          return null;
        }

        // Two-factor, when it's on. A right password alone gets you as far as
        // being asked for the code.
        if (user.totpSecret) {
          if (!code) throw new Error(TWO_FACTOR_REQUIRED);

          let passed = false;
          if (looksLikeRecoveryCode(code)) {
            // A backup code works once: it's removed as it's used, in a
            // single conditional update so two tabs can't both spend it.
            const hash = hashRecoveryCode(code);
            if (user.recoveryCodes.includes(hash)) {
              const spent = await prisma.user.updateMany({
                where: { id: user.id, recoveryCodes: { has: hash } },
                data: { recoveryCodes: user.recoveryCodes.filter((h) => h !== hash) },
              });
              passed = spent.count === 1;
            }
          } else {
            const secret = open(user.totpSecret);
            const step = secret ? verifyTotp({ secret, code, lastStep: user.totpLastStep }) : null;
            if (step != null) {
              // Record the window only if nobody got there first, so the same
              // code can't be used twice in the same thirty seconds.
              const claimed = await prisma.user.updateMany({
                where: {
                  id: user.id,
                  OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
                },
                data: { totpLastStep: step },
              });
              passed = claimed.count === 1;
            }
          }
          if (!passed) {
            await recordFailure(keys);
            throw new Error(TWO_FACTOR_INVALID);
          }
        }

        for (const k of keys) if (k.key && !k.key.startsWith("ip:")) await clearFailures(k.key);
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          kind: "user",
          sv: user.sessionVersion,
        };
      },
    }),
    CredentialsProvider({
      id: "tenant",
      name: "Tenant portal",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password || email.length > 200 || password.length > 200) return null;

        const account = await prisma.tenantAccount.findUnique({
          where: { email },
          include: { tenant: { select: { id: true, name: true, active: true } } },
        });
        const keys = loginThrottleKeys({
          kind: "tenant",
          email,
          ip: clientIp(req?.headers),
          trustedSince: account ? trustedSince("tenant", email, account.sessionVersion, req?.headers) : null,
        });
        if (await isThrottled(keys.map((k) => k.key))) return null;

        const valid = await bcrypt.compare(password, account?.passwordHash ?? DUMMY_HASH);
        if (!account || !valid) {
          await recordFailure(keys);
          return null;
        }

        // A tenant who has moved out keeps their record for the ledger's sake
        // but loses the portal — otherwise last year's tenant still sees the
        // place they left. Not counted as a failure: the password was right.
        if (!account.tenant.active) return null;

        for (const k of keys) if (k.key && !k.key.startsWith("ip:")) await clearFailures(k.key);
        await prisma.tenantAccount.update({
          where: { id: account.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: account.id,
          email: account.email,
          name: account.tenant.name,
          kind: "tenant",
          sv: account.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.kind = (user as { kind?: SessionKind }).kind === "tenant" ? "tenant" : "user";
        token.sv = (user as { sv?: number }).sv ?? 0;
      }
      // Landlord tokens minted before this field existed carry no kind. They
      // were landlords, so that is what they stay — and it means nobody gets
      // signed out by the deploy. A tenant token can only come from the
      // provider above, which always stamps "tenant", so nothing gains access
      // by having the field missing.
      if (token.kind !== "tenant") token.kind = "user";
      // Likewise a token from before sessionVersion existed: version 0, which
      // is every account's starting value, so it stays valid until the
      // account's first "sign out everywhere".
      if (typeof token.sv !== "number") token.sv = 0;
      return token;
    },
    async session({ session, token }) {
      session.kind = token.kind === "tenant" ? "tenant" : "user";
      session.sv = typeof token.sv === "number" ? token.sv : 0;
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};
