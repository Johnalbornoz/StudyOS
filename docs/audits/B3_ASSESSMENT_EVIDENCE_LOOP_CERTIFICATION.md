# B3 — Assessment Execution & Evidence Loop — Certification

Date: 2026-10-10 · Worktree: `studyos-assessment-b3` · Branch: `feat/assessment-b3-evidence-loop`

## 0. Executive Result

```text
EVIDENCE_LOOP_PASS_WITH_CONDITIONS
```

The execution chain is implemented and tested end to end as an orchestration of existing authorities:
a B2 result is frozen on the existing record, attribution turns scored responses into controlled evidence,
and the evidence goes through `updateMastery` only. Nothing is cut over.

It is `WITH_CONDITIONS`, not a clean pass, for three reasons stated plainly:

1. **The canonical writer was not exercised against a real database.** No Postgres harness exists in the
   repository and none was running. The loop is proven against an injected writer that honours the same
   contract (one application per operation key), and the real writer's own guarantees — the unique index,
   the conflict handling, the Knowledge State recalculation and the memory / transfer projectors — are
   asserted at source level. Gate items 10, 12 and 13 rest on that combination.
2. **Attempt start is not wired.** B3 provides the frozen execution references and refuses responses outside
   them, but no route yet creates a session or instance from a snapshot. That wiring is the cutover.
3. **The migration is not applied anywhere.**

Certification gate:

| # | Gate item | Result | Basis |
|---|---|---|---|
| 1 | B2 selection frozen before execution | PASS | `freezeAssessment`; immutability test |
| 2 | Attempts execute exact snapshot content | PASS (boundary) | `executionRefs`; `NOT_IN_SNAPSHOT`; attempt start not wired — condition 2 |
| 3 | Scoring remains canonical | PASS | scores are inputs; B3 contains no grader |
| 4 | Attribution is server-controlled | PASS | no source / mode / activity / target on any loop input |
| 5 | PRIMARY / DIRECT evidence traceable | PASS | provenance on every event |
| 6 | SUPPORTING not over-credited | PASS | `NON_CONSEQUENTIAL`, no writer call |
| 7 | DERIVED creates no mastery evidence | PASS | `DERIVED_ONLY`, no writer call |
| 8 | TRANSITIONAL / UNRESOLVED never consequential | PASS | `UNRESOLVED_CONCEPT` |
| 9 | Independent evidence obeys EvidenceMode | PASS | B1 rule + hints; at most one concept per response |
| 10 | Exactly-once proven | PASS (contract level) | retry and concurrency tests; DB unique index asserted — condition 1 |
| 11 | Exam score independent of attribution | PASS | derived-item and partial-failure tests |
| 12 | Evidence only through `updateMastery` | PASS | source guard: one writer call, no evidence SQL |
| 13 | Knowledge State uses the existing projector | PASS (source level) | the writer recalculates it in its own transaction — condition 1 |
| 14 | Retention / transfer / verification intact | PASS | passed through; nothing recomputed |
| 15 | Exam / preparation scope preserved | PASS | `metadata.examScope`, `context`, `framework` |
| 16 | State not duplicated per curriculum | PASS | cross-curriculum test |
| 17 | TECHNICAL_DEMO produces no learner evidence | PASS | record audience wins over the snapshot |
| 18 | One canonical post-assessment result | PASS | `PostAssessmentState` |
| 19 | Historical attempts / evidence readable | PASS | nullable column; legacy records refused by B3, untouched |
| 20 | Regression / typecheck / build | PASS | 500 files / 8,918 tests; `tsc` clean; build exit 0 |

## A. Integrated Baseline

```text
B2_CERTIFIED_SHA              621b101
UNIVERSAL_DELTA_SHA           f2fac06
Q1_INCLUDED                   NO
POST_B2_ACTIVE_WORK_INCLUDED  NO
B3_START_SHA                  345652d3a4a6a8e70691b4313fdab4765619c7d0
REGRESSION                    PASS
```

