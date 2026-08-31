/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["**/*.ts", "!**/*.module.ts", "!**/*.spec.ts", "!main.ts"],
  moduleNameMapper: {
    "^@smartify/shared-types$": "<rootDir>/../../../packages/shared-types/src/index.ts",
    "^@smartify/config$": "<rootDir>/../../../packages/config/src/index.ts",
    "^@smartify/validation$": "<rootDir>/../../../packages/validation/src/index.ts",
    "^@smartify/database$": "<rootDir>/../../../packages/database/src/index.ts",
  },
};
