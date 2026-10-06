import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Learner context comes from StudentProfile.grade; CONTENT context comes from
 * subject.grade (the content home). Mixing them is the failure mode that makes
 * a shared subject silently render empty, so it is guarded structurally rather
 * than left to reviewer memory.
 *
 * Add a path to ALLOWED only with a written reason — every current service is
 * clean.
 */
const ALLOWED = new Set<string>([]);
const SRC = path.resolve(__dirname, "..");

test("no service scopes CONTENT by the student's own grade", () => {
  const offenders = (fs.readdirSync(SRC, { recursive: true }) as string[])
    .filter((relative) => relative.endsWith(".service.ts"))
    .filter((relative) => {
      if (ALLOWED.has(relative.replace(/\\/g, "/"))) return false;
      return /subject:\s*\{\s*gradeId:/.test(fs.readFileSync(path.join(SRC, relative), "utf8"));
    });

  expect(offenders).toEqual([]);
});
