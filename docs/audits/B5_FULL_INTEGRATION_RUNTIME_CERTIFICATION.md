# B5 — Full Integration & Runtime Certification

Date: 2026-10-10 · Worktree: `studyos-assessment-b5` · Branch: `integration/assessment-b5-runtime-certification`

> **B5-G update (2026-10-11).** Sections **AZ–BI** at the end record the Stage runtime certification. It is
> **in progress**: Stage code and schema are aligned; everything after that waits for one operator action.
>
> **B5-F update (2026-10-10).** Sections **AR–AY** at the end record the pre-Stage cleanup, the final DEV SHA and the
> Stage promotion as far as it went, and supersede AQ.
>
> **B5-E update (2026-10-10).** Sections **AM–AQ** at the end record the hydrated browser gate, the question-supply
> investigation and the Stage entry decision, and supersede AL.
>
> **B5-D update (2026-10-10).** Sections **AE–AL** at the end record the DEV deployment and the hosted end-to-end
> run, and supersede AB, AC and AD.
>
> **B5-R update (2026-10-10).** Sections 0 and A–V record B5 as it ended. Sections **W–AD** at the end record
> the DEV runtime closure and supersede D, O, P, Q, S and V where they differ. The snapshot migration was
> renamed `20261110_1800_assessment_snapshot` (the sibling line took `20261110_1000`–`1700`) and is applied to DEV.

## 0. Executive Result

```text
FULL_INTEGRATION_PASS_WITH_CONDITIONS
```

Read the conditions before the label. Two halves of B5 ended very differently.

**Done and proven**

- All committed lines are reconciled on one branch with no duplicated authority; 503 test files / 9,006
  tests, typecheck and build are green.
- The B3 evidence loop ran through the **real `updateMastery` on a real Postgres 18.6** built from the
  schema baseline plus all 72 migrations: 59 of 59 checks, including exactly-once under concurrency enforced
  by the unique index.
- One start authority (new vs resume) and a per-attempt execution-authority guard exist; the two legacy
  evidence paths now stand down for a canonical attempt.

**Not done — the runtime-certification half**

| Step | State | Why |
|---|---|---|
| Apply `20261110_1000` to hosted DEV | NOT APPLIED | the write was denied by the session's permission system; I did not work around it |
| Canonical runtime on DEV | NOT ADOPTED | follows from the above; the start flag is OFF everywhere |
| Routes wired to the start authority and the canonical completion | NOT WIRED | the service boundary exists; no route calls it |
| B4 setup / result mounted on delivered routes | NOT MOUNTED | depends on the wiring |
| Browser E2E on DEV, signed in | NOT RUN | I do not enter credentials; no session was available |
| Automated accessibility scan | NOT RUN | no tooling in the project |
| Hosted flag values | NOT READ | no access to the hosting configuration from this session |
| Stage | NOT TOUCHED | DEV is not certified; no deploy tooling or authorisation here |

So: integration and the evidence loop are certified; **DEV is not certified and nothing is ready for release.**

Pass criteria (section 62 of the brief):

| # | Criterion | Result |
|---|---|---|
| 1 | B4 closed | PASS (`1211fd3`) |
| 2 | Sibling branches reconciled, no duplicate authority | PASS |
| 3 | All three migrations applied to DEV | **FAIL** — two applied (by someone else, before this session), one pending |
| 4 | Migrations execute on real Postgres | PASS (local 18.6, all 72 through the governed runner) |
| 5 | B3 through real `updateMastery` | PASS (local Postgres) |
| 6 | Exactly-once at DB level | PASS |
| 7 | Snapshot start / resume | PASS at service level on real Postgres; not on a delivered route |
| 8 | B2 the only canonical selector | PASS |
| 9 | B3 the only evidence path for canonical attempts | PASS |
| 10 | Legacy exam shortcut cannot double-run | PASS |
| 11 | Score without learning attribution | PASS |
| 12 | Learning E2E | PARTIAL — service level on real Postgres, not through the app |
| 13 | Exam Preparation E2E | PARTIAL — same |
| 14 | Assessment-type semantics | PASS |
| 15 | B4 result and continuation | PARTIAL — continuation delivered; result view fed by real B3 output in the script, not mounted |
| 16 | Q1 uses B2 readiness semantics | PASS |
| 17 | Browser validation | **NOT RUN** |
| 18 | Accessibility checks | **NOT RUN** (B4 manual checks stand) |
| 19 | Typecheck / build / tests | PASS |
| 20 | DEV certified | **NO** |
| 21 | Stage certified or one external blocker | blocked by DEV |
| 22 | Production unchanged | PASS |

## A. Certified Baselines

| Line | SHA | Status | Certification |
|---|---|---|---|
| B0 / B1 | `cbb6b39` (ancestor) | committed | `ARCHITECTURE_READY`, `FOUNDATION_PASS` |
| B2 certified snapshot | `621b101` (ancestor) | committed | `BLUEPRINT_CORE_PASS` |
| B0 Universal Curriculum Delta | `f2fac06` (ancestor) | committed | `B0_UNIVERSAL_CURRICULUM_DELTA_PASS` |
| B3 | `b8e58e9` (ancestor) | committed | `EVIDENCE_LOOP_PASS_WITH_CONDITIONS` |
| B4 | `1211fd3` | committed | `UNIFIED_EXPERIENCE_PASS_WITH_CONDITIONS` |
| T1 | `41e9676` (already in B4) | committed, frozen | T1 FINAL PASS |
| Q1 | `58daefa` | committed, worktree clean | Q1 F-DATA + B2 alignment docs |
| Post-B2 "B2-A" | `5c69222` (includes `c04d97a`) | committed; its worktree has 23 uncommitted changes | self-certified addendum in the B2 report |

## B. Branch Reconciliation

Order: B4 → Q1 → B2-A (T1 was already in B4).

| Merge | Files | Authority impact | Decision |
|---|---|---|---|
| Q1 `58daefa` → `984cd83` | 18: catalogue data, audits, one operations script, three source files (dev catalogue, objective links, concept labels) | none: no selector, no readiness algorithm, no state writer | INCLUDED |
| B2-A `5c69222` → `325dfcd` | 13: `assessment-blueprint/protected/*`, one read added to the B2 service, index exports, one test file, two documents | see below | INCLUDED |

B2-A classification:

| Addition | Class | Note |
|---|---|---|
| `blueprint-identity`, `authority`, `pools`, `exposure-policy`, `selection-unit`, `diagnostic` | EXTENDS_B2 | pure contracts and hard filters applied before the one shared solver |
| `protected-selection` | EXTENDS_B2 | calls the existing `solveOfficialBlueprint`; no solver of its own |
| `frozen-form` | EXTENDS_B2, **overlap flagged** | a fixed form shared by every Student; a different thing from B3's per-attempt `FrozenAssessment`, but both "freeze" and both sit next to `exam_instances.form`. They must be reconciled before either is persisted |
| `loadReviewedBankExposure` in the B2 service | EXTENDS_B2 | read-only |

One documentation conflict (both sides appended to the B2 report) was resolved by keeping both. Only the
committed state of the B2 branch was merged; that worktree's uncommitted changes were not read or touched.

Code-only regression before any database work: 502 files / 8,988 tests, `tsc` clean, build exit 0.

## C. Final Authority Map

| Decision | Final authority |
|---|---|
| Curriculum identity | Curriculum (`CurriculumScope`, framework profiles) |
| Canonical concept | Catalogue / explicit canonical link |
| Learner state | `updateMastery` → Knowledge State and its projectors |
| Question availability | Question Bank behind `QuestionCoverage` / `QuestionEligibility` |
| Assessment policy | B2 policy families |
| Question selection | B2 solver (the only `solveBlueprint`) |
| Official fidelity | Exam Core (`classifyExamFormFidelity`, `deriveInstanceAttemptType`) |
| Frozen assessment | `assessment_snapshot` on the session / instance; `exam_instances.form` for the official form |
| New vs resume | `startLearningAssessment` |
| Which engine executes an attempt | the attempt's own record (`executionAuthorityOf*`) |
| Scoring | existing graders / Exam Core |
| Evidence attribution | B3 |
| Mastery write | `updateMastery` |
| Next learning decision | Learning Decision |
| Rendering | B4 |
| Q1 readiness | B2 feasibility projection |

## D. Migration Application

Target verified before any write attempt: fingerprint `2a29b99ee14a22b4` = DEV (not Production `6671e7382d808d06`).

| Migration | Hosted DEV | Stage | Local Postgres 18.6 |
|---|---|---|---|
| `20261108_1000_simulation_type_exam_practice` | applied 2026-10-10 23:44 UTC — not by this session | not applied | applied |
| `20261109_1000_simulation_type_challenge_reduced_mock` | applied 2026-10-10 23:44 UTC — not by this session | not applied | applied |
| `20261110_1000_assessment_snapshot` | **PENDING** (dry-run listed exactly this one; the apply was denied) | not applied | applied |

DEV ledger: 72 applied, 1 pending, 0 drifted. The DEV schema has no `assessment_snapshot` column.

Validation on the local database: both simulation CHECKs list the seven types; `EXAM_PRACTICE`,
`EXAM_CHALLENGE`, `REDUCED_MOCK`, `FULL_MOCK` inserts succeed and an unknown type is rejected (23514); both
snapshot columns exist, are nullable JSONB, accept a valid snapshot and reject a malformed one (23514);
rows without a snapshot read as before. `teacher_interventions` was not changed by these migrations (its
own, older `EXAM_PRACTICE` intervention type is a separate vocabulary).

## E. Snapshot Runtime

`startLearningAssessment` (`assessment-start.service.ts`):

- **resume** — an active, unexpired canonical session of the same Student with the same intent, depth and
  targets is returned as it is; no selection runs;
