# F15 — Pilot Acceptance Matrix

The primary certification artifact for this phase. Each row: Requirement → implementation → automated test → integration test → live E2E → evidence → status.

| Requirement | Implementation | Automated test | Integration test | Live E2E | Evidence | Status |
|---|---|---|---|---|---|---|
| Exact F14 baseline | Worktree created from `e3d23a4...`, verified `git rev-parse` match | — | — | — | Baseline verification transcript | **PASS** |
| Full Student exam-taking experience | `item-resolution.service.ts` + `ItemRunner.tsx` + `next-item` route | 11 unit tests | 16/16 real-Postgres (unchanged domains) | Not performed (blocked) | F15_EXAM_TAKING_EXPERIENCE.md | **PASS (structural); DEFERRED (live)** |
| Canonical F9 readiness | Unchanged; new exam-taking flow reuses F9's own `recordSimulationItemResponse`/`computeReadinessSnapshot` verbatim | Unit tests assert delegation, not re-implementation | F9 cert script (unchanged, PASS) | Not performed | F15_EXAM_TAKING_EXPERIENCE.md | **PASS** |
| MIN_COHORT_POLICY resolved | Real migration + ADR | 7 unit tests | F12 cert script (updated, PASS) | Not performed | ADR-F15-MIN-COHORT-POLICY.md | **PASS** |
| Credential/security remediation | Investigated safely; rotation blocked by tooling | — | — | — | F15_SECRET_AND_ENVIRONMENT_HARDENING.md | **FAIL — hard gate, `OPERATOR_ACTION_REQUIRED`** |
| Safe official Preview | Real `vercel deploy`, target=null | — | — | Unauthenticated pages loaded live | F15_PREVIEW_CERTIFICATION.md | **PASS (Preview exists); FAIL (auth misconfigured)** |
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
| No Critical/High unresolved Pilot blocker | 2 found (credential rotation, Preview auth) — both explicitly hard-gated, neither hidden | — | — | — | F15_RESIDUAL_RISK_REGISTER.md | **FAIL — by design, honestly reported** |

## Reading this matrix

Two rows are marked **FAIL** deliberately — not because the phase's own work is deficient, but because two genuine, external-to-this-phase's-code blockers (an exposed local credential file, a misconfigured Preview environment) exist and cannot be resolved by this agent. Per the task's own §50 ("Hard Pilot Blockers... unless repository evidence shows they are not applicable"), these two facts alone are sufficient to keep the overall Pilot gate at NO regardless of how well every other row scored.
