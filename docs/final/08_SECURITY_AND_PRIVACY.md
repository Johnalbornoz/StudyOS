# 08 — Security and Privacy

## Authentication

Clerk, via `clerkMiddleware()` in `src/middleware.ts` — auth-only route matching, no custom rate limiting at the middleware layer (see Rate limiting below). No custom sign-in/sign-up/redirect configuration exists in `src/app/layout.tsx`'s bare `<ClerkProvider>` — the app relies entirely on Clerk's own default catch-all routes and behavior.

## Authorization

See [04_IDENTITY_ROLES_AND_AUTHORIZATION.md](04_IDENTITY_ROLES_AND_AUTHORIZATION.md) for the full model. Summary: code-based (not database-RBAC), per-role, per-request-scope, with a documented, tested negative-authorization posture (F2's own matrix, F11's integrated certification, F15's IDOR unit tests).

## Rate limiting

`checkRateLimit` (in-memory, per-process) protects the highest-cost routes: `learning/record-evidence`, `simulation/attempts` (+ `next-item`), `quizzes/generate-and-take`. **Known, disclosed limitation**: per-process, not distributed — on a multi-instance deployment the effective limit is `limit × instance count`. Acceptable at small pilot scale; a shared (e.g. Redis-backed) limiter is the real Production fix. **DEFERRED**, owner: Rate limiting/infra.

## Dependency security

`npm audit`: **0 known vulnerabilities** as of this package (was 1 critical + 1 high at F15's start, fixed via a `next` patch-level bump). **TESTED** — re-run as part of every phase's own gate.

## IDOR / negative authorization

Unit-tested (`f15-simulation-item-resolution.test.ts` and others) plus real-Postgres cases in the F2/F12 certification scripts (Cases D/F/U/V/W). 7 of 9 exam-session negative-authorization cases have real evidence; 2 remain **DEFERRED** to live E2E — see [06_EXAM_READINESS_AND_INTERVENTIONS.md](06_EXAM_READINESS_AND_INTERVENTIONS.md).

## The credential-rotation gate — the sole remaining hard Pilot/Production gate

**Status: OPEN, `OPERATOR_ACTION_REQUIRED`, HARD PILOT GATE.** Not closed by this package, and this package does **not** declare Pilot readiness while it remains open.

### What is exposed

A real, credential-bearing `.env.local` file exists in a sibling scratchpad worktree (`f0s-security/.env.local`), **never committed to git** (re-confirmed multiple times: `git log --all --oneline --source -- .env.local` and the `**/.env.local` pattern both return zero hits; `.env*` is gitignored). Five credentials by variable name: `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. **No value has ever been read, printed, or logged by any tooling in this program** — this environment's own safety controls actively refuse even a prefix-only read.

### Consumers and Vercel scope (confirmed via `vercel env ls`, never by reading a value)

| Credential | Vercel scope |
|---|---|
| `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Separate Preview/Production values |
| `CLERK_WEBHOOK_SECRET` | Production only — no Preview value exists |
| `DATABASE_URL` | Separate Preview/Production values (independently re-confirmed via the diagnostic route's own fingerprint mechanism) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | **SHARED between Preview and Production** — the one category where an uncoordinated rotation risks a Production interruption |

### Recommended rotation order (safe, not yet executed)

1. **Rotate the per-environment-scoped credentials first** (`DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`) — none of these can break the other environment if rotated independently.
2. **Rotate the shared AI-provider keys last, as one coordinated pair-update**: generate the new key, update the shared Vercel env var, confirm the new key works via a real (low-risk) request through the existing AI gateway allowlist, only then revoke the old key — never leaving a window where neither is valid.
3. **Delete `f0s-security/.env.local`** once every credential is confirmed rotated or confirmed already-orphaned.

A safe, non-destructive way to check whether `f0s-security/.env.local`'s copy of a credential is even the SAME value Vercel currently uses — without ever exposing either value — is provided as a standalone operator-run script (`compare-credential-scope.sh`, SHA-256 digest comparison, same one-way-fingerprint pattern already used for the database diagnostic). This script is **not** run by any automated tooling; the operator runs it themselves.

### What this package will not do

Rotate, revoke, or apply any Vercel environment change on the operator's behalf; read, print, or log any of the 5 values; declare this gate closed based on anything short of the operator's own verified rotation report.

## Local temp-file hygiene (F15-C1)

Three local temporary files created during the F15-C1 database migration trial and briefly holding real DB connection strings (`clone-url`, `preview-url`, `preview.env` in `/private/tmp/studyus-f15-migration-trial-20260919/`) were **securely deleted** without their contents ever being read, printed, or documented — verified by existence-check only (`ls`/test for file presence), never a content read.

## Privacy

No student/parent/teacher PII (name, email, or other personal data) appears in any diagnostic tooling, log statement, or document in this program — every diagnostic route and script built this phase was deliberately scoped to counts and existence checks only, never row content. `errors` table and AI audit logging are structured events, not free-text personal data dumps (not independently re-audited for PII leakage in this package — flagged as a reasonable follow-up, not claimed done).
