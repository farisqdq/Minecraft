import { PrismaClient } from "@prisma/client";
import { datasourceUrl } from "@/lib/prisma-url";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: datasourceUrl() });

// One client per process in every environment: in development so hot
// reloads don't leak pools, and in production so concurrent requests on
// the same instance share connections instead of each opening more.
globalForPrisma.prisma = prisma;