- **new** — one Blueprint Core call → freeze → one INSERT that creates the session with its questions (the
  frozen ids' content, in frozen order, each carrying its snapshot item key) and its snapshot, plus the
  existing delivery ledger, in one transaction.

On real Postgres: OFF without the flag (no query, no selection); new start makes exactly one selection;
the stored questions equal the snapshot items in order; resume returns the same session and snapshot with
no second selection and no second row; a completed session is not resumed; the started attempt completes
through the loop from its own stored snapshot.

Not built: the exam-instance start from a snapshot, and any route that calls the start authority.

## F. Real Postgres Evidence Loop

Environment: a throwaway local PostgreSQL 18.6 on loopback, built with the project's own technique (schema
baseline + ledger + `scripts/db-migrate.ts`), synthetic Student and content, deleted afterwards. pgvector is
not installed locally, so the two vector statements of the baseline were commented in a throwaway copy
(the project's documented substitution). The one mastery policy row was mirrored from DEV (read-only).
Script: `scripts/operations/b5-real-postgres-evidence-loop.ts` — it refuses any non-loopback database.

```text
REAL POSTGRES EVIDENCE LOOP: 59 / 59 checks passed
```

Before / after for the directly attributed concept (first practice attempt):

| | Before | After |
|---|---|---|
| `learning_evidence` rows | 0 | 1 — `PRACTICE_QUIZ`, `correct`, 100 %, key `QUIZ_SUBMISSION::<session>::<learner concept>` |
| `mastery_records` | none | `mastery_score 0.28`, `attempt_count 1` |
| `mastery_events` | 0 | 1 |
| `concept_knowledge_state` | none | `DEVELOPING`, `evidence_count 1` |

Same attempt: the SUPPORTING concept got no evidence, mastery or state row and is listed on the source
evidence; the label-matched (TRANSITIONAL) concept got nothing; all three responses were scored.

## G. Exactly-Once

| Check | Result |
|---|---|
| Retry of a completed attempt | every application `DUPLICATE_IDEMPOTENT`; rows unchanged |
| Six concurrent completions of an applied attempt | rows unchanged |
| Six concurrent FIRST completions of a fresh attempt | exactly one `APPLIED`, five `DUPLICATE_IDEMPOTENT`; one new evidence row, one new mastery event |
| Direct duplicate INSERT with the same operation key | rejected, `23505` on `learning_evidence_operation_key_unique_idx` |
| Exam-family retry | nothing written twice |

The unique index is the final protection; no process-level lock is involved.

## H. Knowledge State

A PROVE attempt on the same concept moved the state `DEVELOPING → PROVISIONAL_MASTERY`, evidence count
1 → 2, through the writer's own recalculation; the loop reported the same before / after it read.

**Finding (existing behaviour, not changed).** The Knowledge State projector counts any evidence written
without assistance as independent — `aiAssistanceType === 'NONE'` — whatever the activity. A practice
answered without hints therefore raised `independent_evidence_count`. B3's own `independent` flag is
stricter (independent activity only) but it does not govern that count. This is true of the legacy path
too. It is the projector's rule to change, not B3's.

Retention: a retention attempt was written as `RETENTION_CHECK`; the memory projector created its state
(`WAITING_FOR_RETENTION`) and answered "not qualified" (too soon after the anchor) — its decision, passed
through. Transfer: not exercised on the database (it needs the transfer grader's verdict and transfer
content) — `TEST_INFRASTRUCTURE_LIMITATION`; unit evidence stands.

## I. Legacy Evidence Cutover

Mechanism: **execution authority is a property of the attempt's record** — CANONICAL when it carries a
snapshot, LEGACY otherwise. No column was added.

| Legacy path | Guard |
|---|---|
| Exam item response → first resolvable concept (`simulation/scoring.service.ts`) | writes evidence only when the attempt's authority is LEGACY; the response row and its score are stored first and regardless |
| Quiz submission (`generate-and-take`) | refuses a canonical session with 409 before grading or writing |
| Canonical loop | refuses a record with no snapshot |

So no attempt can be written by both. The flag only decides how new attempts start; an attempt keeps its
engine. Before the snapshot migration is applied the authority query's "undefined column" is read as
LEGACY (no canonical attempt can exist), so the guards do not break an unmigrated database.

Can the legacy exam shortcut execute on a canonical attempt? **NO.**

## J. Learning E2E

Service level, real Postgres: start → frozen session → responses → loop → evidence → Knowledge State →
`PostAssessmentState` → B4 result view (`EVIDENCE_OBTAINED` for the direct concepts, `NOT_ATTRIBUTABLE` for
the supporting one). Dynamic count: the count is `BlueprintResult`'s; there is no count on the launch
request, the start input or the session insert (unit: 2 / 4 / 4 on the core scenario, 1 on an overlapping
bank). Multi-concept: one PRIMARY + SUPPORTING question credited once.

Not run through the application: no route starts a canonical assessment.

## K. Exam Preparation E2E

Service level, real Postgres: a preparation blueprint frozen on an exam instance; the item with explicit
item-level attribution produced one `EXAM_SIMULATION` evidence row with `examScope` (target from the
attempt's own foreign key, version, attempt); the objective-derived item produced none; an attempt that is
not the instance's was refused. No gap is written anywhere by the loop.

## L. Mock / Reduced / Challenge / Practice E2E

| Case | Evidence |
|---|---|
| Stored types accepted | all four B1 types insert on real Postgres |
| Type derivation | `deriveInstanceAttemptType` tests (B1-E), re-asserted in B0-U and B4 |
| UNKNOWN fidelity | not startable (`FIDELITY_UNKNOWN`); never downgraded — unit |
| Official score with DERIVED-only coverage | real Postgres: 4 of 4 marks, zero evidence rows, result view "attribution unavailable" |
| TECHNICAL_DEMO | real Postgres: scored, zero learner evidence even with explicit attribution |
| A real FULL_MOCK on DEV | `DEV_CONTENT_NOT_READY_FOR_FULL_MOCK` — no student-eligible content |

No exam instance was started through the application.

## M. Q1 Consistency

For three pools (complete, partial, empty) the feasibility projection's QUICK status and question count
equal an actual preparation selection for a learner with no gaps: readiness never calls something
coverable that the solver cannot build. Q1's merge contains no selector and no readiness algorithm.

## N. Question Bank Data Readiness

Hosted DEV, read-only (one READ ONLY transaction). The eligibility column is a simplified reading of the
delivery rule (published, ACTIVE / CALIBRATED, not fixture, not retired).

| Area | Bank items | Student-eligible | Human-reviewed | Objective → concept mapped | Item-level concept attribution | Duration | Licence / source | Feasible |
|---|---:|---:|---:|---:|---:|---|---:|---|
| IB | 169 | 0 | 0 | 162 | 0 | none | 0 | NO |
| AICE | 129 | 0 | 0 | 123 | 0 | none | 0 | NO |
| PAA | 84 | 0 | 0 | 62 | 0 | none | 0 | NO |
| PISA | 56 | 0 | 0 | 47 | 0 | none | 0 | NO |
| Saber 11 (ICFES) | 37 | 0 | 0 | 0 | 0 | none | 0 | NO |
| Cambridge | 21 | 0 | 0 | 0 | 0 | none | 0 | NO |
| SEP / MEN | no assessment content | — | — | — | — | — | — | — |
| Learning cache | 12,716 questions (10,339 validated, 6 Students) | per Student | n/a | n/a | single concept each | none | n/a | YES for linked concepts |

Learner concepts: 104, of which 59 have a canonical link usable for assessment.

## O. Browser Validation

Not performed in B5. No signed-in session was available and I do not enter credentials. The B4 fixture
preview observations stand (desktop, 768 px, 375 px). The edited result screens and the two guarded write
sites are verified by typecheck, build and source guards only.

## P. Accessibility / Responsive

No new UI in B5. No automated scan exists in the project. B4's manual checks stand.

## Q. DEV Certification

```text
DEV_INTEGRATED_ASSESSMENT_FAIL
```

"FAIL" here means **not certified**, not defective: of the eight gate items, the migrations (1), the snapshot
start on DEV (4), the browser flows (6) and B4 rendering canonical results (7) were not reached. Items 2, 3,
5 and 8 are proven off-DEV.

## R. Stage Certification

Not started. Stage is untouched: no migration, no deploy, no smoke.

## S. Flags

| Flag | DEV | Preview / Stage | Production |
|---|---|---|---|
| `CANONICAL_ENGINE_V1_ENABLED` | present, value NOT READ | present, value NOT READ | present, value NOT READ |
| `STUDENT_JOURNEY_V2` | not set ([B0-C]) | not set | not set |
| `EXAM_BLUEPRINT_V2` | not set ([B0-C]) — not enabled | not set | not set |
| `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED` (new) | not set = OFF | not set = OFF | not set = OFF |

The new flag is dedicated on purpose: `CANONICAL_ENGINE_V1_ENABLED` governs the learning decision engine and
its hosted value is unknown, so reusing it could have cut the assessment runtime over wherever it is on.
No flag was changed.

## T. Rollback Plan

| Question | Answer |
|---|---|
| What returns traffic to legacy? | unset `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED`: new starts go to the legacy path immediately |
| Canonical snapshots already created? | they stay, and their attempts stay CANONICAL: authority is the record's, not the flag's. They complete through the canonical loop |
| Which evidence writes are safe? | all: each is keyed and unique in the database; nothing needs undoing |
| Replay / double-write? | impossible by key (same attempt + concept) and by authority (the legacy writers stand down for a canonical attempt) |
| Data deleted on rollback? | none |
| Migration rollback | not required; the column is nullable. Its DROP statements are in the migration header |

## U. Remaining Data Gaps

| Gap | Class |
|---|---|
| No student-eligible reviewed exam item in any family | REVIEW_MISSING |
| No item-level concept attribution on any exam item | MAPPING_MISSING |
| Saber 11 and Cambridge objectives have no published concept mapping | MAPPING_MISSING |
| No recorded duration on any question | DURATION_MISSING |
| No source or licence on any item | LICENCE_MISSING |
| Only Saber 11 Math has a documented blueprint distribution | FIDELITY_METADATA_MISSING |
| 45 of 104 learner concepts have no canonical link | CANONICAL_LINK_MISSING |
| No SEP / MEN assessment content; curricula not imported | CONTENT_MISSING |

## V. Production Readiness

```text
NOT_READY_FOR_RELEASE
```

Production is unchanged. Remaining work, in order:

1. Apply `20261110_1000_assessment_snapshot.sql` to DEV (operator, or grant the permission). *(B5-R: done, as `20261110_1800`; see Y.)*
2. Wire the routes: a start endpoint on `startLearningAssessment`, a completion endpoint on `completeAssessmentEvidence`, and the exam-instance start; mount the B4 setup and result on them.
3. Reconcile B2-A `FrozenForm` with B3 `FrozenAssessment` before either is persisted for official forms.
4. Turn the flag on in DEV only and run the signed-in browser E2E (desktop and mobile) and an accessibility scan.
5. Read the hosted value of `CANONICAL_ENGINE_V1_ENABLED` in each environment.
6. Decide the projector's independence rule (section H).
7. Then Stage: migrations first, in order, on the certified SHA.

---

# B5-R — DEV Runtime Closure

Branch `integration/assessment-b5-runtime-certification`, on top of `9e0e5c3` → `f978bfe` (merge of the sibling
line `47ba817`, QB content carriers and B2 persistence). Stage and Production were not touched. Nothing was pushed
or deployed.

## W. FrozenForm vs FrozenAssessment

Decision implemented as given.

| | FrozenForm | FrozenAssessment |
|---|---|---|
| What it is | the immutable exam form: positions, items, order, marks, sections, timing, identity / hash | the execution and provenance envelope: family, policy, depth / intent, curriculum, exam context, intended coverage, rationale, snapshot identity |
| Canonical persistence | `exam_instances.form` (unchanged) | `assessment_snapshot` (JSONB, nullable) on `quiz_sessions` and `exam_instances` |
| Owns the executed items | **yes** for exam families | **yes** for LEARNING only |

- LEARNING: the FrozenAssessment freezes the question refs and their order; the session serves exactly those.
- Exam families: the FrozenAssessment carries `form: { positionsHash, positions, frozenForm }` — a reference to
  the form, not a second list to execute. `positionsHash` is SHA-256 over the ordered `(index, itemId)` pairs.
  The attempt keeps executing `exam_instances.form`.
- `persistAssessmentSnapshot` reads the instance form first: no form → `FORM_NOT_FROZEN`; a form whose
  positions differ → `FORM_MISMATCH`. `loadAssessmentSnapshot` verifies the same before any execution.
- `freezeExamInstanceProvenance` derives the envelope **from** an existing form (it selects nothing).
- No migration was added for this.

Invariants, proven on real Postgres (section AA / F): provenance for an instance with no form is refused;
provenance for a different form is refused and nothing is stored; storing provenance leaves `form` textually
identical; snapshot refs equal the form positions.

## X. Independence

Independent evidence requires all four: (1) the activity / EvidenceMode allows it, (2) no hint or AI
assistance, (3) direct PRIMARY attribution, (4) canonical learner-concept identity.

- New B3 evidence carries an explicit `metadata.independenceEligible` (`true` / `false`). Exam evidence is
  always `false`. Ordinary practice with no hints is `false`.
- Projector (`countsAsIndependent` in `knowledge-state.service.ts`): explicit value when present, otherwise
  the legacy reading (unassisted = independent). One formula; no second Knowledge State path.
- No historical row was reinterpreted, backfilled or recomputed. DEV holds 0 evidence rows with the explicit
  field (read-only count).

| Case (real Postgres) | `independenceEligible` | evidence_count | independent_evidence_count |
|---|---|---|---|
| Practice, no hint | false | +1 | unchanged |
| PROVE, no hint | true | +1 | +1 |
| PROVE, with a hint | false | +1 | unchanged |
| Legacy row (no field), unassisted | absent | +1 | +1 (legacy behaviour) |

## Y. DEV Migration

Target verified before the write: fingerprint `2a29b99ee14a22b4` = DEV (Production is `6671e7382d808d06`).
The governed runner's dry-run listed exactly one pending migration; the apply was permitted this time.

| | |
|---|---|
| Applied by this session | `20261110_1800_assessment_snapshot` |
| Columns | `quiz_sessions.assessment_snapshot`, `exam_instances.assessment_snapshot` — JSONB, nullable, CHECK requires an object with `snapshotId` and `items` |
| Existing rows | 2,045 quiz sessions and 6 exam instances, all NULL (read as LEGACY) |
| Ledger right after the apply | 81 applied, 0 pending, 0 drifted |
| Ledger at the end of B5-R | **82 applied, 0 pending, 0 drifted** — another session applied `20261111_1000_qb_item_curriculum_nodes` (`3c2b1b8c`, branch `feat/curr-paa-hierarchy`). That file is **not on this branch** |

## Z. Runtime Start & Completion

| Piece | Where | What it does |
|---|---|---|
| Start authority | `startLearningAssessment` (`assessment-start.service.ts`) | resume the open canonical session for the same intent, or one Blueprint Core solve → freeze → one INSERT (session + snapshot + delivery ledger) in a transaction |
| Start route | `POST /api/assessments/learning/start` | 404 with the flag off (checked before auth); parses the launch intent; the Student is the signed-in one; calls the authority once |
| Completion authority | `completeLearningAssessment` (`assessment-completion.service.ts`) | grades each frozen question with the existing `gradeQuizAnswer`, hands scored responses to the B3 loop, marks the session completed |
| Completion route | `POST /api/assessments/learning/[sessionId]/complete` | answers only; returns the `PostAssessmentState`. No flag read: a started canonical attempt stays completable |
| Exam start | `attachExamInstanceProvenance`, called by `startExamInstance` after the IN_PROGRESS update | flag-gated; attaches provenance from the instance form; a failure only warns and the attempt stays LEGACY |
| Exam completion | `completeExamAssessmentEvidence`, called by `finalizeExamCompletion` after scoring | reads the attempt's own stored scores; `REVIEW_REQUIRED` is not evidence until reviewed; never changes a score |

Routes write no evidence, compute no mastery, pick no attribution and build no operation key (source guards in
`b5r-runtime-closure.test.ts`). The attempt type is still decided by B1 at start (PRACTICE → `EXAM_PRACTICE`,
CHALLENGE → `EXAM_CHALLENGE`, MOCK + FULL → `FULL_MOCK`, MOCK + REDUCED → `REDUCED_MOCK`); the snapshot only
restates it. The generated-fallback rule was not touched.

Mounted experience, under the flag:

| Step | Route | Source |
|---|---|---|
| Setup | `/dashboard/assessment?c=<canonical ids>&intent=…&origin=…` | `learningSetupForStudent` → `AssessmentSetup` (QUICK / BALANCED / DEEP from the solver) |
| Preview | same page, after the form | the chosen depth's effort and availability |
| Start | Start button → start route | opens `/dashboard/assessment/<sessionId>` |
| Active | `/dashboard/assessment/[sessionId]` | the frozen questions, frozen order, answers stripped (`toClientQuestion`), existing `QuestionAnswerFields` |
| Completion → Result → Continuation | same page | `AssessmentResult(resultViewOf(PostAssessmentState))`, `AssessmentContinuation` (return to Today, where the next decision lives) |

## AA. Execution Ownership

- An attempt is CANONICAL iff its record carries `assessment_snapshot`; otherwise LEGACY. The flag decides only
  whether **new** starts become canonical.
- Legacy writers stand down for a canonical attempt: `generate-and-take` answers 409
  `ASSESSMENT_EXECUTION_AUTHORITY_CANONICAL`; the exam scoring shortcut skips its `updateMastery`. The shortcut
  was not deleted.
- The canonical completion refuses a LEGACY session (`NOT_CANONICAL`); the canonical exam completion returns
  `NOT_CANONICAL` for a LEGACY attempt.
- Exactly-once is the database's: the unique index on `operation_key`.

Real Postgres 18 (throwaway local cluster, schema baseline + all 80 migrations through the governed runner):
`scripts/operations/b5-real-postgres-evidence-loop.ts` — **80 of 80 checks** (59 in B5). New in B5-R: form
ownership (4), independence (5), the completion authority incl. retry and start-after-completion (5), exam
provenance at start and evidence at completion on real `approved_items` / `exam_attempt_item_responses` rows (7).
In that last group the item coverage is injected; every other step is the real path. The cluster was deleted.

## AB. Signed-in DEV E2E

**Not run.** Two independent reasons:

1. The B5-R code is not on hosted DEV. This session does not push or deploy, and has no hosting access.
2. A signed-in browser session means signing in through the hosted identity provider, which I do not do. The
   repository's fixture mechanism (`scripts/operations/track-a-fixtures.ts`, Clerk test-mode users) creates
   accounts but no browser session.

| Surface | Evidence | Label |
|---|---|---|
| Start, resume, completion, retry, start-after-completion (learning) | real Postgres script | ISOLATED_DB_ONLY |
| QUICK / BALANCED / DEEP | solver and setup-view tests; the three options rendered in the fixture preview | FIXTURE_RENDERED |
| Exam provenance and completion | real Postgres script | ISOLATED_DB_ONLY |
| Shared components (setup, availability, run header, result, continuation) | `/experience-preview`, local | FIXTURE_RENDERED |
| Mounted pages, signed out, flag ON (local) | `/dashboard/assessment` → `/sign-in?redirect_url=…`; both routes → 401 | local browser |
| Start route, flag OFF (local) | 404 `NOT_FOUND` | local browser |
| Mounted pages, signed in | — | **NOT RUN** |
| Anything on hosted DEV | — | **NOT RUN** (`LIVE_DEV`: none) |

Exam preparation on DEV — `CONTENT_READINESS_BLOCKER`. Read-only on DEV: 509 `approved_items`; 426 are
ACTIVE fixtures, 51 are ACTIVE with no origin and no bank record, 11 are PILOT; **0 rows** in
`question_bank_item_concepts` (item-level attribution). A canonical exam attempt on DEV today would be scored
with no learning attribution; the result view renders that state ("score available, attribution unavailable").
No Question Bank content was created or changed.

## AC. Accessibility

```text
ACCESSIBILITY_MANUAL_PASS_TOOLING_GAP
```

No automated scan ran: the project has no accessibility tooling and none was added. Checked by hand on the
fixture preview (local): 9 radios, 0 unlabelled inputs, 0 nameless buttons or links, heading levels never skip,
both progress bars expose `aria-label` / `aria-valuenow` / `aria-valuemax`, alerts use `role="alert"` only for
errors. The new active page reuses those components plus the existing `QuestionAnswerFields`; each question is
a `fieldset` with a `legend`, and the submit button exposes `aria-busy`. **The mounted active and result pages
were not rendered in a browser** (they need a signed-in session), so this label covers the shared components,
not those two pages end to end.

## AD. DEV Final Certification

```text
DEV_STATUS: FAIL (not certified)        STAGE_ENTRY: STAGE_NO_GO
```

"FAIL" means the gate was not met, not that something is broken.

| # | Gate item | Result |
|---|---|---|
| 1 | Baseline preserved (descends from `9e0e5c3`) | PASS |
| 2 | FrozenForm / FrozenAssessment ownership | PASS |
| 3 | Independence rule | PASS |
| 4 | Snapshot migration on DEV | PASS |
| 5 | One start authority, one completion authority, wired to routes | PASS in code; **not deployed to DEV** |
| 6 | Execution ownership, legacy guard | PASS |
| 7 | B4 experience mounted under the flag | PASS in code; entry points not switched (below) |
| 8 | Flag enabled in DEV | **NO** — `DEV_FLAG_PERMISSION_REQUIRED` |
| 9 | Signed-in DEV E2E | **NOT RUN** |
| 10 | Tests, typecheck, build | PASS — 506 files / 9,065 tests, `tsc --noEmit` clean, `next build` OK |

Flags — known values only:

| Flag | Local `.env.local` (this worktree) | Hosted DEV / Preview / Production |
|---|---|---|
| `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED` | not set = OFF | `HOSTED_FLAG_ACCESS_REQUIRED` |
| `CANONICAL_ENGINE_V1_ENABLED` | `true` | `HOSTED_FLAG_ACCESS_REQUIRED` |
| `STUDENT_JOURNEY_V2`, `EXAM_BLUEPRINT_V2` | not set | `HOSTED_FLAG_ACCESS_REQUIRED` |

No flag was changed anywhere.

Remaining conditions, in order:

1. Merge `feat/curr-paa-hierarchy` (`3c2b1b8c`) into this line: DEV already has its migration `20261111_1000`.
2. Deploy this line to hosted DEV and set `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED=true` there only.
3. Signed-in E2E on DEV by an operator, desktop and mobile: setup, the three depths, start, reload (resume),
   submit, result, retry, and a start after completion. The Student needs validated learning-cache questions
   for canonically linked concepts — the start selects from the cache and never generates.
4. Entry points: Today and Learning Path still launch the existing practice. The mounted experience is reached
   by URL. With the flag on, both entries exist; each attempt still has exactly one authority. Switching the
   entry points is the cutover step and was not done.
5. Answers in progress live in the browser only. A reload shows the same frozen questions with empty answers.
6. The mounted runner offers no hints or per-question feedback; it submits once.
7. `launch.ts` still exports `CANONICAL_EXECUTION_ENABLED = false` / `executionPathFor` from B4. Nothing reads
   them; the mounted pages gate on the flag. Remove or align at cutover.
8. Exam families: item-level concept attribution and human review of bank items (section AB) before an exam
   attempt can produce learning evidence.
9. An automated accessibility scan, once tooling exists.

---

# B5-D — DEV Deployment & End-to-End Certification

Line: `2926c29` → `8bb681f` (merge of `3c2b1b8c`) → `6ec1a07` (cutover) → **`3288d6f`** (E2E script, runner
accessibility) — deployed to hosted DEV. Stage and Production were not touched. Nothing was pushed.

## AE. Curriculum Hierarchy Reconciliation

`3c2b1b8c` (`feat/curr-paa-hierarchy`) was inspected against the frozen authorities and merged (`8bb681f`).

| Authority | Effect of `3c2b1b8c` |
|---|---|
| Curriculum authority | uses it: PAA domains / topics are created through the existing `createStructureNode`; adds `reparentLearningObjective` (same structure version only; id, code and description unchanged) |
| CurriculumScope | untouched |
| Canonical concept identity | untouched |
| B2 targets | untouched (objectives keep their ids; the bootstrap lookup now finds an objective by code within its structure version, so a moved objective is never duplicated) |
| B3 evidence, assessment runtime, UI | untouched |
| Schema | one additive migration, `20261111_1000_qb_item_curriculum_nodes` (new table + guards) |

Two chain-guard tests conflicted (both lines appended to the same list) and were resolved by keeping both
entries; five guards that counted files were made order-based. The branch chain now has 81 files, ending in
`20261110_1800` and `20261111_1000`. DEV ledger against this branch: **82 applied, 0 pending, 0 drifted**.

## AF. Entry-Point Cutover

One cutover authority: `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED`, read in one pure server module
(`assessment-execution/execution-flag.ts`). The B4 constant `CANONICAL_EXECUTION_ENABLED` and
`executionPathFor` are deleted; no client component reads any switch (guarded by test).

| Entry | Flag OFF | Flag ON |
|---|---|---|
| Today, My Path, continuation after an activity | existing quiz flow | canonical setup — `/dashboard/assessment?intent=…&origin=…&lc=<concept>` |
| Exam Prep (profile page) | unchanged | adds the canonical availability section; the Exam Core stays the start authority |

How: those surfaces navigate to the launch target the server returns. The two server launch builders
(`resolveCanonicalLaunch`, and `ready()` in the legacy session engine) re-point a launch into the quiz flow
when its mode is an assessment of one concept — `topic_practice` → `CONCEPT_PRACTICE`, `canonical_prove` →
`MASTERY_CHECK`, `canonical_retain` → `RETENTION_CHECK`. The link carries the concept and the intent only;
the engine's item count and difficulty do not travel. The Learning Decision is not duplicated: it still
chooses the concept and the activity.

The setup resolves the Student's own concept to its canonical target through the Blueprint Core (B1 identity
rule) and asks the start for the canonical targets, so a resume finds the same assessment.

**Not re-pointed, by design:** teaching (`canonical_learn_check`), transfer, diagnosis of an open issue,
pending verification and remediation keep their own flows — they are not assessment intents of B2.

**Not re-pointed, and a gap:** secondary surfaces that link straight to `/dashboard/quiz` (subject concept
list, concept page, learning-debt patterns, the cognitive pages). With the flag on they still start a legacy
practice. Each attempt still has exactly one authority, but "never both" does not yet hold for those entries.

## AG. Resume Answer Persistence

Existing structures were audited first. `quiz_responses` already is "what the learner wrote, one row per
session and question", with grades in a separate table that every reader joins. **No migration was needed.**

- A draft is a `quiz_responses` row with no grade row. `saveDraftAnswers` upserts it while the session is
  active, unexpired and canonical; an empty answer deletes it; a graded response is never overwritten.
- `PUT /api/assessments/learning/[sessionId]/answers` (answers only).
- The run page loads the drafts and the runner restores them into the answer controls
  (`decodeClientAnswer`, the inverse of the existing encoder, round-trip tested for every answer format).
- The runner saves 800 ms after a change, when the tab is hidden or the page is left, and before submitting.
- A draft is not evidence: the service and route touch only `quiz_responses` (source guard), and the hosted
  run shows evidence, mastery events and Knowledge State unchanged after a save.

v1 runner behaviour, stated on the page: one submission, no hints, no per-question feedback.

## AH. Hosted DEV Deployment

Governed path: `git archive <sha>` into a scratch directory + the project link, `vercel deploy --target dev`.

| | |
|---|---|
| Deployed SHA | `3288d6f` |
| Deployment | `dpl_CQyiDYZZwJPAo91kDQV2gGMNMKET` — `https://study-hi42u0mnk-study-so.vercel.app` |
| `/api/version` | `commitSha 3288d6f`, `deploymentTarget dev`, `environment development` |
| Earlier deployment of this pass | `6ec1a07` — `dpl_ECwXpTsv3m89za9CxjaxoMMawuPX` (superseded) |
| DEV ledger | 82 applied, 0 pending, 0 drifted; last `20261111_1000` |
| Stable DEV alias | **not moved** (`study-os-env-dev-study-so.vercel.app` is shared with other sessions) |
| Protection | Vercel Authentication (unchanged) |

## AI. Hosted Flag State

| Flag | DEV | Preview / Stage | Production |
|---|---|---|---|
| `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED` | **`true`** — set by this pass, `dev` environment only; effective on the deployment (start route answers 401, not 404) | not changed; not read | not changed; not read |
| `CANONICAL_ENGINE_V1_ENABLED` | present; value not read. Observed behaviour: the session-start API answers with authority `CANONICAL_ENGINE_V1` | not read | not read |
| `STUDENT_JOURNEY_V2` | not set | not read | not read |
| `EXAM_BLUEPRINT_V2` | not set | not read | not read |

Reading values by pulling the environment, and listing Preview / Production, was denied by the session's
permission system and not worked around. The DEV names above come from the DEV variable listing.

## AJ. Authenticated DEV E2E

Mechanism: the repository's Track A fixtures — a Clerk test-mode identity with no password
(`student-a`), authenticated by a 10-minute backend-issued session token held in memory, over real HTTP
through `vercel curl`. No real account was used. Script: `scripts/operations/b5d-dev-e2e-http.ts`
(it performs no database write of its own; the database is read to verify each step).

**This is HTTP as the fixture Student, not a browser session.** I do not sign a browser in through the
hosted identity provider.

| Run (deployment `3288d6f`) | Intent / depth | Session | Snapshot | Questions | Checks |
|---|---|---|---|---|---|
| 1 — the launch the Learning Decision returned | `MASTERY_CHECK` / QUICK | `quiz-b5-33b10f8f2d51-65c65d17` | `33b10f8f2d51c9d29980b4000b4fa558` | 1 | 42 / 42 |
| 2 — practice opened directly | `CONCEPT_PRACTICE` / DEEP | `quiz-b5-12c9a6d487b6-29ec52af` | `12c9a6d487b61c005ec9b9769c51a1b6` | 2 | 43 / 43 |

Three earlier runs on `6ec1a07` also passed (42, 43, 43).

| Step | Hosted result |
|---|---|
| Entry | session-start and the continuation resolver return `/dashboard/assessment?intent=MASTERY_CHECK&origin=TODAY&lc=…`; Today and My Path render with no hard-coded legacy practice link |
| Setup | 200; the form names the canonical concept, not the learner-local id |
| Dynamic question count | setup shows QUICK 1 · BALANCED 1 · DEEP 2 (Blueprint Core). Started DEEP: snapshot items 2 = API 2 = setup 2 = preview 2. Started QUICK prove: 1 = 1 = preview 1 |
| Start | `executionAuthority CANONICAL`; snapshot stored on the session; the session serves exactly the frozen items in the frozen order |
| Active page | renders the frozen questions; no answer key in the response |
| Resume | 2 answers saved → the same request returns the **same session and snapshot** (`resumed: true`), no new session, snapshot unchanged, the reloaded page carries both answers and says so |
| Draft is not evidence | evidence, mastery events and Knowledge State unchanged after saving |
| Legacy guard | the legacy submission answers 409 `ASSESSMENT_EXECUTION_AUTHORITY_CANONICAL` and writes nothing |
| Completion | 200 with a `PostAssessmentState` naming the snapshot; session completed |
| Evidence / Knowledge State, run 1 (prove) | evidence 38 → 39, mastery events 38 → 39, `evidence_count` 38 → 39, **`independent_evidence_count` 36 → 37**, `independenceEligible: true`; state LEARNING → LEARNING |
| Evidence / Knowledge State, run 2 (practice) | evidence 39 → 40, events 39 → 40, `evidence_count` 39 → 40, **`independent_evidence_count` 37 → 37**, `independenceEligible: false` |
| Exactly-once | retried completion: every application `DUPLICATE_IDEMPOTENT`; evidence, mastery, events and Knowledge State identical; one row for the operation key |
| After completion | drafts refused (409 `NOT_ACTIVE`); the finished page links to Today; the Learning Decision returns the next launch (canonical setup again) |
| Exam Prep | 200; canonical availability evaluated, 0 eligible questions, four attempts shown unavailable, none with a start link; no exam instance created |

## AK. Responsive / Accessibility

```text
ACCESSIBILITY_MANUAL_PASS_TOOLING_GAP
```

No accessibility tooling exists in the project; no automated scan ran. What was inspected: the **actual
mounted pages as hosted DEV served them to the fixture Student** (setup, preview, active, active after resume,
finished, Exam Prep), saved with their own stylesheet and opened locally with scripts removed; and the result
and continuation rendered by the real components from the `PostAssessmentState` hosted DEV returned.

| Check | Result |
|---|---|
| Keyboard | Tab reaches the depth group, arrow keys change the depth, Tab reaches Start; in the active page Tab lands on the first answer field, then the next, then Submit. No positive `tabindex` |
| Visible focus | 2 px brand outline on the depth option, the buttons and the answer fields |
| Labels | 0 unnamed inputs; each question is a `fieldset` with a `legend`; free-text fields carry "Pregunta n de N"; 0 nameless buttons or links |
| Headings | one `h1` per page; no skipped level (result: h1, h2, h2) |
| Announcements | draft status is `role="status"` `aria-live="polite"`; errors use `role="alert"`; the progress bar exposes label, value and max |
| Buttons | Start is `type="button"`, Submit is `type="submit"` inside a labelled form, both expose `aria-busy` |
| Mobile 375 px | no horizontal overflow on any page; 0 targets under 44 px; inputs at 16 px (no zoom-on-focus); zoom not disabled |
| Desktop 1280 px | no overflow; layout holds inside the learner shell |
| Timer | none shown in a learning assessment |

Fixed during the check: answer options showed raw `$…$` math (now typeset), option rows were under 44 px and
had no focus ring, the finished page had no heading.

Limits: these are static captures. Hydrated behaviour in a signed-in browser — typing, the autosave status
appearing, the submit click and the result replacing the form — was exercised over HTTP, not on screen.
Pre-existing and not changed here: the document declares `lang="en"` while the Student's content is Spanish.

## AL. Final DEV Certification

```text
DEV_INTEGRATED_ASSESSMENT_PASS_WITH_CONDITIONS        STAGE_ENTRY: STAGE_NO_GO        NOT_READY_FOR_RELEASE
```

| # | Criterion | Result |
|---|---|---|
| 1 | Branch matches DEV migration history | PASS |
| 2 | Canonical code deployed to DEV | PASS (`3288d6f`, immutable deployment; stable alias not moved) |
| 3 | Flag ON in DEV | PASS |
| 4 | Today / My Path enter the canonical flow | PASS (launch authority and continuation, hosted) |
| 5 | B2 creates the assessment | PASS |
| 6 | Snapshot persisted | PASS |
| 7 | Resume preserves answers | PASS |
| 8 | B3 completion executes | PASS |
| 9 | Legacy evidence cannot double-run | PASS |
| 10 | B4 result renders `PostAssessmentState` | PASS for the components on the real hosted state; not seen in a signed-in browser |
| 11 | Continuation works | PASS |
| 12 | Signed-in safe-fixture **browser** E2E | **NOT MET** — passed over HTTP as the fixture identity; no browser session |
| 13 | Desktop / mobile | PASS on captures of the hosted pages |
| 14 | Mounted-page accessibility | PASS, manual, with the limits in AK |
| 15 | Tests / typecheck / build | PASS — 508 files / 9,096 tests, `tsc --noEmit` clean, `next build` OK |

Stage is `STAGE_NO_GO` only because of item 12. It becomes `STAGE_GO_WITH_CONDITIONS` when an operator does
one signed-in click-through on the DEV deployment as the fixture Student (ticket:
`npx tsx --env-file=.env.local scripts/operations/track-a-fixtures.ts signin student-a`): Today → setup →
start → type an answer → reload → answer restored → submit → result → "Ir a Hoy", on desktop and on a phone.

Question Bank readiness (separate track; read-only on DEV; nothing changed):

| | |
|---|---|
| Approved items | 509 (bank items 496: 477 `FIXTURE`, 19 `STUDYUS_GENERATED`) |
| Student-eligible for the fixture Student's exam version | 0 |
| Human review decisions | 0 |
| Item-level canonical attribution | 0 rows |
| Recorded durations | 0 |
| Provenance / licensing | fixture or generated; no licensed or official source |

Remaining conditions:

1. Operator signed-in click-through on DEV (above).
2. Secondary entries that link straight to the legacy quiz (subject concept list, concept page, learning-debt,
   cognitive pages) still start a legacy practice with the flag on.
3. The canonical start selects from the Student's validated question cache and never generates. On DEV the
   fixture concept (48 validated questions) yields 1 / 1 / 2 questions. A Student whose concept has no cached
   questions, or no canonical link (24 unresolved and 11 label-only of 94 mappings on DEV), sees
   "not available yet" from Today. Whether anything still fills that cache once practice no longer runs the
   legacy generator was not established.
4. A retried completion grades again before the database refuses the duplicate: correct, but it spends AI calls.
5. The stable DEV alias still points at an older deployment; moving it is the operator's call. The flag is
   set for the whole `dev` environment, so any later DEV deployment that contains this code starts canonical.
6. Stage, when opened: promote exactly `3288d6f` (or its successor certified the same way), apply the same
   82-entry chain, certify safe Stage data, run the Stage smoke. The Stage flag stays off until then.
7. Exam content: review, item-level attribution, durations and provenance before any exam attempt can
   produce learning evidence or a mock can be offered.
8. An automated accessibility scan once tooling exists; the `lang` attribute.

---

# B5-E — Final DEV Visual Gate & Stage Readiness

Certified code: **`a2e041e`** (two fixes found by this gate, on top of `3288d6f`), deployed to hosted DEV as
`dpl_GN5fp6XvaY4UKvgQgibXv1RPP82v` — `https://study-1lyr5nala-study-so.vercel.app`; `/api/version` confirmed
before each journey. Stage and Production were not touched. Nothing was pushed.

## AM. Hydrated Authenticated Browser Certification

**How the session was authenticated — a deviation from the brief.** I did not redeem the sign-in ticket in a
browser: I do not sign a browser in through a hosted identity provider. Instead a loopback-only proxy
(temporary, untracked, deleted afterwards) forwarded a local browser to the hosted DEV deployment and added the
fixture Student's backend-issued session token (`student-a`, the same mechanism as the HTTP E2E) to each
request. The browser therefore ran the **real hosted build, fully hydrated, as the fixture Student**. What this
does not exercise: the identity provider's own sign-in screen and its client-side session (cookie) handling.

| Journey | Deployment | Viewport | Session | Result |
|---|---|---|---|---|
| Desktop | `3288d6f` | pane width ≈ 800 px | `quiz-b5-55e7defadaa4-a5bf5aa7` | PASS |
| Mobile | `a2e041e` | 375 × 812, touch emulation | `quiz-b5-27ee9d177eb3-71c7db7f` | PASS |

Both: Today → "Comprobar" → canonical setup → preview → Start → answer → leave → come back → answer restored →
submit → result → "Ir a Hoy" → Today.

| Check | Desktop | Mobile |
|---|---|---|
| Canonical route used from Today | `/dashboard/assessment?intent=MASTERY_CHECK&origin=TODAY&lc=…` | same |
| Setup count = B2 output | "1 pregunta" on setup and preview; 1 frozen item | same |
| Active page loads, hydrated | 1 question, 4 options, math typeset | 1 free-text question |
| Answer persists | "Respuestas guardadas" after selecting; full reload restored the option | after typing; left to Today, came back **through Today → setup → Start** |
| Same session after resume | same URL / id | same id (`resumed`), not a new session |
| Same snapshot after resume | `55e7defadaa46087…` | `27ee9d177eb3bdc8…` |
| Completion | submitted with the keyboard (Tab, Enter) | submitted by tap |
| Result | "Tu resultado", 100 %, evidence registered for Linear Equations | same |
| Continuation | "Ir a Hoy" → Today | same |
| Database after | completed; 1 evidence row; 1 response row | same |
| Console errors on canonical pages | none | none |

Three practice depths, hydrated (`a2e041e`): QUICK 1 · BALANCED 1 · DEEP 2 questions, as the HTTP run reports.
HTTP E2E on `a2e041e`: 43 / 43.

Found by this gate and fixed in `a2e041e`:

1. Today's card said "10 preguntas" (the engine contract's count) while the Blueprint Core selects 1. The card
   now shows no count when the launch enters the canonical setup; the setup shows the real one.
