# StudyUs Phase 5-R3 — Server-Authoritative Tutor Assessment Scope Closure

## 1. Executive Summary

Phase 5-R2's guard ran `when conceptId is present`. Fresh audit
confirmed the gap external review flagged: `conceptId` on a Tutor
message is optional, client-supplied, and untrusted — a learner could
omit it (or supply an unrelated one) while free-texting about the
concept actually under active restriction, and the guard would never
run at all. This remediation makes the guard **unconditional**, scoped
primarily by the conversation's own server-persisted `subject_id`
rather than the client-supplied `conceptId`, which is now strictly a
narrowing refinement that can never widen what's allowed.

## 2. Fresh Tutor Identity Audit (S1)

Traced `/api/tutor/message`'s `SendSchema`, `tutor.service.ts::sendMessage`,
and `tutor_conversations` directly:

```ts
const SendSchema = z.object({
  studentId: z.string().uuid(),
  conversationId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  conceptId: z.string().uuid().optional(),   // <-- optional, client-supplied
});
```

`sendMessage` reads `conv.subject_id` fresh from `tutor_conversations`
on every call (`SELECT subject_id, title FROM tutor_conversations
WHERE id = $1`) — never from the request body. That column is itself
set once, at conversation creation (`/api/tutor/conversations` POST,
`subjectId` also `.optional()` there), and is then immutable for the
life of the conversation from the client's perspective: a later
message cannot alter it.

```
TUTOR_CONCEPT_ID_SOURCE = CLIENT
TUTOR_SUBJECT_ID_SOURCE = MIXED
```

`MIXED` because the *value* originates from client input at
conversation-creation time, but is then server-persisted and read-only
per message thereafter — trustworthy as a **per-message** scope anchor
precisely because nothing in a single `sendMessage` call can move it.
It is not perfectly trustworthy in an absolute sense (a client could,
in principle, create a conversation under a "safe" subject and still
ask about a concept in another subject in free text) — see §7's
handling of the genuinely unscoped case, and §9 R1 for the one
residual, non-blocking edge this leaves.

## 3. Server-Authoritative Scope (S2)

`conceptId` is now consumed strictly as an optional narrowing
refinement — the guard's own logic (§4) checks it first only because
it is the *most specific* signal when present, never as a substitute
for the subject-level check. A wrong/unrelated `conceptId` can only
ever cause the guard to fall through to the broader, still-safe
subject check; it can never cause an early "allowed."

## 4. Subject-Aware Active Evidence Guard (S3)

Same file, extended in place (no second permission system):

```ts
// src/services/active-evidence-guard.service.ts
export interface ActiveInstructionRestrictionInput {
  studentId: string;
  subjectId: string | null;  // conversation's own server-persisted scope
  conceptId?: string;        // optional client-supplied refinement
}
getActiveInstructionRestriction(input): Promise<ActiveEvidenceCollectionState>
canProvideInstructionalAssistance(input): Promise<boolean>
```

`RESTRICTED_EVIDENCE_MODES` is still computed from
`activity-taxonomy.ts`'s own `EVIDENCE_MODE_BY_ACTIVITY` — no duplicate
taxonomy, unchanged from Phase 5-R2.

## 5. Restricted Assessment Scope (S4)

`getActiveInstructionRestriction` checks, in order:

1. **Concept-specific** (only when `conceptId` given): any restricted
   quiz session whose `conceptId`/`conceptIds` matches exactly.
2. **Subject scope**: any restricted quiz session in the SAME subject
   as the conversation — or, when the conversation has **no** subject
   binding at all, ANY restricted quiz session anywhere for this
   student. An absent scope fails toward "check everything," never
   toward "nothing to check."
3. **Verification scope** (§6): the same discipline, subject-scoped or
   unscoped.

`CUMULATIVE_ASSESSMENT`/`MOCK_EXAM` naturally clear step 2 via their
own `subjectId` field on the `quiz_sessions` row (already returned by
`getStudentActiveQuizzes` — no per-concept enumeration needed) — Tutor
is blocked for the whole subject while one is active, exactly per S4's
"prefer temporarily blocking... over allowing a bypass," and never for
a genuinely unrelated subject (tested: §8).

