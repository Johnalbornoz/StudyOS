# Student Exam Journey — current state vs. V2 target model

- **Base audited:** `bf98086` (Preview line: Curriculum V2 08d1f9a, QB V2 df3b864, Exam Eligibility C/D, Academic Profile Phase A).
- **Branch for this work:** `design/student-exam-journey-v2` (worktree `studyos-journey`). Design only; no code, no DB, no deploy.
- **Method:** read-only code audit of three areas (onboarding/academic context, Exam Core, Home/IA/evidence). One finding (G-01) was checked directly against the source.
- **Companion:** [`STUDENT_EXAM_JOURNEY_V2.md`](STUDENT_EXAM_JOURNEY_V2.md) (target design, deliverables A–M).

---

## 1. Summary

StudyUs already has most of the **parts** of the journey, but no **journey**.

| Layer | What exists | What is missing |
|---|---|---|
| Identity / academic context | Self-declared Academic Profile linked to the catalogue (Phase A); `student_academic_subjects`; class → curriculum binding; `class_exam_assignments` | Institution data never pre-fills the student; no per-field provenance; no multi-year academic timeline; no exam-only entry |
| Exam targets | `student_exam_profiles` (several per student, objective-first, `source STUDENT/EXAM_INSTANCE/INSTITUTION`); eligibility with reasons; recommended preparations | Exam session, target result, previous result; target confirmation status; exam discovery for "I don't know my exam" |
| Exam execution | Diagnostic (PRACTICE + `purpose=DIAGNOSTIC`), adaptive Practice, Paper/component selection, MOCK and CHALLENGE (frozen forms, REDUCED/FULL fidelity), delivery policy, scoring, results, learning bridge | Pedagogical sequencing (diagnostic → practice → Mock 1 → reinforcement → Mock 2); mock numbering; reinforcement cycle tied to a mock |
| Capability gating | Five readiness levels (`CATALOG_ONLY … FULL_MOCK_READY`), `capabilities.ts` with reasons, QB usage/alignment, SHADOW/ENFORCE | Exposed as journey states the student understands (NOT_READY / CONTENT_UNAVAILABLE / BLUEPRINT_INCOMPLETE) |
| Prediction | `score_projection_availability`; `score_conversion_models` (0 rows → always `NOT_AVAILABLE_NO_CALIBRATION`); "Preparación estimada StudyUs" wording; `cambridge_results` | Any grade projection (IB 1–7), component/IA estimates, teacher predicted grade, student-reported actual result, projection history |
| Home | `today/page.tsx`: hero = next **concept** activity; exam = goal chip only | A journey-state-driven primary CTA; exam phase never drives Home |
| Knowledge history | Rich per-concept state (`concept_knowledge_state`, `concept_memory_state`, `concept_transfer_state`), canonical engine replay, no reset on curriculum change | Stored milestone timeline; academic-period dimension; readiness using canonical stage/retention/transfer |

**Short verdict against the PASS criteria in the brief:**

| Required walkthrough | Today |
|---|---|
| Institution → curriculum → learning path → future assessment → exam prep → Mock → prediction → final preparation | **FAIL** at the first step (the student re-declares everything) and at prediction (none exists) |
| Independent Exam → target exam → profile → diagnostic → preparation → Mock → result | **FAIL** at the entry: the exam-only path is blocked by the onboarding gate (G-01) |
| Independent Longitudinal → curriculum → multi-year evidence → future exam → readiness → preparation | **PARTIAL**: evidence persists across years by design, but there is no year progression, no timeline, and readiness doesn't use stage/retention |
| All three on the same Learning OS + Exam Core | **YES** structurally. There is one learner state and one Exam Core, and nothing is duplicated per path. That is the strongest asset to keep. |

---

## 2. Findings, ordered by severity

### P0 — blocks a required path

**G-01 · The exam-only entry (Path B) is unreachable without first creating a subject.**
- `src/lib/student/onboarding-gate.ts:59-63`: the stage is `FIRST_SUBJECT` while `subjects` count is 0.
- `:97-98`: in that stage only `/dashboard/profile`, `/dashboard/onboarding` and `/dashboard/subjects/new` are allowed. Every other `/dashboard/*` path, including `/dashboard/exam-prep`, redirects to `/dashboard/onboarding`.
- The onboarding page offers "Quiero prepararme para un examen" → `/dashboard/exam-prep` (`src/app/dashboard/onboarding/page.tsx:64`), so the click lands back on onboarding.
- `first-destination.ts:40-45` already models `RESUME_EXAM_PREPARATION` for an exam-goal-only learner. The proxy gate contradicts it. If an exam profile ever exists without a subject (for example one created by an institution or the API), `onboardingRouteRedirect` sends the student to exam-prep and the gate sends them back: a redirect loop.
- The gate also ignores `student_exam_profiles` and `class_enrollments` (`onboarding-gate.server.ts:10-21`).
- *Evidence level:* code reading of a pure function. Not executed in a browser.
- **Status (J0): FIXED** on `design/student-exam-journey-v2`. Reproduced by test before the fix: the redirect loop `/ → /dashboard/exam-prep → /dashboard/onboarding → /dashboard/exam-prep` and the blocked exam intent (`tests/unit/journey-j0-exam-only-access.test.ts` fails 9/15 on the pre-J0 gate, passes 15/15 after). See `STUDENT_EXAM_JOURNEY_V2.md` §P.

