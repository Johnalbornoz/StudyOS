# B5 — Full Integration & Runtime Certification

Date: 2026-10-10 · Worktree: `studyos-assessment-b5` · Branch: `integration/assessment-b5-runtime-certification`

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

