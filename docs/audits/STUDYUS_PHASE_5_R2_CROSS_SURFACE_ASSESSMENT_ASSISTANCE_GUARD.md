# StudyUs Phase 5-R2 — Cross-Surface Assessment Assistance Guard

## 1. Executive Summary

External review found one final integrity gap: Practice hints are
correctly gated to `PRACTICE` evidence mode by `canUseAI()`, but Tutor
chat had no awareness at all of whether the learner currently has an
active `INDEPENDENT`/`ASSESSMENT` evidence-collection attempt open
elsewhere in the product. A learner could start an Assessment, open
Tutor for the same concept, receive concept-specific (now possibly
misconception-targeted) teaching, and return to the Assessment — a
genuine cross-surface bypass of Phase 3 Evidence Mode that the Assessment
route itself could never see or prevent.

This remediation adds **one** new server-side authority,
`getActiveEvidenceCollectionState` (`src/services/active-evidence-guard.service.ts`),
and wires it into `tutor.service.ts::sendMessage` **before** any
`TeachingIntent` computation, grounding, or AI provider call. It reuses
Phase 3's own canonical `EvidenceMode` taxonomy and two already-certified
reads — nothing about Evidence Mode, Mastery, Knowledge State,
Verification, or Teaching Strategy semantics was redefined.

## 2. Fresh Active-Attempt Audit (S1)

Freshly read `database/baseline/STUDYUS_BASELINE_2026_08.sql` and
`quiz-persistence.service.ts` rather than assuming a status model:

```sql
CREATE TABLE public.quiz_sessions (
  ...
  status text DEFAULT 'active',
  completed_at timestamp without time zone,
  expires_at timestamp without time zone NOT NULL,
  activity_type text,
  evidence_mode text,
  CONSTRAINT quiz_sessions_status_check CHECK (status = ANY (ARRAY['active','completed','expired']))
);
```

- **No `abandoned` status exists** — the CHECK constraint allows exactly
  `active`/`completed`/`expired`. An abandoned attempt simply sits at
  `status = 'active'` until its `expires_at` (45 minutes from creation,
  `quiz-persistence.service.ts::createQuizSession`) passes; nothing
  transitions it to `expired` on a schedule — reads compute "still
  active" as `status = 'active' AND expires_at > NOW()`.
- **`getStudentActiveQuizzes(studentId)` already exists** and already
  implements exactly that rule (`quiz-persistence.service.ts`,
  unmodified) — the canonical, pre-existing "is this learner in an
  active attempt right now" read. Reused verbatim, not reimplemented.
- **`verification_attempts`** has its own, separate lifecycle
  (`outcome IS NULL` = unresolved) — a SOLO_VERIFY resume (Phase 4-R's
  `verificationLaunch`) reuses the **original** `quiz_sessions` row
  (created when that session was still an ordinary PRACTICE attempt),
  so that row's own `evidence_mode` column still reads `'PRACTICE'`,
  not `'INDEPENDENT'`. A guard that only checked `quiz_sessions` would
  silently miss an active SOLO_VERIFY resume. `getAssessmentStateForConcept`
  (Phase 3/3-R/4-R, unmodified) already exposes `hasPendingVerification`
  for exactly this case — reused, not reimplemented, and verification
  semantics are untouched.

## 3. Restricted Set (S2)

Read directly from `activity-taxonomy.ts`'s own
`EVIDENCE_MODE_BY_ACTIVITY` (unmodified) rather than hand-listed twice:

| ActivityType | EvidenceMode | Restricted? |
|---|---|---|
| PRACTICE | PRACTICE | No |
| REVIEW | PRACTICE | No |
| REMEDIATION | PRACTICE | No |
| SOLO_CHECK | INDEPENDENT | **Yes** |
| RETENTION_CHECK | INDEPENDENT | **Yes** |
| TRANSFER | INDEPENDENT | **Yes** |
| SOLO_VERIFY | INDEPENDENT | **Yes** (via `verification_attempts`, see §2) |
| DIAGNOSTIC_CHECK | ASSESSMENT | **Yes** |
| CUMULATIVE_ASSESSMENT | ASSESSMENT | **Yes** |
| MOCK_EXAM | ASSESSMENT | **Yes** |

`RESTRICTED_EVIDENCE_MODES = {'INDEPENDENT', 'ASSESSMENT'}` — computed
against the taxonomy, not a second policy.