**G-02 · The institution student is asked everything the institution already knows.**
- The profile is always self-declared (`AcademicProfileWizard.tsx`). `grades.academic_programme_id / academic_year / academic_level` and the class subjects are never read for the student. In `academic-context.ts:96-117`, grade comes only from the profile.
- Class invitations are accepted in `/dashboard/notifications`, which sits behind the onboarding gate. The student must finish the profile and create a subject before they can even see that their school invited them.
- No join code, and no invitation before the student has an account (`NO_STUDENT_ACCOUNT`).

**G-03 · No prediction exists, and no data model supports one.**
- `score_conversion_models` has 0 rows, so the projection is always `NOT_AVAILABLE_NO_CALIBRATION`.
- Every V2 vertical scores `RAW` with `NO_OFFICIAL_SCALE`.
- There is no IB grade-boundary model. `cambridge_grade_thresholds` exists but nothing in `src/` reads it.
- No component estimates (IA "Not simulated"), no teacher predicted grade, no student-reported actual result outside Cambridge.
- *Note:* this is correct behaviour today: StudyUs does not invent a scale. The journey must keep showing that honestly until the Blueprint Engine supplies a prediction model.

### P1 — the journey cannot be followed unambiguously

**G-04 · Home is not journey-aware.**
- The hero is always the next concept activity (`today/page.tsx:185, 298`).
- Exams appear only as a goal chip (`lib/experience/goal.ts`, which explicitly "never reads readiness").
- The orchestrator's "exam approaching" signal reads school assessments (`assessment_schedule_rules`), not `student_exam_profiles.exam_date`. There are two unrelated "exam" sources.

**G-05 · No pedagogical sequencing of exam activities.**
- Mocks unlock on content only (`POST /api/exams/instances` → 409 `MODE_NOT_AVAILABLE` / `COMPONENT_NOT_READY`). Nothing requires a diagnostic before a mock, and nothing like "Mock 2 after reinforcement" or mock numbering exists.
- `nextStep` (`preparation-plan.ts:242-266`) has no `TAKE_MOCK` / `RETAKE_MOCK` / `ENTER_COMPONENT_ESTIMATE` / `RECORD_RESULT`.
- Every instance starts a simulation attempt with `simulationType:'FULL_MOCK'` regardless of mode (`exam-instance.service.ts:349`). That is harmless today, but it is misleading for any future "count the mocks" logic.

**G-06 · Exam target lacks the fields the journey needs.**
- There is no `exam_session`, target result or previous result on the profile.
- `preparation_goals` (TARGET_SCORE / TARGET_GRADE …) exists with service functions but **no caller**. It is dead, and can be reused.
- Profile status `COMPLETED` exists but nothing sets it, so there is no "exam taken" or "result recorded" lifecycle.

**G-07 · Readiness does not consume the canonical knowledge history.**
- The F9 readiness snapshot counts raw `learning_evidence` rows (`readiness.service.ts:61-86`). The preparation plan reads `concept_knowledge_state.mastery_state` + `memory_status` (`preparation-plan.ts:116-150`).
- Neither reads the canonical stage (LEARN → PRACTICE → PROVE → RETAIN → TRANSFER → CONSOLIDATED), and neither weights by recency or academic period.
- The "mastered" definition differs between Progress (canonical CONSOLIDATED, `dashboard/page.tsx:59-61`) and Exam Prep (`VALIDATED_MASTERY`, `preparation-plan.ts:116`).

**G-08 · Exam evidence leaks into legacy learning scores.**
- Simulation responses write `learning_evidence` with source `EXAM_SIMULATION` (`simulation/scoring.service.ts:24-33,137`).
- The canonical engine correctly ignores them (`pedagogical-shadow/evidence-adapter.ts:104-115`), but `knowledge-state.service.ts:106-116` counts them in understanding/application.
- This conflicts with "Practice ≠ Exam" and with the rule that exam evidence is exam-specific.

**G-09 · No longitudinal academic timeline.**
- `student_academic_profile` is one overwritten row. `academic_year` and `school_year` are free text, and there is no rollover or promotion.
- Grades start at 6 (`academic-options.ts`), and only five countries are supported.
- Knowledge state correctly does **not** reset (keyed per student + concept). The design keeps that.

