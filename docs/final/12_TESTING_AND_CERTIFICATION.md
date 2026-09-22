# 12 — Testing and Certification

## Full automated suite (Vitest) — current

```
Test files: 357 passed (357)
Tests:      5668 passed (5668)
Failed:     0
Skipped:    0
```

Grown from F15's own close (352 files / 5632 tests) by, cumulatively:
15 diagnostic-route tests (Preview DB state + exam-catalog inspection),
3 new `/api/health` tests, 4 Exam Profile self-service
authorization/catalog tests, 11 Pilot exam-catalog seed-service tests,
and 3 `listAvailableExamOptions` tests — all added in F15-C1. (Briefly
peaked at 358/5676 while a temporary seed-trigger route and its 8 tests
existed; both were removed once the seed was verified against Preview,
per that route's own stated temporary lifecycle.)

## Typecheck and build

`npx tsc --noEmit -p tsconfig.json` — clean, 0 errors. `npm run build` — clean, exit 0. Both re-run and re-verified after every code change in this program, including every F15-C1 commit.

## Dependency audit

`npm audit` — **0 known vulnerabilities**. Was 1 critical + 1 high at F15's start (a `next`/transitive-`sharp` issue), fixed via a patch-level version bump, re-verified clean since.

## Real-Postgres certification scripts (`scripts/operations/*.sh`)

18 scripts exist, each spinning up a real (ephemeral or Neon-branched) Postgres instance and exercising a specific domain's migration + lifecycle + negative-authorization cases — never mocked:

```
f1-identity-migration-cert.sh
f2-authorization-migration-cert.sh
f3-entitlement-migration-cert.sh
f4-learning-architecture-migration-cert.sh
f5-learner-state-migration-cert.sh
f6-curriculum-mapping-migration-cert.sh
f7-assessment-framework-migration-cert.sh
f8-assessment-framework-migration-cert.sh
f9-exam-readiness-simulation-migration-cert.sh
f10-parent-experience-migration-cert.sh
f11-a-teacher-authorization-migration-cert.sh
f11b-teacher-intervention-migration-cert.sh
f11c1-execution-orchestration-migration-cert.sh
f11c2-skill-execution-migration-cert.sh
f11c3-competency-execution-migration-cert.sh
f11c4-exam-execution-migration-cert.sh
f11-integrated-migration-cert.sh
f12-institution-intelligence-migration-cert.sh
```

F15's own QA report re-ran a 16-script subset most relevant to the domains it touched (F10-parent, F10-multi-role plus the above minus F1/F3/F4, whose behavior F15 did not touch) — **all 16 passing**, including 3 real bugs found and fixed **in the cert scripts themselves** (caused by F15's own MIN_COHORT_POLICY migration invalidating a zero-rows assumption the F12 script had hard-coded).

## Structural architecture tests

Every domain has its own `*-source-guard.test.ts` (e.g. `f12-institution-intelligence-source-guard.test.ts`) — these assert architectural invariants (e.g. "this module never imports directly from a lower-layer table it shouldn't") as part of the main Vitest suite, not a separate mechanism.

## What "TESTED" does and doesn't mean in this package

- **TESTED** (unit or real-Postgres): the logic is exercised against realistic inputs, including negative/adversarial cases where applicable, and passes.
- **NOT the same as LIVE VERIFIED**: none of the above runs against the actual deployed Vercel infrastructure with a real Clerk-authenticated session. That is a separate, narrower category — see [13_PILOT_RUNBOOK.md](13_PILOT_RUNBOOK.md) for what has and hasn't been checked that way.

## Live verification performed to date (as of this package, before authenticated E2E completes)

| What | Method | Result |
|---|---|---|
| Preview boots, unauthenticated marketing page renders | Real HTTP + browser load | **LIVE VERIFIED** |
| Preview Clerk resolves to the correct application | Real browser load of `/sign-in`, 3 separate deployments | **LIVE VERIFIED** |
| Preview database migration state | Real query via temporary diagnostic route, twice (before/after repair) | **LIVE VERIFIED** |
| `/api/health` | Real `curl` against live Preview | **LIVE VERIFIED** |
| Pilot exam catalog exists (post-seed) — **row existence only, not exam usability** | Real query via the Preview DB diagnostic route, before and after `--write`, twice | **LIVE VERIFIED** — `activeExamDefinitionCount`/`publishedExamVersionCount`/`publishedBlueprintCount` all 1, exam discoverable by name |
| Pilot exam catalog is actually answerable/usable (item-by-item) | Real manual attempt, `MINI_MOCK` mode | **[FASE 0 FREEZE, 2026-09-21] FAILED** — question 1 of 1 returned "no se encontró un concepto equivalente para ti", only action "Omitir esta parte"; no diagnosis, score, gap analysis, or recommendation possible. Row existence above must not be read as this. See `docs/implementation/f15/F15_PHASE0_ACCEPTANCE_FREEZE.md`. |
| Authenticated flows (Student/Teacher/Parent/Institution/multi-role) | — | **BLOCKED pending operator-assisted login** — **[FASE 0 FREEZE]: these are also frozen to `NOT_CERTIFIED`, not merely "blocked," since none has been observed end-to-end even structurally.** |
| Responsive design, unauthenticated pages | 3 widths, live | **LIVE VERIFIED (unauthenticated only)** |
| Responsive design, authenticated pages | — | **DEFERRED**, rolls into the E2E session |
| Accessibility (`aria-live` fix) | Code review + one live structural check | **PASS (code-level); DEFERRED (real assistive-technology confirmation)** |
| Authenticated-flow latency | — | **DEFERRED**, rolls into the E2E session |

## Certification discipline (the invariant that held across all 16 phases)

No phase's own QA report has ever declared a live/authenticated result PASS without actually executing it. Deferred items are always named explicitly with an owner, never silently folded into an aggregate PASS. This package continues that discipline — see [15_RESIDUAL_RISKS_AND_IVG.md](15_RESIDUAL_RISKS_AND_IVG.md) and [16_TRACEABILITY_MATRIX.md](16_TRACEABILITY_MATRIX.md).