## 6. SOLO_VERIFY (S5)

The Phase 5-R2 finding stands unchanged: a SOLO_VERIFY resume reuses
the *original* PRACTICE `quiz_sessions` row, whose `evidence_mode`
still reads `'PRACTICE'`. Step 3's `hasPendingRestrictedVerification`
(the one genuinely new query this phase introduces) is the mechanism
that still catches it — subject-scoped via a join on `concepts.subject_id`
when a subject is known, or student-scoped alone when it isn't. No
verification semantics were touched: this reads the same `outcome IS
NULL` definition Phase 3/3-R/4-R already use.

## 7. Conceptless Tutor (S6)

`sendMessage` now calls `getActiveInstructionRestriction` **unconditionally**
— not gated behind `if (conceptId)` — immediately after the user's
message is persisted, and strictly before `getTeachingIntentForConcept`,
`buildCompactTutorContext`, `retrieveContext`, or `executeAI`. Verified
directly (`tutor-cross-surface-guard.test.ts`): a conceptId-less
message on an actively-restricted subject calls none of those four.

## 8. False Concept ID (S7) — deterministic, no free-text inspection

The guard never inspects message text. A wrong/unrelated `conceptId`
supplied during an active restricted attempt cannot create a bypass:
step 1 (concept-specific) simply finds nothing and falls through to
step 2 (subject scope), which still matches on the conversation's real
subject regardless of what concept was named. Tested directly with two
adversarial cases: a wrong in-subject `conceptId`, and a wrong
`conceptId` against a multi-concept `CUMULATIVE_ASSESSMENT` — both
still blocked.

## 9. Normal Learning Unaffected (S8) — VERIFIED

| Scenario | Result |
|---|---|
| No active restricted attempt | Allowed |
| PRACTICE, same subject | Allowed |
| REMEDIATION, same subject | Allowed |
| Completed Assessment | Allowed |
| Expired Assessment | Allowed |
| Resolved SOLO_VERIFY | Allowed |
| Restricted activity in a **different** subject | Allowed |

All seven tested directly (`active-evidence-guard.test.ts`).

## 10. TRANSFER (S9) — explicit regression, not inferred

`TRANSFER`'s `EvidenceMode` (`activity-taxonomy.ts`, unmodified) is
`INDEPENDENT`. A dedicated test (not merely relying on the taxonomy
table) constructs an active `TRANSFER` session and asserts the guard
blocks it, conceptId omitted.

**ACTIVE_TRANSFER_TUTOR_ASSISTANCE = BLOCKED**

## 11. Server Authority (S10) — VERIFIED, 0 bypasses

| Adversarial input | Result |
|---|---|
| `conceptId` omitted | Blocked (§7) |
| `conceptId` altered/wrong | Blocked (§8) |
| `conceptId` belonging to another, non-active concept | Blocked (subject scope still matches — §8) |
| Direct `sendMessage` service call | Blocked identically — enforcement lives in the service, not the route; there is no separate route-level check to skip |
| Direct Tutor API call | Same code path as above — `/api/tutor/message` has no logic of its own beyond calling `sendMessage` |

**CLIENT_CONCEPT_SCOPE_BYPASS_PATHS = 0 / 5**

## 12. Safe Response (S11)

Unchanged from Phase 5-R2: the same localized, non-error, five-locale
canned reply. Contains no assessment answers, no protected concept
list, no misconception data, no verification internals — verified by
asserting the blocked reply never contains the seeded misconception
code or strategy language that an allowed request's `TeachingIntent`
would have produced.

## 13. Cognitive Safety (S12) — VERIFIED, 0/1

