import { PrismaClient } from "@prisma/client";

// Single shared Prisma client instance, reused across the backend app
// and any scripts (seed, migrations helpers) that need DB access.
declare global {
  // eslint-disable-next-line no-var
  var __smartifyPrisma__: PrismaClient | undefined;
}

export const prisma =
  global.__smartifyPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__smartifyPrisma__ = prisma;
}

export * from "@prisma/client";