**G-10 · Subjects are chosen twice.**
- Profile subjects (`student_academic_subjects`, catalogue-linked) are ignored by the SubjectPicker, which uses the hard-coded `SUBJECT_CATALOG` and creates an unlinked personal `subjects` row.

### P2 — UX quality

- **G-11:** Learning modes are distinguished by text only. There is no visual system for Learn / Practice / Independent / Training / Mock / Projection. `LearningSupportStatus` (SUPPORTED/INDEPENDENT) is a good seed.
- **G-12:** Exam Prep is hidden under "Más". There are two plan surfaces (`/plan` "Mi plan" vs `/study-plan` "Plan de estudio"). Progress is `/dashboard` while Home is `/dashboard/today`.
- **G-13:** Not-ready reasons exist (`capabilities.ts`: `STRUCTURE_ONLY`, `BANK_IN_PROGRESS`, `REDUCED_ONLY`, …), but they are rendered per activity, not as a journey state with a "what comes next" explanation.
- **G-14:** Cambridge Checkpoint is absent from the catalogue. Case 3 cannot be executed until the Blueprint Engine adds it.

### P3 — hygiene

- `AcademicProfileCTA.tsx` and `OnboardingChecklist.tsx` are dead, with unused i18n keys (`profile.cta*`, `onboarding.step1-3*`).
- Legacy and catalogue profile models run side by side, and the gate checks only the legacy columns.
- Two exam stacks (legacy F7/F9 simulation vs. V2 objective-first): profiles without an `objective_key` render the F9 UI.

---

## 3. Coverage of the target states (brief §ESTADOS)

Legend: **E** = exists as a state or flag, **D** = derivable from existing data, **—** = no data.

| Target state | Today | Source / gap |
|---|---|---|
| NO_ACADEMIC_PROFILE | E | gate `ACADEMIC_PROFILE` |
| ACADEMIC_PATH_DEFINED | E | `isAcademicProfileComplete` (legacy columns) |
| NO_EXAM_TARGET | D | no non-archived `student_exam_profiles` |
| FUTURE_EXAM_IDENTIFIED | D (partial) | eligibility "recommended" exists; there is no persisted "future milestone" without creating a profile |
| EXAM_PREPARATION_NOT_DUE | — | no preparation window concept |
| FOUNDATION_BUILDING | — | Learning OS runs, but is not labelled relative to a target |
| EXAM_READINESS_AVAILABLE | D | `capabilities.canPractice` + `canUseLearningBridge` |
| DIAGNOSTIC_DUE | D | `nextStep = DIAGNOSTIC` |
| PREPARATION_ACTIVE | D | preparation plan exists |
| PRACTICE_ACTIVE | D | PRACTICE instances |
| PAPER_TRAINING | D | component-scoped practice instances; not labelled as such |
| MOCK_AVAILABLE | E (content only) | `canRunReducedMock / canRunFullMock`; no pedagogical gate |
| MOCK_1_COMPLETED | D | first COMPLETED MOCK instance; no numbering |
| EARLY_PREDICTION_AVAILABLE | — | conversion models empty |
| REINFORCEMENT_ACTIVE | D (partial) | learning bridge / EXAM_GAP recommendations; not tied to a mock |
| MOCK_2_AVAILABLE | — | no sequencing |
| MOCK_2_COMPLETED | D | second COMPLETED MOCK |
| UPDATED_PREDICTION_AVAILABLE | — | — |
| ADDITIONAL_COMPONENTS_REQUIRED | — | IA components exist in the catalogue, but no estimate input |
| FULL_PREDICTION_AVAILABLE | — | — |
| FINAL_PREPARATION | — | — |
| EXAM_READY | — | — |
| EXAM_COMPLETED | — | profile `COMPLETED` is never set |
| RESULT_RECORDED | E (Cambridge, coordinator only) | `cambridge_results` |

---

## 4. What to keep (do not rebuild)

1. **One learner state per student + concept**, never reset per year or curriculum. This is the backbone of the longitudinal promise.
2. **Canonical pedagogical engine** (stage replay) and the SUPPORTED/INDEPENDENT distinction.
3. **Exam Core V2:** `exam_instances` (PRACTICE/MOCK/CHALLENGE, frozen forms, REDUCED/FULL fidelity), delivery policy, scoring with provenance, `exam_attempt_results`, learning bridge, EXAM_GAP recommendations.
4. **Capability contract** (`objectives/capabilities.ts`) and the readiness ladder (`catalog/readiness.ts`): the journey consumes them instead of re-deciding.
5. **Eligibility with reasons** (`eligibility/*`), including `INSTITUTION_ASSIGNED`. It never blocks a choice.
6. **Honesty conventions:** "Preparación estimada StudyUs", `NO_OFFICIAL_SCALE`, unofficial provenance badge, "exam evidence is exam-specific".
