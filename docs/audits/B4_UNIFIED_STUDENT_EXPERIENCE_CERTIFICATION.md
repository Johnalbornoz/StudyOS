# B4 — Unified Student Assessment Experience — Certification

Date: 2026-10-10 · Worktree: `studyos-assessment-b4` · Branch: `feat/assessment-b4-unified-student-experience`

## 0. Executive Result

```text
UNIFIED_EXPERIENCE_PASS_WITH_CONDITIONS
```

What B4 delivers:

- **One set of view contracts and one set of components** for setup, exam attempt options, the active
  shell header, the result and the continuation, for the three families. They render authority outputs and
  decide nothing pedagogical.
- **No dead ends on the delivered runtime.** The three result screens that ended in a plain "back" link or a
  page-local guess now end in a canonical next step.
- **No runtime cutover.** B2 / B3 are not on any delivered path.

Why it is `WITH_CONDITIONS`:

1. **The new setup, run header and unified result are not mounted on a delivered route.** They consume B2 /
   B3 contracts, and those are not the runtime. Flows A–E are certified at contract and component level and
   observed in a fixture preview; on the delivered app only the continuation changed.
2. **No authenticated session was used.** The real pages (Today, the exam result, the quiz, the assigned
   practice) were not observed live. The three edits to them are verified by typecheck, build and source
   guards, not by rendering.
3. **No automated accessibility scan.** The project has no axe tooling; checks were manual and structural.

Certification gate:

| # | Gate item | Result | Basis |
|---|---|---|---|
| 1 | Learning and Exam Prep share one lifecycle | PASS (contracts / components) | one launch request, one preview, one result, one continuation |
| 2 | UI does not select questions | PASS | strict launch schema; source guards |
| 3 | UI does not calculate mastery | PASS | source guards; result rows come from B3 |
| 4 | Depths are semantic, not counts | PASS | labels + B2 numbers; no count control |
| 5 | B2 feasibility drives availability | PASS | `previewOf` from the solution; `examAttemptOptions` from B2 + B1 |
| 6 | Known estimates shown accurately | PASS | tests with recorded durations |
| 7 | Unknown estimates not fabricated | PASS | minutes null → no time shown |
| 8 | Official / reduced / challenge distinct | PASS | four B1 types, fixed order, no catch-all |
| 9 | Score without learning attribution | PASS | `UNAVAILABLE` state, rendered as information |
| 10 | Intended vs observed evidence | PASS | coverage sentence + per-concept status |
| 11 | Primary continuation is canonical | PASS | `continuationViewOf`; exam result no longer picks "first gap" |
| 12 | No exam-gap → Today shortcut | PASS | gaps are not an input of continuation; guard |
| 13 | Resume preserves frozen identity | PASS (contract) | `runViewOf` on the same snapshot; no resume surface was rebuilt |
| 14 | TECHNICAL_DEMO absent from learner UX | PASS | guard over components, copy, requests, options |
| 15 | Framework does not fork logic | PASS | node scope via CurriculumScope; guard |
| 16 | First-use path understandable | NOT RE-VALIDATED | existing Today cold states unchanged; not observed live |
| 17 | Returning path prioritises continuation | PASS (existing) + B4 continuation | Today unchanged; results now continue |
| 18 | Responsive / accessibility / i18n | PASS with limits | fixture preview at three widths; five locales; no axe |
| 19 | No unauthorised cutover | PASS | guard: no route imports the B2 / B3 / B4 services |
| 20 | Tests / typecheck / build | PASS | 501 files / 8,959 tests; clean; exit 0 |

## A. Baseline