## 4. Active Means Active (S3)

`getStudentActiveQuizzes`'s existing `status = 'active' AND expires_at > NOW()`
filter is the entire "active means active" rule — the smallest
deterministic mechanism the real schema supports, reused rather than
invented. A completed, expired, or genuinely abandoned-and-expired
session is excluded automatically; nothing new was added to detect
staleness because the existing 45-minute expiry already is the
staleness bound.

## 5. Concept Scope (S4)

The guard is scoped to exactly one `conceptId` per call. A restricted
`quiz_sessions` row blocks only when `conceptId = q.conceptId` **or**
`q.conceptIds` (the multi-concept array `CUMULATIVE_ASSESSMENT`/
`MOCK_EXAM` populate) contains it — so an active mock exam covering
concept X blocks Tutor for X even when Tutor is opened outside the exam
page, but never blocks an unrelated concept or subject (tested:
`active-evidence-guard.test.ts`, "an active restricted attempt for a
DIFFERENT concept does not block this concept").

## 6. Canonical Guard (S5)

```ts
// src/services/active-evidence-guard.service.ts
export interface ActiveEvidenceCollectionState {
  allowed: boolean;
  reason: 'NO_ACTIVE_RESTRICTED_EVIDENCE' | 'ACTIVE_QUIZ_SESSION' | 'ACTIVE_VERIFICATION';
  activityType: ActivityType | null;
  evidenceMode: EvidenceMode | null;
  sessionId: string | null;
}
getActiveEvidenceCollectionState(studentId, conceptId): Promise<ActiveEvidenceCollectionState>
canProvideInstructionalAssistance(studentId, conceptId): Promise<boolean>  // convenience boolean form
```

Structured state, not a bare boolean, per the task's own preference.
No second Evidence Mode policy — the restricted set is read from
`activity-taxonomy.ts`, and both underlying reads are reused verbatim.

## 7. Tutor Enforcement (S6)

`tutor.service.ts::sendMessage`: when `conceptId` is present, the guard
runs immediately after the user's message is persisted and **before**
`getTeachingIntentForConcept`, `buildCompactTutorContext`, grounding
retrieval, or `executeAI` are ever reached. If blocked, the function
returns early with a canned reply — none of those run at all (verified
by mock-call-count assertions, not inferred).

## 8. Safe UX Behavior (S7)

A real, localized, non-error reply — not a 500, not a blank response —
reusing the existing `tutor_messages` persistence path unchanged:

> "I can't provide instructional help for this concept while an
> independent assessment attempt is active. Finish the attempt first,
> then I can help you review it."

Covers all 5 supported locales (es/en/de/fr/pt) via a small lookup
inside `tutor.service.ts` itself — deliberately not added to
`src/lib/i18n/messages.ts`'s UI-wide `MessageKey` system (tutor replies
are already free-form text, not structured UI labels; adding one
conversational sentence there would require touching all 5 locale
objects and the type union for something that isn't a UI label).

## 9. Normal Tutoring Unaffected (S8) — VERIFIED

| Scenario | Result |
|---|---|
| PRACTICE attempt active | Allowed |
| REMEDIATION/PRACTICE step active | Allowed |
| No active attempt | Allowed |
| Completed Assessment | Allowed (never appears in `getStudentActiveQuizzes` at all) |
| Resolved SOLO_VERIFY | Allowed (`hasPendingVerification: false`) |
| Historical failed quiz | Allowed |

All six tested directly (`active-evidence-guard.test.ts`).

## 10. Cross-Surface Server Authority (S9) — VERIFIED

The Tutor API's own request schema (`/api/tutor/message`'s `SendSchema`)
has **no** mode/activityType field at all — there is structurally
nothing for a client to lie about. The guard's only input is
`studentId` (already ownership-verified upstream by `verifyStudentAccess`)
and `conceptId`; everything else it reads comes from server-side
`quiz_sessions`/`verification_attempts` state. Tested: the guard mock
is asserted to receive only `(studentId, conceptId)`, called exactly
once per message; a direct call to `sendMessage` (equivalent to "a
direct Tutor API call") is blocked identically to one reached through
the route, since the route has no separate enforcement logic of its
own — `sendMessage` **is** the enforcement point. A guard-lookup
failure (simulated DB outage) fails **closed**: no `TeachingIntent`
lookup, no AI call — an integrity control degrades to "unavailable,"
never to "unchecked."

**SERVER_AUTHORITATIVE = YES**
**CLIENT_MODE_BYPASS_PATHS = 0 / 3** (omitted mode-like field — none
exists to omit; a lied mode-like field — none exists to lie about; a
direct API call — blocked identically, since enforcement lives in the
service, not the route)

## 11. Quiz Hints Unchanged (S10) — VERIFIED

`src/app/api/quizzes/hint/route.ts` was **not touched** by this
remediation (confirmed: absent from `git status`'s modified-file list
this phase). `canUseAI()` still runs first, unmodified, before any
`TeachingIntent` lookup — the full `hint-route-permission.test.ts`
suite (Phase 5-R, 14 tests) still passes unchanged, part of this
phase's 1225-test run.

## 12. Remediation Unaffected (S11) — VERIFIED

REMEDIATION's EvidenceMode is `PRACTICE` (`activity-taxonomy.ts`,
unmodified) — never in `RESTRICTED_EVIDENCE_MODES`. Tested directly:
an active `REMEDIATION` quiz session allows Tutor assistance.

