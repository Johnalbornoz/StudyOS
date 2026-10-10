# B1 — Canonical Assessment Foundation: Certification

Date: 2026-10-10. Canonical architecture source: `docs/audits/B0_INTEGRATED_ASSESSMENT_ARCHITECTURE_CERTIFICATION.md` (sections X.9–X.16).

Paths are relative to the repo root. `AF/` = `src/lib/assessment-foundation/`.

# 0. Executive Result

```text
FOUNDATION_PASS_WITH_CONDITIONS
```

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