| Item | Value |
|---|---|
| Start SHA | `b8e58e9722384232905dbc93a77f94ab7914ecb5` (B3) — HEAD verified, tree clean, B3 ancestor |
| Baseline | 500 files / 8,918 tests; `tsc` clean; build exit 0 |
| Integrated | `41e9676` — T1 presentation line, frozen ("T1 FINAL STATUS: PASS / DONE"). Committed, eight files, labels and concept presentation only, merges cleanly, touches student surfaces B4 builds on. Merge commit `b6c8b19` |
| Excluded | `integration/q1-paa-assessment-b1` (`58daefa`): Q1 data / readiness, not a B4 surface |
| Excluded | `feat/assessment-b2-blueprint-core` (`c04d97a`, protected pools and exposure): post-B2 backend work, not certified against B3, owned by another session |
| Not touched | every other worktree |

## B. Current-State UX Audit

Student navigation (`src/lib/lx/learner-navigation.ts`): Hoy, Aprender (path, knowledge, subjects),
Preparación de examen (when primary), Progreso; secondary: tutor, plan, assignments, study plan, debt.

| Surface | Route | Class |
|---|---|---|
| Today | `/dashboard/today` | canonical home: `NextChallengeCard` from the Learning OS snapshot |
| Learn / path | `/dashboard/learn`, `/dashboard/path`, `/dashboard/path/[subjectId]` | canonical entry |
| Concept mission | `/dashboard/subjects/[id]/concepts/[conceptId]` | canonical launch |
| Quiz | `/dashboard/quiz` | setup + runner + result in one client page; canonical continuation for single-concept sessions |
| Explain / transfer / remediation | `/dashboard/cognitive/*`, `/dashboard/remediation/[pathId]` | runner + result with `ContinuationPanel` |
| Exam preparation | `/dashboard/exam-prep`, `/dashboard/exam-prep/[examProfileId]` | three branches: objective-first, journey (flag), legacy start panel |
| Exam instances | `/dashboard/exams` | create / start / history |
| Exam attempt | `/dashboard/exam-prep/attempt/[attemptId]` (+ `/result`) | runner and result |
| Assigned practice | `/dashboard/assignments/practice` | runner + result |

Findings:

| Finding | Where | B4 |
|---|---|---|
| Dead end: result ends in a plain link | assigned practice (`PracticeRunner`) | fixed |
| Next step chosen by the page ("first GAP, else DEVELOPING concept") | exam result | fixed: canonical next challenge |
| Several primary buttons compete on one result | exam result bridge section | fixed: one primary |
| No continuation for multi-concept and diagnostic results | quiz | fixed: fallback to Today |
| Manual question-count slider (1–20) | quiz legacy setup (`?setup=1`, cumulative / exam-simulation modes) | left in place; not used by the new setup |
| Hard-coded minutes per activity type | `learning-execution-policy.ts`, shown only under the legacy authority | left; documented |
| Two unrelated next-action presenters on the exam side | `exam-journey/ux.ts`, `preparation.service` | left; documented |
| No depth concept anywhere in student UI | — | added as a view contract and component |
| No fixture / preview route, no jsdom, no Storybook | — | local-only fixture preview added |

Target route map: one experience reached from Today, the path, Progress and Exam Preparation, converging on
setup → run → result → continuation. No new top-level destination was created.

## C. Target Experience Architecture

```text
surface (Today · path · Progress · Exam Prep)
   │  AssessmentLaunchRequest          intent only
   ▼
setup view  ◄── Blueprint Core solution(s) (read-only)      [B2]
   ▼
run view    ◄── frozen assessment                            [B3]
   ▼
result view ◄── PostAssessmentState                          [B3]
   ▼
continuation view ◄── ContinuationResolution / NextChallengeView   [Learning Decision]
```

`src/lib/assessment-experience/` holds the contracts (codes, never prose); `src/components/assessment/`
holds the components; `src/lib/i18n/assessment-experience-messages.ts` holds the words.

## D. View Contracts

