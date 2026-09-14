/**
 * Safe wrapper for development schema migrations — added after the
 * 2026-09-12 database-reset incident (see
 * docs/incident-2026-09-12-database-reset.md). Developers should run
 * `pnpm db:migrate:safe` instead of calling `prisma migrate dev` directly.
 *
 * Fails closed: if target validation or the backup fails for any reason,
 * `prisma migrate dev` is never invoked.
 */
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { runBackup } from "./backup-guard";

// packages/database — where the local `prisma` devDependency (pinned to
// ^5.18.0) actually resolves. Without pinning this, `npx prisma` resolves
// against whatever directory the wrapper happened to be invoked FROM
// (e.g. the repo root, which has no local `prisma` at all), and npx can
// silently fetch and run an unrelated, unpinned "latest" version instead.
const DATABASE_PACKAGE_DIR = path.resolve(__dirname, "..");

function main() {
  console.log("[migrate-safe] Verifying target and creating a pre-migration backup...");

  let backup;
  try {
    backup = runBackup("pre_migration");
  } catch (err) {
    console.error(`[migrate-safe] ABORTED — ${err instanceof Error ? err.message : String(err)}`);
    console.error("[migrate-safe] prisma migrate dev was NOT run.");
    process.exit(1);
    return;
  }

  console.log(`[migrate-safe] Backup verified: ${backup.filePath} (${backup.sizeBytes} bytes). Proceeding with migration.`);

  const extraArgs = process.argv.slice(2);
  const result = spawnSync("npx", ["--no-install", "prisma", "migrate", "dev", ...extraArgs], {
    stdio: "inherit",
    shell: true,
    cwd: DATABASE_PACKAGE_DIR,
  });

  process.exit(result.status ?? 1);
}

main();
