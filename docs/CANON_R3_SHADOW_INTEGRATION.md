# CANON-R3 — PEDAGOGICAL ENGINE SHADOW INTEGRATION

## STATUS

**CODE_PASS** (not "LIVE PASS" or "LIVE_PENDING" as anything more definitive
— this environment has no live browser, database, auth, or AI-provider
access, confirmed absent again this phase: no `.env`/`.env.local`, no
`DATABASE_URL`, no `.vercel` project link). The evidence adapter, old/new
canonical snapshot readers, comparator, safe shadow record, and a
Preview-execution CLI are built, fully unit-tested against synthetic
fixtures grounded in the REAL schema/write-path this session directly
inspected, and type/build clean. **No live Preview comparison — including
the mandatory Radicación case — was executed**, because no DB connection
exists in this session. Section "COMMANDS FOR PREVIEW" gives the exact,
ready-to-run commands for a future Preview-connected session.

Verification:
- `npx tsc --noEmit` — clean.
- `npx vitest run tests/unit/canon-r2-pedagogical-engine.test.ts
  tests/unit/canon-r2r1-engine-contract-closure.test.ts
  tests/unit/canon-r3-shadow-integration.test.ts` — **183 tests, all
  passing** (83 + 53 + 47).
- `npx vitest run` (full suite) — **237 test files, 4162 tests, all
  passing** (was 236 files / 4115 tests before this phase — +1 file, +47
  tests, zero regressions).
- `npm run build` — clean.

## SCOPE

New files only, all outside the frozen pure engine:

```
?? scripts/canon-r3-shadow-compare.ts
?? src/lib/pedagogical-shadow/            (evidence-adapter.ts, fingerprint.ts,
                                            old-canonical-snapshot.ts,
                                            new-canonical-snapshot.ts,
                                            comparator.ts, shadow-record.ts,
                                            types.ts, index.ts)
?? tests/unit/canon-r3-shadow-integration.test.ts
```

`git diff --stat -- src/lib/pedagogical-engine/` for this phase: **empty**
— the frozen engine is byte-for-byte untouched.

## BEHAVIOR FIREWALL

No React component, Next.js route, API, DB schema, AI generation code,
Luna/Terra routing, `reasoning_effort`, prompt construction,
`promptCacheKey`, caching, Quality Gate, semantic verification, provider
fallback, performance logic, or Production data was touched. The new engine
has zero authority: it is never called from any learner-facing code path in
this phase, it changes no state, and its output is read by the comparator
and the CLI script only — both of which print to stdout and write nothing.

## EVIDENCE SOURCES

Audited directly against the real schema (`database/baseline/STUDYUS_BASELINE_2026_08.sql`)
and the one real write path (`src/services/mastery.service.ts`,
`src/app/api/quizzes/generate-and-take/route.ts`):

- **`learning_evidence`** — the real columns are `id, student_id,
  concept_id, source_type, result, difficulty, timestamp, subject_id,
  activity_type, learning_mode, hints_used, ai_assistance_type,
  confidence_before_answer, metadata (jsonb), score_percent`. **There is
  no item-count/question-count/sample-size column.** One row is written
  per (studentId, conceptId, quizId) *bucket* — i.e. per concept per quiz
  submission, not per individual question.
- **`learning_evidence.activity_type`** (the column) is **always the
  literal `'quiz'`** at the one real write site — it is NOT the canonical
  `ActivityType`. The real canonical `ActivityType` lives in
  **`learning_evidence.metadata->>'activityType'`**, copied verbatim from
  `quiz_sessions.activity_type` at generation time. This distinction is
  easy to miss and is the single most important grounding fact this audit
  found.
- **`quiz_sessions`** — carries `quiz_mode` (topic_practice, quick_check,
  review, retention_check, cumulative_assessment, exam_simulation,
  diagnostic_check — the real, complete enum, confirmed against
  `QUIZ_MODE_CONFIG` in `generate-and-take/route.ts`), `activity_type`,
  `evidence_mode`, `hints_used_questions`.
