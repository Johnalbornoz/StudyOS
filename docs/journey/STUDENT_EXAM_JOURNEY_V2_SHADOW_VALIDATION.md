# Student Exam Journey V2 — shadow validation (J2)

- **Baseline:** `8b76197` on `design/student-exam-journey-v2`. Date: 2026-10-05. Evaluation day (`asOf`): 2026-10-05.
- **Verdict:** `LOCAL_SHADOW_VALIDATED`. **Not** `DEV_SHADOW_VALIDATED` (hosted activation did not happen; see §0).
- **Recommendation:** `READY_FOR_J1_J3_DESIGN` (§H).

---

## 0. How the shadow was validated

| Source | What | Writes |
|---|---|---|
| **Real DEV data**, read-only | The real loader + resolver (`resolveStudentExamJourneys`) and the app's own current decision code run locally against the DEV database (fingerprint `2a29b99ee14a22b4`, ledger 60). A runtime guard refused anything but `SELECT`/`WITH`. Only test identities were read: 9 `+clerk_test@example.com` fixtures, 19 `synthetic-*` learners, 1 cert fixture (29 in all). The 6 other accounts were not read. | none |
| **Ephemeral copy** | A throwaway local Postgres 18 built from the repo: baseline + 59 migrations + the DEV operator steps (`track-b-v2-apply --write`, `track-b-v2-learning-catalog --write`). Controlled scenarios were created **only through real StudyUs services**: `createObjectivePreparation`, `createExamInstance`, `startExamInstance`, `getNextSimulationItem` / `submitSimulationItemAnswer`, `completeSimulationAttempt`, `finalizeExamCompletion`. No fixture row was inserted as content, and nothing was marked valid content. Destroyed after each run. | throwaway only |
| **Unit / contract tests** | `tests/unit/journey-*.test.ts` | — |

**Hosted DEV activation: not done.**
- Hosted shadow needs (a) a DEV deployment carrying `STUDENT_JOURNEY_V2=SHADOW` and (b) signed-in fixture Students hitting the Exam Prep pages, so that `[journey-shadow]` lines appear in the runtime logs.
- (a) changes the shared DEV environment/alias, which other tracks also move. Earlier sessions established that env/alias changes are operator actions.
- (b) requires minting sessions for fixture identities, which was previously blocked as credential materialization.
- None of it was improvised.

**Operator steps** to obtain `DEV_SHADOW_VALIDATED` later (no code change needed):

```
git archive 8b76197+<this commit> | tar -x -C <scratch>   # copy .vercel/project.json
npx vercel@latest deploy --target dev --env STUDENT_JOURNEY_V2=SHADOW --env STUDYUS_COMMIT_SHA=<sha>
# sign in as a fixture Student, open /dashboard/exam-prep, then:
npx vercel@latest logs <deployment> | grep '\[journey-shadow\]'
# or, signed in: GET /api/exam-preparation/journey   (internal diagnostic, 404 when the flag is off)
```

**"Current behaviour"** means the app's own decision code on this branch (gate, first destination, `getPreparationView().next`, capability status) evaluated on the same data. Student UX was not driven in a browser.

---

## A. Shadow validation matrix