| Step | Result |
|---|---|
| New worktree `studyos-assessment-b3` from `621b101` | HEAD = `621b101`, clean; `cbb6b39` and `621b101` are ancestors |
| Merge `f2fac06` | `345652d`; additive, no file under `src/lib/assessment-blueprint` changed |
| B2 report addendum | `dd06c59` (documentation only) |
| Regression on the base | 498 files / 8,877 tests (8,751 + 92 B2 + 34 B0-U), `tsc` clean, build exit 0 |
| `B0_UNIVERSAL_PASS_PRESERVED` / `B1_PASS_PRESERVED` / `B2_BLUEPRINT_CORE_PASS_PRESERVED` | yes / yes / yes |
| T1 (`remediation/t1-micro-delta` `41e9676`), read-only | 8 files since the merge base: labels, presentation, one report, two tests. No B3 authority. Not merged |
| Q1 (`58daefa` / `896987f`) | not merged, by decision |
| `studyos-assessment-b1` worktree and `feat/assessment-b2-blueprint-core` | not touched |

## B. Execution Architecture

```text
BlueprintSolution (B2)
   │  freezeAssessment            frozen-assessment.ts        pure
   ▼
FrozenAssessment ── persistAssessmentSnapshot ──► quiz_sessions.assessment_snapshot
   │                                              exam_instances.assessment_snapshot   (write-once)
   │  executionRefs: the only questions the attempt serves, in frozen order
   ▼
responses ── scored by the EXISTING graders ──► ScoredResponse[]
   │  planEvidence                 evidence-plan.ts            pure
   ▼
AttributionOutcome[] + EvidenceWrite[]
   │  completeAssessmentEvidence   assessment-execution.service.ts
   ▼
updateMastery  ──► learning_evidence ─► mastery ─► Knowledge State ─► memory / transfer projectors
   ▼
PostAssessmentState (+ exam gaps via the B1 boundary, + the Learning Decision authority's own decision)
```

| File | Role | IO |
|---|---|---|
| `frozen-assessment.ts` | snapshot contract, freeze, verify | none |
| `evidence-plan.ts` | attribution execution, writer inputs, intended vs observed | none |
| `post-assessment.ts` | result contract | none |
| `assessment-execution.service.ts` | snapshot store, loop, activity binding | one `UPDATE` (snapshot column), reads, `updateMastery` |

## C. Snapshot Persistence

**Where.** One nullable JSONB column, `assessment_snapshot`, on the two existing records:
`quiz_sessions` (LEARNING) and `exam_instances` (EXAM_PREPARATION / OFFICIAL_EXAM). No new table. For
official exams `exam_instances.form` remains the frozen form; the column adds the blueprint's audit context
beside it.

**Why a column.** `quiz_sessions` has no free JSON field: `questions` is the delivered array and
`canonical_activity_contract` is the authorised activity contract that B1 and resume queries read by key.
Putting a snapshot inside either would change what those mean.

**What is frozen.** Selected question references in order (and official slot); per question the coverage at
selection time, learning objectives, provenance, recorded difficulty / marks / duration / type (null when
not recorded), the blueprint's intended contribution and reasons; family, path, intent, policy id and
version, depth, activity (quiz mode, ActivityType, EvidenceMode, evidence source), curriculum references,
exam context, intended targets, blueprint status, unmet requirements, soft shortfalls, candidate-set digest,
learner-evidence digest and `asOf`, explicit `createdAt`. Not copied: question content, the curriculum, the
Student's state.

**Immutability.** `snapshotId` is a digest of the content; a stored snapshot that is malformed or edited is
refused (`DIGEST_MISMATCH`). The store writes only `WHERE assessment_snapshot IS NULL`: the same snapshot
twice is a no-op, a different one is `ALREADY_FROZEN_DIFFERENTLY`. Tests mutate, re-tag and reorder the bank
and change the Student's state after freezing: the existing assessment is byte-identical and attribution
reads only what it froze; a new assessment differs.

## D. Scoring Integration

B3 scores nothing. `ScoredResponse` carries what the existing graders decided: `fraction`, status
(`SCORED` / `UNANSWERED` / `PENDING_REVIEW`), hints recorded by the session, the response row. A transfer
session's evidence score is the existing transfer grader's verdict, supplied whole. A response awaiting
review is not evidence, as in the existing exam path.

## E. Evidence Attribution

| Coverage of the concept on the question | Outcome | Consequential | Independent |
|---|---|---|---|
| Single PRIMARY, Student has a CANONICAL instance | `ATTRIBUTED` | Yes | Only in an INDEPENDENT activity with no hint |
| SUPPORTING | `NON_CONSEQUENTIAL` | No | No |
| One of several PRIMARY | `NON_CONSEQUENTIAL` | No | No |
| UNSPECIFIED (objective mapping → DERIVED) | `DERIVED_ONLY` | No | No |
| TRANSITIONAL link | `UNRESOLVED_CONCEPT` | No | No |
| No learner instance / unresolved | `UNRESOLVED_CONCEPT` | No | No |

