# B1 — Canonical Assessment Foundation: Certification

Date: 2026-10-10. Canonical architecture source: `docs/audits/B0_INTEGRATED_ASSESSMENT_ARCHITECTURE_CERTIFICATION.md` (sections X.9–X.16).

Paths are relative to the repo root. `AF/` = `src/lib/assessment-foundation/`.

# 0. Executive Result

```text
FOUNDATION_PASS_WITH_CONDITIONS      (after B1-C closure; see section T)
```

**Section U (B1-D) is the latest state and supersedes T wherever they differ:** practice exam instances now store `EXAM_PRACTICE`; one migration exists (`20261108_1000`); T1 is reconciled through `091e91d`; the CHALLENGE check failed (`CHALLENGE_FULL_MOCK_INVARIANT_FAILED`) and is awaiting a decision.

**Section T (B1-C) supersedes sections 0–S wherever they differ.** In particular: B1 is now committed, the production build passes, the TRANSITIONAL rule is frozen as "unresolved for assessment planning", and `FULL_MOCK` cannot be started without a frozen exam instance by any path, including a Teacher assignment. The text below is the original B1 result, kept for the record.

All twelve certification gates are met in code and covered by tests (section P). The conditions are operational, not architectural:

1. **Uncommitted.** The work is in the working tree of `foundation/assessment-b1`; nothing was committed or pushed.
2. **Not exercised in a browser or against a live server.** Verification is typecheck plus 8,666 unit, contract and in-memory integration tests. No `next build`, no E2E.
3. **Hosted flag value still unread.** `CANONICAL_ENGINE_V1_ENABLED` is set in hosted DEV, Preview and Production, but its value is encrypted and was not read (B0 X.8). B1 does not depend on it.
4. **One residual label-match writer.** `ensureCatalogMapping` still writes `MATCHED / EXACT_LABEL_MATCH` for concepts extracted from a Student's own content. B1 makes that link non-authoritative at the read boundary (TRANSITIONAL) instead of changing the writer, because switching it to `PROPOSED` needs a confirmation path that does not exist. DEV currently has 0 such links.
5. **One remaining non-instance `FULL_MOCK` entry.** A teacher-assigned exam intervention can still start an attempt stored as `FULL_MOCK` with no exam instance (`src/lib/student/teacher-intervention-execution.service.ts:764`). After B1 it can no longer receive learner-generated content, and it is classified as a Preparation Simulation, but its stored type and its label are unchanged.

---

# A. Baseline

| Item | Value |
|---|---|
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-assessment-b1` |
| Branch | `foundation/assessment-b1`, created from `1b38bd7` (`remediation/t1-micro-delta`) |
| Start SHA | `1b38bd715f9f4d7d2be0e3a7b6852455196beec4` |
| `git merge-base --is-ancestor b8f21f4 HEAD` | TRUE |
| `git merge-base --is-ancestor 1b38bd7 HEAD` | TRUE |
| Working tree at start | clean except the copied, untracked B0 report |
| Migrations in repo | 69 files, last `20261107_1000_exam_target_session_and_aspiration.sql` |
| DEV ledger (read-only check) | 70 rows (baseline + 69), last `20261107_1000` — matches the repo |
| Baseline tests | `npx vitest run`: **483 files, 8,532 tests, all passing**. No pre-existing failure |
| Baseline typecheck | `npx tsc --noEmit`: clean |
| Untouched branches | `remediation/t1-account-profile`, `remediation/t1-final-delta`, `remediation/t1-micro-delta` |

Dependencies: `node_modules` is a symlink to the micro-delta worktree's (identical `package-lock.json`); it is git-ignored.

Micro-delta behaviours preserved: `subject-curriculum-topics.ts`, `preparation.service.ts` and `subject-catalog.ts` were **not modified** in B1. `tests/unit/t1-micro-delta.test.ts`, `t1-final-delta.test.ts` and `t1-remediation.test.ts` pass unchanged.

---

# B. Architecture Implemented

```text
CURRICULUM AUTHORITY                                   src/lib/curriculum
  bootstrap.service.ts   <- exam vertical config / catalogue seed request rows here
  curriculum-scope.ts    CurriculumScope (one structure version)
        │
        ▼
CANONICAL CONCEPT IDENTITY                             src/lib/catalog
  concept-identity.ts            CANONICAL | TRANSITIONAL | UNRESOLVED
  concept-identity.service.ts    reads concept_catalog_mapping; one explicit link write
        │
        ▼
STUDENT ASSESSMENT CONTEXT                             AF/student-assessment-context(.service).ts
  = academic reference + CurriculumScopeRef[] + learner-state reference
    + PreparationContext (AF/preparation-context(.service).ts, over student_exam_profiles)
    + AssessmentIntent
        │
        ▼
QUESTION COVERAGE                                      AF/question-coverage(.service).ts
  ReviewedExamBankCoverageProvider   approved_items -> objective -> objective<->concept
  LearningItemCacheCoverageProvider  question_bank_candidates -> learner concept -> explicit link
        │
        ▼
QUESTION ELIGIBILITY                                   AF/question-eligibility.ts
  family boundaries + applicability + licence, delegating to isEligible / DEFAULT_ELIGIBILITY
        │
        ▼
BLUEPRINT CONTRACTS                                    AF/blueprint-contract.ts
  BlueprintRequirement (LEARNING | EXAM_PREPARATION | OFFICIAL_EXAM)
  [B2 shared solver — not built]
  BlueprintResult (READY | PARTIAL | INSUFFICIENT_COVERAGE)
        │
        ▼
GENERATED ASSESSMENT BOUNDARY                          AF/generated-assessment.ts
  exam: view of frozen exam_instances        learning: view of quiz_sessions
  official mock boundary                     src/lib/simulation/preparation-simulation.ts
  EvidenceAttribution contract               AF/evidence-attribution.ts   [B3 executes]
        │
        ▼
CONTINUATION                                           src/lib/lx/continuation.ts (extended)
  NextChallengeView (extended)               src/lib/experience/next-challenge.ts
  ExamGapCandidate (published need)          AF/exam-gap-candidate.ts