| Case | Data | Current behaviour | Journey V2 result | Expected | Verdict | Notes |
|---|---|---|---|---|---|---|
| **S1** institution learner, curriculum, no target | real DEV: `synthetic-02/03` (class bound to an institution curriculum) | Today; no exam surface forced | learner `ACADEMIC_PATH_DEFINED` / `INSTITUTION`, `requiresAcademicInput=false`; `NONE / NO_EXAM_TARGET → CONTINUE_LEARNING` | context recognised, nothing forced | **PASS** | 16 more synthetic learners are in classes **not** bound to a curriculum: the resolver says `NO_ACADEMIC_PROFILE` (the institution's grade programme is not read yet) → M6 |
| **S2** institution learner with active target | real DEV: `studyus-ta-student-a` (2 classes, 1 programme) + IB Math AA SL target | gate ALLOWED; Exam Prep next = `DIAGNOSTIC` | context `INSTITUTION`, no re-onboarding; `HORIZON / EXAM_PREPARATION_NOT_DUE → SET_EXAM_DATE`; blocker `EXAM_DATE_UNKNOWN`; mock reduced (26 %) startable, not recommended | context reused, state consistent | **PASS_WITH_EXPECTED_DIFFERENCE** | M1 (no date). DEV has 0 `class_exam_assignments`, so the *institution-assigned* target path is covered by unit tests only |
| **S3** independent PAA, no subjects | ephemeral (the DEV PAA fixture is reserved for manual E2E and has no target: left untouched) | gate: Exam Prep ALLOWED, Today ALLOWED; `/` → `/dashboard/exam-prep`; next `DIAGNOSTIC` | `EXAM_ONLY_PROFILE`; `ACTIVATION / DIAGNOSTIC_DUE → START_DIAGNOSTIC` | Exam Prep reachable, no loop | **PASS** | next action matches; J0 holds on the real schema |
| **S4** subjects, no target | real DEV: `studyus-tb-objective` | Today ALLOWED | `ACADEMIC_PATH_DEFINED` / `STUDENT`; `NO_EXAM_TARGET → CONTINUE_LEARNING`; no target manufactured | normal Learning OS | **PASS** | targets come only from preparations and class exam assignments |
| **S5** Blueprint incomplete | ephemeral: `cie.igcse.0580.core` (catalogue-only) | next `EXPLORE_LEARNING`, status "canAdd" | blocker `BLUEPRINT_INCOMPLETE:STRUCTURE`; `HORIZON`; mock `UNAVAILABLE`, not startable; `NOTIFY_WHEN_AVAILABLE` | `BLUEPRINT_INCOMPLETE`, never mock-ready | **PASS_WITH_EXPECTED_DIFFERENCE** | M3 |
| **S6** Blueprint ok, bank insufficient | ephemeral: `ib.dp.language-a-literature.sl` (structure only) | next `REVIEW_STRUCTURE` | blockers `CONTENT_UNAVAILABLE` (PRACTICE, DIAGNOSTIC, MOCK); **no** `BLUEPRINT_INCOMPLETE`; `REVIEW_STRUCTURE` | `CONTENT_UNAVAILABLE` | **PASS** (after fix) | the first run reported `BLUEPRINT_INCOMPLETE`: BUG_JOURNEY-1, fixed. Full mocks: PAA 21 %, IB AA SL 26 %, PISA 27 % length → reduced forms only (`MOCK_REDUCED_FORM_ONLY`), consistent with the QB audit; not hidden |
| **S7** mock scored, no model | ephemeral: real PAA mock, `instance COMPLETED`, `result SCORED` | next `DIAGNOSTIC` / `ADD_TO_PLAN` (no mock awareness) | `SIMULATION / MOCK_1_COMPLETED → REVIEW_MOCK_RESULT`; blocker `PREDICTION_MODEL_UNAVAILABLE`; prediction `PREDICTION_MODEL_UNAVAILABLE`, model `NO_MODEL`, `official:false`; no grade anywhere | no fabricated prediction | **PASS_WITH_EXPECTED_DIFFERENCE** | M4 |
| **S8** mock available, low readiness | ephemeral: S3 / S7 Students (no diagnostic, no evidence) | Exam Core **started and scored** the mock for this Student | mock `AVAILABLE_NOT_RECOMMENDED`, `startable:true`, guidance `DIAGNOSTIC_OR_EVIDENCE_PENDING, READINESS_BELOW_GUIDANCE`; no MOCK-scope blocker | available, maybe not recommended, never locked | **PASS** | proved end to end, not only in the resolver |
| **S9** far exam | ephemeral: IB AA SL on 2029-05-01 (939 days) | next `DIAGNOSTIC` | `HORIZON / EXAM_PREPARATION_NOT_DUE → CONTINUE_LEARNING`; reason `WINDOW_NOT_OPEN {windowDays:182, policy:journey-policy-v1, classification:EXPERIMENTAL_PRODUCT_HEURISTIC}`; mock still startable | policy visible, not in Blueprint, no hard block | **PASS_WITH_EXPECTED_DIFFERENCE** | M2 |
| **S10** multiple targets | ephemeral: one Student with PAA (real mock, 36 answers: 2 STRENGTH / 3 DEVELOPING / 15 GAP), IB AA SL, PISA 2022 | PAA `ADD_TO_PLAN`; IB `DIAGNOSTIC`; **PISA `PRACTICE`** | PAA `MOCK_1_COMPLETED` (1 mock); IB `HORIZON` (0 mocks, unaffected; 0 concepts shared with PAA); PISA `DIAGNOSTIC_DUE` + `CROSS_EXAM_EVIDENCE_RISK {concepts:16, otherExamOnlyRequirements:13}` | each target independent, contamination documented | **PASS** (Journey) | the current app **skips PISA's diagnostic because of PAA's results**: BUG_CURRENT G6 (M5, §F) |

### Policy invariants

| # | Invariant | Result | Evidence |
|---|---|---|---|
| 1 | Resolver never fabricates availability | PASS | 2,800-combination matrix; S5/S6/S7 on the real schema |
| 2 | Missing Blueprint → blocker | PASS | S5 `BLUEPRINT_INCOMPLETE` |
| 3 | Missing content → blocker | PASS | S6 `CONTENT_UNAVAILABLE` ×3; unknown content facts → `CONTENT_UNAVAILABLE` |
| 4 | Missing prediction model → no prediction | PASS | S7/S10 `NO_MODEL` → `PREDICTION_MODEL_UNAVAILABLE`, `official:false` |
| 5 | Low readiness alone never hard-blocks a mock | PASS | S8: Exam Core ran it; resolver `startable:true` |
| 6 | Independent Exam Target needs no subjects | PASS | S3 (0 subjects): gate ALLOWED, `EXAM_ONLY_PROFILE` |
| 7 | Institutional context is reused | PASS (curriculum-bound classes) / DEPENDENCY for unbound classes | S1/S2; M6 → J1 |
| 8 | Learning-only Student not forced into Exam Prep | PASS | S4: `NO_EXAM_TARGET → CONTINUE_LEARNING` |
| 9 | Multiple targets resolve separately | PASS | S10; instances per `exam_profile_id`; other-exam evidence excluded from readiness |
| 10 | State is derived, not persisted | PASS | no table or column added; the resolver is pure; the shadow writes only log lines |

---

## B. Mismatches (current app vs Journey V2)

| # | Where | Current | Journey V2 | Class | Notes |
|---|---|---|---|---|---|
| M1 | Targets without a date (S2; **4/4 real DEV targets**) | `DIAGNOSTIC` | `HORIZON → SET_EXAM_DATE` + `EXAM_DATE_UNKNOWN` | **EXPECTED_DIFFERENCE** | design §B.5: no date → outside the window. **J3 input:** ask date/session when the target is created, or define a default for Student-created targets. Today no real target has a date |
| M2 | Far exam (S9) | `DIAGNOSTIC` | `HORIZON → CONTINUE_LEARNING` | **EXPECTED_DIFFERENCE** | P6 + journey policy; practice remains possible (nothing blocked) |
| M3 | Catalogue-only exam (S5) | `EXPLORE_LEARNING` | `NOTIFY_WHEN_AVAILABLE` | **EXPECTED_DIFFERENCE** | nothing mapped to learn and no subjects: the honest step is a notification |
| M4 | After a scored mock (S7) | `DIAGNOSTIC` / `ADD_TO_PLAN` | `MOCK_1_COMPLETED → REVIEW_MOCK_RESULT` | **EXPECTED_DIFFERENCE** | current next step has no mock awareness (G-05) → J5 |
| M5 | PISA after a PAA mock (S10) | `PRACTICE` (diagnostic skipped) | `DIAGNOSTIC_DUE` + `CROSS_EXAM_EVIDENCE_RISK` | **BUG_CURRENT** | G6, §F. Fix belongs to the G6 hotfix / Blueprint-readiness work, not to this track |
| M6 | 16 institution learners in classes without a curriculum binding | asked to complete the profile | `NO_ACADEMIC_PROFILE`, `requiresAcademicInput:true` | **DEPENDENCY_BLOCKED** | the resolver reads class → institution curriculum only; the grade's programme (`grades.academic_programme_id`) is J1 |
| M7 | Institution-assigned target | (no data on DEV: 0 `class_exam_assignments`) | covered by unit tests only | **DEPENDENCY_BLOCKED** | needs an assignment fixture; Track A owns it |

**Journey defects found by this validation, all fixed in this commit:**

| # | Defect | Fix | Test |
|---|---|---|---|
| BUG_JOURNEY-1 | Structure-only exams (definition `DRAFT` over a `PUBLISHED` version, by design in `apply-vertical-config`) were reported `BLUEPRINT_INCOMPLETE`: a QB gap blamed on the Blueprint | `publishedVersionExists` accepts `ACTIVE`/`DRAFT` definitions (same rule as Exam Core's bridge query) | `journey-shadow-validation` "BUG_JOURNEY-1" + S6 on the real schema |
| BUG_JOURNEY-2 | HORIZON recommended `CONTINUE_LEARNING`/`NOTIFY` to a Student with nothing to learn even when the exam structure is viewable | learning scope (subjects or learning bridge) → `CONTINUE_LEARNING`; else structure visible → `REVIEW_STRUCTURE`; else `NOTIFY_WHEN_AVAILABLE` | "BUG_JOURNEY-2" |
| BUG_JOURNEY-3 | The J2 loader counted another exam's result (plan status `NEEDS_CONFIRMATION`, context only) as THIS target's readiness and evidence coverage | `plan-facts.ts`: other-exam-only requirements excluded from ready share and coverage, counted in `otherExamOnlyRequirements` | "journey-side fix" (+ S10 PISA on the real schema) |

**O-05 observation (not changed here):** when a Student explicitly adds a concept from an exam plan ("Añadir a mi plan"), `learning-links.service.ts:173` creates a normal `subjects` row named after the canonical subject. This is user-initiated, not automatic, so O-05 is respected, but J3 must decide whether exam-derived learning should live in an exam-derived scope rather than a normal subject.

---

## C. Section O

O-01 APPROVED · O-02 APPROVED · O-03 APPROVED · O-04 APPROVED · **O-05 APPROVED · O-06 APPROVED · O-07 APPROVED**. Text in `STUDENT_EXAM_JOURNEY_V2.md` §O.

Contract changes in this commit:
- **O-06:** `ResultProvenance = STUDENT_REPORTED | INSTITUTION_REPORTED | VERIFIED_DOCUMENT | OFFICIAL_INTEGRATION` on previous and actual results.
  - The output field `examResult` is `{ provenance, verified }`; `verified` is true only for `VERIFIED_DOCUMENT` / `OFFICIAL_INTEGRATION`.
  - Reasons: `RESULT_STUDENT_REPORTED`, `RESULT_INSTITUTION_REPORTED`, `RESULT_VERIFIED`.
- **O-05:** contract tests assert that no next action creates subjects and nothing in the journey writes subjects.
- **O-07:** contract tests assert that only class **exam** assignments become targets. School assessments, teacher assignments and join codes do not.

## D. Preparation policy — `journey-policy-v1`

- **Classification:** `EXPERIMENTAL_PRODUCT_HEURISTIC`. It is not an academic rule.
  - The value is carried in `JOURNEY_POLICY_V1.classification` and in every `WINDOW_*` reason detail, alongside the policy version.
- **Formula:** window = `8 + 18 × gapShare` weeks. `gapShare` = 1 − the weighted share of mapped requirements ready in THIS exam; unknown evidence counts as gap.
- **Observed values:**
  - 182 days with no evidence (S3, S5, S6, S9; PISA in S10).
  - 151 days for PAA after its own mock raised the ready share (S10). The window responds to evidence.
- **Where it lives:**
  - It lives in the Journey: `src/lib/exam-journey/policy.ts`.
  - It is not in Blueprint facts; a test asserts `BlueprintReadinessFacts` has no window/weeks/days field.
- **Effect:** it never blocks.
  - S9 at 939 days is `HORIZON`, but the mock stays startable and practice remains available.
- **Replaceable:**
  - The resolver takes the policy as a parameter (tested with an alternative policy).
  - `policy_version` is in every shadow line.

## E. Endpoint review — `GET /api/exam-preparation/journey`

| Condition | Status |
|---|---|
| Authenticated owner required | YES: `studentGate` (tested: 401 passes through, no resolution) |
| Disabled unless `STUDENT_JOURNEY_V2=SHADOW` | YES: 404 before any auth or DB call (tested) |
| No unnecessary PII | YES: target ids, catalogue keys, enums; the Student id is never in the body (tested) |
| Clearly internal / diagnostic | **Fixed in this commit:** the body carries `internal: "JOURNEY_SHADOW_DIAGNOSTIC"`, the header is `X-StudyUs-Internal: JOURNEY_SHADOW_DIAGNOSTIC` with `Cache-Control: no-store`, and the header comment says it is not a public contract |
| Not consumed by Student UX | YES: a source test allows only the two Exam Prep pages (shadow hook) and this route to import the journey |

Verdict: **safe to keep as an internal diagnostic.** It is not promoted to a public API.

## F. Cross-target contamination

- **Journey V2: PASS.**
  - Each target reads its own instances (`exam_profile_id`).
  - Another exam's evidence is context only: it is excluded from the ready share and coverage (BUG_JOURNEY-3, fixed).
  - Cross-exam influence is reported (`CROSS_EXAM_EVIDENCE_RISK`, `readinessStatus.crossExamEvidenceRisk`), never hidden.
- **Current app (G6): FAIL**, documented, not fixed here. There are two paths:
  1. **Plan context counted as coverage.**
     - `preparation.service.ts` `examEvidence()` → `byConcept` (other exams).
     - `preparation-plan.ts` `classifyRequirement` → `NEEDS_CONFIRMATION`.
     - `nextStep()` counts it as "evidence" → it skips THIS exam's diagnostic.
     - Reproduced on the real schema: PISA after a PAA mock → `PRACTICE` (S10, 13 requirements).
  2. **Shared learner state.**
     - `simulation/scoring.service.ts` → `updateMastery(EXAM_SIMULATION)`.
     - `knowledge-state.service.ts` counts `EXAM_SIMULATION` in understanding/application.
     - `concept_knowledge_state.mastery_state` → `classifyRequirement` can mark another exam's requirement `ALREADY_STRONG` with no evidence in its own format.
     - Proven deterministically (`journey-shadow-validation` "PROOF" tests).
     - Not observable for Path B Students without learner concepts.
     - The resolver cannot separate it, so it flags the risk.
- **Owner of the definitive fix:** the G6 hotfix / Blueprint-readiness work. No broad readiness refactor in this track.

## G. Non-regression

| Area | Result |
|---|---|
| Full unit suite | **7,582 / 7,582 PASS** (456 files; +21 new; previous 7,561) |
| Journey (J0, J2, shadow, validation) | 84 PASS |
| Onboarding / gate / first destination / objective-first / Exam Prep / Exam Core suites | PASS (inside the full suite; only my own J2 fixtures were adapted to the O-06 / G6 contract fields, with no assertion weakened) |
| Typecheck | `tsc --noEmit` clean |
| Build | `next build` OK |
| Student v1 / Today / navigation | unchanged (no file touched) |
| Exam Core | unchanged (no file under `src/lib/exam-core`) |
| Real schema | J0 + all loader SQL ran on baseline + 59 migrations + catalogue, and read-only on DEV |

## H. Recommendation — `READY_FOR_J1_J3_DESIGN`

The resolver produces coherent, honest states on real data. The three defects it surfaced were journey-side and are fixed. The remaining mismatches are expected by design, current-app bugs (G6) or dependencies.

**Gate to start J1/J3 implementation** (design may start now):

| # | Condition | Owner |
|---|---|---|
| 1 | Hosted `DEV_SHADOW_VALIDATED`: operator deploys with `STUDENT_JOURNEY_V2=SHADOW`, signs in fixture Students, and the `[journey-shadow]` lines match this report | operator |
| 2 | J3 design decides how a target gets its date/session (M1: 4/4 real targets have none) | this track |
| 3 | J1 design reads the institution grade programme so unbound classes still give context (M6) | this track + Track A data |
| 4 | An institution-assigned target fixture on DEV (`class_exam_assignments` = 0 today) (M7) | Track A |
| 5 | G6 hotfix scheduled; until then the journey keeps `CROSS_EXAM_EVIDENCE_RISK` visible (M5) | G6 / Blueprint-readiness |
| 6 | No prediction model exists for any exam (`NO_MODEL` everywhere); prediction UI stays out of scope until the Blueprint supplies classified models (O-02) | Blueprint track |

None of these blocks the J1/J3 **design**. Conditions 1 and 4 block calling the journey hosted-validated; 2 and 3 are J1/J3 design inputs.
