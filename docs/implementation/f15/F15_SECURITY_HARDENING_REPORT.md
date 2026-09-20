# F15 — Security Hardening Report (Workstream F/G)

Focused, pilot-critical pass — not an unlimited security audit.

## Dependency security (real, fixed this phase)

`npm audit` at F15's baseline found:
- **CRITICAL**: `next@16.0.0-16.3.2` — unauthenticated RCE (Windows-hosted servers; Image Optimization API with AVIF files).
- **HIGH**: `sharp<0.35.4` (transitive, via `next`) — libheif vulnerabilities.

**Fixed**: bumped `next` from the pinned `16.3.1` to `16.3.5` in `package.json` (a patch-level bump within the same major, not a breaking-change upgrade). `npm install` pulled in a fixed `sharp` transitively. `npm audit` now reports **0 vulnerabilities**. Verified: `tsc --noEmit` clean, full suite 352/352 files passing, `next build` clean after the bump — no behavior change observed.

## IDOR (exam-taking surface — the newly-built one)

See F15_EXAM_SESSION_INTEGRITY.md's full matrix. Summary: every new route (`GET/POST /api/simulation/attempts/[id]/next-item`) independently re-verifies `isOwner(actorUserId, attempt.studentId)` before returning or mutating anything — never trusts the URL's `[id]` alone. Verified by 11 real unit tests including two explicit IDOR cases.

## Rate limiting (a real, previously narrow gap)

Before this phase, `checkRateLimit` (`src/lib/auth.ts`) existed but had exactly one caller in the entire codebase (`/api/learning/record-evidence`). Extended to three more high-cost/abuse-relevant routes this phase:

| Route | Limit | Rationale |
|---|---|---|
| `POST /api/quizzes/generate-and-take` (generate branch only) | 30/min per user | The single highest AI-cost endpoint in the app; submission (grading) is left unlimited since it completes work already in progress, not new spend |
| `POST /api/simulation/attempts` (start) | 20/min per user | Creates real DB rows and can trigger downstream AI generation |
| `GET /api/simulation/attempts/[id]/next-item` | 60/min per user | Unlike most GET routes, this one can trigger real AI question generation (item-resolution.service.ts) — rate-limited like a generation endpoint, not treated as free reads |

All three return `429 RATE_LIMITED` with a safe, generic message — never a stack trace. A `rate_limited` pilot event is logged on trip (see F15_OBSERVABILITY_MODEL.md). The underlying limiter remains in-memory/per-process (a pre-existing, documented limitation — `// TODO: Implement with Redis for production`, unchanged) — acceptable for a single-instance pilot, a real residual for a multi-instance Production deployment (see F15_RESIDUAL_RISK_REGISTER.md).

## Input validation

Every new route (`next-item` GET/POST) uses Zod for request-body validation, matching the codebase's own universal convention — no new validation pattern introduced.

## Server-side role/ownership checks

No new route in this phase trusts a client-supplied role or id as an authorization boundary. `next-item`'s owner-only checks, `MIN_COHORT_POLICY`'s server-side-only suppression decision (frontend never independently determines cohort sufficiency), and the unchanged F1-F12 authorization primitives were all re-verified by direct code reading, not assumed.

## Error leakage

Spot-checked every `error.message`/`error instanceof` pattern touched or added this phase (`src/app/api/simulation/attempts/[id]/next-item/route.ts`, the Teacher interventions route's error mapping). All surface deliberately-authored, safe Error-subclass messages (e.g. `SimulationItemNotActiveError`'s own constructed string) — never a raw exception's `.stack`, never a raw SQL error, never a provider payload. Next.js's own production build behavior (an uncaught exception returns a generic 500 with no stack trace to the client) was relied upon and not modified — confirmed unchanged by `next build`'s own production-mode output.

## AI Gateway (re-verified, not redesigned — no concrete pilot blocker found)

`src/lib/ai/gateway.ts`/`src/lib/ai/operational-limits.ts` (F0-S, unchanged) already provide: a mandatory `reserveAIRequest` call before every provider fetch (allowed-model allowlist, max request bytes, per-minute/per-day call caps, feature-flagged off entirely unless `AI_ENABLED=true`), a bounded 30s timeout, structured logging with no PII/raw-prompt content by default (`STUDYUS_AI_DEBUG_RAW` gate, off by default everywhere), and typed error propagation. This phase's own real-Postgres regression run observed this gateway correctly REJECTING generation calls with `CONFIGURATION_ERROR` in the ephemeral test environment (no real provider keys configured there) rather than silently succeeding or leaking a raw provider error — a real, live confirmation of the gateway's own fail-closed behavior, not merely re-read code.

## Admin/test endpoints

Not separately re-audited this phase beyond what F0-S/F13's own source guards already cover (no admin/test endpoint was touched or added this phase).

## Not performed this phase (disclosed)

A full manual penetration-test-style pass (fuzzing, header injection, CSRF-specific review) was not performed — out of scope for a "focused, pilot-critical pass" per the task's own explicit instruction not to convert this into an unlimited audit.