- **Item count**: the real per-bucket question count (`bucket.total`) is
  used only to weight the mastery-score algorithm
  (`src/lib/algorithms/mastery.ts`'s `sampleSizeFactor`) and is persisted
  **only** inside `decision_events.reason_details.sampleSize` (a separate
  audit table, joined via `source_event_type='learning_evidence',
  source_event_id=<row id>, decision_type='MASTERY_UPDATED'`) — never on
  `learning_evidence` itself.
- **Misconceptions**: `getMisconceptionCountsForConcept(studentId,
  conceptId)` (`src/services/misconception.service.ts`) returns a live
  `criticalCount` — the correct, already-existing, real authority for
  "is a critical misconception currently active," used verbatim rather
  than reimplemented.
- **Transfer**: `concept_transfer_state` (aggregate success counts per
  distance) and `transfer_task_instances` (one row per INDIVIDUAL
  transfer task) — confirmed real transfer distances are **NEAR / MID /
  FAR**, not the new engine's NEAR/CONTEXTUAL/HIGHER, and Transfer
  evidence is recorded **one task at a time**, never as a batch of 3
  challenges. Both facts are load-bearing for the TRANSFER DIAGNOSTIC
  MAPPING and MAPPING TABLE sections below.
- **Response contract** (SHOW_WORK/EXPLAIN/JUSTIFY) and per-item
  independence/hint data below the bucket level: no dedicated column
  found in this audit; only bucket-level `hints_used`/`ai_assistance_type`
  is real and used.

## EVIDENCE ADAPTER

`mapStudyUSEvidenceToPedagogicalEvidence(rows: StudyUSEvidenceRow[]):
EvidenceAdapterResult` (`src/lib/pedagogical-shadow/evidence-adapter.ts`)
is the ONE adapter. Pure — no DB, no fetch; callers supply already-fetched,
typed rows. For each row it either produces exactly one `RawEvidenceItem`
or records one or more `AdapterUnresolvedMapping` entries (never both
silently) and returns:
`{items, unresolved, warnings, confidence, rowsConsidered,
evidenceSnapshotFingerprint}`.

## MAPPING TABLE

| StudyUS `ActivityType` / `quiz_mode` | → PedagogicalActivityType | Grounding |
|---|---|---|
| `PRACTICE` / `REVIEW` / `REMEDIATION`, or `topic_practice` / `review` | `PRACTICE` | direct, unambiguous |
| `SOLO_CHECK` / `SOLO_VERIFY`, or `quick_check` | `PROVE` | closest real analog to an independent demonstration — does **not** pre-judge whether the attempt qualifies (`quick_check` is 6 questions, not 10 — the engine's own item-count check decides that, honestly, as `UNRESOLVED_POLICY`) |
| `RETENTION_CHECK`, or `retention_check` | `RETENTION_CHECK` | direct — same 6-vs-10 caveat applies |
| `TRANSFER` | `TRANSFER` | challenge breakdown separately handled (see below) |
| `DIAGNOSTIC_CHECK` / `CUMULATIVE_ASSESSMENT` / `MOCK_EXAM`, or `diagnostic_check` / `cumulative_assessment` / `exam_simulation` | **`UNSUPPORTED_ACTIVITY_TYPE`** | legitimate real evidence purposes with no v1-engine equivalent — never forced into the nearest stage |
| `LEARN_CHECK` | `LEARN_CHECK` | forward-compatible hook only — no real source produces this value today |
| anything else / neither field resolvable | **`UNKNOWN_SOURCE`** | never guessed |

## LEARN_CHECK AVAILABILITY

**StudyUS has no existing quiz_mode or ActivityType representing an
initial comprehension checkpoint.** This is a directly-audited fact (the
complete real `quiz_mode` enum is topic_practice, quick_check, review,
retention_check, cumulative_assessment, exam_simulation, diagnostic_check
— none of these represent "just learned it, prove basic understanding").
Every evidence set the adapter processes therefore carries a
`LEARN_CHECK_SOURCE_UNAVAILABLE` finding (`evidenceId: null` — a
concept-level, not row-level, gap) unless a caller supplies an explicit
`activityType: 'LEARN_CHECK'` row (the forward-compatible hook, never
triggered by real data today). **This means every real concept in
StudyUS today will show `stage: LEARN` under the frozen v1 engine**,
regardless of how much real Practice/Prove/Retention/Transfer evidence
exists — this is the single largest, most consequential finding of this
phase, and it is a genuine, structural gap in the real data, not an
adapter bug.

## INDEPENDENCE MAPPING

`independent = (aiAssistanceType === 'NONE') && (hintsUsed === 0)`
(`resolveIndependent`). Conservative by construction: any assistance type
other than the literal `'NONE'`, OR a missing/`undefined` assistance
field, OR any nonzero hint count, marks the attempt as NOT independent.
Tested directly (Tests 2, 3, 15 of the CANON-R3 suite) — missing data
never defaults to independent.

## DIFFICULTY MAPPING

Passed through verbatim (`item.difficulty = row.difficulty`) — never
recomputed, never re-derived from the new policy. The real column already
holds the actually-administered (aggregate-mean, for a multi-question
bucket) difficulty; the new engine's own `DifficultyPolicy` consumes it
as-is to decide the NEXT target, exactly as CANON-R2R1 designed it to.

## MISCONCEPTION MAPPING

Two genuinely separate facts, never conflated:
- `RawEvidenceItem.hasCriticalMisconception` — a per-attempt historical
  fact (`StudyUSEvidenceRow.hasItemCriticalMisconception`), supplied by a
  caller who has already joined the misconception occurrence records for
  that specific attempt. `undefined` (defaults `false`) otherwise — never
  inferred from `result` alone.
- `activeCriticalMisconception` (on the engine's OWN input, not the
  adapter's output at all) — a CURRENT, live fact. The correct real
  authority is `getMisconceptionCountsForConcept(studentId,
  conceptId).criticalCount > 0` (`src/services/misconception.service.ts`,
  called verbatim in `scripts/canon-r3-shadow-compare.ts`) — a historical
  misconception that has since been resolved does NOT keep this true
  forever, since `getMisconceptionCountsForConcept`'s own "active"
  definition already excludes resolved occurrences (confirmed by reading
  that service). Test 16 of the CANON-R3 suite confirms the adapter's
  output type has no `activeCriticalMisconception` field at all — it is
  structurally impossible for this module to fabricate one.

## TRANSFER DIAGNOSTIC MAPPING

`transferFoundationalFailureIndicated` is **never** set by this adapter
from `perChallengeScores`/`scorePercent` — it is only ever a caller-
supplied, independently-sourced field
(`StudyUSEvidenceRow.transferFoundationalFailureIndicated`). StudyUS has
no such diagnostic signal today (no field in `concept_transfer_state` or
`transfer_task_instances` reliably means "foundational/procedural
competence failed," as opposed to "this specific application context was
hard"). Every Transfer-purpose row without this field explicitly supplied
produces a warning (not an unresolved mapping — it does not block the row
from being mapped, since Case A, the conservative default per
CANON-R2R1, remains a valid outcome) rather than silent inference.

## OLD CANONICAL SNAPSHOT

`buildOldCanonicalSnapshot` (`src/lib/pedagogical-shadow/old-canonical-snapshot.ts`)
is a PURE composition function that calls, verbatim, four already-existing
canonical authorities: `getConceptKnowledgeState` / `getActiveMasteryPolicy`
(`knowledge-state.service.ts`), `resolveConceptJourneyResult`
(`path-view.ts`), and `buildCanonicalLearningProgress`
(`canonical-learning-progress.ts`) — the SAME functions My Path / Concept
Mission / Today already call. It reimplements none of their logic (Test
18). A thin IO wrapper, `fetchOldCanonicalSnapshot`, performs the only two
real DB reads (both pre-existing SELECT-only functions) — read-only by
construction (Test 20; no INSERT/UPDATE/DELETE anywhere in the file).

One honest limitation: `nextAction` requires a full Phase 4
`LearningDecision`, which requires running the entire adaptive-learning
orchestrator (scheduler, remediation, misconception, calibration services,
etc.) — a much larger IO surface than a read-only comparison tool needs.
Rather than reproducing that orchestration (which would be exactly the
"reimplementing instead of calling" this module must never do),
`fetchOldCanonicalSnapshot` accepts an OPTIONAL pre-fetched
`LearningDecision` and reports `nextAction: null` (honestly UNAVAILABLE,
Test 19) when none is supplied — a real, documented gap, not an
approximation.

## NEW CANONICAL SNAPSHOT

`buildNewCanonicalSnapshot` (`src/lib/pedagogical-shadow/new-canonical-snapshot.ts`)
calls the frozen `evaluateCanonicalLearningState` unmodified and normalizes
its output into `{stage, actionState, nextCanonicalAction, progressPercent,
policyVersion, canonicalRevision}`. No engine behavior is touched.

## COMPARATOR

`compareCanonicalDecisions(oldSnapshot, newDecision, adapterMetadata)`
(`src/lib/pedagogical-shadow/comparator.ts`) is pure and deterministic
(Test 27). It first normalizes stage vocabularies via one documented
equivalence table (`OLD_TO_NEW_STAGE_EQUIVALENT`: the old model's
`NOT_STARTED`/`READY_TO_PROVE` — states with no v1-engine counterpart —
fold into `LEARN`/`PROVE` respectively), then classifies:
1. `oldSnapshot.stage == null` → `UNRESOLVED` (nothing to compare).
2. Equivalent stages, roughly-agreeing executability → `MATCH`.
3. Equivalent stages, differing executability (e.g. same RETAIN, old
   EXECUTABLE vs. new WAITING) → `EXPECTED_POLICY_DIFFERENCE`
   (`ACTION_STATE_DIFFERS_SAME_STAGE`) — the frozen engine's stricter
   gating is EXPECTED to produce this.
4. A LEARN-only new stage with `LEARN_CHECK_SOURCE_UNAVAILABLE` present →
   `ADAPTER_DATA_GAP` (`NEW_LEARN_BLOCKED_BECAUSE_LEARN_CHECK_NOT_AVAILABLE`)
   — never blamed on the new engine.
5. An `ITEM_COUNT_NOT_AVAILABLE` gap → `EXPECTED_POLICY_DIFFERENCE`
   (`HISTORICAL_ITEM_COUNT_DOES_NOT_MEET_NEW_POLICY`).
6. A `TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE` gap touching Transfer →
   `ADAPTER_DATA_GAP` (`TRANSFER_BREAKDOWN_UNAVAILABLE`).
7. old=RETAIN/new=PRACTICE → `OLD_MODEL_INCONSISTENCY`
   (`OLD_RETAIN_NEW_PRACTICE_BECAUSE_NO_QUALIFIED_PROVE`).
8. old=TRANSFER/new=RETAIN → `OLD_MODEL_INCONSISTENCY`
   (`OLD_TRANSFER_NEW_RETAIN_BECAUSE_RETENTION_UNSATISFIED`).
9. LOW adapter confidence with no other explanation → `UNRESOLVED` — never
   `NEW_MODEL_POSSIBLE_DEFECT` on shaky data (Test 26).
10. HIGH confidence, no known gap or policy reason → `NEW_MODEL_POSSIBLE_DEFECT`
    (flagged for future investigation outside this phase, per Part 37 —
    never fixed here).

Every outcome carries at least one `DisagreementReasonCode` — never a bare
`"MISMATCH"` (Part 21's own instruction, verified directly: every test
asserts on a specific `reasonCodes` entry).

## ADAPTER CONFIDENCE

`HIGH` — no unresolved mappings at all. `MEDIUM` — only
`ITEM_COUNT_NOT_AVAILABLE` / `UNSUPPORTED_ACTIVITY_TYPE` /
`TRANSFER_DEPTH_TAXONOMY_MISMATCH` present. `LOW` — `LEARN_CHECK_SOURCE_UNAVAILABLE`
or `TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE` present (given the LEARN_CHECK
finding above, **every real concept's confidence will be LOW today** — an
expected, honest consequence of the real data gap, not a bug in the
confidence classifier). Confidence is never used by the comparator to
declare the new engine correct or incorrect — only to route disagreements
toward `ADAPTER_DATA_GAP`/`UNRESOLVED` instead of `NEW_MODEL_POSSIBLE_DEFECT`
when the underlying data itself is suspect (Test 26).

## SAFE TELEMETRY

No runtime logging was added in this phase (the CLI prints structured
JSON to stdout for a human operator; nothing is wired into any logging
pipeline). Had it been, the schema conceptually described in the spec
(`pedagogical_shadow_comparison {conceptId, policyVersion, oldStage,
newStage, oldAction, newAction, comparisonResult, reasonCodes,
adapterConfidence, evidenceCountsByType}`) already matches
`ShadowComparisonRecord`'s own shape field-for-field.

## READ-ONLY GUARANTEE

Verified by source audit (Tests 28–33 of the CANON-R3 suite) across
every file in `src/lib/pedagogical-shadow/` and the CLI script: no
`INSERT`/`UPDATE`/`DELETE` SQL keyword, no AI/provider import, no
generation-service import, no Quality Gate import, no React import, no
`@/app/*` import. The CLI's only writes are `console.log` calls.

## RADICACIÓN PLAN / RESULT

**Not executed — no live Preview/DB access in this environment.** The
exact plan, ready to run once access exists:

```bash
npx tsx --env-file=.env.local scripts/canon-r3-shadow-compare.ts \
  --student <the reported student's uuid> \
  --concept <Radicación de números enteros's concept uuid>
```

Based on this session's real-schema audit, the EXPECTED shape of that
result (a prediction, not a live finding, clearly labeled as such): the
adapter will report `LEARN_CHECK_SOURCE_UNAVAILABLE` (as it will for
every concept), `confidence: LOW`; the previously-reported evidence
(`TRANSFER 0%, PRACTICE 0%, PRACTICE 0%, PRACTICE 33%`) will very likely
map its Transfer row with `TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE`
(single aggregate score, no 3-challenge breakdown in real data) and its
Practice rows will map cleanly (score/difficulty are reliably present);
the new engine's `stage` will almost certainly resolve to `LEARN` (per the
LEARN_CHECK finding above) while the old model's own stage for this
concept is whatever it currently reports live — a comparison the
comparator will classify `ADAPTER_DATA_GAP` (`NEW_LEARN_BLOCKED_BECAUSE_LEARN_CHECK_NOT_AVAILABLE`)
rather than a defect in either model. **This prediction must be verified,
not assumed, once Preview access exists** — this report does not claim it
as a result.

## SAMPLE COMPARISON PLAN / RESULT

**Not executed**, same reason. Plan:

```bash
npx tsx --env-file=.env.local scripts/canon-r3-shadow-compare.ts --sample 25
```

This draws 25 random real `(student, concept)` pairs with at least one
`learning_evidence` row and runs the full pipeline against each,
read-only. Given the LEARN_CHECK finding, the sample is expected to be
dominated by `ADAPTER_DATA_GAP` results rather than a rich spread across
LEARN/PRACTICE/PROVE/RETAIN/TRANSFER/CONSOLIDATED states — this is itself
an important, honest finding to confirm live, not a flaw in the sampling
plan. No fabricated sample data is presented in place of a real run.

## DISAGREEMENT CATEGORIES

The six `ComparisonResult` values (`MATCH`, `EXPECTED_POLICY_DIFFERENCE`,
`ADAPTER_DATA_GAP`, `OLD_MODEL_INCONSISTENCY`, `NEW_MODEL_POSSIBLE_DEFECT`,
`UNRESOLVED`) and the nine `DisagreementReasonCode` values are defined in
`src/lib/pedagogical-shadow/types.ts` and exercised directly by Tests
21–27 (Part 40) — see COMPARATOR above for the exact routing rules.

## PERFORMANCE FIREWALL

The shadow layer is never imported by any route, service, or component in
this phase — it is reachable only via the standalone CLI script, run
out-of-band. Zero learner-critical-path impact by construction (there is
no code path from a learner request into this module at all).

## ENGINE FREEZE VERIFICATION

`git diff --stat -- src/lib/pedagogical-engine/` for this phase: **empty**.
Tests 37–44 (Part 42) additionally re-verify, by reading the live,
unmodified `CANONICAL_POLICY` object and running the live engine, that
every CANON-R2R1 threshold is unchanged: LEARN >80 (exclusive), Practice
≥80/[2,4], Prove exactly-10/≥80/[3,4], Retention exactly-10/≥80/3-day-wait/[3,4],
Transfer exactly-3/≥80-overall/≥70-per-challenge/[4,5], the difficulty
policy's reason-code vocabulary, and the complete output contract's field
list.

## TESTS

`tests/unit/canon-r3-shadow-integration.test.ts` — **47 tests**: Evidence
Adapter (Part 38, 17 tests + 2 supplementary score-normalization variants),
Old Snapshot (Part 39, 3 tests), Comparator (Part 40, 7 tests), Safety
(Part 41, 9 tests), Engine Frozen (Part 42, 8 tests), plus 1 end-to-end
pipeline test exercising adapter → new engine → old snapshot → comparator
→ safe record together.

## FULL REGRESSION

`npx vitest run` (whole repository): **237 test files, 4162 tests, 0
failures** — up from 236/4115 before this phase (net +1 file, +47 tests).
`npx tsc --noEmit` and `npm run build` both clean.

## FILES CHANGED

```
?? scripts/canon-r3-shadow-compare.ts
?? src/lib/pedagogical-shadow/comparator.ts
?? src/lib/pedagogical-shadow/evidence-adapter.ts
?? src/lib/pedagogical-shadow/fingerprint.ts
?? src/lib/pedagogical-shadow/index.ts
?? src/lib/pedagogical-shadow/new-canonical-snapshot.ts
?? src/lib/pedagogical-shadow/old-canonical-snapshot.ts
?? src/lib/pedagogical-shadow/shadow-record.ts
?? src/lib/pedagogical-shadow/types.ts
?? tests/unit/canon-r3-shadow-integration.test.ts
?? docs/CANON_R3_SHADOW_INTEGRATION.md
```

`src/lib/pedagogical-engine/**` — untouched (confirmed above).

## COMMANDS FOR PREVIEW

Once a future session has real Preview DB access (`.env.local` with a
valid `DATABASE_URL`):

```bash
# Radicación — the mandatory first case
npx tsx --env-file=.env.local scripts/canon-r3-shadow-compare.ts \
  --student <student-uuid> --concept <radicacion-concept-uuid>

# All concepts for one student
npx tsx --env-file=.env.local scripts/canon-r3-shadow-compare.ts \
  --student <student-uuid> --all-concepts

# A representative random sample
npx tsx --env-file=.env.local scripts/canon-r3-shadow-compare.ts --sample 25
```

Every invocation is read-only and dry-run by construction — there is no
`--write` flag to accidentally pass.

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `feat(canon-r3): pedagogical engine shadow integration` — the new
   `src/lib/pedagogical-shadow/` module, the CLI script, and the test
   file.
2. `docs(canon-r3): shadow integration report` — this document.

No file inside `src/lib/pedagogical-engine/` is touched by either commit.