2. After submitting, the result replaced the form without moving focus. Focus now goes to the result heading.

Observed, not caused by this work and not fixed:

- One React hydration warning (#418) on the **first** full load of Today in a fresh tab; not reproduced on a
  second full load, and never on a canonical page. Today is unchanged by this line.
- Once, on mobile, the tab was back on Today before I submitted, with no action of mine in between. The
  session page then stayed put for 30 s under observation and the journey completed. I could not attribute it
  (app or test pane) and did not reproduce it.

Hydrated accessibility — `ACCESSIBILITY_MANUAL_PASS_TOOLING_GAP`, **now checked on the hydrated, authenticated
pages** (no automated tooling exists in the project):

| Check | Result |
|---|---|
| Keyboard order | setup: depth group → Start; active: answer control → Submit; arrow keys move within the option group |
| Visible focus | 2 px outline on the option, the text field and the buttons (`:focus-visible` true) |
| Question / option labels | each question is a `fieldset` + `legend` "Pregunta n de N"; options are labelled radios; the text field is named "Pregunta 1 de 1" |
| Accessible names | no unnamed control on setup, preview, active or result |
| Headings | one `h1` per page; result: `h1` "Tu resultado", `h2`, `h2` |
| Live / error | draft status announced politely ("Respuestas guardadas"); errors are `role="alert"` |
| Submit semantics | a `submit` button in a labelled form; Enter submits; `aria-busy` while sending |
| Result heading | receives focus after completion |
| Continuation CTA | a link, "Ir a Hoy", reachable by keyboard |
| Keyboard trap | none |
| Mobile | no horizontal overflow on Today, setup, active, resumed, result; no target under 44 px; text input 16 px; zoom not disabled |

## AN. Learning Question Supply

```text
QUESTION_SUPPLY_HEALTHY   (with the conditions below)
```

A producer independent of the legacy quiz exists and was observed running on DEV against the canonical
deployment. The legacy generator was **not** the only normal producer.

**Writers.** `question_bank_candidates` has one row creator, `addValidatedCandidates`
(`src/services/question-bank.service.ts`). Rows are VALIDATED by column default: the generators' own quality
gate is the validation; there is no later status transition. It is called from:

| Caller | Triggered by | Survives the cutover? |
|---|---|---|
| Background worker (`activity-delivery-worker.service.ts`: `PREPARE_INVENTORY` → `BANK_REPLENISH`) | `scheduleDeliveryReplenishment`, queued when **Today renders** (for its one recommended concept) and when a **Concept Mission page renders**; also on a legacy launch and a legacy submit | **yes** for Today and Concept Mission; the two legacy triggers disappear |
| Legacy emergency generation (`completeEmergencyDelivery`) | the legacy quiz route, inline, when nothing is ready | no |
| Bench / certification scripts | operator | n/a |

The worker is executed by `POST /api/internal/generation-worker`, which the deployment calls on itself. That
needs `CRON_SECRET` and `VERCEL_URL`; without them jobs stay pending. No cron is defined in the repository.

**Lifecycle.** A concept is the Student's next action → Today (or its mission page) queues a job → the worker
resolves the canonical next activity and sizes the pool for it → generators produce questions, stored validated
→ the canonical start selects from the Student's validated rows and records each delivery in the same ledger
(`question_bank_deliveries`, `usage_count`) → the next Today view measures depth again; for prove, retain and
transfer delivered rows no longer count, so exposure causes generation.

**Exhaustion in the canonical path** (Blueprint Core, unchanged):

| Intent | All cached questions already seen |
|---|---|
| Practice, mastery check, diagnostic | **reused**, ranked after unseen ones and reported as a soft shortfall; the assessment still starts |
| Retention check | questions used in the last 14 days are excluded; if all are recent → nothing selected → "not available yet" |
| Any | nothing in the canonical start or completion generates or queues generation; there is no inline fallback |

**Measured on DEV (read-only).** Jobs: 2,322 `PREPARE_INVENTORY` and 809 `BANK_REPLENISH` succeeded; the latest
ran at 02:50 UTC, during this gate, for activity PROVE with `bankShort: false`. The fixture Student has 48
validated questions (40 prove, 8 of them seen); none was added during the gate because the pool was judged deep
enough.

Conditions:

1. **Cold start.** A concept whose cache is empty when the Student presses Start gets "not available yet";
   the legacy path would have generated inline. Today pre-warms only its one recommended concept; My Path does
   not pre-warm.
2. **No trigger in the canonical flow itself.** Recommended, small: queue the same replenishment when the
   canonical setup is opened and after completion. Not done here (no policy change in this pass).
3. **Stage must be able to drain the queue**: `CRON_SECRET` set and the deployment able to call itself.
4. The worker sizes the pool for the engine's contract and prepares ready-made sets the canonical start never
   uses. Harmless, but wasted work.
5. A cached question whose concept has no canonical link cannot be selected (B1 rule), however many exist.

## AO. Remaining Legacy Entry Points

Every `/dashboard/quiz` reference in `src/` was audited (27 lines, 17 files).

| Surface | Current | Target | Action |
|---|---|---|---|
| Subject page, concept row "Comprobación individual" (`subjects/[id]/ConceptList.tsx:139`) | hand-built `…/quiz?conceptId&mode=quick_check`, shown for every concept | `SHOULD_USE_CANONICAL` | Re-point (or remove) under the flag. It is a client link and `quick_check` has no mapped intent, so it needs the server to supply the target. **Open — the one ordinary-practice entry that competes** |
| Subject page "Evaluación acumulativa" / "Simulación de examen" (`subjects/[id]/page.tsx:226,229`) | hand-built, subject-wide, no concept | `OUT_OF_SCOPE_SPECIALIZED_FLOW` (borderline) | Product decision: `MIXED_CUMULATIVE` exists in B2 but nothing maps to it. Leave |
| Remediation steps (`remediation.service.ts:493–497`) | `…&mode=topic_practice|quick_check|cumulative_assessment&remediationStepId=` | `OUT_OF_SCOPE_SPECIALIZED_FLOW` | Leave. Note: must never be routed through the entry cutover (it would drop the step id) |
| Explain & Defend, Transfer pages | no quiz URL of their own; continuation comes from the server | `OUT_OF_SCOPE_SPECIALIZED_FLOW` | None |
| Concept page, learning-debt list | already link to the Concept Mission, not the quiz | `INTENTIONALLY_LEGACY` (no launch) | None — the B5-D report overstated these |
| Continuation panel, Start buttons, study plan | navigate to the server's launch target | covered by the cutover | None |
| Teacher class assignments | own route, legacy submit | `OUT_OF_SCOPE_SPECIALIZED_FLOW` | None |
| Learner shell focus-mode list | route detection for `/dashboard/quiz` only | `INTENTIONALLY_LEGACY` | Optional: add `/dashboard/assessment` if focus chrome is wanted there |

One more, inside the legacy session engine: it launches `review`, `quick_check` and `retention_check` modes that
the cutover does not map. Irrelevant where the canonical engine is the authority (DEV behaves so); relevant in
any environment where it is not.

## AP. Final DEV Certification

```text
DEV_INTEGRATED_ASSESSMENT_PASS
```

| Gate | Result |
|---|---|
| Desktop browser journey, hydrated, authenticated | PASS (`3288d6f`) |
| Mobile browser journey, hydrated, authenticated | PASS (`a2e041e`) |
| Hydrated accessibility, manual | PASS |
| Runtime green on the certified SHA | PASS — HTTP E2E 43 / 43 on `a2e041e` |
| Tests / typecheck / build | 508 files / 9,097 tests, 0 failed; `tsc --noEmit` clean; `next build` OK |

Caveat that stays attached to this PASS: authentication was by proxy-injected fixture token (section AM).

Fixture data. `student-a` now carries 8 canonical sessions and 8 evidence rows from B5-D / B5-E (Knowledge
State for Linear Equations: evidence 43, independent 39). The fixture tooling keeps Sofía's learning history
on purpose (`teacher-reset`: "her own learning history is kept — produced only through the governed engine
path"); the only tool that removes it is the full `cleanup` + `provision`, which also resets every other Track
A identity. Nothing was deleted. It is fixture data, not learner data.

Retry cost — `PERFORMANCE/COST OPTIMIZATION`, not a blocker. A retried completion grades again before the
database refuses the duplicate. Recommended later: check, before grading, whether the session is already
completed and its evidence keys exist, and return the stored outcome; this needs the result to be reproducible
without re-grading, which the current contract does not store.

Exam content — `EXAM_CONTENT_NOT_RELEASE_READY` (release blocker, not an engine blocker): 509 approved items,
0 human review decisions, 0 item-level concept attributions, 0 durations, no licensed source. Unchanged.

## AQ. Stage Entry Decision

```text
STAGE_GO_WITH_CONDITIONS
```

1. Promote exactly `a2e041e`.
2. Reconcile the Stage ledger with the 82-entry chain of this branch.
3. Apply pending migrations before the code is activated.
4. Keep `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED` off until the Stage deployment and migrations are confirmed.
5. Enable the flag in Stage only.
6. Run a reduced signed-in Stage smoke. An operator signing in through the real sign-in screen would also
   close the one thing this gate did not exercise.
7. Confirm the question queue drains in Stage (`CRON_SECRET`, self-dispatch) and that the smoke Student has
   cached questions on a canonically linked concept.
8. Confirm which learning-decision engine Stage runs (`CANONICAL_ENGINE_V1_ENABLED`): with it off, the legacy
   engine's `review` / `quick_check` / `retention_check` launches are not re-pointed.
9. Production stays untouched.

Open product items, not Stage blockers: the subject-page "Comprobación individual" link; a replenishment
trigger in the canonical flow; the retry cost; exam content.

---

# B5-F — Pre-Stage Cleanup & Stage Certification

Start: `2ae85c6` (code `a2e041e`), clean tree. No unrelated work was merged. Production was not touched. Nothing
was pushed.

## AR. Canonical Entry-Point Cleanup

Subject page, concept row "Comprobación individual":

| Flag | Link |
|---|---|
| OFF | `/dashboard/quiz?subjectId=…&conceptId=…&mode=quick_check` (unchanged) |
| ON | `/dashboard/assessment?intent=MASTERY_CHECK&origin=LEARNING_PATH&lc=<concept>` → canonical setup → canonical start |

`quick_check` of one concept is now an assessment mode at the same entry boundary Today and My Path use
(`entry.ts`: `quick_check → MASTERY_CHECK`, independent and unassisted like prove). The concept row calls
`conceptCheckHref(...)`; it builds no route and reads no flag — the server page reads the flag and hands it down.
The same mapping also re-points a `quick_check` launched by the legacy session engine.

Student-facing direct quiz links, all of them:

| Surface | Intent | Canonical required? | Action |
|---|---|---:|---|
| Subject page, concept row "Comprobación individual" | learner-selected check of one concept | yes | **done** |
| Subject page "Evaluación acumulativa" | subject-wide cumulative assessment, no concept | no (specialised) | left; `MIXED_CUMULATIVE` exists in B2 but mapping it is a product decision |
| Subject page "Simulación de examen" | subject-wide exam simulation | no (specialised) | left |
| Repair Path steps (`remediationStepHref`) | remediation step, carries `remediationStepId` | no (specialised) | left |
| Today, My Path, continuation, study plan, Start buttons | server launch target | yes | already canonical (B5-D) |
| Teacher class assignment runner | assignment | no (specialised) | left |

A test now fails if any page or component hand-builds a one-concept practice / check link to the legacy quiz.
Still not mapped, and only reachable where the legacy decision engine is the authority: its `review` and
`retention_check` launches.

## AS. Learning Question Supply Lifecycle

```text
QUESTION_SUPPLY_HEALTHY
```

```text
Learning surface / canonical setup      requestAssessmentSupply (after the response)
  → existing queue                      one open PREPARE_INVENTORY job per Student + concept
  → existing worker, own invocation     measures the pool against its own safe-depth rule; generates only if short
  → generators' quality gate            questions stored VALIDATED in the Student's cache
  → B2 eligibility + selection          only what is eligible now is offered or started
```

- The setup is a supply **trigger** only (`assessment-supply.service.ts`). It asks for the Student's own
  concepts behind the scope (ownership enforced in the query; at most 5 per request). The Question Bank / cache
  stays the content authority and B2 the selection authority.
- **Start never generates.** A setup with nothing eligible still says "not available yet"; the request makes a
  later visit succeed.
- **Idempotent.** It reuses the queue's own rule — `INSERT … ON CONFLICT (dedup_key) WHERE status IN ('PENDING',
  'RUNNING') DO NOTHING`, key `prepare:<student>:<concept>`. Test: 35 requests, 10 of them concurrent, for the
  same Student + concept → one job; a new one only after the previous finished.
- **After completion** the completed session's concepts are requested the same way, in `after()`: it cannot
  delay, change or fail the result, writes no evidence and does not touch the Learning Decision.
- No second pipeline: `generation_jobs` still has one writer.

Hosted DEV, `2d3fc68`:

| Case | Result |
|---|---|
| Setup opened for the fixture concept (pool already deep) | job queued and drained `SUCCEEDED`, `bankShort: false`, nothing generated |
| Same setup twice more while open | never more than 1 open job |
| **Cold concept** (Differentiation, 0 cached questions) | setup: "Esta práctica todavía no está disponible" → job queued → worker generated 15 questions in about 45 s → the same setup now offers QUICK / BALANCED 2 / DEEP 3 |

The worker generates for the concept's current activity in the Learning Decision (here: learn check); the
Blueprint Core draws from every validated question of the concept. A concept with no activity in the Learning
Decision is not generated for.

## AT. Final DEV SHA

```text
FINAL_DEV_CERTIFIED_SHA = 2d3fc68
```

Deployed to hosted DEV as `dpl_CuzknmyC2JHaGjfcCiqK36Fqpsfc` — `https://study-5v3dno0aa-study-so.vercel.app`.

| Reduced DEV verification (HTTP, fixture `student-a`) | Result |
|---|---|
| Subject page → canonical setup; no `quick_check` quiz link left | PASS |
| Low / cold pool → replenishment queued and drained | PASS |
| Today / My Path still canonical | PASS |
| Start → snapshot; resume; complete → result; exactly-once; legacy guard | PASS |
| Run 1 (mastery check) | 47 / 47 |
| Run 2 (practice, DEEP) | 48 / 48 |
| Tests / typecheck / build | 509 files / 9,107 tests, 0 failed; `tsc --noEmit` clean; `next build` OK |

Watch items — both `NON_REPRODUCED_WATCH_ITEM`: the React #418 warning on Today and the unexpected return to
Today on mobile. Neither was seen again; note that B5-F ran no hydrated browser session, so this is "not
re-observed", not "ruled out".

## AU. Stage Migration & Deployment

Pre-flight (read-only):

| | Found |
|---|---|
| Stage alias `study-os-stage-study-so.vercel.app` | `92e3509`, `dpl_9VrkbGMci5w65bpWqKJeQ99yGpfS` — an ancestor of this branch (145 commits behind, none of its own) |
| Stage database | Neon `ep-holy-thunder-ayxlpyex`, fingerprint `53d158d5811e7ee0` |
| Stage ledger | 60 applied, **22 pending**, 0 drifted |
| Canonical flag | not set in the `preview` environment = OFF |
| `CANONICAL_ENGINE_V1_ENABLED` | present; value not read |
| `CRON_SECRET` | present |
| Worker history | 195 `PREPARE_INVENTORY` and 63 `BANK_REPLENISH` succeeded, last on 2026-10-09 |
| Safe test Student | **none** — the 4 Students in Stage are real people's accounts |

The 22 pending migrations were not only this line's: they are every migration since `20261031_1000` (exam
platform, human review, safety routing, academic profile, simulation types, Question Bank carriers, frozen
forms, the snapshot column, curriculum nodes). They are additive or constraint-widening; none rewrites or
deletes data. The governed runner's dry-run listed exactly those 22; they were applied in order.

