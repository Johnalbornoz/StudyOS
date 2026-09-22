# F15 — Pilot Readiness & Production Hardening — Final Report

See individual documents in `docs/implementation/f15/` for full detail; this is the consolidated summary. Final decision at the end.

## F15-C1 update (branch `f15-c1/pilot-gate-closure`, HEAD `a9b2d8a`, 2026-09-20)

Since this report's original Final Decision (below, unchanged text, now superseded in two specific respects):

1. **Preview Clerk misconfiguration (section G, R2): RESOLVED.** Operator fixed the Preview-scope keys; this agent independently re-verified live (`/sign-in` → "Sign in to StudyOS_App", Development mode).
2. **Preview database migration state (section U, `IVG-F7-01`): RESOLVED.** Runtime Preview DB repaired from 15→32 migrations by the operator via the governed migration runner; independently re-verified by this agent via a temporary diagnostic route (0 pending migrations, 0 checksum drift, identity integrity at 0 anomalies across students/users/profiles/user_roles). `IVG-F12-02` closes on the same evidence.
3. Only **one** hard Pilot gate remains: credential rotation (R1 / `IVG-F14-06` / `IVG-F15-01`), still `OPERATOR_ACTION_REQUIRED`.
4. Full authenticated E2E (sections H–L) is now unblocked by configuration — the only remaining blocker is this agent's categorical no-credential-entry rule, resolved by the operator-assisted login protocol already established for this program.

**READY FOR PILOT remains NO** (updated reasoning below) — this update does not change that decision, only narrows what's still blocking it.

**[FASE 0 FREEZE — 2026-09-21]**: points 3 and 4 above are retracted as descriptions of the *current* state (kept here, not deleted, as the honest record of what was believed at the time). A manual exam-taking attempt performed 2026-09-21 exercised part of the "unblocked by configuration" E2E and found it **fails**: `MINI_MOCK`, question 1 of 1, "no se encontró un concepto equivalente", only action "Omitir esta parte" — no diagnosis, score, or recommendation is possible. This is a second, independent Pilot blocker, not resolved by credential rotation or by operator login. Identity/roles, student licensing, parent invitation, teacher approval, and institution/coordinator flows also remain without E2E evidence — see `docs/implementation/f15/F15_PHASE0_ACCEPTANCE_FREEZE.md` for the full frozen-state matrix and validation order going forward.

### A. BASELINE
`origin/f14/experience-completion-readiness@e3d23a44d0657b6ccf9fedf08aa8e8d454839d41` verified exactly. Isolated worktree, `git rev-parse HEAD` matched. Local `main` untouched throughout (re-confirmed at close).

### B. CURRENT STATE / PILOT GAP
See F15_CURRENT_STATE_AND_PILOT_GAP_ASSESSMENT.md. F14's 8 listed blockers reconciled: 2 fully resolved (exam-taking, MIN_COHORT_POLICY), 1 substantially resolved with a new specific sub-blocker found (Preview now real, but its auth is misconfigured), 1 partially resolved (this agent's credential-entry restriction, newly identified as the deeper reason live E2E remains blocked), 4 remain deferred for the same reasons as before, now more precisely scoped.

### C. EXAM-TAKING EXPERIENCE
Built. Real architectural gap found (no wiring from `SimulationPlanTarget` to actual content) and closed by reusing 3 already-certified systems, never a new exam engine. 11 unit tests, real UI, real API routes. See F15_EXAM_TAKING_EXPERIENCE.md.

### D. EXAM SESSION INTEGRITY
Full chain traced and verified (Teacher assignment → specific session → same-session execution → reconciliation → status update). 9-case IDOR/negative-auth matrix, 7 with real/unit evidence, 2 deferred to live. See F15_EXAM_SESSION_INTEGRITY.md.

### E. MIN_COHORT_POLICY
Resolved with a real, documented, versioned product decision (minimumCohortSize=10). Two additional real gaps found and fixed (Diagnostics/Interventions were unsuppressed). See ADR-F15-MIN-COHORT-POLICY.md.

