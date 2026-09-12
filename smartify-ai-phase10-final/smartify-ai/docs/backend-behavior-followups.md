# Separate backend behavior issue

## Multer nesting rejection returns HTTP 500

Recorded 2026-09-08; deliberately not changed in the Next.js remediation.

Both curriculum upload routes configure Multer 2.2.0 fieldNestingDepth: 0. Nested multipart field names are rejected before service invocation, but Nest 10.4.22 does not map the new LIMIT_FIELD_NESTING error to a client error. The global exception filter therefore returns generic HTTP 500.

Follow up separately with a narrowly scoped mapping to an appropriate 4xx response and a real multipart regression asserting status, sanitized body, and no service invocation for both routes. Keep upload limits, PDF import behavior, and dependency upgrades out of that behavior-only change.