| | After |
|---|---|
| Stage ledger | **82 applied, 0 pending, 0 drifted** |
| Deployed | `2d3fc68` → `dpl_5FagcFXGuom1dSrKjYQryKoa7gcd`, `https://study-oo49i5u29-study-so.vercel.app` (`/api/version`: `2d3fc68`, target `preview`) |
| Flag on that deployment | OFF — the start route answers 404, i.e. the legacy runtime |
| Signed-out behaviour | `/dashboard/assessment` → sign-in; worker endpoint without the secret → 401 |
| Stage alias | **not moved** — still `92e3509`, now running on the migrated schema |
| Stage flag | **not enabled** |

Why it stops here: enabling the canonical runtime on Stage without being able to exercise it would switch real
people's accounts to an unverified path. See AV.

## AV. Real Stage Authentication

```text
STAGE_TEST_IDENTITY_REQUIRED
```

No safe Stage identity exists, and the real sign-in gate is an operator step in any case (I do not sign a
browser in through the identity provider, and the fixture tooling is DEV-only by design). Not done.

Needed from the operator:

1. A test Student in the Stage identity instance (not a real learner), signed in through the real sign-in UI.
2. `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED=true` in the `preview` environment only, then redeploy **`2d3fc68`**
   and point the Stage alias at it.