```

Not built, by design: solver, adaptive count, QUICK/BALANCED/DEEP, personalised exam assembly, attribution execution, any next-action producer, any UI beyond one prop.

---

# C. Contract Matrix

| Contract | B0 class | B1 status | File / type / service |
|---|---|---|---|
| CurriculumScope | EXTEND_EXISTING | **IMPLEMENTED** (extends `resolveCurriculumContext`: a `CurriculumOption` names a structure version; this loads it) | `src/lib/curriculum/curriculum-scope.ts` (`CurriculumScope`, `CurriculumScopeRef`, `buildCurriculumScope`, `nodesOfConcept`, `conceptsOfObjective`, `curriculumScopeGaps`); `curriculum-scope.service.ts` (`loadCurriculumScope`, `publishedScopeRefForSubject`, `scopeRefForObjective`) |
| StudentAssessmentContext | NEW_REQUIRED | **IMPLEMENTED** | `AF/student-assessment-context.ts` (`StudentAssessmentContext`, `AssessmentIntent`, `validateAssessmentIntent`, `composeStudentAssessmentContext`); `.service.ts` (`loadStudentAssessmentContext`) |
| PreparationContext | EXTEND_EXISTING | **EXTENDED** (projection of `StudentExamProfile`) | `AF/preparation-context.ts` (`projectPreparationContext`, `isPlannablePreparation`); `.service.ts` (`loadPreparationContext`, `loadPreparationContexts`) |
| QuestionCoverage | NEW_REQUIRED | **IMPLEMENTED** | `AF/question-coverage.ts` (`QuestionCoverage`, `QuestionRef`, `coverageOfReviewedBankItem`, `coverageOfLearningCacheItem`, `summarizeCoverage`); `.service.ts` (`QuestionCoverageProvider`, two providers, `loadQuestionCoverage`) |
| QuestionEligibility | EXTEND_EXISTING | **EXTENDED** (wraps `isEligible`) | `AF/question-eligibility.ts` (`evaluateQuestionEligibility`, `eligibleCandidates`) |
| BlueprintRequirement | EXTEND_EXISTING | **EXTENDED** (from `ActivityContract` and `FormPosition`) | `AF/blueprint-contract.ts` (`BlueprintRequirementSchema`, `learningRequirementFromActivityContract`, `officialRequirementFromFormPositions`) |
| BlueprintResult | EXTEND_EXISTING | **EXTENDED** (from `AssembledForm`) | `AF/blueprint-contract.ts` (`BlueprintResultSchema`, `officialResultFromAssembledForm`) |
| EvidenceAttribution | NEW_REQUIRED | **IMPLEMENTED** as contract; execution DEFERRED to B3 | `AF/evidence-attribution.ts` (`EvidenceAttribution`, `planEvidenceAttribution`, `attributionViolations`) |
| GeneratedAssessmentSnapshot | REUSE exam / EXTEND learning | **REUSED** (exam) / **EXTENDED** as a read projection (learning); persistence of new fields DEFERRED | `AF/generated-assessment.ts` (`snapshotFromExamInstance`, `snapshotFromQuizSession`) |
| NextAction / Continuation | EXTEND_EXISTING | **EXTENDED** (optional fields only) | `src/lib/lx/continuation.ts` (`AssessmentOriginContext`, `ContinuationTarget`, `LearningOrigin.assessment`, `LAUNCH.target`); `src/lib/experience/next-challenge.ts` (`assessment`, `estimate`) |
| ExamGapCandidate (§20) | reuse/extend existing gap type | **EXTENDED** from `ExamGap` | `AF/exam-gap-candidate.ts` |
| LearningActivity | NOT_NEEDED | not created (asserted by test) | — |
| PreparationProfile | NOT_NEEDED | not created (asserted by test) | — |

Shared vocabulary: `AF/families.ts` (`AssessmentFamily`, `AssessmentPath`, `COUNT_AUTHORITY`), `AF/known.ts` (`Known<T>`: KNOWN / UNKNOWN / NOT_APPLICABLE).

---

# D. Curriculum Authority

**B0 authority:** Curriculum owns structure versions, hierarchy, learning objectives and objective ↔ concept mappings. Exam Core may request rows; it is not a semantic authority.

| | |
|---|---|
| Current implementation (before) | `apply-vertical-config.service.ts` and `catalog/learning-links.service.ts` issued `INSERT`s into 10 curriculum-owned tables directly |
| Change | New `src/lib/curriculum/bootstrap.service.ts` holds those lookups and inserts as `ensure*` functions. Both Exam Core modules now call it. The SQL, natural keys, columns and order are the same as before |
| Why | One owner of the write path. A later change to curriculum semantics is made in the Curriculum domain, not in an exam config |
| Test | `b1-curriculum-bootstrap.test.ts`: six real vertical configs (Saber 11 Math, PAA, Cambridge 0580, IB Physics HL, PISA 2022, AICE 9709 AS) applied in dry run against a recording client; asserts nodes, objectives, versions, provenance and that blueprint targets use the returned objective ids. `b1-architecture.test.ts`: no file under `src/lib/exam-core` writes a curriculum-owned table |
| Backward compatibility | Existing rows and ids untouched. Idempotency and "never supersede a published version" preserved and tested. The dry-run transaction still governs the writes (the caller's client is passed in) |

Not changed: what the configs declare, the `EXAM_SECTION` node type, objective identity across versions. Nodes created this way are reported by `CurriculumScope` as `BOOTSTRAP_ASSESSMENT_SECTION`, not as curriculum hierarchy.

---

# E. Concept Identity

**B0 authority:** `canonical_concepts.id` is the identity; learner concepts are instances linked explicitly; label matching is not canonical.

Finding during reconciliation: the explicit link and its basis already exist (`concept_catalog_mapping.canonical_concept_id` + `mapping_method`). **No migration was needed.** The boundary was strengthened instead.

| | |
|---|---|
| Change 1 | `src/lib/catalog/concept-identity.ts`: `classifyConceptIdentity` returns `CANONICAL` (basis CREATED_FROM_CANONICAL / REVIEWED / SEEDED), `TRANSITIONAL` (label match only) or `UNRESOLVED` |
| Change 2 | `concept-identity.service.ts`: read functions over the mapping; never reads a label |
| Change 3 | `addConceptToStudentLearning` (exam bridge, "Reforzar") created a concept from a canonical concept and then linked it by **matching the label it had just copied**. It now writes the link explicitly with `linkLearnerConceptCreatedFromCanonical`, using the method the plan-enrolment path already writes for the same fact (`PLAN_ENROLLMENT`) |
| Why | The only place where a known canonical id was thrown away and re-derived by name |
| Test | `b1-curriculum-identity.test.ts`, `b1-integration-flows.test.ts` (explicit link, no label read, no overwrite of a conflicting link) |
| Backward compatibility | No row is rewritten. Existing `status = 'MATCHED'` readers behave as before. Evidence stays keyed on the learner concept |

**Backfill:** none. Classification is deterministic at read time: a concept whose key is `catalog:<uuid>` or `CANON_<HEX>` of the linked canonical id was created from it.

**DEV population under the B1 rule (read-only query, 101 learner concepts):**

| Identity | Count |
|---|---|
| CANONICAL, created from canonical (method) | 56 |
| CANONICAL, created from canonical (proved by key; these 10 were label-matched before B1) | 10 |
| CANONICAL, reviewed | 1 |
| TRANSITIONAL (label match only) | 0 |
| **UNRESOLVED** | **34** |

The 34 unresolved concepts stay unresolved. 46 of 85 evidence rows sit on them.

---

# F. Question Store Abstraction

Model B as frozen: two physical stores, unchanged, behind one contract.

| Store | Tables (unchanged) | Provider | Chain |
|---|---|---|---|
| `REVIEWED_EXAM_BANK` | `question_bank_items`, `approved_items` | `reviewedExamBankCoverageProvider` | item → learning objective → `objective_concept_mappings` (PUBLISHED) → canonical concepts |
| `LEARNING_ITEM_CACHE` | `question_bank_candidates` | `learningItemCacheCoverageProvider` | question → learner concept → explicit link → canonical concept |

- `loadQuestionCoverage(refs)` dispatches each reference to its store's provider and returns them in order.
- Neither provider reads the other's tables (asserted). **No item-to-item bridge was created.**
- In B1 contracts the per-student store is named a cache, not a question bank.

---

# G. Question Coverage

| Field | Reviewed bank | Learning cache |
|---|---|---|
| Question reference, store | KNOWN | KNOWN |
| Learning objectives | KNOWN (one) | UNKNOWN (generation does not populate it) |
| Canonical concepts | 0..N via objective mapping, role `UNSPECIFIED`, with the mapping's relation | 0..1 via the explicit link, role `PRIMARY`, with `linkAuthority` |
| Unresolved | `OBJECTIVE_HAS_NO_CONCEPT_MAPPING` | `LEARNER_CONCEPT_NOT_LINKED` |
| Curriculum applicability | KNOWN (the objective's structure version) | UNKNOWN |
| Exam applicability | KNOWN when the bank identity has an exam version | NOT_APPLICABLE |
| Question type, difficulty | KNOWN when recorded | KNOWN when recorded |
| Marks | KNOWN when in content | NOT_APPLICABLE |
| **Estimated time** | **UNKNOWN (no source)** | **UNKNOWN (no source)** |
| Provenance | OFFICIAL / LICENSED / STUDYUS_GENERATED / FIXTURE | GENERATED_UNREVIEWED |
| Licensing | KNOWN only when the item cites sources; otherwise UNKNOWN | NOT_APPLICABLE |
| Review / lifecycle | lifecycle state; `humanReviewed` true only with a human review row | not reviewed |

Honesty rules enforced by tests: no default for a missing value; an objective's concepts are not claimed to be equally assessed by an item; no weight field exists; a version with no bank identity is treated as a fixture.

Multi-concept readiness: `concepts` is an array with a role per concept (`PRIMARY` / `SUPPORTING` / `UNSPECIFIED`) and a basis (`ITEM_ATTRIBUTION` is defined and unused until item-level data exists).

---

# H. Question Eligibility

`evaluateQuestionEligibility(coverage, request)` returns eligible or a list of reasons. It permits; it does not select.

| Rule | Behaviour |
|---|---|
| Reviewed-bank delivery | Unchanged: `isEligible` with `DEFAULT_ELIGIBILITY` (CALIBRATED/ACTIVE, non-fixture for students, usage, alignment) |
| OFFICIAL_EXAM | Reviewed bank only; a mock use is forced even if the caller passes PRACTICE; exam version must match. A cached/generated item is refused regardless of policy flags |
| EXAM_PREPARATION | Reviewed bank by the practice rule; the Student's own cached content only if `allowUnreviewedInPreparation` is set, and only if canonically resolved |
| LEARNING | The Student's own VALIDATED cached questions; reviewed bank by the practice rule |
| Ownership | A cached item belongs to one Student |
| Applicability | Exam version, component, structure version, objectives, canonical concepts, question type |
| Concept authority | A concept reached only through a TRANSITIONAL link does not satisfy a canonical target unless the request allows it |
| Licensing | OFFICIAL / LICENSED provenance requires a known licence in {PUBLIC, LICENSED} |

Count: no function in this module returns or accepts a number of questions.

---

# I. Blueprint Foundation

One schema (`BlueprintRequirementSchema`, zod, strict) with optional policy blocks instead of a flat object: `targets`, `evidence`, `difficulty`, `diversity`, `time`, `exposure`, `emphasis`, `official`.

| Family | Required | Forbidden | Adapter from existing authority |
|---|---|---|---|
| LEARNING | `evidence`, at least one canonical target | `official`, `emphasis` | `learningRequirementFromActivityContract` — copies the engine's count range, difficulty, independence and pass bar verbatim |
| EXAM_PREPARATION | exam version | `official` | none yet (policy is B2); `emphasis.mayDeviateFromOfficialDistribution` is literally `true` |
| OFFICIAL_EXAM | `official` block with slots, `frozenSelectionRequired: true`, `adaptsToLearner: false` | `emphasis`, `evidence`, learner targets | `officialRequirementFromFormPositions` — one slot per blueprint position |

`BlueprintResult` statuses: `READY`, `PARTIAL`, `INSUFFICIENT_COVERAGE`. An official result is never `PARTIAL` and may only reference reviewed-bank questions. `officialResultFromAssembledForm` maps the existing form output; an incomplete form becomes `INSUFFICIENT_COVERAGE`, matching the existing `FORM_INCOMPLETE` rule.

Count authority is recorded as data (`COUNT_AUTHORITY`): evidence requirements, preparation policy, official blueprint. The requirement has no top-level count field; an unknown key is rejected.

Blueprint V2 is not read, imported or enabled by any B1 module.

---

# J. Evidence Attribution Contract

Implemented: the type, a pure planner (`planEvidenceAttribution`) and an invariant check (`attributionViolations`).

| Semantics | Encoded as |
|---|---|
| Multi-concept ≠ full credit for each | At most one `DIRECT` target per response; independent evidence only for a single PRIMARY target of an independent learning activity |
| SUPPORTING concept | `CONTRIBUTORY`, never independent |
| Objective-level coverage only | `UNDETERMINED` |
| No invented weights | `weight` is `UNKNOWN` |
| Exam evidence | Planned for `EXAM_PERFORMANCE`; requires `examScope`; the type contains no stage |
| Student has no instance of the concept | No evidence dimension; reported, not dropped |

Deferred to B3: consuming an attribution in `updateMastery`'s callers, the validity-for-purpose rule for exam evidence, the replay comparison. **`updateMastery`, Knowledge State and evidence weighting are unchanged**; `src/services/mastery.service.ts` is still the only file that inserts into `learning_evidence` (asserted).

---

# K. Generated Assessment

- **Exam:** `snapshotFromExamInstance` is a view of the existing frozen `exam_instances.form`. No table, no copy, no second instance system.
- **Learning:** `snapshotFromQuizSession` projects what `quiz_sessions` already stores (`canonical_activity_contract`, policy version, stage, concept ids, question count, delivery source). A legacy session reports UNKNOWN for what it never recorded.
- **Persistence deferred:** family policy id, intended coverage and selection rationale for learning and preparation are not persisted in B1. Nothing computes them until the B2 solver exists.

---

# L. Official Mock Boundary

| | |
|---|---|
| Before | `POST /api/simulation/attempts` accepted `FULL_MOCK`; unfilled positions could be filled by AI generation keyed to the Student's own concepts |
| Change 1 | The route rejects `FULL_MOCK` with `409 OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE` and names the canonical path. `TOPIC_EXAM`, `DOMAIN_EXAM`, `MINI_MOCK` start as before |
| Change 2 | `sourceExamItem` refuses the generated fallback for any official-format attempt: a MOCK/CHALLENGE instance, or a `FULL_MOCK` with no instance. Reported with the existing reason `NO_ITEM_GENERATED` |
| Change 3 | The exam-prep page passes only preparation types to the start panel (one prop) |
| Naming | `src/lib/simulation/preparation-simulation.ts`: `assessmentPathOf` → `OFFICIAL_MOCK` only for a frozen MOCK/CHALLENGE instance; the direct path is `PREPARATION_SIMULATION` |
| Unchanged | The canonical path: exam instances freeze the form before starting, and a non-practice instance never leaves a position to be generated |
| Test | `b1-official-mock-boundary.test.ts` invokes the real route handler and `sourceExamItem` |

Note found during implementation: an exam instance starts its attempt with stored type `FULL_MOCK` for every mode, including PRACTICE. So `simulation_type` does not indicate fidelity; the instance does. The boundary is written on that basis, and practice instances keep their existing fallback.

Residual: see condition 5.

---

# M. Student Assessment / Preparation Context

- `loadStudentAssessmentContext(studentId, intent)` composes `loadResolvedStudentContext`, the concept identities, the preparation context and published scope references. It returns issues instead of a context when the intent breaks a family boundary (for example an official exam with learner-chosen targets, or a target owned by another Student).
- It holds identities and references only: no mastery or knowledge-state value, no curriculum copy, no question content (asserted on the serialised object).
- `PreparationContext` represents qualification (free text), subject, level, exam versions, intended session, target date and target result **where the record states them**. Component/paper is `UNKNOWN`: no column records it. The intended session is read from `target_exam_series` + `target_exam_year` only.

---

# N. Continuation / Next Action

Extended in place, additive and optional:

- `LearningOrigin.assessment?: AssessmentOriginContext` — family, exam target, exam attempt.
- `ContinuationResolution` LAUNCH `target?: ContinuationTarget` — the concept a launch acts on when the authority names another one.
- `NextChallengeView` READY `assessment?`, `estimate?`.
- Helpers: `continuationConcept`, `isCrossConceptContinuation`, `withAssessmentContext`.

`CONTINUATION_CONTRACT_VERSION` stays 1. Nothing populates the new fields yet, so every resolution produced today is unchanged. `resolveContinuation` is still the only exported continuation resolver (asserted). No ranking policy was added.

`ExamGapCandidate` carries evidence, exam target, severity, relevance and date context. Its schema is strict: `putIntoToday`, `nextLearningActivity` or `priority` are rejected. It is not wired into the Learning Decision Authority; that is later work.

---

# O. Migrations

```text
NONE
```

Reason: the explicit learner ↔ canonical link, its basis column and every field the contracts read already exist. Snapshot persistence was deferred instead of adding columns nothing fills.

---

# P. Tests

Commands, run in `/Users/jalbornoz/PROYECTOS/studyos-assessment-b1`:

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean (covers `src` and `tests`) |
| `npx vitest run` (before B1) | 483 files, 8,532 tests, 0 failures |
| `npx vitest run` (after B1) | **490 files, 8,666 tests, 0 failures** |
| `npx vitest run tests/unit/b1-*.test.ts` | 7 files, 134 tests, 0 failures |

New tests by level:

| Level | File | Tests |
|---|---|---|
| Domain / contract | `b1-curriculum-identity.test.ts` | 17 |
| Domain / contract | `b1-question-coverage-eligibility.test.ts` | 22 |
| Domain / contract | `b1-blueprint-attribution-snapshot.test.ts` | 41 |
| Integration (in-memory SQL router) | `b1-integration-flows.test.ts` | 12 |
| Integration (recording client, real configs) | `b1-curriculum-bootstrap.test.ts` | 11 |
| Integration + boundary (real route handler) | `b1-official-mock-boundary.test.ts` | 12 |
| Architecture | `b1-architecture.test.ts` | 19 |

Backward compatibility is covered by the 8,532 pre-existing tests, which pass with one edit: `tests/unit/qb-student-delivery-policy.test.ts` lists the files that read `approved_items`; the coverage provider was added to its non-delivery list, with a comment, because it describes items and delivers none.

During the work one run failed (2 tests, that same file) and was fixed as described. No test was weakened or skipped.

Not run: `next build`, lint (no lint script exists), any browser or HTTP E2E, `db:migration-test` (no migration).

---

# Q. Regression Assessment

| Boundary | Assessment |
|---|---|
| T1 | `t1-remediation`, `t1-final-delta`, `t1-micro-delta`, `student-onboarding-gate` pass unchanged. Micro-delta files untouched |
| T2 | No T2 code exists; nothing modified. `CurriculumScope` gives T2 the chain to validate |
| Learning / LX | No decision, generation, grading or evidence code changed. Continuation and next-challenge got optional type fields only |
| Question Bank / Q1 | No QB service, lifecycle, review, health or demand code changed. One guard test list updated |
| Exam Core | `apply-vertical-config` and `learning-links` route their curriculum writes through the boundary; `item-sourcing` gained the fallback guard. Exam instances untouched |
| Verticals | Six real configs still materialise (tested); no config changed |
| Historical attempts, evidence, mastery | No write path, schema or reader changed |
| Today / My Path / Progress | No file changed |

Behaviour changes a user or operator can observe:

1. `POST /api/simulation/attempts` with `FULL_MOCK` now returns 409.
2. The simulation start panel on the exam-prep page no longer lists a full mock.
3. A teacher-assigned full-mock intervention with no bank item for a position now shows that position as unavailable instead of an AI-generated item.
4. "Reforzar" links the new concept explicitly; it can no longer fail with a label mismatch.

Remaining for B4/B5: browser E2E of the exam-prep page and the start panel; the teacher-intervention label.

---

# R. Known Data Gaps

Unchanged by B1 and still visible through the contracts. None is an architecture failure.

| Gap (DEV, read-only) | How it appears in B1 contracts |
|---|---|
| 0 student-eligible exam items; 0 human review rows | `evaluateQuestionEligibility` returns `BANK_DELIVERY_RULE`; `humanReviewed` false |
| 207 of 460 objectives without a concept mapping | coverage `UNRESOLVED / OBJECTIVE_HAS_NO_CONCEPT_MAPPING`; `curriculumScopeGaps.objectivesWithoutConcept` |
| 34 of 101 learner concepts without a canonical link | identity `UNRESOLVED`; coverage `LEARNER_CONCEPT_NOT_LINKED` |
| 282 of 283 structure nodes are exam sections | `curriculumScopeGaps.hierarchyIsBootstrapOnly` |
| Both prerequisite graphs empty | not read by B1 |
| No score conversion models, no Cambridge thresholds | not read by B1 |
| No item cites a source | `licensing` UNKNOWN |
| No estimated time anywhere | `estimatedSeconds` UNKNOWN |
| Exam evidence without `examScope` | `planEvidenceAttribution` refuses to plan exam evidence without a scope |
| No target grade recorded | `targetResult` UNKNOWN |

No content, mapping or reference data was created. Tests use their own fixtures.

---

# S. B2 Readiness

B2 can consume:

- `loadStudentAssessmentContext` — one input for any family, with intent validation.
- `loadCurriculumScope` and the scope helpers — objectives and concepts of a pinned version.
- `loadQuestionCoverage` over both stores, and `evaluateQuestionEligibility` / `eligibleCandidates` — the candidate universe per family.
- `BlueprintRequirementSchema` with two working adapters (learning from the canonical contract, official from blueprint positions), and `BlueprintResultSchema`.
- `planEvidenceAttribution` / `attributionViolations` — for B3.
- `assessmentPathOf` — the official vs preparation distinction for any attempt.
- `examGapCandidatesFrom` — published needs, as an input to an Exam Preparation policy.

B2 must still build: the solver, the EXAM_PREPARATION policy and its requirement adapter, multi-concept learning requirements, persistence of the learning snapshot.

```text
B2_GO_WITH_CONDITIONS
```

Conditions:

1. B1 is reviewed and committed on `foundation/assessment-b1`.
2. The exam-prep start panel and the 409 on the legacy route are checked once in a running DEV build.
3. A decision on the teacher-assigned `FULL_MOCK` intervention: route it through an exam instance, or relabel it as preparation.
4. A decision on whether `ensureCatalogMapping` should write `PROPOSED` instead of `MATCHED`, which needs a confirmation path for the Student or an admin.

---

# T. B1-C — Final Closure

Date: 2026-10-10. Scope: close the B1 operational conditions, freeze two semantic decisions, reconcile T1, validate at build and runtime. B2 was not started.

The B1-C brief as received ended mid-sentence at gate item 10 ("TRANS…"). Items 1–9 are assessed as written; item 10 is taken to be the TRANSITIONAL consumption rule of brief section 4.

## T.1 Result

```text
FOUNDATION_PASS_WITH_CONDITIONS
```

| # | Gate | Result |
|---|---|---|
| 1 | B0 report in version control | PASS — `73c303a` |
| 2 | B1 committed and traceable | PASS — `5ea60e5` |
| 3 | Latest required T1 delta reconciled | PASS — `c2f8924` merged in `d503920`, no conflicts |
| 4 | Test suite green | PASS — 492 files, 8,693 tests, 0 failures |
| 5 | Typecheck green | PASS |
| 6 | Production build has no B1-caused failure | PASS — `next build` exit 0 |
| 7 | DEV smoke confirms the simulation-start behaviour | **PARTIAL** — API confirmed live; the start panel could not be observed on a live page (T.4) |
| 8 | `FULL_MOCK` without `exam_instance` cannot be created by any active path | PASS — enforced in the single start function |
| 9 | Teacher-assigned official mocks obey the invariant | PASS |
| 10 | TRANSITIONAL is not usable for assessment planning (inferred) | PASS |

Why not an unqualified `FOUNDATION_PASS`:

1. **Gate 7 is partial.** The only DEV profile that renders the legacy start panel belongs to a real account, which I did not sign in as. The panel was verified by rendering the real component and by the prop in the built page, not on a live page.
2. **One semantic question is open (T.3, row "practice instance").** An exam instance in PRACTICE mode still stores its attempt as `FULL_MOCK` and may fill an unfilled position with generated content. It is classified and labelled as exam practice, not as a mock, but the stored value is unchanged.

## T.2 Changes made in B1-C

| B0 authority / contract | Before | Change | Test | Backward compatibility |
|---|---|---|---|---|
| Official mock invariant | `startSimulationAttempt` accepted `FULL_MOCK` from any caller | Throws `FullMockRequiresExamInstanceError` unless the caller passes `examInstanceId` and the frozen form (`presetItems`); checked before any read or write | `b1c-full-mock-invariant.test.ts` (real function) | Other types unaffected; `startExamInstance` passes its id |
| Teacher-assigned exam practice | A Teacher `FULL_MOCK` intervention started a direct attempt with no instance | `startInterventionExamAttempt`: a preparation type starts directly; a full mock is created as a MOCK exam instance over all simulation-capable components, frozen, then started. If no official form can be frozen the assignment is not startable | same file + source guards in `b1-official-mock-boundary.test.ts` | Stored interventions and historical attempts untouched; eligibility gate still unconditional and inside the same transaction |
| Attempt naming | Attempt and result pages labelled every instance attempt by its stored type ("Simulacro completo"), including practice instances | `attemptKindLabelKey`: an instance attempt is labelled by the instance mode; a non-instance attempt keeps its type label | `b1c-full-mock-invariant.test.ts` | Presentation only |
| Concept identity consumption | `TRANSITIONAL` links appeared in coverage with a `linkAuthority` marker and could be accepted by a policy flag | `canonicalConceptIdForAssessment` is the one rule. A TRANSITIONAL link is not coverage: `concepts` is empty, resolution is `UNRESOLVED / LEARNER_CONCEPT_LINK_TRANSITIONAL`, the id is kept only in `unconfirmedConceptId`. The `allowTransitionalConceptLinks` policy flag was removed. `learnerConceptFor` returns CANONICAL links only | identity, coverage, eligibility, attribution and integration tests | `ensureCatalogMapping` (the writer) is unchanged; legacy readers of `status = 'MATCHED'` unchanged |

Two pre-existing guard tests were updated to the new call shape without weakening what they guard: `f11c4-exam-execution-source-guard.test.ts` (the attempt is still created inside the transaction; call name changed) and `e2e-object-authorization.test.ts` (the attempt subtitle is still a localized label, never a raw enum).

## T.3 Official Mock Invariant

```text
FULL_MOCK ⇒ frozen exam_instance
```

Enforced at `startSimulationAttempt` (`src/lib/simulation/attempt.service.ts`), the only function that creates a simulation attempt.

| Producer | exam_instance required? | Official? | Status |
|---|---|---|---|
| `POST /api/simulation/attempts` (Student, direct) | n/a — cannot produce `FULL_MOCK` | No (Preparation Simulation) | Rejects `FULL_MOCK` with 409 before any access check; confirmed at runtime |
| `POST /api/exams/instances/[id]/start` → `startExamInstance`, instance mode MOCK / CHALLENGE | Yes | **Yes** | Complies: form frozen at creation, eligible reviewed content only, incomplete form refused, no generated content |
| Teacher intervention, assigned `FULL_MOCK` | Yes (created by `startOfficialMockForIntervention`) | **Yes** | Complies since B1-C; not startable when no official form exists |
| Teacher intervention, `TOPIC_EXAM` / `DOMAIN_EXAM` / `MINI_MOCK` | No | No (Preparation Simulation) | Not a `FULL_MOCK` |
| `startExamInstance`, instance mode **PRACTICE** | Yes | **No** (exam practice) | Stored type is `FULL_MOCK` for every instance mode (a plan-shape selector). Has an instance and a frozen form, so `FULL_MOCK ⇒ exam_instance` holds. It may still fill an unfilled position with generated content. **Open for a ruling** |
| Any other caller of `startSimulationAttempt` with `FULL_MOCK` | — | — | Impossible: throws |
| Historical attempts | — | — | Read as before; no row rewritten |

Open ruling on the practice-instance row. Two ways to close it, neither done here because both change Exam Preparation behaviour:

- Store a non-`FULL_MOCK` type for practice instances (touches plan building and delivery-policy checks keyed on the type).
- Forbid generated fallback for every stored `FULL_MOCK` (practice instances would show an unfilled position as unavailable).

## T.4 Runtime Validation

**Build.** `npx next build` → exit 0, compiled, 228 static pages generated. The first attempt failed with "Symlink [project]/node_modules is invalid": classified **environment** (the worktree's dependencies were a symlink). Replaced with a real copy; no code changed.

**DEV smoke.** The built app was served locally (`next start`, port 3107) with the DEV environment file, so the DEV database and the DEV Clerk instance. Authentication used the project's own DEV fixture identity `student-a` through `scripts/operations/track-a-fixtures.ts tokens` (passwordless session tokens; the script refuses any non-DEV database or Clerk instance). No browser sign-in was performed. Tokens were deleted afterwards.

| Check | Expected | Actual |
|---|---|---|
| `POST /api/simulation/attempts`, `FULL_MOCK`, unauthenticated | 401 | 401 |
| Same, authenticated, `UNTIMED` | 409 `OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE` | 409, body `{"error":"OFFICIAL_MOCK_REQUIRES_EXAM_INSTANCE","data":{"canonicalPath":"/api/exams/instances","allowedSimulationTypes":["TOPIC_EXAM","DOMAIN_EXAM","MINI_MOCK"]}}` |
| Same, authenticated, `OFFICIAL_SIMULATION_TIMED` | 409 | 409, same body |
| `GET /api/simulation/eligibility` (read) | 200 | 200; full mock not eligible: `NO_REAL_MOCK_CONTENT` |
| `GET /api/exams/instances` (official path) | 200, not blocked | 200, `{"instances":[]}` |
| `GET /api/exams/catalog/level` and `POST /api/exams/instances` MOCK | available only with content | 404 `NOT_AVAILABLE` for the nodes tried: the official path's own availability gate, with zero student-eligible content on DEV. The B1 boundary is not on this path |
| `GET /dashboard/exam-prep/<profile>` as `student-a` | 200 | 200. This profile resolves to a governed objective, so the page shows the objective-first preparation home. **It renders no simulation start panel and no full-mock option** |
| `GET /dashboard/exam-prep`, `GET /dashboard/today` | 200 | 200, 200 |

**Start panel.** Route: `/dashboard/exam-prep/[examProfileId]`, legacy branch (profiles with no resolvable objective). Expected options after B1: `MINI_MOCK`, `TOPIC_EXAM`, `DOMAIN_EXAM`. Not observed live (see T.1). Verified instead by `tests/unit/b1c-start-panel-render.test.ts`, which server-renders the real `StartSimulationPanel`: without the filter it offers `FULL_MOCK`; with the value the page now passes it offers `MINI_MOCK`, `TOPIC_EXAM`, `DOMAIN_EXAM`.

**Reforzar.** Not exercised at runtime: it needs an exam result with a gap, which no fixture identity has, and creating one would be fabricated data. Covered by `b1-integration-flows.test.ts` (explicit link, no label read).

**Writes during the smoke.** No Production access. On DEV: no exam, attempt or content row was created (every state-changing call was rejected). Authenticated requests may update the fixture user's own session bookkeeping; fixture tokens create Clerk DEV sessions.

No review rows, eligible items, mappings or scoring data were created. The DEV gaps of section R are unchanged.

## T.5 Concept Identity Consumption Rule

```text
CANONICAL     → usable
TRANSITIONAL  → unresolved for assessment planning
UNRESOLVED    → unresolved
```

One function decides it: `canonicalConceptIdForAssessment` (`src/lib/catalog/concept-identity.ts`).

B1 consumers, all compliant:

| Consumer | How it complies |
|---|---|
| QuestionCoverage (learning cache) | Only a CANONICAL identity produces a covered concept |
| QuestionEligibility | Reads coverage only; no policy can accept a TRANSITIONAL link; a non-learning request with unresolved coverage is `CONCEPT_UNRESOLVED` |
| BlueprintRequirement | Targets are canonical ids supplied by a caller; no learner link is read |
| EvidenceAttribution | Built from coverage; a TRANSITIONAL-only question is `unattributed` |
| StudentAssessmentContext | `learnerConceptFor` returns CANONICAL links only; the identity summary counts transitional separately |
| ExamGapCandidate | Uses the objective ↔ concept mapping; no learner link |

When this leaves no candidate, the contracts report `UNRESOLVED`, `CONCEPT_UNRESOLVED` or `INSUFFICIENT_COVERAGE`. Nothing guesses.

Remaining legacy consumers of `concept_catalog_mapping` that still treat every `MATCHED` row alike (outside B1, unchanged; for later blocks):

| Consumer | Use | Consequential for assessment? |
|---|---|---|
| `readiness/student-concept-resolution.service.ts` (`resolveStudentConceptForCanonicalConcept`) | canonical → learner concept | Yes — used by the next four |
| `simulation/scoring.service.ts` | which learner concept an exam response credits | Yes (B3) |
| `exam-core/item-sourcing.service.ts` | concept for generated fallback | Yes (B2) |
| `exam-core/objectives/preparation.service.ts`, `learning-plan/exam-bridge.service.ts` | preparation plan and gaps | Yes (B2) |
| `readiness/blueprint-coverage.service.ts`, `simulation/post-exam-diagnosis.service.ts`, `exam-core/exam-gaps.service.ts`, `exam-core/result-view.service.ts` | readiness, diagnosis, gap and result views | Yes (B2/B5) |
| `exam-core/question-bank/demand.service.ts` | demand counts | Aggregate (Q1) |
| `learning-plan/personal-plan.service.ts`, `class-plan.service.ts`, `subject-curriculum-topics.ts`, `teacher/*`, `student/teacher-intervention-execution.service.ts`, `services/learning-os-snapshot.service.ts` | plan enrolment, class views, display labels | Plan and display |
| `curriculum/private-content-alignment.service.ts`, `catalog/mapping.service.ts` | content alignment; the writer | Writer unchanged by decision |

DEV today has 0 TRANSITIONAL links (67 CANONICAL, 34 UNRESOLVED), so these readers currently see no label-only match.

Deferred data-governance capability, recorded and not implemented (`MAPPING_LIFECYCLE_DEFERRED`):

```text
AUTO DISCOVERY → PROPOSED → REVIEW / CONFIRMATION → CANONICAL
```

Not required for B2 as long as B2 refuses TRANSITIONAL mappings.

## T.6 Latest T1 Reconciliation

| Item | Value |
|---|---|
| Previous B1 base | `1b38bd7` |
| Reconciled SHA | `c2f8924` (`remediation/t1-micro-delta`) |
| Method | `git merge --no-ff c2f8924` on `foundation/assessment-b1`, merge commit `d503920` |
| Conflicts | None. `src/app/dashboard/exam-prep/[examProfileId]/page.tsx` auto-merged |
| Files resolved by hand | None |
| Both preserved | T1 polish (17 files) and the B1 `preparationSimulationTypes` prop on the same page |
| Result | typecheck clean; full suite green (the merge added 4 T1 tests) |

Not reconciled: `remediation/t1-micro-delta` has since moved to `5fe6d70` (one more commit, Cambridge display localization, 8 files including `PreparationHome.tsx` and `subject-curriculum-topics.ts`). It was not in the B1-C instruction and was left for a decision. None of the T1 branches was modified.

## T.7 Commits

| SHA | Content |
|---|---|
| `73c303a` | `docs(architecture): certify integrated assessment B0` — the B0 report only |
| `5ea60e5` | `feat(assessment): establish canonical assessment foundation` — B1 implementation, tests and this report as it stood |
| `d503920` | merge of `c2f8924` |
| (this commit) | B1-C closure: this section and `b1c-start-panel-render.test.ts` |

Nothing was pushed.

## T.8 Final Test Results

| Run | Files | Tests | Failures |
|---|---|---|---|
| Baseline before B1 (`1b38bd7`) | 483 | 8,532 | 0 |
| After B1 as first reported | 490 | 8,666 | 0 |
| After B1-C changes, before the merge | 491 | 8,686 | 0 |
| After merging `c2f8924` | 491 | 8,690 | 0 |
| **Final** | **492** | **8,693** | **0** |
| B1 / B1-C tests only (`tests/unit/b1*.test.ts`) | 9 | 157 | 0 |

`npx tsc --noEmit`: clean. `npx next build`: exit 0.

## T.9 B2 Entry

```text
B2_GO_WITH_CONDITIONS
```

1. A ruling on practice exam instances stored as `FULL_MOCK` (T.3).
2. One look at the legacy start panel on a live page, by someone who can sign in to a profile that shows it.
3. A decision on reconciling `5fe6d70`.
4. `CANONICAL_ENGINE_V1_ENABLED` hosted value still unconfirmed (carried from B0).

---

# U. B1-D — Final Semantic Closure

Date: 2026-10-10. Scope: practice attempt type, CHALLENGE verification, T1 through `091e91d`. B2 was not started.

## U.1 Result

```text
CHALLENGE_FULL_MOCK_INVARIANT_FAILED
```

B1 is **not** upgraded to `FOUNDATION_PASS`. Everything else in the B1-D gate passes:

| Gate | Result |
|---|---|
| PRACTICE writes `EXAM_PRACTICE` | PASS |
| MOCK writes `FULL_MOCK` | PASS |
| CHALLENGE proven official-fidelity before retaining `FULL_MOCK` | **FAIL** — see U.4 |
| No adaptive / generated path can create or fill a `FULL_MOCK` | PASS |
| Historical rows remain readable | PASS |
| Migration is additive | PASS |
| T1 reconciled through `091e91d` | PASS |
| Tests / typecheck / build | PASS |

CHALLENGE was left exactly as it was (stored as `FULL_MOCK`). It was not reclassified.

## U.2 Practice vs Official Attempt Semantics

| Exam instance mode | Stored attempt type | Official fidelity | Frozen form | Generated content |
|---|---|---|---|---|
| PRACTICE | **`EXAM_PRACTICE`** (new) | No — preparation | Positions frozen where the bank has items; unfilled positions stay open | Allowed under the preparation rule |
| MOCK | `FULL_MOCK` | Structure, timing and difficulty target are official; length may be reduced (U.4) | Required, complete or no form | Never |
| CHALLENGE | `FULL_MOCK` (unchanged, pending) | **No** (U.4) | Required, complete or no form | Never |
| none (direct path) | `TOPIC_EXAM` / `DOMAIN_EXAM` / `MINI_MOCK` | No — preparation simulation | No | Allowed under the preparation rule |

`EXAM_PRACTICE` — exam-instance-based preparation over the instance's selected components and positions. It may be full-length. It is not an official mock.

Write authority: only `startExamInstance`, through `attemptTypeForInstanceMode(instance.mode)`. `startSimulationAttempt` refuses `EXAM_PRACTICE` unless a PRACTICE instance starts it, and refuses `FULL_MOCK` unless a MOCK / CHALLENGE instance with a frozen form starts it. Both checks run before any read or write.

Behaviour preserved for practice instances:

- **Positions:** `EXAM_PRACTICE` selects every position of the selected components, narrowed by focus objectives, exactly as `FULL_MOCK` did for a practice instance. It does not consult the mini-mock readiness subset (tested against `MINI_MOCK` on the same blueprint: 5 positions vs 2).
- **Delivery policy:** resolved policy is identical to before. The per-version allow-list governs client-requestable modes and does not list `EXAM_PRACTICE`; timing-mode rules still apply.
- **Feedback, timing, focus objectives, selected components:** unchanged.

Client authority is not widened: the direct start route, the eligibility route and the Teacher assignment schema still enumerate only their previous values, so a submitted `EXAM_PRACTICE` is `INVALID_INPUT`. The start panel list and the version delivery-policy schema do not contain it.

Generated fallback rule, final: **never for a stored `FULL_MOCK`, with no exception**; never for a MOCK / CHALLENGE instance; allowed for `EXAM_PRACTICE` and the three direct preparation types.

Naming note: the Teacher-intervention domain already has an unrelated `intervention_type` / `execution_type` value also spelled `EXAM_PRACTICE` (a different column and meaning). It was not touched.

## U.3 Migration

`database/migrations/20261108_1000_simulation_type_exam_practice.sql`

| | |
|---|---|
| WHY | `FULL_MOCK` must mean an official mock only; a practice instance needs its own persisted type |
| DATA IMPACT | Widens two CHECK constraints (`simulation_plans_type_check`, `simulation_attempts_type_check`) to also accept `EXAM_PRACTICE`. No column, no row touched |
| BACKFILL | None. Historical practice attempts stored as `FULL_MOCK` are not rewritten |
| ROLLBACK / RISK | Restore the two previous CHECKs; possible only while no row stores `EXAM_PRACTICE` |
| OLD-READER COMPATIBILITY | Old code never writes or expects the new value; it keeps working on a migrated database |
| NEW-READER COMPATIBILITY | New code reads historical `FULL_MOCK` practice rows through the instance mode (label and path) |

**Deployment order (required):** apply the migration to an environment **before** deploying code that writes `EXAM_PRACTICE` there. With code first, starting a practice exam instance fails the CHECK and is rejected.

**Not applied anywhere by this work.** The DEV ledger still ends at `20261107_1000`. `teacher_interventions` is deliberately not widened.

## U.4 CHALLENGE — why the invariant fails

Current behaviour, from the repository:

| Property | CHALLENGE today | Evidence |
|---|---|---|
| Frozen exam instance | Yes | `createExamInstance` freezes every non-practice instance at creation and deletes it if assembly fails |
| Complete form or none | Yes, relative to the stored blueprint | `freezeForm` throws `FORM_INCOMPLETE` when any position is unfilled |
| Official timing | Yes | `timingFor` returns `OFFICIAL_SIMULATION_TIMED` for every non-practice mode |
| No generated fallback | Yes | non-practice positions are preset `EXCLUDED`; fallback rule refuses `FULL_MOCK` |
| Not adapted to learner weakness | Yes | selection uses blueprint fit, difficulty target and exposure only |
| **Official difficulty** | **No** | `CHALLENGE_TARGET = 1.1`, band 1.05–1.15: deliberately harder than the real exam. MOCK targets 1.0 (`src/lib/exam-core/form-assembly.ts`) |
| **Full official length** | **Not guaranteed** | when the blueprint is shorter than the component's official item count, a non-practice instance draws `REDUCED_MOCK` items and the form's fidelity is `REDUCED` (`formInputs`, `assembleForm`) |

So CHALLENGE is frozen, complete against its blueprint, officially timed and never generated — but it is by design not the official difficulty, and it can be a reduced form. It is not a complete official-form assessment in the sense of the frozen invariant.

**The reduced-length finding also applies to MOCK.** A MOCK instance on a reduced blueprint is stored as `FULL_MOCK` while the product itself calls it a reduced mock (`exv2.mode.MOCK.reduced`, delivery use `REDUCED_MOCK`). On DEV only the Saber 11 Mathematics blueprint is at official length; the others are reduced forms. This was outside the CHALLENGE question as asked, and it is reported because it is the same ambiguity.

Recommended minimal additive option (not implemented):

- `EXAM_CHALLENGE` for CHALLENGE instances: frozen, officially timed, official structure, above-official difficulty; not official-fidelity.
- `REDUCED_MOCK` for a MOCK instance whose frozen form is not full-length; `FULL_MOCK` only when the form is full-length (`fidelity = FULL`, delivery use `FULL_MOCK`).
- One further additive migration widening the same two CHECKs; the same single writer (`attemptTypeForInstanceMode`, taking the frozen form's fidelity); no backfill.
- Both new types keep "frozen instance required" and "no generated content", so the start and fallback rules extend from `FULL_MOCK` to the three frozen types.

`tests/unit/b1d-exam-practice.test.ts` contains a characterization suite for CHALLENGE recording what holds and what does not.

## U.5 FULL_MOCK producer matrix (final for this pass)

| Producer | Instance mode | Stored type | Frozen form required | Generated fallback allowed | Correct? |
|---|---|---|---|---|---|
| `startExamInstance` (Student, `POST /api/exams/instances/[id]/start`) | MOCK | `FULL_MOCK` | Yes | No | Yes for structure, timing, difficulty; **length may be reduced** (U.4) |
| `startExamInstance` | CHALLENGE | `FULL_MOCK` | Yes | No | **No** — above-official difficulty, may be reduced (U.4) |
| `startExamInstance` | PRACTICE | `EXAM_PRACTICE` | n/a | Yes (preparation) | Yes — no longer a `FULL_MOCK` producer |
| Teacher intervention, assigned `FULL_MOCK` → `startOfficialMockForIntervention` | MOCK | `FULL_MOCK` | Yes | No | Same as the MOCK row |
| Teacher intervention, `TOPIC_EXAM` / `DOMAIN_EXAM` / `MINI_MOCK` | none | as assigned | No | Yes (preparation) | Yes — not `FULL_MOCK` |
| `POST /api/simulation/attempts` (direct) | none | `TOPIC_EXAM` / `DOMAIN_EXAM` / `MINI_MOCK` | No | Yes (preparation) | Yes — `FULL_MOCK` → 409, `EXAM_PRACTICE` → 400 |
| Any other call to `startSimulationAttempt` with `FULL_MOCK` | — | — | — | — | Impossible: throws before any read |

Invariant as enforced in code: stored `FULL_MOCK` → instance mode MOCK or CHALLENGE → frozen form required → generated fallback never. The active exception to the *intended* invariant (`instance.mode = MOCK` only, official fidelity) is CHALLENGE, plus reduced-length MOCK forms.

## U.6 Runtime Validation (reclassified)

Legacy start panel: **`PASS_WITH_TESTED_UI_PATH`**. No real user account was signed into. The evidence is the live authenticated API smoke (409 for `FULL_MOCK`), server-rendering of the real panel component in a test (it offers only mini mock, topic and domain with the value the page passes), the unit tests of the filter, and the production build. The rest of T.4 stands.

No new runtime smoke was run in B1-D: the practice-instance start cannot be exercised on DEV without eligible content, and `EXAM_PRACTICE` cannot be written there until the migration is applied.

## U.7 Latest T1 Reconciliation

| Item | Value |
|---|---|
| Previously included | `c2f8924` |
| Now included | `5fe6d70` and `091e91d` (tip of `remediation/t1-micro-delta` at the time) |
| Method | `git merge --no-ff 091e91d`, merge commit `676afe1`, after the B1-D commit |
| Conflicts | None; nothing resolved by hand |
| Content | Cambridge display localization; governed concept labels for the recommendation card. No migration, no attempt semantics, no concept linkage, no curriculum-domain change |
| Contradiction with a frozen authority | None found in the merged result |

## U.8 Commits

| SHA | Content |
|---|---|
| `7382bb6` | `feat(assessment): EXAM_PRACTICE attempt type for practice exam instances (B1-D)` |
| `676afe1` | merge of `091e91d` |
| (this commit) | this section |

Nothing was pushed.

## U.9 Final Test Results

| Run | Files | Tests | Failures |
|---|---|---|---|
| End of B1-C | 492 | 8,693 | 0 |
| After the B1-D change | 493 | 8,716 | 0 |
| **After merging `091e91d`** | **493** | **8,720** | **0** |
| B1 tests only (`tests/unit/b1*.test.ts`) | 10 | 180 | 0 |

`npx tsc --noEmit`: clean. `npx next build`: exit 0, 228 static pages.

During the work the first full run after adding the type failed 8 tests, all in B1's own test files plus the migration-chain assertion; each asserted the previous stored type or migration list and was updated to the new behaviour.

## U.10 B2 Entry

```text
B2_NO_GO
```

One decision stands between this and `B2_GO`: how CHALLENGE (and reduced-length MOCK forms) should be stored, given that neither is an official-fidelity full mock. Two operational items follow it: apply `20261108_1000` on DEV before deploying this branch there, and the carried-over confirmation of `CANONICAL_ENGINE_V1_ENABLED` on hosted environments.
