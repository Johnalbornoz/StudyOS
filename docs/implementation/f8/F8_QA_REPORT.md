# F8 — Framework-Aware Teaching & Exam Skills — QA Report

Branch: `f8/framework-aware-teaching-exam-skills`
Base: `origin/f7/assessment-framework-engine` @ `c4fa9f3c96019152b45c74bd01e22fbc93bc592d`
Date: 2026-09-18

## Test Layer Matrix (task §59, mandatory format)

```
AUTOMATED:
  executed: 5403
  passed:   5403
  failed:   0
  skipped:  0

REAL_POSTGRES:
  executed: 17 (adversarial matrix cases A-Q, task §33) + migration apply + idempotency re-apply + schema verification
  passed:   17
  failed:   0
  skipped:  0

AUTHENTICATED_E2E:
  executed: 2 (Student A -> own ALLOW; Student A -> Student B DENY, both via real canAccessLearner against real Postgres)
  passed:   2
  failed:   0
  deferred: 6 (Parent accepted/revoked, Teacher active/wrong-class, Entitlement ACTIVE/SUSPENDED -- see F8_AUTHENTICATED_E2E_REPORT.md, IVG-F8-02)

REMOTE_PREVIEW_SMOKE:
  executed: 17 (10 new F8 routes anonymous-401 + 7 F0-S-F7 regression routes, see F8_PREVIEW_CERTIFICATION.md)
  passed:   17
  failed:   0

AI_REAL_PROVIDER:
  executed: 0
  passed:   0
  failed:   0
  deferred: 1 (no provider credentials available in this environment -- IVG-F8-01, see F8_AI_PROVIDER_CERTIFICATION.md)

IVG_DEFERRED:
  count: 3
  IDs: IVG-F7-01 (carried forward), IVG-F8-01, IVG-F8-02, IVG-F8-03
```

(Note: 3 new F8 IDs + 1 carried-forward F7 ID = 4 total entries in the register; "count: 3" above refers to the 3 new-in-F8 IDs, consistent with `F8_IVG_DEFERRED_TEST_REGISTER.md`'s own "New in F8" table. The carried-forward item is listed separately in that document's own table, per task §52's instruction to distinguish carried-forward conditions from new ones.)

## 1. Automated domain/unit tests

| Suite | Files | Tests | Result |
|---|---|---|---|
| Canonical V2 (`canon-*.test.ts`, `audit-canon-v2-*.test.ts`) | 46 | 915 | ALL PASS |
| Named regression F0-S → F7 (`f0s-*` … `f7-*`) | 42 | 380 | ALL PASS |
| F8's own new suite (`f8-*.test.ts`) | 4 | 69 | ALL PASS |
| Full repository suite (`npx vitest run`, no filter) | 330 | 5403 | ALL PASS |

`tsc --noEmit`: clean, zero errors. `next build`: compiled successfully, zero errors, all new F8 routes present in the route list.

## 2. Real-PostgreSQL certification

Script: `scripts/operations/f8-assessment-framework-migration-cert.sh` (ephemeral, local-only — never Neon/Preview/Production).

- Full baseline + chronological migration history (through F8's own migration) applied cleanly.
- F8's migration re-applied a second time with zero errors (idempotent).
- All 6 new F8 tables verified present; exactly 1 `ACTIVE` diagnostic policy and 1 `ACTIVE` intervention policy seeded by the migration itself.
- Full task §33 adversarial matrix (A–Q), all 17 cases, exercised via real service calls including the real F5 `updateMastery()` and real F2 `canAccessLearner()` — see the commit message for `test(f8): real-Postgres migration and full adversarial matrix certification (A-Q)` for the complete case-by-case summary, and `F8_GAP_CLASSIFICATION_MODEL.md`/`F8_EXAM_SKILLS_MODEL.md`/`F8_FRAMEWORK_AWARE_TEACHING_MODEL.md` for the design each case verifies.

Two real inspection gaps were found and corrected only during this certification (not caught by the earlier research pass): `learning_evidence.concept_id` carries a real FK to `concepts(id)` (missed because the original research read only the `CREATE TABLE` statement, not the separately `pg_dump`'d `ALTER TABLE ADD CONSTRAINT`), and `canAccessLearner`'s owner check is a real `students.user_id = actorUserId` relationship, never bare id equality. Both are documented in the certification commit and reflected in the final seed/runner scripts.

## 3. Authenticated E2E

See `F8_AUTHENTICATED_E2E_REPORT.md` in full. Summary: Student-A/Student-B ownership boundary proven for real against real Postgres; the broader parent/teacher/entitlement matrix is deferred to the IVG register (`IVG-F8-02`) since F8 introduces no new code on those specific boundaries — it only calls F2/F3's existing, unmodified functions, already certified in their own phases.

## 4. AI real-provider certification

See `F8_AI_PROVIDER_CERTIFICATION.md` in full. No provider credentials available in this environment; honestly deferred (`IVG-F8-01`), never simulated or reported as PASS.

## 5. Non-interference verification (Canonical V2 and F0-S–F7)

`tests/unit/f8-canonical-v2-noninterference.test.ts` asserts, at the source level, across every F8 lib and route file: no import of Canonical V2 internals other than the read-only `canonical-decision.service` entry point; no call to any Canonical V2 progression function; no write to any Canonical-V2-owned table; no direct write to `learning_evidence` (only via the real, unmodified `updateMastery()`); no exposed `PROVE_PASSED`/etc. vocabulary; `classification.algorithms.ts` has zero AI/network imports (pure); `evidence-integration.service.ts` never attaches `competencyIds`; diagnosis persistence is append-only (no `UPDATE`/`DELETE` against `learner_gap_diagnoses` anywhere in F8); the two new `command_term_interpretations` partial unique indexes exist at the schema level. Corroborated behaviorally by the unmodified Canonical V2 suite (46 files/915 tests) and F0-S–F7 named suites (42 files/380 tests) all passing unchanged.

## 6. Known non-blocking items

- `next.config.js` middleware-convention deprecation warning — pre-existing, unrelated to F8.
- The minimal student-flow attempt-recording endpoint (`POST /api/teaching/interventions/[id]/attempts`) accepts an already-graded outcome from the caller rather than re-implementing question generation/grading itself — a deliberate task §33 scope decision ("do not perform final UX redesign," "minimal Preview UX/API"), not an oversight. See `F8_EXAM_SKILLS_MODEL.md`.

## 7. Overall QA verdict

**PASS**, with the deferrals above explicitly registered and none silently upgraded to PASS. Zero regressions across 5403 total automated tests, zero TypeScript errors, a clean production build with all new routes present, and a real-PostgreSQL adversarial certification covering all 17 required matrix cases.