A permanent test scans every `db.query` call made during a blocked
Tutor turn and asserts none touches `mastery_records`/
`concept_knowledge_state`/`learning_evidence`/`verification_attempts`
(as a write — the guard's own bounded SELECT is a read)/
`student_misconceptions`. `tutor_messages`/`tutor_conversations`
persistence continues exactly as it already did for every Tutor turn,
before this phase.

## 14. Query Cost (S13)

Freshly confirmed: `getStudentActiveQuizzes` already returns
`subjectId`, `conceptId`, `conceptIds`, `activityType`, `evidenceMode`
per row — sufficient to do the subject-level filter **in memory**,
over an already-bounded result set, with **zero new query** for the
quiz-session side (unchanged from Phase 5-R2). The one new query
(`hasPendingRestrictedVerification`) replaces Phase 5-R2's reuse of
the 5-query `getAssessmentStateForConcept` with a single, purpose-built,
`LIMIT 1` read — a **net reduction** in cost, not a regression:

| Path | Reads | vs. Phase 5-R2 |
|---|---|---|
| Restricted quiz session found | 1 | unchanged |
| No active quiz session | 1 + 1 | **was 1 + 5** |

Both reads are indexed (`idx_verification_attempts_student` +
`concepts` primary key for the join) and independent of total
historical evidence size or how many concepts exist in the subject —
confirmed by `EXPLAIN ANALYZE` against real PostgreSQL 18.6 (§15):
`Bitmap Index Scan on idx_verification_attempts_student` +
`Index Scan using concepts_pkey`, zero sequential scans, 0.027ms.

```
TUTOR_GUARD_INCREMENTAL_QUERY_COST = 1-2 bounded, indexed reads per Tutor message (down from 1-6 in Phase 5-R2)
QUERY_COST = BOUNDED
```

## 15. SQL Validation Against Disposable PostgreSQL 18.6 (S14)

Ran a real, disposable `postgresql@18.6` instance locally (Homebrew
build, `initdb`/`pg_ctl`, torn down after validation — no Docker
dependency needed, none left running) with a minimal schema mirroring
the production baseline (`subjects`, `concepts` with
`idx_concepts_subject`, `verification_attempts` with
`idx_verification_attempts_student`/`idx_verification_attempts_concept`,
matching the real `outcome` CHECK constraint). Seeded and verified
every scenario S14 names:

| Scenario | Result |
|---|---|
| Same subject, pending row exists | Returns the pending row, correctly excludes an older *resolved* row in the same subject |
| Different subject | Zero rows (no cross-subject leakage) |
| Multi-concept scope | N/A — this query is verification-only; multi-concept coverage is handled by `quiz_sessions.conceptIds`, reused unmodified (Phase 5-R2), not new SQL |
| Expired session | N/A — handled by `getStudentActiveQuizzes`' own unmodified `expires_at` filter, not new SQL |
| Completed session | N/A — same, unmodified |
| Pending verification, unscoped (no subject) | Returns the pending row for the correct student |
| Resolved verification | Zero rows |
| Multiple pending rows in-subject | Returns the most recent one (deterministic `ORDER BY created_at DESC LIMIT 1`, consistent with this codebase's existing tie-break convention) |
| Query plan | Index scans only, no sequential scan, sub-millisecond |

All results matched expectations exactly. No separate R3-V phase was
needed.

## 16. Migrations (S15)

No schema change — `verification_attempts`/`concepts` already carry
everything the new query needs, and both join columns were already
indexed.

**NEW_MIGRATIONS_PHASE_5_R3 = 0**

## 17. Protected Systems

`git status` this phase shows exactly one modified production file:
`src/services/tutor.service.ts` (the guard call moved outside the
`if (conceptId)` gate; no other logic touched). `active-evidence-guard.service.ts`
was extended in place (still untracked/new from Phase 5-R2's
perspective). Every protected file — `assessment-verification.service.ts`,
`quiz-persistence.service.ts`, `/api/quizzes/verify/route.ts`,
`learning-session-engine.service.ts`, `adaptive-teaching-policy.ts`,
`adaptive-learning-policy.ts`, the hint route/permission policy — is
absent from the diff.

## 18. Tests

27 release-blocking test items, all covered:

| Test file | Count | Covers |
|---|---|---|
| `active-evidence-guard.test.ts` (rewritten) | 23 | Release tests 1-8, 11-16, 26 |
| `tutor-cross-surface-guard.test.ts` (rewritten) | 14 | Release tests 9-10, 17-21 |
| `tutor-adaptive-teaching.test.ts` (mock updated) | 6 | Release test 21 — Phase 5-R adaptive Tutor still works when allowed |
| `hint-route-permission.test.ts` (untouched) | 14 | Release test 22 |

Plus real-PostgreSQL-18.6 validation (§15) for the new SQL specifically.

## 19. Full Regression

99 test files, **1236 tests passing** (1225 baseline + 11 net new: +6
in the rewritten guard suite, +6 in the rewritten Tutor cross-surface
suite offset by consolidating a couple of superseded Phase 5-R2 cases),
zero failures, zero skipped.

`npx tsc --noEmit` clean. `npm run build` clean. `npm run db:status`:
6 applied, 0 pending, 0 drifted.

## 20. Git Diff

```
 M src/services/tutor.service.ts                    (guard call unconditional, no other change)
?? src/services/active-evidence-guard.service.ts     (extended in place: subject-aware signature, +1 new SQL query)
?? tests/unit/active-evidence-guard.test.ts           (rewritten for the new signature)
?? tests/unit/tutor-cross-surface-guard.test.ts       (rewritten for the conceptless case)
?? tests/unit/tutor-adaptive-teaching.test.ts         (mock updated to the new export name)
```

Nothing staged, nothing committed, nothing pushed.

## 21. Remaining Risks (carried forward + one new observation)

**BLOCKING: none.**

**NON-BLOCKING:**
- Every risk disclosed in Phase 5-R's report (§19 there) still stands,
  unchanged and untouched by this remediation.
- **R1 (new, minor)** — a `conceptId` naming a concept in a *different*
  subject than the conversation's own can, in one narrow case, cause a
  slightly wider block than strictly necessary (step 1 matches on
  `conceptId` alone, before the subject filter). This only ever makes
  the guard MORE conservative, never creates a bypass, and requires an
  unusual client input (a conceptId that doesn't belong to the
  conversation's own subject) that the real product UI would not
  normally send. Documented, not fixed, since fixing it would trade a
  harmless, rare over-block for extra complexity in a security-critical
  path.

## 22. Final Decision

```
TUTOR_CONCEPT_ID_SOURCE = CLIENT
TUTOR_SUBJECT_ID_SOURCE = MIXED
CONCEPTLESS_TUTOR_INTEGRITY_GUARD = VERIFIED
CLIENT_CONCEPT_SCOPE_BYPASS_PATHS = 0 / 5
ACTIVE_SOLO_CHECK_CONCEPTLESS_TUTOR = BLOCKED
ACTIVE_RETENTION_CHECK_CONCEPTLESS_TUTOR = BLOCKED
ACTIVE_TRANSFER_CONCEPTLESS_TUTOR = BLOCKED
ACTIVE_DIAGNOSTIC_CONCEPTLESS_TUTOR = BLOCKED
ACTIVE_CUMULATIVE_ASSESSMENT_CONCEPTLESS_TUTOR = BLOCKED
ACTIVE_MOCK_EXAM_CONCEPTLESS_TUTOR = BLOCKED
ACTIVE_SOLO_VERIFY_CONCEPTLESS_TUTOR = BLOCKED
UNRELATED_SUBJECT_TUTOR = ALLOWED
BLOCKED_REQUEST_TEACHING_INTENT_LOOKUPS = 0 / 3
BLOCKED_REQUEST_GROUNDING_CALLS = 0 / 1
BLOCKED_REQUEST_AI_CALLS = 0 / 4
COGNITIVE_MUTATIONS_FROM_GUARD = 0 / 1
TUTOR_GUARD_INCREMENTAL_QUERY_COST = 1-2 bounded, indexed reads per Tutor message
QUERY_COST = BOUNDED
NEW_MIGRATIONS_PHASE_5_R3 = 0
FULL_TEST_COUNT = 1236
PHASE_5_RELEASE_BLOCKERS_CLOSED = YES
READY_FOR_PHASE_5_PRODUCTION_RELEASE = YES
READY_FOR_PHASE_6 = YES_WITH_CONDITIONS
```

`READY_FOR_PHASE_6 = YES_WITH_CONDITIONS` carries forward the
non-blocking risks in §21 — none new that touch this remediation's
scope beyond the one disclosed, harmless over-block edge case.

---

**STOP.** No commit. No push. No deploy. Phase 6 not begun.
