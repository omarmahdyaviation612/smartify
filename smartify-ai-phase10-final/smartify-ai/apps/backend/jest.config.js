/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  // Phase 9.4D: *.postgres.spec.ts files connect to a REAL PostgreSQL
  // database (see ai-budget-reservation.postgres.spec.ts) instead of a
  // mocked Prisma client. Excluded from the default `npx jest` run so the
  // rest of the suite keeps working with zero DB dependency (CI, offline
  // dev, etc.) — run them explicitly via `pnpm test:postgres-integration`.
  testPathIgnorePatterns: ["/node_modules/", "\\.postgres\\.spec\\.ts$"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["**/*.ts", "!**/*.module.ts", "!**/*.spec.ts", "!main.ts"],
  moduleNameMapper: {
    "^@smartify/shared-types$": "<rootDir>/../../../packages/shared-types/src/index.ts",
    "^@smartify/config$": "<rootDir>/../../../packages/config/src/index.ts",
    "^@smartify/validation$": "<rootDir>/../../../packages/validation/src/index.ts",
    "^@smartify/database$": "<rootDir>/../../../packages/database/src/index.ts",
  },
};
