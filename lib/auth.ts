import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  MAX_PER_ACCOUNT,
  MAX_PER_IP,
  accountKey,
  clearFailures,
  clientIp,
  ipKey,
  isThrottled,
  recordFailure,
} from "@/lib/throttle";

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
 * that difference is enough to learn which emails are customers.
 */
const DUMMY_HASH = bcrypt.hashSync(`no-account-${Math.random()}`, 12);

export const authOptions: AuthOptions = {
  session: { strategy: "jwt" },
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
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        // Paused accounts and addresses get the same answer as a wrong
        // password. The login page asks separately whether it's a pause, so
        // the person sees "try again in 12 minutes" rather than being told
        // their right password is wrong.
        const keys = [accountKey("user", email), ipKey(clientIp(req?.headers))];
        if (await isThrottled(keys)) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // A miss on an unknown email counts too, so failure counts can't be
        // used to learn which emails have accounts — and costs the same time.
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) {
          await recordFailure([
            { key: keys[0], max: MAX_PER_ACCOUNT },
            { key: keys[1], max: MAX_PER_IP },
          ]);
          return null;
        }

        await clearFailures(keys[0]!);
        return { id: user.id, email: user.email, name: user.name ?? undefined, kind: "user" };
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
        if (!email || !password) return null;

        const keys = [accountKey("tenant", email), ipKey(clientIp(req?.headers))];
        if (await isThrottled(keys)) return null;

        const account = await prisma.tenantAccount.findUnique({
          where: { email },
          include: { tenant: { select: { id: true, name: true, active: true } } },
        });
        const valid = await bcrypt.compare(password, account?.passwordHash ?? DUMMY_HASH);
        if (!account || !valid) {
          await recordFailure([
            { key: keys[0], max: MAX_PER_ACCOUNT },
            { key: keys[1], max: MAX_PER_IP },
          ]);
          return null;
        }

        // A tenant who has moved out keeps their record for the ledger's sake
        // but loses the portal — otherwise last year's tenant still sees the
        // place they left. Not counted as a failure: the password was right.
        if (!account.tenant.active) return null;

        await clearFailures(keys[0]!);
        await prisma.tenantAccount.update({
          where: { id: account.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: account.id,
          email: account.email,
          name: account.tenant.name,
          kind: "tenant",
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.kind = (user as { kind?: SessionKind }).kind === "tenant" ? "tenant" : "user";
      }
      // Landlord tokens minted before this field existed carry no kind. They
      // were landlords, so that is what they stay — and it means nobody gets
      // signed out by the deploy. A tenant token can only come from the
      // provider above, which always stamps "tenant", so nothing gains access
      // by having the field missing.
      if (token.kind !== "tenant") token.kind = "user";
      return token;
    },
    async session({ session, token }) {
      session.kind = token.kind === "tenant" ? "tenant" : "user";
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};