Other outcomes: `NOT_SCORED`, `NO_CANONICAL_CONCEPT`, `UNSUPPORTED_DIMENSION` (difficulty not recorded;
transfer verdict missing), `NOT_IN_SNAPSHOT`, `TECHNICAL_DEMO`.

**Supporting coverage — the documented choice.** The evidence model has one strength scale (source-type
weight, confidence weight, sample size) and no notion of "contextual" evidence. Rather than invent a
decimal weight, a supporting attribution is **metadata-only**: it is recorded in the provenance of the
evidence event its response did produce (`metadata.assessment.nonConsequential`) and in the result, and
makes no writer call.

**`contributes.strength`** from B2 is frozen as `items[].intended` and is used for nothing but reporting
intended coverage. It is never a multiplier (guarded by test).

**Event boundary.** The two existing ones, reused, never both:

| Family | Event | Operation key | Evidence fields |
|---|---|---|---|
| LEARNING | one per (session, concept), at completion | `QUIZ_SUBMISSION::<session id>::<learner concept>` | mean of the concept's fractions; ≥ 70 correct, ≥ 50 partial; `confidenceWeight 0.9`; `sampleSize`; mean recorded difficulty; source from the quiz-mode registry |
| Exam families | one per scored item response | `EXAM_SIMULATION_RESPONSE::<attempt id>.<frozen position>::<learner concept>` | `EXAM_SIMULATION`; full marks correct, some marks partial; `scorePercent`; item difficulty |

These are the expressions of the existing write sites; a test fails if either side drifts.

## F. Multi-Concept Semantics

Required case, Q1 → C1 PRIMARY + C2 SUPPORTING: scored once; one writer call, for C1; C2 is
`NON_CONSEQUENTIAL` with the same `responseRef`, listed on C1's evidence; a retry applies nothing; C2's
state is never touched although the Student has a C2 instance. Two PRIMARY concepts on one question: neither
is credited (the B1 rule: no single direct target).

## G. Independent Evidence

Independence requires all of: the session's EvidenceMode is INDEPENDENT (from the existing taxonomy, bound
at generation), no hint on the response, a single PRIMARY concept, a LEARNING independent dimension (B1).
A hinted response is still attributed, not independent. One response is independent proof of at most one
concept. The independence figure itself is computed by the existing state projection.

## H. Idempotency

The writer's own mechanism, unchanged: `learning_evidence.operation_key` with a unique index; the first
insert wins and a duplicate returns `duplicate: true` without touching evidence, mastery or state. B3 builds
the key from server-side identifiers only and adds no operation type. Tests: sequential retry (single and
multi-concept), two concurrent completions (six calls, three effects), a second attempt on the same concept
is a new action, and after a partial failure a retry completes only the missing concept.

Not proven here: the race on a real database (condition 1). No additional uniqueness constraint is needed —
the existing index covers it.

## I. Evidence Provenance / Exam Scope

Every event carries `metadata.assessment`: snapshot id, family, path, intent, policy, attempt reference,
curriculum references, canonical concept, attribution role, the source responses (item key, question
reference, store, provenance, frozen position, response row, independence) and the non-consequential
attributions of those responses. Exam-family events add the existing `metadata.examScope`
(`examEvidenceScopeMetadata`), `context.examAttemptId`, `framework.examVersionId`, and the exam target,
components, objectives and slot. The exam target is the attempt's own foreign key, resolved through
instance → simulation attempt → exam attempt; an attempt that is not the instance's is refused. No column
was added for scope.

## J. Mastery Integration

One call site, `deps.updateMastery`, defaulting to the canonical `updateMastery`. Its input is exactly what
the existing sites send, plus provenance. A writer failure for one concept is recorded as `WRITE_FAILED`,
does not stop other concepts and never alters a score.

## K. Knowledge State

Recalculated by `updateMastery` in its own transaction (`recalculateConceptKnowledgeState`). B3 reads
`mastery_state` before and after only to report `conceptStateChanges`; it has no formula and no threshold.

## L. Retention

A retention check reaches the writer with `metadata.activityType = 'RETENTION_CHECK'`; the memory projector
decides whether it qualified and B3 passes `retentionCheckQualified` through. Nothing about review dates or
spacing exists in B3.

