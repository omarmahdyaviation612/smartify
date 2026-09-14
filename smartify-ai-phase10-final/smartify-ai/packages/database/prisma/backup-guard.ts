/**
 * Mandatory pre-migration backup guard (added after the 2026-09-12
 * database-reset incident — see docs/incident-2026-09-12-database-reset.md).
 *
 * Validates the DATABASE_URL target, then takes a verified pg_dump backup.
 * Exported as a function so migrate-safe.ts can call it directly and abort
 * on any thrown error, rather than parsing subprocess output; also runnable
 * standalone via `pnpm db:backup`.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import * as dotenv from "dotenv";
import { spawnSync } from "node:child_process";

// The repo has no packages/database/.env — DATABASE_URL normally lives in
// apps/backend/.env. Load it without overriding a value already exported
// into the shell (dotenv never overwrites an existing process.env key).
dotenv.config({ path: path.resolve(__dirname, "../../../apps/backend/.env") });

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const ALLOWED_DATABASE = "smartify";

export interface BackupResult {
  filePath: string;
  sizeBytes: number;
  host: string;
  port: string;
  database: string;
}

export function runBackup(label = "pre_migration"): BackupResult {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — refusing to back up an unknown target.");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL — refusing to back up.");
  }

  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const database = parsed.pathname.replace(/^\//, "").split("?")[0];

  console.log(`[db-backup] Target -> host=${host} port=${port} database=${database}`);

  if (process.env.NODE_ENV === "production") {
    throw new Error("This backup guard is for development use only — refusing to run with NODE_ENV=production.");
  }
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `Refusing to back up unexpected host "${host}" — only ${[...ALLOWED_HOSTS].join(", ")} are allowed by this development safety tool.`,
    );
  }
  if (database.toLowerCase() !== ALLOWED_DATABASE) {
    throw new Error(`Refusing to back up unexpected database "${database}" — expected "${ALLOWED_DATABASE}".`);
  }

  const pgDumpBin = resolvePgDump();
  const versionCheck = spawnSync(pgDumpBin, ["--version"]);
  if (versionCheck.status !== 0 || versionCheck.error) {
    throw new Error(`pg_dump is not available (tried "${pgDumpBin}") — cannot create a safety backup, refusing to continue.`);
  }

  const backupDir = path.resolve(__dirname, "../../../backups/postgres");
  fs.mkdirSync(backupDir, { recursive: true });

  const fileName = `smartify_${label}_${formatTimestamp(new Date())}.pgdump`;
  const filePath = path.join(backupDir, fileName);

  // Pass connection details via PG* env vars rather than the raw
  // DATABASE_URL: pg_dump's libpq URI parser rejects Prisma's "?schema="
  // query parameter, and env vars also keep the password out of argv.
  const dump = spawnSync(pgDumpBin, ["-Fc", "-f", filePath], {
    stdio: "inherit",
    env: {
      ...process.env,
      PGHOST: host,
      PGPORT: port,
      PGDATABASE: database,
      PGUSER: parsed.username || undefined,
      PGPASSWORD: parsed.password || undefined,
    },
  });
  if (dump.status !== 0 || dump.error) {
    cleanupFailedFile(filePath);
    throw new Error(`pg_dump exited with status ${dump.status ?? "unknown"} — backup was NOT created successfully.`);
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file was not found at ${filePath} after pg_dump reported success.`);
  }
  const sizeBytes = fs.statSync(filePath).size;
  if (sizeBytes <= 0) {
    cleanupFailedFile(filePath);
    throw new Error(`Backup file ${filePath} is zero bytes — treating as a failed backup.`);
  }

  console.log(`[db-backup] OK: ${filePath} (${sizeBytes} bytes)`);
  return { filePath, sizeBytes, host, port, database };
}

function resolvePgDump(): string {
  if (process.env.PG_DUMP_PATH) return process.env.PG_DUMP_PATH;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["pg_dump"]);
  if (which.status === 0) {
    const first = which.stdout
      .toString()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    if (first) return first;
  }
  const winDefault = "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe";
  if (fs.existsSync(winDefault)) return winDefault;
  return "pg_dump";
}

function cleanupFailedFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // best-effort only
  }
}

function formatTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

if (require.main === module) {
  try {
    runBackup(process.argv[2] || "pre_migration");
    process.exit(0);
  } catch (err) {
    console.error(`[db-backup] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