| Contract | Source of every value | File |
|---|---|---|
| `AssessmentLaunchRequest` | the Student's intent; strict schema | `launch.ts` |
| `AssessmentSetupView`, `AssessmentPreview`, `DepthOption` | B2 `BlueprintSolution` | `views.ts` |
| `ExamAttemptOption` | B2 official feasibility + B1 `deriveInstanceAttemptType` | `views.ts` |
| `AssessmentRunView`, `RunCapabilities` | B3 `FrozenAssessment` + the existing AI-permission policy | `views.ts` |
| `AssessmentResultView` | B3 `PostAssessmentState` | `views.ts` |
| `AssessmentContinuationView` | `ContinuationResolution` / `NextChallengeView` | `continuation.ts` |
| `learningSetupForStudent` | B2 service per depth; CurriculumScope for a node | `assessment-experience.service.ts` |

The launch schema rejects question ids, counts, thresholds, priorities and difficulty.

## E. Today

Unchanged. It remains a consumer of the Learning OS snapshot through `NextChallengeCard`. Under the
canonical authority it shows a question count only when the activity contract states one and never shows
minutes; the hard-coded per-activity minutes appear only under the legacy authority. B4 added nothing that
computes or places a recommendation there (guarded).

## F. Curriculum / My Path

`learningSetupForStudent` accepts a curriculum node of any framework and resolves it to canonical concepts
through `CurriculumScope` (`conceptsUnderNode`). Tested with an official IB theme, a Colombian school unit
and a provider session: same code, no framework name. Not mounted on a route.

## G. Practice Depth

| Depth | Learner label (es) | Meaning shown |
|---|---|---|
| QUICK | Repaso rápido | Un vistazo a cada concepto para mantenerlo fresco. |
| BALANCED | Práctica completa | Lo necesario para afianzar cada concepto. |
| DEEP | Profundizar | Más variedad y más reto para demostrar que lo dominas. |

Each option shows what B2 selected for it: concepts covered, questions, and minutes only when durations are
recorded. Core scenario through the real pipeline: 2 / 4 / 4 questions, DEEP partial; the same depth on a
different bank gives 1. There is no control that sets a number. A diagnostic or a mastery check has one
shape and offers no depth choice.

Limited or impossible setups are states with learner-safe reasons; internal causes never reach the view.

## H. Exam Preparation

The existing preparation home, objective-first view and start panel are unchanged. B4 adds the shared
`ExamAttemptOptions` component and the request / preview contracts for a preparation practice, and makes the
exam result continue canonically (section L). `student_exam_profiles` remains the only profile.

## I. Mock / Challenge / Reduced Mock

`examAttemptOptions` returns four distinct options in a fixed order — Práctica de examen, Simulacro
reducido, Simulacro completo, Reto de examen — using the existing `ex.type.*` names. A full mock is
available only when B1 would store a FULL_MOCK; otherwise it is shown as "No disponible todavía" with one of
three reasons, is not a link, and is never replaced by a smaller attempt. With no eligible content every
option is unavailable.

## J. Active Assessment

`AssessmentRunHeader` renders capabilities: help line from the existing `canUseAI` policy and the session's
EvidenceMode, immediate feedback for learning only, integrity line for an official form, progress as an ARIA
progressbar counted against the frozen assessment. The existing runners (`quiz/page.tsx`, `ItemRunner`) were
not rebuilt.

## K. Results