3. The smoke in AW, desktop and mobile.

## AW. Stage Learning Smoke

Not run (AV). The smoke to run, once signed in:

```text
Today → canonical setup → Start → answer → reload → answer restored → complete → result → "Ir a Hoy"
Subject → "Comprobación individual" → canonical setup
Exam Prep → four attempts shown unavailable, no start link
```

A new test Student has no cached questions: the first setup will say "not available yet" and queue the
supply request; it becomes available once the worker has run (about a minute on DEV), provided the Learning
Decision has an activity for the concept and the concept is canonically linked.

## AX. Stage Question Supply

Configuration is in place (`CRON_SECRET` present; the worker ran successfully on Stage as recently as
2026-10-09; the endpoint is protected). The new setup-triggered request was **not** exercised on Stage: it needs
an authenticated setup render.

## AY. Stage Certification

```text
STAGE_INTEGRATED_ASSESSMENT_FAIL        (not certified — blocked by STAGE_TEST_IDENTITY_REQUIRED)
```

| # | Gate | Result |
|---|---|---|
| 1 | Exact DEV-certified SHA deployed | PASS (`2d3fc68`, immutable deployment; alias not moved) |
| 2 | Stage migrations clean | PASS (82 / 0 / 0) |
| 3 | Flag enabled in Stage only | NOT DONE (held until it can be verified) |
| 4 | Real sign-in path | NOT DONE — operator |
| 5 | Canonical Learning smoke | NOT RUN |
| 6 | Resume | NOT RUN |
| 7 | Subject-page canonical entry | NOT RUN on Stage (PASS on DEV) |
| 8 | Question replenishment worker | configuration present; new trigger NOT RUN on Stage |
| 9 | Result / continuation | NOT RUN |
| 10 | No legacy double evidence | NOT RUN on Stage (PASS on DEV) |
| 11 | Desktop / mobile | NOT RUN |
| 12 | Tests / build green | PASS |

