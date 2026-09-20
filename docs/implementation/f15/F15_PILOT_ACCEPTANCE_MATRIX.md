# F15 — Pilot Acceptance Matrix

The primary certification artifact for this phase. Each row: Requirement → implementation → automated test → integration test → live E2E → evidence → status.

## F15-C1 update (2026-09-20)

Two rows below change status this sub-phase, both on independently re-verified live evidence (not operator assertion): "Safe official Preview" (auth now correct) and a newly-added "Preview database migration state" row (now fully migrated and integrity-verified). Only one hard-gate row remains failing: credential rotation.

| Requirement | Implementation | Automated test | Integration test | Live E2E | Evidence | Status |
|---|---|---|---|---|---|---|
| Exact F14 baseline | Worktree created from `e3d23a4...`, verified `git rev-parse` match | — | — | — | Baseline verification transcript | **PASS** |
| Full Student exam-taking experience | `item-resolution.service.ts` + `ItemRunner.tsx` + `next-item` route | 11 unit tests | 16/16 real-Postgres (unchanged domains) | Not performed (blocked) | F15_EXAM_TAKING_EXPERIENCE.md | **PASS (structural); DEFERRED (live)** |
| Canonical F9 readiness | Unchanged; new exam-taking flow reuses F9's own `recordSimulationItemResponse`/`computeReadinessSnapshot` verbatim | Unit tests assert delegation, not re-implementation | F9 cert script (unchanged, PASS) | Not performed | F15_EXAM_TAKING_EXPERIENCE.md | **PASS** |
| MIN_COHORT_POLICY resolved | Real migration + ADR | 7 unit tests | F12 cert script (updated, PASS) | Not performed | ADR-F15-MIN-COHORT-POLICY.md | **PASS** |
| Credential/security remediation | Investigated safely; rotation blocked by tooling | — | — | — | F15_SECRET_AND_ENVIRONMENT_HARDENING.md | **FAIL — hard gate, `OPERATOR_ACTION_REQUIRED`** |
| Safe official Preview | Real `vercel deploy`, target=null | — | — | Unauthenticated pages loaded live; `/sign-in` re-checked live post-fix | F15_PREVIEW_CERTIFICATION.md | ~~**PASS (Preview exists); FAIL (auth misconfigured)**~~ **[F15-C1] PASS (Preview exists, auth correct — "Sign in to StudyOS_App", Development mode)** |
| Preview database migration state | 32/32 migrations applied via governed runner, in-place repair of the real runtime DB | 12 diagnostic-route unit tests | 16/16 real-Postgres regressions unaffected | Queried live twice via temporary diagnostic route (before/after repair) | F15_DATABASE_AND_MIGRATION_READINESS.md | **[F15-C1] PASS — 0 pending, 0 checksum drift, identity integrity 0 anomalies (11 students/11 users/15 profiles/15 user_roles, 0 broken links, 0 duplicates)** |
| Authenticated Student E2E | — | — | — | Not performed | F15_AUTHENTICATED_E2E_REPORT.md | **NOT PERFORMED** |
| Authenticated Teacher E2E | — | — | — | Not performed | F15_AUTHENTICATED_E2E_REPORT.md | **NOT PERFORMED** |
| Teacher → Student assignment E2E | Code path traced end to end (F15_EXAM_SESSION_INTEGRITY.md) | Unit tests for the exam-answering leg | F11-C4 cert script (unchanged, PASS) covers the intervention-lifecycle leg | Not performed | F15_EXAM_SESSION_INTEGRITY.md | **PASS (structural); NOT PERFORMED (live)** |
| Parent E2E | Unchanged from F10/F14 | — | F10 cert script (unchanged, PASS) | Not performed | F15_AUTHENTICATED_E2E_REPORT.md | **NOT PERFORMED (live)** |
| Institution E2E | Unchanged from F12/F14, plus MIN_COHORT_POLICY fix | — | F12 cert script (updated, PASS) | Not performed | F15_QA_REPORT.md | **PASS (structural); NOT PERFORMED (live)** |
| Multi-role isolation E2E | Unchanged architecture | — | F12 cert script Case W (multi-role, real Postgres, PASS) | Not performed | F15_AUTHORIZATION_NEGATIVE_TEST_REPORT.md | **PASS (structural); NOT PERFORMED (live)** |
| Authorization negative tests | 9-case matrix compiled | 2 new IDOR unit tests | 5 real-Postgres cases (F12 cert script Cases D/F/U/V/W) | Not performed | F15_AUTHORIZATION_NEGATIVE_TEST_REPORT.md | **PASS (7/9 with real/unit evidence); DEFERRED (2 live-only cases)** |
| Responsive critical-path | Unauthenticated marketing page only, live, 3 widths | — | — | Partial (unauthenticated only) | F15_RESPONSIVE_CERTIFICATION.md | **PARTIAL** |
| Accessibility critical-path | Code-level review + 1 live-observed structural check + 1 real fix (`aria-live`) | — | — | Partial (unauthenticated only) | F15_ACCESSIBILITY_CERTIFICATION.md | **PARTIAL** |
| Performance baseline | 2 real single-run samples (unauthenticated) + query-shape reasoning | — | — | Partial | F15_PERFORMANCE_BASELINE.md | **PARTIAL** |
| Security hardening | Dependency fix, rate limiting extended, IDOR tests, error-leakage spot check | 2 new IDOR tests | — | — | F15_SECURITY_HARDENING_REPORT.md | **PASS** |
| Observability sufficient for Pilot | New pilot-event model, 8 events wired across 6 routes | — | — | — | F15_OBSERVABILITY_MODEL.md | **PASS (minimal, real); PARTIAL (no correlation-id threading yet)** |
| Full suite PASS | 352/352 files, 5632/5632 tests | — | — | — | F15_QA_REPORT.md | **PASS** |
| Real-Postgres regressions PASS | 16/16, including 3 real bugs found+fixed in the F12 script itself | — | — | — | F15_QA_REPORT.md | **PASS** |
| IVG reconciliation | 37 items, unambiguous single-state-each | — | — | — | F15_IVG_REGISTER.md | **PASS** |
| No Critical/High unresolved Pilot blocker | 2 found (credential rotation, Preview auth) — both explicitly hard-gated, neither hidden | — | — | — | F15_RESIDUAL_RISK_REGISTER.md | ~~**FAIL — by design, honestly reported**~~ **[F15-C1] FAIL — 1 remains (credential rotation only; Preview auth resolved)** |

## Reading this matrix

**[F15-C1 update, 2026-09-20]**: Of the two rows originally marked **FAIL**, one ("Safe official Preview") is now **PASS** — the Preview Clerk misconfiguration was fixed by the operator and independently re-verified live by this agent. The remaining FAIL row (credential rotation) is unchanged and, on its own, is still sufficient to keep the overall Pilot gate at NO — per the task's own §50 ("Hard Pilot Blockers... unless repository evidence shows they are not applicable"), a single unresolved hard blocker is enough regardless of how well every other row scores.

Original text (superseded above): ~~Two rows are marked **FAIL** deliberately — not because the phase's own work is deficient, but because two genuine, external-to-this-phase's-code blockers (an exposed local credential file, a misconfigured Preview environment) exist and cannot be resolved by this agent.~~