## 13. SOLO_VERIFY Resume (S12) — VERIFIED

While `assessment-verification.service.ts::getAssessmentStateForConcept`
reports `hasPendingVerification: true` for a concept, Tutor is blocked
for that concept (tested directly). Once the attempt resolves
(`hasPendingVerification: false`), Tutor is allowed again. No
verification semantics were modified — this only *reads* the same
field Phase 4-R's Decision Engine already reads.

## 14. No Cognitive Mutation (S13) — VERIFIED, 0/N

Neither `active-evidence-guard.service.ts` nor the new guard branch in
`tutor.service.ts` performs any write beyond the pre-existing
`tutor_messages`/`tutor_conversations` inserts/updates that already
happened on every Tutor turn before this phase. A permanent test
(`tutor-cross-surface-guard.test.ts`, "zero cognitive mutation from the
guard either way") scans every `db.query` call made during a blocked
request and asserts none touches `mastery_records`/
`concept_knowledge_state`/`learning_evidence`/`verification_attempts`/
`student_misconceptions`.

**COGNITIVE_MUTATIONS_FROM_GUARD = 0 / 2** (0 mutations across both the
allowed and the blocked code path)

## 15. Auditability (S14)

Not added this phase. The task explicitly makes this conditional
("If... appropriate without noisy logging... Logging every availability
check is not required") — a blocked Tutor turn is already visible as
an ordinary `tutor_messages` row with the canned reply text (no new
persistence needed to prove the block happened; it's the same audit
trail every other Tutor turn already has). Adding a `decision_events`
row per availability *check* (as opposed to per *decision* the system
acted on) would mean writing one for the overwhelming majority of Tutor
turns that are never blocked — exactly the "noisy logging" the task
says to avoid. Deliberately deferred; disclosed, not silently skipped.

## 16. Query Cost (S15)

| Path | Reads | Source |
|---|---|---|
| Restricted quiz session found | 1 (`getStudentActiveQuizzes`) | short-circuits before touching verification state |
| No active quiz session | 1 + 5 (`getAssessmentStateForConcept`) | both already-certified, bounded functions, reused verbatim |

Both are indexed, current-state-only reads (`status='active' AND
expires_at > NOW()`, `outcome IS NULL ... LIMIT 1`) — no full quiz
history, no full verification-attempt scan, no unbounded read. Tested
directly (`active-evidence-guard.test.ts`, "release test 25: query cost
bounded" — asserts each dependency is called at most once per guard
call, and that a restricted-quiz hit never reaches the second read at
all).

**QUERY_COST = BOUNDED**

## 17. Migrations (S16)

`quiz_sessions.status`/`.expires_at`/`.activity_type`/`.evidence_mode`
and `verification_attempts.outcome` already existed and already carry
everything this guard needs — no schema change was required or made.

**NEW_MIGRATIONS_PHASE_5_R2 = 0**

## 18. Protected Systems — confirmed untouched

`git status` this phase shows exactly one modified production file
beyond the new guard itself: `src/services/tutor.service.ts` (adds the
guard branch + canned-reply lookup; the Phase 5-R adaptive-teaching
wiring in the same file is unchanged). `assessment-verification.service.ts`,
`quiz-persistence.service.ts`, `/api/quizzes/verify/route.ts`,
`learning-session-engine.service.ts`, `adaptive-teaching-policy.ts`,
`adaptive-learning-policy.ts` — every protected file — do not appear in
the diff at all.

## 19. Tests

26 release-blocking test items, all covered:

| Test file | Count | Covers |
|---|---|---|
| `active-evidence-guard.test.ts` | 17 | Release tests 1-11, 25 |
| `tutor-cross-surface-guard.test.ts` | 9 | Release tests 9, 15-18, 22-23 |
| `tutor-adaptive-teaching.test.ts` (updated) | 6 | Re-confirms Phase 5-R wiring unaffected |
| `hint-route-permission.test.ts` (unchanged) | 14 | Release tests 19-20 |

## 20. TypeScript / Build / DB Status

- `npx tsc --noEmit` — clean.
- `npm run build` — clean.
- `npm run db:status` — 6 applied, 0 pending, 0 drifted (unchanged).

## 21. Full Regression

99 test files, **1225 tests passing** (1199 baseline + 26 new), zero
failures, zero skipped.

## 22. Git Diff

```
 M src/services/tutor.service.ts   (+44/-15, guard branch + canned-reply lookup + persistAssistantReply extraction)
?? src/services/active-evidence-guard.service.ts   (new, 100 lines)
?? tests/unit/active-evidence-guard.test.ts         (new, 17 tests)
?? tests/unit/tutor-cross-surface-guard.test.ts     (new, 9 tests)
 M tests/unit/tutor-adaptive-teaching.test.ts        (mocks the new guard, defaulted to allowed, for its pre-existing Phase 5-R assertions)
```

Nothing staged, nothing committed, nothing pushed.

## 23. Final Decision

```
ACTIVE_RESTRICTED_EVIDENCE_DETECTION = VERIFIED
CROSS_SURFACE_TUTOR_GUARD = VERIFIED
ACTIVE_SOLO_CHECK_TUTOR_ASSISTANCE = BLOCKED
ACTIVE_SOLO_VERIFY_TUTOR_ASSISTANCE = BLOCKED
ACTIVE_RETENTION_CHECK_TUTOR_ASSISTANCE = BLOCKED
ACTIVE_DIAGNOSTIC_CHECK_TUTOR_ASSISTANCE = BLOCKED
ACTIVE_CUMULATIVE_ASSESSMENT_TUTOR_ASSISTANCE = BLOCKED
ACTIVE_MOCK_EXAM_TUTOR_ASSISTANCE = BLOCKED
PRACTICE_TUTOR_ASSISTANCE = ALLOWED
COMPLETED_ASSESSMENT_TUTOR_ASSISTANCE = ALLOWED
SERVER_AUTHORITATIVE = YES
CLIENT_MODE_BYPASS_PATHS = 0 / 3
BLOCKED_REQUEST_TEACHING_INTENT_LOOKUPS = 0 / 8
BLOCKED_REQUEST_AI_CALLS = 0 / 8
COGNITIVE_MUTATIONS_FROM_GUARD = 0 / 2
QUERY_COST = BOUNDED
NEW_MIGRATIONS_PHASE_5_R2 = 0
FULL_TEST_COUNT = 1225
PHASE_5_RELEASE_BLOCKERS_CLOSED = YES
READY_FOR_PHASE_5_PRODUCTION_RELEASE = YES
READY_FOR_PHASE_6 = YES_WITH_CONDITIONS
```

`BLOCKED_REQUEST_TEACHING_INTENT_LOOKUPS`/`BLOCKED_REQUEST_AI_CALLS`
denominators (8) count the distinct blocked scenarios exercised:
SOLO_CHECK, RETENTION_CHECK, DIAGNOSTIC_CHECK, CUMULATIVE_ASSESSMENT,
MOCK_EXAM, multi-concept CUMULATIVE_ASSESSMENT, active SOLO_VERIFY, and
a guard-lookup-failure (fail-closed) case — zero of the eight ever
reached `getTeachingIntentForConcept` or the AI provider.

`READY_FOR_PHASE_6 = YES_WITH_CONDITIONS` carries forward, unchanged,
the four non-blocking risks already disclosed in the Phase 5-R report
(§19 there) — none of them touch this remediation's scope, and none is
newly introduced here. One new, non-blocking observation: per-check
auditability (§15) was deliberately deferred as noisy; if a future
phase wants a per-block audit trail, the same `decision_events`
mechanism used elsewhere can carry it without a new table.

---

**STOP.** No commit. No push. No deploy. Phase 6 not begun.