Release readiness:

```text
LEARNING   NOT_EVALUATED — Stage is not certified
EXAMS      NOT_READY_FOR_PRODUCTION_EXAM_RELEASE — human review, student eligibility, item-level attribution,
           provenance / licensing and durations are still missing
```

Things to know before the operator continues:

- The Stage alias now runs old code (`92e3509`) on a schema 22 migrations newer. The migrations are additive,
  and nothing was observed failing, but only unauthenticated endpoints were checked.
- Promoting `2d3fc68` to the alias moves Stage forward by 145 commits — every track merged into this line, not
  only the assessment runtime.
- With the flag off, `2d3fc68` behaves as the legacy runtime; the cutover is the flag alone.

---

# B5-G — Stage Runtime Certification (in progress)

Certified code: `2d3fc68` (unchanged). Branch HEAD `5a30b44` differs from it by the report only. Production was
not touched. Nothing was pushed.

## AZ. Stage Code/Schema Alignment

Pre-flight: clean tree; HEAD descends from `2d3fc68`; Stage database `ep-holy-thunder-ayxlpyex`, fingerprint
`53d158d5811e7ee0` (the one verified in B5-F); ledger 82 applied, 0 pending, 0 drifted; the immutable deployment
`dpl_5FagcFXGuom1dSrKjYQryKoa7gcd` still serves `2d3fc68`. No ambiguity in the target.

