import { PrismaClient } from "@prisma/client";
import { datasourceUrl } from "@/lib/prisma-url";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// An interactive transaction waits for its connection under maxWait, which
// is separate from the URL's pool_timeout and defaults to two seconds — far
// too short when the instance has one connection and another request holds
// it. It waits as long as any other query does.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ datasourceUrl: datasourceUrl(), transactionOptions: { maxWait: 20_000, timeout: 20_000 } });

// One client per process in every environment: in development so hot
// reloads don't leak pools, and in production so concurrent requests on
// the same instance share connections instead of each opening more.
globalForPrisma.prisma = prisma;