## M. Transfer

A transfer session is written with the existing grader's `overallScore` / `passed`; without that verdict
nothing is written (`TRANSFER_GRADING_MISSING`). Transfer depth is the transfer projector's, inside the writer.

## N. Verification

Untouched. B3 changes no trigger and calls no verification service; `verificationState` is null in the
result. The loop's `deps` object is the additive point where a future independent verification could attach.

## O. Exam Preparation

A B2 preparation result freezes onto an exam instance (path `EXAM_PRACTICE`). Test: an objective-derived
item and an item with explicit item-level attribution, both scored. The explicit one produces one evidence
event with full exam scope; the derived one produces none. The score covers both. Gaps are read for that
exam target and returned as `ExamGapCandidate[]`; nothing is placed or ranked.

## P. Official Exam

The exam instance stays the frozen form; an incomplete official form cannot be frozen; a generated question
cannot be in one. Required derived-item case: three items scored 4 of 6 marks; five attributions, all
`DERIVED_ONLY`; no writer call although the Student has every instance. The score is valid without any
learning attribution.

**A divergence to decide before cutover.** The current runtime (`simulation/scoring.service.ts`) writes exam
evidence to the first resolvable concept of the item's objective — that is derived coverage. B3 follows the
frozen rule and writes none. Adopting B3 for exams therefore reduces the evidence exams produce until
item-level attribution exists. The two paths also use different operation ids, so they must never both run
for the same attempt.

## Q. Cross-Curriculum Continuity

The same concept assessed under two curricula writes to one learner concept; the second attempt starts from
the state the first left; each event keeps its own curriculum reference; the operation key and state key
contain no curriculum. No crosswalk table exists and the deferred institution link was not added (guarded).

## R. PostAssessmentState

`assessment` (snapshot, family, path, intent, record, policy) · `attemptRef` · `studentId` · `score` ·
`coverage` (intended; selected / answered / scored / consequential) · `attributionOutcomes` · `evidence`
(per concept: status, operation key, mastery before / after, event id, retention verdict, error) ·
`conceptStateChanges` · `unresolvedAttributions` · `examGaps` · `verificationState` · `nextDecision`
(`AVAILABLE` / `NONE` / `NOT_REQUESTED` / `UNAVAILABLE`) · `learnerEvidence` · `diagnostics` (counts and
identifiers only).

`consequential` coverage reflects what the writer applied, not what was planned. The next decision is the
Learning Decision authority's own answer, opaque to B3; `canonicalNextDecision` reads the existing Learning
OS snapshot. A failing decision read does not fail the assessment.

## S. Regression / Historical Compatibility

No existing source file was changed. Existing records have `assessment_snapshot = NULL`; B3 refuses them
(`NO_SNAPSHOT`) and the B1 projections still describe them. The runtime's two write sites are unchanged.
Four chain-guard tests were updated to accept the appended migration, and the B2 "no importer" guard now
allows the B3 module as the single consumer; each still asserts its original property.

## T. Tests

| Check | Result |
|---|---|
| `tests/unit/b3-evidence-loop.test.ts` | 27 |
| `tests/unit/b3-architecture.test.ts` | 14 |
| Full suite | 500 files / 8,918 tests, 0 failed |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx next build` | exit 0 |

Migration: `database/migrations/20261110_1000_assessment_snapshot.sql` — created, not applied, not executed
against any database (reviewed by reading only). Chain = 72 files.

## U. B4 Readiness

```text
B4_GO_WITH_CONDITIONS
```

B4 can render `PostAssessmentState` as it is. Conditions:

1. Validate the loop through the real `updateMastery` on an isolated Postgres before any runtime adoption.
2. Apply `20261108_1000`, `20261109_1000`, `20261110_1000` in that order before any code that writes them.
3. Wire attempt start to the snapshot (create the session / instance from `executionRefs`) as a separate, flagged cutover; do not run the legacy exam evidence path and B3 on the same attempt.
4. Decide the exam-evidence divergence in section P.
5. Confirm the hosted value of `CANONICAL_ENGINE_V1_ENABLED` before activation.

Data gaps: no item-level concept attribution (exam items yield no consequential evidence today); no skill or
competency attribution is produced by B3 (skill state still derives only from evidence explicitly tagged by
existing writers); no recorded durations; learner concepts without a CANONICAL link receive nothing.