The Stage alias was moved to that existing deployment. No rebuild, no flag change.

| Check on `https://study-os-stage-study-so.vercel.app` | Result |
|---|---|
| `/api/version` | `2d3fc68`, target `preview`, `dpl_5FagcFXGuom1dSrKjYQryKoa7gcd` |
| Database diagnostics | fingerprint `53d158d5811e7ee0`, 82 migrations applied, ledger present |
| `/` → `/es`, `/sign-in` | 200 |
| `/dashboard/today` signed out | redirects to sign-in with `redirect_url` |
| Canonical start with the flag OFF | 404 `NOT_FOUND` — the legacy runtime is the only one |

Previous alias target, for rollback: `dpl_9VrkbGMci5w65bpWqKJeQ99yGpfS` (`92e3509`).

## BA. Stage Test Identity

Not created. Creating an account in the identity provider is an operator action: I do not create accounts on
an external identity service, and the repository's fixture tooling refuses anything but DEV. No Stage-fixture
standard exists in the repository. The four existing Stage Students are real accounts and were not touched.

## BB. Real Authentication

```text
STAGE_OPERATOR_SIGNIN_REQUIRED
```

Minimal operator action, in the browser that will then be used for the smoke:

1. Open `https://study-os-stage-study-so.vercel.app/sign-up` (pass the hosting login if asked).
2. Sign up a test-only Student, e.g. `stage-assessment-fixture+clerk_test@example.com` (the identity
   provider's test-mode address; no real mailbox).
3. Finish first-run as a **Student** and add one subject from the catalogue (not a free-text subject), so its
   concepts are canonically linked and Today shows a recommended activity.
4. Leave that browser signed in and say so.

Everything else continues from there without further operator input: checking the Student in the database,
enabling the flag in Stage only, redeploying `2d3fc68`, and the desktop / mobile smoke in that signed-in session.

## BC. Stage Learning E2E

Not run — waits for BB.

## BD. Stage Resume / Exactly Once

Not run — waits for BB.

## BE. Stage Question Supply

Configuration: `CRON_SECRET` present in the Stage environment; the worker endpoint refuses a call without it
(401); the worker last succeeded on Stage on 2026-10-09. The setup-triggered request is not yet exercised on
Stage — it needs the signed-in setup. A new Student starts with an empty cache, which is exactly the cold case
to be shown.

## BF. Stage Exam Prep

Not run — waits for BB.

## BG. Stage Accessibility / Responsive

Not run — waits for BB.

## BH. Stage Final Certification

```text
STAGE_INTEGRATED_ASSESSMENT_FAIL        (not certified yet — STAGE_OPERATOR_SIGNIN_REQUIRED)
```

| # | Gate | Result |
|---|---|---|
| 1 | Stage alias runs the exact DEV-certified SHA | PASS |
| 2 | Migration chain 82 / 0 / 0 | PASS |
| 3 | Canonical flag ON in Stage | not yet (enabled only after sign-in works, as specified) |
| 4 | Safe Stage test identity | operator |
| 5 | Real sign-in UI / session | operator |
| 6–19 | Today, My Path, Subject, start, resume, completion, exactly-once, result, supply, Exam Prep, desktop, mobile, accessibility, no double-write | waiting |
| 20 | Tests / typecheck / build | PASS — 509 files / 9,107 tests, `tsc --noEmit` clean, `next build` OK |

Stage flags as known: `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED` not set (OFF, confirmed by behaviour);
`CANONICAL_ENGINE_V1_ENABLED` present, `VALUE_NOT_READ`; `STUDENT_JOURNEY_V2` and `EXAM_BLUEPRINT_V2` not set.

## BI. Split Release Readiness

```text
LEARNING   LEARNING_NOT_READY_FOR_RELEASE — Stage is not certified yet
EXAMS      EXAMS_NOT_READY_FOR_PRODUCTION_RELEASE
```


## BJ. B5-G continuation — Stage entitlement, flag and authenticated smoke (2026-10-11)

Ownership of B5-G moved to the canonical Assessment Engine thread by explicit operator instruction. Stage only;
Production untouched; the four pre-existing Stage Students and their grants were not modified.

**Test identity.** Student `05c6275b-6558-4421-b74c-f3017debef74` (user `6da2a1b2-5f81-4dba-96d4-932bb1dd61f4`),
created by the operator on 2026-10-11: Mexico, national curriculum, grade 12, subject Matemáticas, one concept
"Ecuaciones de segundo grado". Not a `+clerk_test` address and `users.is_test = false`.

**Entitlement.** Granted through the supported service `grantAdminLicense` (the mechanism behind the three
existing Stage grants): subscription `4560826d-4e78-4e7d-b1ec-e3baac202702`, source `ADMIN_PROMOTION`, expires
2026-10-25, actor = the StudyUs admin account, reason states it was executed for this certification. The script
refused any database but `ep-holy-thunder-ayxlpyex` and any student but this one. No payment, no provider call.
`resolveLearningAccess`: `NO_LICENSE` → `LICENSED / ADMIN_GRANT`. Billing page shows "Licencia otorgada por la
administración. Válida hasta el 25/10/2026".

**Flag and deployment.** `2d3fc68` redeployed to `preview` with `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED=true` set
on that deployment only (`--env`), not on the shared `preview` environment: `dpl_HQ64wMCMZiJNCU9Ne2BbSZQGo4aE`,
`https://study-e499lezjt-study-so.vercel.app`. Stage alias moved to it. Signed-out canonical start: 401 on the new
deployment, 404 on the flag-OFF one. Database fingerprint `53d158d5811e7ee0`, ledger 82.

Rollback targets, in order: `dpl_5FagcFXGuom1dSrKjYQryKoa7gcd` (`2d3fc68`, flag OFF,
`study-oo49i5u29-study-so.vercel.app`); `dpl_9VrkbGMci5w65bpWqKJeQ99yGpfS` (`92e3509`).
Rollback: `vercel alias set study-oo49i5u29-study-so.vercel.app study-os-stage-study-so.vercel.app`.

**Authenticated smoke (operator's signed-in Chrome session, desktop).**

| Check | Result |
|---|---|
| Authenticated Student, no demo banner | PASS |
| Today (cold: "Necesitamos conocerte"; after the activity: next challenge + week + plan) | PASS |
| Learn / My Path, subject entry, concept entry | PASS |
| Question supply, cold Student | PASS — 5 questions from inventory (`delivery_source = INVENTORY`) |
| Learning activity "Comprobar comprensión" (learn-check) | PASS — 5 of 5 answered: MC and AI-graded open answers, correct and incorrect feedback |
| Reload / resume | PASS — returned to question 2 with the "retomamos" notice |
| Exactly-once | PASS — a double-click submit produced one response; 1 session, 5 responses, 5 distinct questions, 1 evidence row |
| Result | PASS — 4 of 5, 80%, next step offered. Note: headline "Todavía no" at 80% |
| Progress / evidence | PASS — subject page 15%, evidence verified 1/1; mastery, knowledge state, memory state rows written |
| **Canonical snapshot runtime (`/dashboard/assessment`, MASTERY_CHECK)** | **FAIL — UNAVAILABLE, `SOME_TOPICS_NOT_READY` (`UNRESOLVED_TARGET`)** |
| Exam Prep entry (PAA) | PASS — profile created, readiness view renders |
| Exam assessment start | Correctly unavailable: all four modes "No disponible todavía" (no bank) |
| Feature-flag behaviour | PASS — concept row links to `/dashboard/assessment?intent=MASTERY_CHECK…` with the flag ON |
| Mobile | NOT VERIFIED — the Chrome window did not resize (viewport stayed 1495 px) |
| Accessibility (spot check) | PARTIAL — one `h1`, `main` present, no horizontal scroll, images have alt; `<html lang="en">` on a Spanish page; icon links in the collapsed nav groups have no accessible name in the tree |

**Blocker — `STAGE_CONCEPT_NOT_CANONICALLY_LINKED`.** The learn-check is a teaching activity the assessment system
does not own (`entry.ts`), so it ran on the learning runtime and its session has `assessment_snapshot IS NULL`.
The snapshot runtime is reached through practice / mastery check, and there the Blueprint Core refuses: the
Student's concept has `concept_catalog_mapping.status = UNRESOLVED` (no canonical concept). On Stage 50 of 53
learner concepts are unresolved; the catalogue has "Quadratic functions and inequalities" (Mathematics) but no
exact label match for "Ecuaciones de segundo grado". No canonical FrozenAssessment has been started on Stage.

```text
STAGE_INTEGRATED_ASSESSMENT_FAIL   (learning path PASS; canonical snapshot runtime not exercised)
```
