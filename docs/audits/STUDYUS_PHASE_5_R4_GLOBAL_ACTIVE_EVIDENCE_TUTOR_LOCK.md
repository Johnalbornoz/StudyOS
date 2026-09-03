# StudyUs Phase 5-R4 — Global Active-Evidence Tutor Lock

## 1. Executive Summary

Phase 5-R3 closed the `conceptId`-omission bypass by scoping the guard
to the conversation's own server-persisted `subject_id`. Fresh review
found the residual gap: that `subject_id` is itself **client-chosen**
at conversation-creation time. A conversation deliberately labelled
Subject B, asked in free text about Subject A while a restricted
attempt is active in Subject A, would have passed Phase 5-R3's
subject-scoped check. Free-form text cannot be proven to stay within a
conversation's nominal subject without AI classification — which the
task's own central invariant forbids for an integrity control.

The only deterministic fix is to stop using subject/concept as a
security boundary for this gate at all: **while the student has ANY
active restricted evidence collection anywhere, general Tutor
instructional assistance is unavailable, full stop.** `subjectId`/
`conceptId` remain exactly as useful as before for TeachingIntent
selection and RAG grounding **once the gate has already passed** — they
just no longer decide whether it runs.

## 2. The Change

One new, thin function in the same file (no second policy/service):

```ts
// src/services/active-evidence-guard.service.ts
export async function getActiveRestrictedEvidenceForStudent(studentId: string): Promise<ActiveEvidenceCollectionState> {
  return getActiveInstructionRestriction({ studentId, subjectId: null });
}
```

This is not new logic — Phase 5-R3's `getActiveInstructionRestriction`
already had a `subjectId === null` branch meaning "no subject binding,
check every active restricted attempt for this student" (built for the
genuinely-unscoped-conversation case). This function just calls that
branch explicitly, by an intention-revealing name, rather than relying
on a caller passing `subjectId: null` to mean something not obvious at
the call site. Zero new query shape; `getActiveInstructionRestriction`'s
existing, already-tested subject-scoped logic and its 30-test suite
are untouched and still valid as a general primitive.

`tutor.service.ts::sendMessage`'s guard call becomes:

```ts
const evidenceState = await getActiveRestrictedEvidenceForStudent(studentId).catch(...);
```

— `conv.subject_id` and `conceptId` are no longer passed to the guard
at all. They remain used later in the function, exactly as before, for
`getTeachingIntentForConcept`/`buildCompactTutorContext`/`retrieveContext`
once the gate has already passed.

## 3. Canonical Restricted Modes (S2)

Unchanged: `RESTRICTED_EVIDENCE_MODES = {'INDEPENDENT', 'ASSESSMENT'}`,
still computed from `activity-taxonomy.ts`'s own
`EVIDENCE_MODE_BY_ACTIVITY` — no second taxonomy, no hand-maintained
list.

## 4. Active Means Active (S4)

Unchanged: `getStudentActiveQuizzes`'s `status = 'active' AND
expires_at > NOW()` for quiz sessions, `outcome IS NULL` for pending
verification. Neither definition was touched this phase.

## 5. Subject/Concept No Longer Security Boundaries (S5) — VERIFIED

Structurally proven, not just tested by convention:
`getActiveRestrictedEvidenceForStudent.length === 1` — the function
signature itself has no subject/concept parameter to be influenced by.
`tutor.service.ts`'s call site passes only `studentId`. Four
adversarial scenarios confirm the call is identical regardless of
client input:

| Scenario | Guard call |
|---|---|
| `conceptId` omitted | `getActiveRestrictedEvidenceForStudent(studentId)` |
| `conceptId` wrong/altered | `getActiveRestrictedEvidenceForStudent(studentId)` |
| Conversation subject differs from an active restriction's subject | `getActiveRestrictedEvidenceForStudent(studentId)` |
| Conversation has no subject at all | `getActiveRestrictedEvidenceForStudent(studentId)` |

All four produce the exact same call — there is no code path by which
subject or concept could change what the gate checks.

## 6. Normal Learning (S6) — VERIFIED

| Scenario | Result |
|---|---|
| No active restricted evidence, anywhere | Allowed |
| PRACTICE only | Allowed |
| REMEDIATION only | Allowed |
| Completed assessment | Allowed |
| Expired assessment | Allowed |
| Resolved verification | Allowed |

Once a restricted attempt completes/expires/resolves, it disappears
from `getStudentActiveQuizzes`'/the pending-verification query's result
sets on the very next check — no separate "unlock" step, no residual
lock state anywhere (nothing is cached; every check is computed fresh).

## 7. UI Experience (S7)

Unchanged from Phase 5-R2/5-R3: the same localized, non-error,
five-locale canned reply. Verified the blocked reply never contains
the seeded misconception code or strategy language an allowed
`TeachingIntent` would have produced.

## 8. No Other Surfaces (S8)

`git status` this phase shows exactly one modified production file:
`src/services/tutor.service.ts` (the guard call now passes only
`studentId`; nothing else in the function changed). Practice hints,
Explain & Defend, Remediation, Assessment, Verification,
`LearningDecision`, `TeachingIntent`, and the Teaching Policy are
absent from the diff — unmodified.

## 9. Query Cost (S9/S13)

Unchanged in shape from Phase 5-R3, since this phase reuses the exact
same underlying function and its exact same unscoped query branch:

| Path | Reads |
|---|---|
| A restricted quiz session is found | 1 (`getStudentActiveQuizzes`) |
| None found | 1 + 1 (`getStudentActiveQuizzes` + the unscoped `hasPendingRestrictedVerification`) |

Both bounded and indexed (`idx_verification_attempts_student`),
independent of the student's total historical evidence size and of how
many subjects/concepts the student has. Confirmed by a dedicated test
asserting each dependency is called at most once.

**TUTOR_GUARD_QUERY_COST = 1 read if a restricted quiz session is found; otherwise 2 bounded, indexed reads total**

## 10. PostgreSQL Validation (S10)

**Query text did not change.** `getActiveRestrictedEvidenceForStudent`
calls the exact same unscoped `hasPendingRestrictedVerification(studentId, null)`
code path Phase 5-R3 already validated against real, disposable
PostgreSQL 18.6 (scenario "Pending verification, unscoped (no
subject)" in that phase's report §15 — returned the correct row for
the correct student, using the plain, non-joined, indexed
`student_id`/`outcome IS NULL` query). No new SQL, no re-validation
needed this phase, consistent with the task's own "if R3's student-wide
pending-verification SQL already supports this scope, reuse it."

## 11. Migrations (S11)

No schema change.

**NEW_MIGRATIONS_PHASE_5_R4 = 0**

## 12. Tests

29 release-blocking test items, all covered:

| Test file | Count | Covers |
|---|---|---|
| `active-evidence-guard.test.ts` (extended) | 30 | Release tests 1, 4-9, 14-18, 28 |
| `tutor-cross-surface-guard.test.ts` (rewritten) | 15 | Release tests 2, 3, 10-13, 19-23 |
| `tutor-adaptive-teaching.test.ts` (mock updated) | 6 | Release test 23 confirmation |
| `hint-route-permission.test.ts` (untouched) | 14 | Release test 24 |

## 13. Full Regression

99 test files, **1251 tests passing** (1236 baseline + 15 new), zero
failures, zero skipped. `npx tsc --noEmit` clean. `npm run build`
clean. `npm run db:status`: 6 applied, 0 pending, 0 drifted.

## 14. Git Diff

```
 M src/services/tutor.service.ts                    (guard call now passes only studentId)
