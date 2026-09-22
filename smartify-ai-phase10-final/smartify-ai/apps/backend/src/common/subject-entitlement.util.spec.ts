import { hasSubjectEntitlementInList, isStudentSubjectRowActive } from "./subject-entitlement.util";

describe("isStudentSubjectRowActive", () => {
  it("no row at all is never active", () => {
    expect(isStudentSubjectRowActive(null)).toBe(false);
    expect(isStudentSubjectRowActive(undefined)).toBe(false);
  });

  it("expiresAt: null is permanent access — always active", () => {
    expect(isStudentSubjectRowActive({ expiresAt: null })).toBe(true);
  });

  it("expiresAt in the future is active", () => {
    const future = new Date(Date.now() + 60 * 1000);
    expect(isStudentSubjectRowActive({ expiresAt: future })).toBe(true);
  });

  it("expiresAt in the past is NOT active, even though the row still exists", () => {
    const past = new Date(Date.now() - 60 * 1000);
    expect(isStudentSubjectRowActive({ expiresAt: past })).toBe(false);
  });

  it("expiresAt exactly equal to `now` is not active (strict > now)", () => {
    const now = new Date();
    expect(isStudentSubjectRowActive({ expiresAt: now }, now)).toBe(false);
  });
});

describe("hasSubjectEntitlementInList", () => {
  const now = new Date();
  const future = new Date(now.getTime() + 60 * 1000);
  const past = new Date(now.getTime() - 60 * 1000);

  it("finds a matching, permanently-owned subject", () => {
    const subjects = [{ subjectId: "math", expiresAt: null }];
    expect(hasSubjectEntitlementInList(subjects, "math", now)).toBe(true);
  });

  it("finds a matching, active time-limited subject", () => {
    const subjects = [{ subjectId: "math", expiresAt: future }];
    expect(hasSubjectEntitlementInList(subjects, "math", now)).toBe(true);
  });

  it("ignores an expired grant for the same subject", () => {
    const subjects = [{ subjectId: "math", expiresAt: past }];
    expect(hasSubjectEntitlementInList(subjects, "math", now)).toBe(false);
  });

  it("ignores an unrelated subject even if it's actively owned", () => {
    const subjects = [{ subjectId: "science", expiresAt: null }];
    expect(hasSubjectEntitlementInList(subjects, "math", now)).toBe(false);
  });

  it("an empty list is never entitled", () => {
    expect(hasSubjectEntitlementInList([], "math", now)).toBe(false);
  });
});
