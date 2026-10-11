# B5 — Full Integration & Runtime Certification

Date: 2026-10-10 · Worktree: `studyos-assessment-b5` · Branch: `integration/assessment-b5-runtime-certification`

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

1. Apply `20261110_1000_assessment_snapshot.sql` to DEV (operator, or grant the permission).
2. Wire the routes: a start endpoint on `startLearningAssessment`, a completion endpoint on `completeAssessmentEvidence`, and the exam-instance start; mount the B4 setup and result on them.
3. Reconcile B2-A `FrozenForm` with B3 `FrozenAssessment` before either is persisted for official forms.
4. Turn the flag on in DEV only and run the signed-in browser E2E (desktop and mobile) and an accessibility scan.
5. Read the hosted value of `CANONICAL_ENGINE_V1_ENABLED` in each environment.
6. Decide the projector's independence rule (section H).
7. Then Stage: migrations first, in order, on the certified SHA.