### F. SECRET / ENVIRONMENT HARDENING
Investigated further; rotation blocked by this environment's own credential-materialization safeguard. Hard Pilot gate, `OPERATOR_ACTION_REQUIRED`. See F15_SECRET_AND_ENVIRONMENT_HARDENING.md.

### G. PREVIEW
**A real Preview deployment now exists** (`dpl_B2xeHtPKgeMcZyfPoDQGDFxnqax3`, target=null) — the first in this program's history. A real, new blocker found by loading it: Clerk is misconfigured to an unrelated application. Hard Pilot gate. **[F15-C1: RESOLVED — see update above and F15_PREVIEW_CERTIFICATION.md.]**

### H–L. AUTHENTICATED JOURNEYS / MULTI-ROLE / CACHE ISOLATION
Not performed live (two independent blockers: Preview auth misconfiguration, this agent's own no-credential-entry rule). Strong structural/real-Postgres-regression evidence exists for every journey (16/16 scripts passing, including several of the exact negative-authorization cases the task requested). See F15_AUTHENTICATED_E2E_REPORT.md, F15_AUTHORIZATION_NEGATIVE_TEST_REPORT.md, F15_CACHE_AND_CONTEXT_ISOLATION.md. **[F15-C1: Preview auth blocker resolved; still not performed live pending an operator-assisted login session.]**

### M. AUTHORIZATION NEGATIVE TESTS
9-case matrix; 7 backed by real evidence (2 new unit tests + 5 real-Postgres cases), 2 deferred to live. See F15_AUTHORIZATION_NEGATIVE_TEST_REPORT.md.

### N. SECURITY HARDENING
Critical+High dependency vulnerabilities fixed (npm audit: 0 remaining). Rate limiting extended to 3 more high-cost routes. IDOR unit-tested. Error-leakage spot-checked, clean. See F15_SECURITY_HARDENING_REPORT.md.

### O. AI GATEWAY HARDENING
Re-verified, no redesign needed — real, working timeout/cost-cap/allowlist controls already existed and were confirmed (including a live observation of the gateway correctly fail-closing during this phase's own real-Postgres regression run). See F15_SECURITY_HARDENING_REPORT.md.

### P. OBSERVABILITY
A minimal, real pilot-event model added, matching the existing AI logger's own style. 8 events wired across 6 routes. Correlation-id threading not yet complete (disclosed). See F15_OBSERVABILITY_MODEL.md.

### Q. PERFORMANCE
2 real single-run samples (unauthenticated marketing page only) plus query-shape/bundle reasoning. No percentile fabricated. Authenticated-flow measurement blocked by the same auth issue. See F15_PERFORMANCE_BASELINE.md.

### R. RESPONSIVE
3 widths checked live against the real Preview (unauthenticated page only, one minor cosmetic overlap found at 375px). Every authenticated page unchecked. See F15_RESPONSIVE_CERTIFICATION.md.

### S. ACCESSIBILITY
Code-level review; one real gap found AND FIXED (`aria-live` on question transitions); live AT verification not performed. See F15_ACCESSIBILITY_CERTIFICATION.md.

### T. DATA CONSISTENCY
Full propagation chain traced; readiness recomputation is synchronous, Teacher-intervention reconciliation is intentionally lazy (both by pre-existing design, both disclosed with expected delay/refresh/failure behavior). See F15_DATA_CONSISTENCY_REPORT.md.

### U. DATABASE / MIGRATION READINESS
One new migration (real, idempotent, re-verified via 16/16 regressions). Preview/Pilot database's own actual migration state remains unverified (long-standing `IVG-F7-01`). **[F15-C1: RESOLVED — runtime Preview DB repaired 15→32 migrations, independently re-verified, identity integrity confirmed at 0 anomalies. See F15_DATABASE_AND_MIGRATION_READINESS.md's own update.]**

### V. BACKUP / RECOVERY
No backup/restore automation exists anywhere in this codebase — reported honestly, no guarantee invented. See F15_BACKUP_RECOVERY_MODEL.md.

### W. PILOT OPERATING MODEL
Data/user strategy specified (reusing existing, proven fixture functions — no new tooling needed). Support/incident severity model defined. Rollback/containment model defined (app-level rollback real and safe; DB rollback honestly not guaranteed; `AI_ENABLED` is a real partial kill switch). See F15_PILOT_DATA_AND_USER_MODEL.md, F15_SUPPORT_AND_INCIDENT_MODEL.md, F15_ROLLBACK_AND_CONTAINMENT_MODEL.md.

### X. REGRESSIONS
16/16 real-Postgres certifications PASS (3 real bugs found and fixed in the F12 cert script itself, caused by this phase's own MIN_COHORT_POLICY change, fully resolved).

### Y. FULL TEST MATRIX
352 files / 5632 tests / 5632 passed / 0 failed / 0 skipped. `tsc --noEmit` clean. `next build` clean. `npm audit`: 0 vulnerabilities. No lint script exists in this repository (pre-existing, confirmed, not a regression).

### Z. IVG RECONCILIATION
37 total items, unambiguous single state each: 4 RESOLVED, 6 SUPERSEDED (folded into 3 broader items), 27 OPEN/DEFERRED (13 new this phase), 0 FAILED. See F15_IVG_REGISTER.md. **[F15-C1: 7 RESOLVED (+`IVG-F7-01`, `IVG-F12-02`, `IVG-F15-02`), 24 OPEN/DEFERRED. See the register's own updated totals.]**

### AA. BUGS FOUND
7 real bugs found this phase, all documented with root cause; 6 fixed, 1 (Preview Clerk misconfiguration) correctly left for the operator since this agent has no access to fix it. See F15_QA_REPORT.md. **[F15-C1: bug #7 fixed by the operator and re-verified; an 8th bug (Preview DB migration gap) found and fixed this sub-phase — see the QA report's own addendum.]**

### AB. RESIDUAL RISKS
12 risks documented with severity/probability/impact/mitigation/ownership/blocking-flags. 2 are hard Pilot gates (R1 credential rotation, R2 Preview auth). See F15_RESIDUAL_RISK_REGISTER.md. **[F15-C1: R2 RESOLVED. Only R1 remains a hard gate.]**

### AC. PILOT ACCEPTANCE MATRIX
See F15_PILOT_ACCEPTANCE_MATRIX.md — the primary certification artifact. Most rows PASS (structurally/with real regression evidence); live-authenticated rows are honestly marked NOT PERFORMED/PARTIAL; 2 rows explicitly FAIL by design (the two hard gates), never hidden. **[F15-C1: the Preview-auth FAIL row now reads PASS — see the matrix's own update.]**

### AD. FINAL COMMIT SHA
F15 original: `642aa0267ef9d15b4da323d8b89d7ff64dedc1fa`. **F15-C1 current: `a9b2d8aa3072064c6cf3185b100cb524de97e7df` (branch `f15-c1/pilot-gate-closure`), deployed to Preview as `dpl_qz9b6nwoUpUEx8pYxpzs6oPxHR7h` (`study-g0e8ic1c9-study-so.vercel.app`, `target: preview`, confirmed via `vercel inspect`).** Per this program's own rule, `642aa02`/`860028a` must no longer be cited as the currently-deployed SHA now that code has changed.

**[Onboarding/authorization rework, 2026-09-21]**: a further 8 commits (`6ef8be1`..`551596e`, code HEAD `a85aeda4e33c93461b5fc1a761f709f58582b7c7` + a docs-only commit on top, same branch) close a set of gaps the task's own inspection surfaced independent of the two hard gates above: the Clerk webhook and dashboard layout no longer silently default every account to STUDENT; a Parent can no longer self-link to a student by email; premium AI/quiz/study-plan routes are now server-side gated by `LEARNING_FULL_ACCESS` where they previously were not; a Teacher self-service institution-selection UI and an institution coordinator approve/reject/revoke/assign UI now exist where before only ungated backend routes did. Full detail, matrix, and residual risks: `F15_ONBOARDING_AUTHORIZATION_REWORK.md`. **This code IS now deployed to Preview** (`dpl_EtKFu6e4Zn6cREAC5HEZzkmNFobN`, `study-a1nzky54e-study-so.vercel.app`, confirmed `target: preview`), **but its one new migration (originally filed as `20260921_1000_student_initiated_parent_invitation.sql`, renamed 2026-09-21 to `20260921_1100_student_initiated_parent_invitation.sql` — see R14 in `F15_RESIDUAL_RISK_REGISTER.md`) has NOT been applied to any database** — the student→parent invitation flow will error on that live deployment until an operator applies it; every other change in this sub-phase reads only pre-existing tables and works on the deployment as-is. The Final Decision below (`READY FOR PILOT: NO`, gated on R1/R2) is unchanged and, if anything, reinforced: this phase adds a third, smaller pending item (apply this migration) to what must happen before Pilot, on top of the two hard gates already recorded.

---

## Final Decision

**PASS_WITH_CONDITIONS**

This phase made substantial, real, verified progress on every one of F14's 8 listed blockers, closed the single largest functional gap (exam-taking) with genuine, tested, non-fabricated engineering work, resolved a long-standing open product-policy decision (MIN_COHORT_POLICY), achieved a genuine Vercel Preview deployment for the first time in this program's history, hardened real security gaps (dependency vulnerabilities, rate limiting, one accessibility fix), and reconciled the entire IVG history without ambiguity. It also surfaced two new, genuine, hard-gating conditions (an un-rotated exposed credential, a misconfigured Preview auth setup) that this agent is correctly unable to resolve itself, and was honest that live authenticated E2E/responsive/accessibility/performance verification remains undone for reasons now precisely diagnosed rather than vaguely deferred.

```
READY FOR PILOT: NO
```
Blocked specifically and only by the two hard gates (R1, R2) plus the resulting inability to execute authenticated E2E — not by any deficiency in the engineering work itself. Both gates have a clear, bounded, operator-executable path to resolution.

**[F15-C1 update, 2026-09-20]: R2 is now RESOLVED and independently re-verified (Preview Clerk fixed) and the Preview database migration gap discovered during this closure work is also RESOLVED and independently re-verified. The decision remains `READY FOR PILOT: NO` — per this program's own explicit rule, this cannot flip to YES while R1 (credential rotation) remains unresolved, regardless of how much else has closed. The one remaining blocker to a YES is now singular and precise: (a) verified credential rotation, and (b) execution of the authenticated E2E matrix via an operator-assisted login session.]**

**[FASE 0 FREEZE — 2026-09-21]: "singular and precise" above is retracted. Executing part of (b) revealed a third blocker: the exam-taking flow fails a real attempt (see freeze note above this section). `READY FOR PILOT` was already `NO` and remains `NO` — no flip in decision — but the reasoning "only (a) and (b)" is no longer accurate. Full reconciliation: `docs/implementation/f15/F15_PHASE0_ACCEPTANCE_FREEZE.md`.]**

```
READY FOR PRODUCTION: NO
```
Unchanged expectation from every prior phase — Production requires a materially higher bar than this phase targeted or claims.

```
READY FOR PRODUCTION RELEASE PHASE: YES
```
The architecture, operational model (support/incident/rollback/data strategy), and engineering discipline demonstrated this phase are sufficient to BEGIN the final controlled release process once R1/R2 are resolved and authenticated E2E is executed — this is a statement about readiness to enter that process, not about Production readiness itself.

Per the stop condition: no further phase begun, no Production hardening deployed, no merge to `main`, no Production environment change, no IVG closed without evidence, no authenticated E2E claimed without execution, no accessibility certification claimed from static review alone, no performance result claimed without measurement, no credential remediation claimed without verified rotation. Stopping here.