Hierarchy: what happened → what was demonstrated → what stays open → what changed → next step.
Per concept: evidence recorded (with direction from the writer's own before / after) · not answered · under
review · does not count for this concept yet. Nothing says "failed". An official result shows marks, and
when the questions do not say which concept each measures it states that as information.

## L. Continuation

`continuationViewOf` returns exactly one primary step: the resolver's launch, the Learning Decision
authority's next challenge (opened from Today), a "not yet" for a retention check, or — when no authority
has an action — the way to Today. Secondary links return to the surface of origin.

Applied on the delivered runtime:

| Screen | Before | After |
|---|---|---|
| Exam result | primary = first gap concept chosen by the page; per-gap primaries | one primary = canonical next challenge; per-gap actions secondary; retake and "back to preparation" secondary |
| Assigned practice result | plain link to assignments | primary to the next challenge on Today; assignments secondary |
| Quiz result without a single concept | no next step | primary to the next challenge on Today |

## M. New vs Returning Student

Not changed. Today already distinguishes no-concept, cold, caught-up and read-failure states inside one
shell, and the onboarding gate redirects an incomplete profile before render. These were read in code, not
observed live.

## N. Accessibility

Observed in the fixture preview: every radio is inside a label; every fieldset has a legend; progress has
`role="progressbar"` with label, min, max and current; informational notices use `role="status"` and no
`role="alert"`; no empty links; primary buttons are 44 px high at mobile width; Tab reaches the controls
with a visible focus outline. The setup is a plain form and works without script.
Not done: an automated scan (no axe in the project), a screen-reader pass, contrast measurement.

## O. Responsive

Fixture preview at desktop, 768 px and 375 px: no horizontal overflow; option rows stack and buttons go
full width at mobile.

## P. i18n

67 keys in a new `ax.` namespace, in es / en / de / fr / pt, merged through the governed catalogue (a missing
key is a compile error). A test renders every component in every locale and fails on any raw enum, key or
`undefined` in visible text, and on architecture vocabulary in the copy.

## Q. Browser Validation

| Inventory item | How it was observed |
|---|---|
| 1. Today recommendation | fixture preview: the real `NextChallengeCard` with a fixture view |
| 2. Practice setup (known effort · unknown duration · partial only · unavailable) | fixture preview |
| 3. Active activity header (practice · official) | fixture preview |
| 4. Result (learning · official without attribution) | fixture preview |
| 5. Continuation (canonical · return) | fixture preview |
| 6. Exam Prep action / 7. Mock availability | fixture preview |
| Real pages with a signed-in Student | **not observed** — no account was used |

The preview is `/experience-preview`, fixtures only, no data access, and returns 404 in any production
build or Vercel environment. No console errors. No content was created in any database.

## R. Authority Guardrails

| UI question | Authority |
|---|---|
| What should the Student do? | Learning Decision |
| What assessment is needed? | B2 policy |
| Which questions? | B2 solver |
| Can it start? | B1 eligibility / fidelity, B2 feasibility |
| What was scored? | existing graders |
| What evidence counted? | B3 |
| What changed? | Knowledge State (through `updateMastery`) |
| What next? | Learning Decision |
| How is it shown? | B4 |

Enforced by tests: no selection, sizing, randomness, mastery arithmetic, label matching or framework switch
in the experience layer; TECHNICAL_DEMO absent from components, copy, requests and options; no exam gap
placed on Today; no route imports the B2, B3 or B4 services.

## S. Tests

| Check | Result |
|---|---|
| `tests/unit/b4-unified-experience.test.ts` | 35 |
| Full suite | 501 files / 8,959 tests, 0 failed |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx next build` | exit 0 |

Three earlier guards were updated to recognise the experience layer as a reader (B0-U, B2 and B3 "no
importer" checks); the B3 one additionally requires its imports to be type-only.

## T. Runtime Cutover State

| Item | State |
|---|---|
| B2 as delivered runtime | NO |
| B3 as delivered runtime | NO |
| Frozen-snapshot launch path | prepared, OFF by a constant; no flag is read |
| Dual execution | none: B3 is called nowhere |
| Migrations | none added; `20261108`, `20261109`, `20261110` remain unapplied |
| Hosted flags | untouched |
| Exam evidence decision | recorded as final for cutover: B3 semantics supersede the legacy first-concept shortcut. Runtime unchanged; no B4 screen assumes exam items create concept evidence |

## U. B5 Readiness

```text
B5_GO_WITH_CONDITIONS
```

B3 conditions still open: real-Postgres validation of the evidence loop; migrations unapplied; snapshot
attempt-start cutover; legacy exam-evidence divergence (decided, not applied); hosted canonical-engine flag.

B4 conditions for B5:

1. Mount the setup, run header and unified result on delivered routes as part of the B2 / B3 cutover.
2. Review the three edited result screens signed in, at desktop and mobile.
3. Validate first use and returning use signed in.
4. Run an automated accessibility scan on the mounted screens.
5. Retire the manual question-count slider when the new setup replaces the legacy one.
