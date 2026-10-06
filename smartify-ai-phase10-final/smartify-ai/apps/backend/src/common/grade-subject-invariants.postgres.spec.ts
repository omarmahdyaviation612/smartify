/**
 * Read-only proof that the REAL database satisfies the GradeSubject
 * invariants after Task 2's backfill. This file never writes: it calls
 * findInvariantViolations() and nothing else, and refuses to connect to
 * anything that is not a local database.
 *
 * Excluded from the default jest run by jest.config.js's
 * testPathIgnorePatterns — run it explicitly:
 *   pnpm --filter @smartify/backend exec jest --testPathIgnorePatterns=/node_modules/ \
 *     --testPathPattern=grade-subject-invariants.postgres.spec.ts
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import { PrismaClient } from "@smartify/database";
import { findInvariantViolations } from "./grade-subject-invariants";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

describe("grade offering invariants — read-only, real PostgreSQL", () => {
  let db: PrismaClient;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (expected apps/backend/.env or the shell environment)");
    const host = new URL(url).hostname;
    if (!ALLOWED_HOSTS.has(host)) throw new Error(`Refusing to run against non-local host: ${host}`);
    db = new PrismaClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("every active subject has its home offering, and no grade offers two rows for one subject", async () => {
    expect(await findInvariantViolations(db)).toEqual([]);
  });
});