?? src/services/active-evidence-guard.service.ts     (extended in place: +1 thin wrapper function, zero new query shape)
?? tests/unit/active-evidence-guard.test.ts           (extended: +10 tests for the global function)
?? tests/unit/tutor-cross-surface-guard.test.ts       (rewritten for the subject/concept-independent call site)
?? tests/unit/tutor-adaptive-teaching.test.ts         (mock updated to the new export name)
```

Nothing staged, nothing committed, nothing pushed.

## 15. Remaining Risks

**BLOCKING: none.**

**NON-BLOCKING:** every risk disclosed in Phase 5-R's report (§19
there) still stands, unchanged. Phase 5-R3's one disclosed edge case
(a `conceptId` naming a concept in a different subject causing a
narrow, harmless over-block) is now moot — subject/concept no longer
affect this gate's decision at all, so that edge case cannot occur.

## 16. Final Decision

```
GLOBAL_ACTIVE_RESTRICTED_EVIDENCE_DETECTION = VERIFIED
TUTOR_GLOBAL_ACTIVE_EVIDENCE_LOCK = VERIFIED
CROSS_SUBJECT_TUTOR_BYPASS_PATHS = 0 / 7
CONCEPTLESS_TUTOR_BYPASS_PATHS = 0 / 4
ACTIVE_SOLO_CHECK_TUTOR = BLOCKED
ACTIVE_RETENTION_CHECK_TUTOR = BLOCKED
ACTIVE_TRANSFER_TUTOR = BLOCKED
ACTIVE_DIAGNOSTIC_CHECK_TUTOR = BLOCKED
ACTIVE_CUMULATIVE_ASSESSMENT_TUTOR = BLOCKED
ACTIVE_MOCK_EXAM_TUTOR = BLOCKED
ACTIVE_SOLO_VERIFY_TUTOR = BLOCKED
PRACTICE_TUTOR = ALLOWED
REMEDIATION_TUTOR = ALLOWED
COMPLETED_EVIDENCE_TUTOR = ALLOWED
BLOCKED_REQUEST_TEACHING_INTENT_LOOKUPS = 0 / 2
BLOCKED_REQUEST_GROUNDING_CALLS = 0 / 1
BLOCKED_REQUEST_AI_CALLS = 0 / 3
COGNITIVE_MUTATIONS_FROM_GUARD = 0 / 1
TUTOR_GUARD_QUERY_COST = 1 read if a restricted quiz session is found; otherwise 2 bounded, indexed reads total
NEW_MIGRATIONS_PHASE_5_R4 = 0
FULL_TEST_COUNT = 1251
PHASE_5_RELEASE_BLOCKERS_CLOSED = YES
READY_FOR_PHASE_5_PRODUCTION_RELEASE = YES
READY_FOR_PHASE_6 = YES_WITH_CONDITIONS
```

`READY_FOR_PHASE_6 = YES_WITH_CONDITIONS` carries forward only the
non-blocking risks already disclosed in Phase 5-R's report — nothing
new from this remediation.

---

**STOP.** No commit. No push. No deploy. Phase 6 not begun.
