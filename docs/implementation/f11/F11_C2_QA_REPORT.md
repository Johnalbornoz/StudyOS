# F11-C2 — QA Report

Branch: `f11c2/skill-reinforcement-execution`
Base: `origin/f11c1/concept-reinforcement-execution@f5276260782730ca8fa6e29fb44bead649d38eb0`
Certified HEAD: see final report §V

## Test Layer Matrix (mandatory separate reporting, task §39)

```
AUTOMATED:
  executed: 5571 (8 net new F11-C2 source-guard tests; 4 pre-existing tests fixed for a real regression, see Bugs)
  passed:   5571
  failed:   0
  environment: vitest, in-process, no database

REAL_POSTGRES:
  executed: 41 assertions (cases A-Q plus setup/fixture-validity checks)
  passed:   41
  failed:   0
  environment: ephemeral local Postgres (unix socket, never Neon/Preview/Production)

AUTHORIZATION_ADVERSARIAL:
  executed: 8 (cross-student, Parent, assigning Teacher, unrelated Teacher, multi-role,
             nonexistent skill, retired skill, mismatched skill/concept)
  passed:   8

CONCURRENCY:
  executed: 2 (sequential retry, real Promise.all concurrency) + 1 orphan-residual check
  passed:   3

EVIDENCE_RECONCILIATION:
  executed: 5 checkpoints (happy path, negative inference, mismatch, aggregation, full-run total)
  passed:   5

F11_C1_REGRESSION:
  real Postgres: 41/41 assertions PASS, unchanged (startConceptReinforcementExecution untouched)
  unit: 3 files, re-verified passing (source guard, route security -- route security updated to
        mock the new dispatcher name, not a behavior change)

F11_B_REGRESSION:
  real Postgres: PASS, unchanged
  unit: 2 files PASS, unchanged

F11_A_REGRESSION:
  real Postgres: PASS, unchanged
  unit: 2 files PASS, unchanged

F10_REGRESSION:
  real Postgres (lifecycle + multi-role check): PASS, unchanged
  unit: 5 files PASS, unchanged

F5_F8_REGRESSION (Skill/Evidence semantics):
  88 files / 1532 tests across F2/F5/F8/F9/F10/F11/quiz/mastery/evidence/skill/competency/canon-*
  PASS, 1532/1532 (4 required a real, mechanical index-shift fix -- see Bugs; zero semantic change)

CANONICAL_V2_REGRESSION:
  included in the 88-file/1532-test run above (all canon-*.test.ts files)
  PASS, unchanged
```

## Bugs Discovered and Fixed

**One real regression**, found by the existing test suite exactly as it should be: adding `storeQuiz`'s new trailing `targetSkillIds` parameter shifted the positional index of every parameter counted *from the end* of the SQL params array. Four pre-existing tests (`canon-r5r1-quiz-session-v1-marker.test.ts`, `canon-r6-prove-v1-exact10-independent-assessment.test.ts` ×2, `lx9-final-transfer-recovery-canonical-progress.test.ts`, `quiz-persistence-evidence-mode.test.ts`) asserted `params[params.length - N]` for a fixed `N`; each was updated to the new, correct offset (or, for the `INSERT INTO` window-slice test, the window was widened to still include the statement). **No test's actual assertion or intent was weakened** — every one still verifies exactly what it verified before, at the corrected position. This is a real, mechanical consequence of an additive schema change, not a design flaw; it is exactly the kind of thing task §9's "existing Practice tests remain unchanged/passing" requirement exists to catch.

## Overall QA Verdict

**PASS.** Zero regressions in substance across 1532 named-regression tests and 41 real-Postgres assertions; the one fix required was a mechanical index correction in test code, caught and corrected before certification.
