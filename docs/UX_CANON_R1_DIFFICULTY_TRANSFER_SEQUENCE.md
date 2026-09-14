# UX/CANON-R1 — VISIBLE DIFFICULTY + TRANSFER SEQUENCING

## STATUS

**PASS.** Both findings are resolved at their canonical root, not patched at the symptom. The Transfer-before-Retention defect had a single, provable root cause in one function (`determineValidationReadiness`), fixed by reordering two existing checks — no new authority was invented. Difficulty is now visible on the active-question surface and Results, remaining strictly system-defined (no selector, slider, or preference was introduced). `npx tsc --noEmit`, `npx vitest run` (233 files / 3949 tests), and `npm run build` are all clean on the implementation commit.

---

## LIVE FINDINGS

**Finding 1 — difficulty invisible.** Live telemetry showed `activityType: REVIEW, targetDifficulty: 4, difficultyReasonCode: PRACTICE_ESTABLISHED_CHALLENGE` — a canonical, system-determined difficulty the learner had no way to see.

**Finding 2 — Transfer executed before Retention.** For concept "Fuerza centrípeta": Solo Check 67% → Practice 100% → **TRANSFER 100%** — then Concept Mission showed `Estás aquí: Retener` with the retention-pending explanation, while the Transfer stage was **visually marked completed**. Canonical StudyUS journey is `LEARN → PRACTICE → PROVE → RETAIN → TRANSFER → CONSOLIDATED`; Transfer evidence was recorded before Retention was ever satisfied.

---

## ROOT CAUSE — TRANSFER BEFORE RETENTION

Traced (PART G), not guessed, to one function: `determineValidationReadiness` (`src/services/knowledge-state.service.ts`).

**Before:**
```ts
export function determineValidationReadiness(scores, misconceptions, sufficiency, policy): ValidationReadiness {
  if (misconceptions.criticalCount > policy.maximumCriticalMisconceptions) return 'ACTIVE_CRITICAL_MISCONCEPTION';
  if (!sufficiency.passed) return 'INSUFFICIENT_EVIDENCE';
  if (policy.requiresTransfer && scores.transfer === null) return 'TRANSFER_REQUIRED';   // checked FIRST
  if (scores.retention === null) return 'WAITING_FOR_RETENTION';                          // never reached if transfer is also null
  return 'READY';
}
```

For a concept that just finished PROVE — `scores.retention === null` **and** `scores.transfer === null` simultaneously, exactly the live shape — the `TRANSFER_REQUIRED` check fired first and the function never reached the retention check at all. This is backwards relative to both the canonical journey order and `computeLearningState`'s own documented precedence ("retention > transfer").

**Propagation, traced exactly (no other file re-implements this decision):**

1. `knowledge-state.service.ts::determineValidationReadiness` → wrong `validationReadiness = 'TRANSFER_REQUIRED'` persisted on `ConceptKnowledgeState`.
2. `adaptive-learning-orchestrator.service.ts` (lines ~429-434) emits a `TRANSFER_REQUIRED` signal (not `WAITING_FOR_RETENTION`) purely from that one field — a simple if/else pair, no independent derivation.
3. `adaptive-learning-policy.ts::computeLearningState` reads `ks.validationReadiness === 'TRANSFER_REQUIRED'` → returns `'TRANSFER_GAP'`, never reaching its own `RETENTION_RISK` check (which requires `validationReadiness === 'WAITING_FOR_RETENTION'`, never true here).
4. `adaptive-learning-policy.ts::selectActivityType` reads `readiness === 'TRANSFER_REQUIRED'` → returns `'TRANSFER'`.
5. `learner-journey-contract.ts::deriveLearnerJourneyStage` mirrors `learningState === 'TRANSFER_GAP'` → `stage: 'TRANSFER'`.
6. Every consumer of steps 3-5 (Today, My Path, Concept Mission, continuation) faithfully mirrors the decision — **none of them independently re-derives the stage**, so none of them was individually buggy; they all correctly displayed an already-wrong upstream fact.

**Why it flipped to RETAIN after Transfer completed:** once the (premature) Transfer attempt recorded evidence, `scores.transfer` became non-null. The `TRANSFER_REQUIRED` check (line 3 above) became false, so the function finally reached `scores.retention === null` → correctly returned `WAITING_FOR_RETENTION`. The retention gap was **always there** — it only became visible once the higher-precedence (but wrong) transfer check stopped masking it.

**Fix:** swap the two checks — retention is now checked before transfer, matching the canonical order.

```ts
if (scores.retention === null) return 'WAITING_FOR_RETENTION';
if (policy.requiresTransfer && scores.transfer === null) return 'TRANSFER_REQUIRED';
```

One existing test's own title (`phase2-memory-integration.test.ts`: *"determineValidationReadiness returns WAITING_FOR_RETENTION whenever retention is null, regardless of every other dimension passing"*) already stated this exact invariant — the pre-fix implementation only satisfied it when `transfer` was non-null; the fix makes the function's behavior match what that test already claimed.

**Confirmed NOT a second, independent bug:** `determineMasteryState` (the actual VALIDATED_MASTERY/CONSOLIDATED gate) was never vulnerable to this ordering issue — it ANDs `retentionOk`/`transferOk` as independent booleans rather than a sequential if/else chain, so `scores.retention === null` already made `VALIDATED_MASTERY` unreachable regardless of transfer. Part O's instruction ("do not change mastery/evidence thresholds") required no change here, and none was made.

---

## PRODUCT DECISION — DIFFICULTY

Difficulty is **SYSTEM-DEFINED**, **LEARNER-VISIBLE**, **NOT LEARNER-EDITABLE**. No dropdown, slider, difficulty selector, "make easier/harder," or learner preference was introduced, or will be — that would require a second difficulty algorithm, which this codebase's own principle (and this phase's explicit instruction) forbids.

This reverses LX-4J's earlier removal of the intrinsic 1-5 difficulty display — LX-4J removed it because, at the time, "there is no canonical learner-relative difficulty authority... showing a five-level scale implied one." That premise is no longer true: StudyUS now canonically determines difficulty (`resolveTargetDifficulty`, threaded into every question's own `difficulty` field), so showing it is no longer a false claim.

---

## DIFFICULTY DATA AUTHORITY

`getDifficultyPresentation(difficulty, t)` (`src/lib/lx/difficulty-presentation.ts`) is the one presentation authority:

```ts
export function getDifficultyPresentation(difficulty: number, t: T): DifficultyPresentation {
  const value = Math.max(1, Math.min(5, Math.round(difficulty)));
  return { value, max: 5, label: t[LEVEL_KEYS[value - 1]] };
}
```

It reads `t['difficulty.level1']`..`t['difficulty.level5']` — never a score, never `resolveTargetDifficulty` itself, never a mastery/evidence field. It only clamps (defensively) and labels an **already-canonical** number. `describeDifficultyTier` (`quiz-generation.service.ts`) remains the sole authority on what a difficulty tier *means* pedagogically to the generator/verifier — untouched by this phase, and never duplicated here.

Presentation mapping (ES, per the spec):

| Value | Label |
|---|---|
| 1/5 | Inicial |
| 2/5 | Básica |
| 3/5 | Intermedia |
| 4/5 | Alta |
| 5/5 | Avanzada |

EN, DE, FR, PT equivalents added to `src/lib/i18n/messages.ts` for all 5 supported locales (`difficulty.level1`-`5`, `difficulty.label`, `difficulty.of`, `difficulty.workedLabel`, `difficulty.autoAdjustExplanation`).

---

## QUESTION UX

`DifficultyBadge` (`src/app/dashboard/quiz/DifficultyBadge.tsx`), rendered on the active question:

```tsx
<DifficultyBadge difficulty={q.difficulty} t={at} />
```

- Visible: `Dificultad 4/5 · Alta` (small, muted, secondary to the question — placed alongside the existing calculator-affordance indicator, never above the question text).
- Accessible (sr-only): `Dificultad 4 de 5, Alta` — the visible compact text is `aria-hidden`; the natural-language string is what assistive tech announces, so neither depends on the visible punctuation nor on color alone.
- Not a control: a plain `<span>`, no interactive ARIA role, no `tabIndex`, no `onChange`/`onClick`.
- Explanatory copy reuses the file's existing native `title`-attribute convention (the same pattern the calculator-allowed indicator already uses) — `"StudyUS ajusta automáticamente la dificultad según tu evidencia de aprendizaje."` — no new tooltip dependency was added.

---

## RESULTS UX

Right after the score block, before the diagnostic/IB blocks:

```tsx
{formatDifficultyWorked(at, {
  min: Math.min(...questions.map((q) => q.difficulty)),
  max: Math.max(...questions.map((q) => q.difficulty)),
})}
```

`formatDifficultyWorked` renders a single value (`Dificultad trabajada: 4/5 · Alta`) when every question in the activity shares one difficulty (the ordinary case for canonical generation), or a range (`Dificultad trabajada: 3–4/5`, no tier label, since a range spans more than one tier) when they legitimately differ. **No average was invented** — required test 7 explicitly asserts the range text never contains a decimal.

PART E (optional activity-history difficulty visibility) was **not implemented** in this pass — it is explicitly optional per the spec, and this phase's scope discipline ("first measure, then implement targeted changes") did not extend to auditing every history-list surface for clutter risk. Not a regression: history already shows activity type, score, and assistance mode; difficulty was simply not added there.

---

## LANGUAGE

`DifficultyBadge` is always invoked with `at` — the SAME `ReturnType<typeof getMessages>` object `LearningSupportStatus`, `ContextualHelp`, and every other active-learning string on the quiz page already use, sourced from the ACTIVITY_LANGUAGE the quiz session itself was generated in, never `GLOBAL_INTERFACE_LANGUAGE`. Required test 10 asserts `DifficultyBadge` is never called with the shell-language `t`, and that neither `DifficultyBadge.tsx` nor `difficulty-presentation.ts` hardcodes a locale. All 5 supported locales (es/en/de/fr/pt) define every difficulty message key — verified directly.

---

## CANONICAL TRANSFER PRECONDITION

Enforced entirely by the one shared authority fixed above (`determineValidationReadiness`) — no second, UI-only, or route-local eligibility rule was written. Once `validationReadiness` correctly resolves `WAITING_FOR_RETENTION`, `computeLearningState`/`selectActivityType`/`deriveLearnerJourneyStage` all correctly stop offering/selecting `TRANSFER`, and every surface built on them (Today, My Path, Concept Mission, continuation) inherits the fix automatically, without any code of their own needing to change.

---

## SERVER BACKSTOP

`src/app/api/cognitive/transfer/generate/route.ts` had **no canonical eligibility check at all** before this phase — a direct request to this route would generate a Transfer task regardless of canonical state. Added, before the distance-authorization/generation loop, before any AI call:

```ts
const ksForTransferGate = await getConceptKnowledgeState(validated.studentId, validated.conceptId).catch(() => null);
if (ksForTransferGate?.validationReadiness === 'WAITING_FOR_RETENTION') {
  return NextResponse.json({ error: 'RETENTION_REQUIRED_BEFORE_TRANSFER' }, { status: 409 });
}
```

Reads the SAME `ConceptKnowledgeState.validationReadiness` field every other surface consults — never a second eligibility computation. Required tests 18-19 confirm the 409 response and that `generateStructuredTransferActivity` (the AI call) is never invoked when this fires; test 23 confirms a legitimate request (any other `validationReadiness`, or a missing knowledge-state row) proceeds to real generation exactly as before.

---

## PREMATURE TRANSFER EVIDENCE

**UNRESOLVED, by explicit design — not fixed with an invented rule.** `getTransferScore` (`transfer.service.ts`) reads the most recent 10 `learning_evidence` rows with no filter on when they were recorded relative to Retention's own satisfaction. This means: once Retention is later satisfied, the EXISTING (premature) Transfer evidence will be read exactly the same as any other Transfer evidence, and `determineValidationReadiness`'s (now-corrected) precedence would proceed straight to `READY`/`VALIDATED` without demanding a fresh Transfer attempt.

Searched the codebase for any existing evidence-freshness/eligibility rule that could authoritatively answer "does old Transfer evidence still count after Retention is satisfied" — **none exists**. Per the spec's own explicit fallback ("if canonical authority has NO explicit rule... mark this as UNRESOLVED"), no new rule was invented here. The evidence itself is preserved untouched either way (Part K's explicit requirement) — this UNRESOLVED status governs only whether it is later treated as *sufficient*, a product/pedagogy decision outside this phase's authority to invent.

---

## JOURNEY VISUALIZATION

Root-caused a second, independent bug (PART L): `buildMilestones` (`concept-mission.ts`) computed each rung's `demonstrated` flag from **raw evidence existence** (`demonstratedFor`) completely independently of the rung's own canonical `position` (PASSED/CURRENT/UPCOMING). `ConceptMission.tsx`'s rendering (`milestoneStatusText`/`markerGlyph`) checks `m.demonstrated` **first**, ahead of `position` — so a rung with `position: 'UPCOMING'` (correct, since Transfer hadn't been canonically reached) but `demonstrated: true` (because premature Transfer evidence exists) rendered a checkmark and "done" text regardless. This is the exact live defect.

**Fix**, in `buildMilestones` (the one canonical authority — not a rendering-component patch):

```ts
const demonstratedBy = position === 'UPCOMING' ? null : demonstratedFor(rung, inputs);
```

Raw evidence for a rung already reached (PASSED or CURRENT) still correctly shows as demonstrated (unchanged behavior — this is meaningful, e.g. a RETAIN rung that is CURRENT again for a fresh spaced check can legitimately show "you've done this before"). Raw evidence for a rung not yet reached is now withheld from the journey visualization's own `demonstrated` signal — the evidence itself is never deleted, filtered, or hidden; `demonstratedFor`, `getTransferScore`, and Results all still read it exactly as before. Required test 21 asserts this distinction structurally: history (`demonstratedFor`) and canonical position are independent inputs, reconciled in exactly one place.

One pre-existing test (`lx3-concept-mission.test.ts`) asserted the OLD (buggy) behavior — independent-evidence existing for an UPCOMING `PROVE` rung rendering `demonstrated: true` — updated to assert the corrected invariant, with the live-defect connection documented in the test itself.

---

## RESULTS / CONTINUATION COPY

`continuation.waitingBody` (shown by `ContinuationPanel` whenever `resolveContinuation` returns `status: 'WAITING'` with no specific due date — exactly the state right after a Transfer-before-Retention-fix scenario) previously read:

> "Por ahora no necesitas otra actividad." *("For now you don't need another activity.")*

This could be misread as a permanent "nothing more is needed" claim. Updated, across all 5 locales, to match the spec's own suggested phrasing:

> "Por ahora no necesitas hacer nada más. StudyUS te avisará cuando sea momento de comprobar que aún lo recuerdas."

This never claims the journey is complete unless canonical state is genuinely `CONSOLIDATED` — it explicitly reassures the learner that StudyUS will follow up, matching what "waiting for retention" actually means. `ContinuationPanel`'s branching itself (`c?.status === 'LAUNCH'` / `'WAITING'` / fallthrough to `RETURN_TO_MISSION`) was not changed — it already derives its decision from the SAME canonical `resolveContinuation` output the rest of the system uses, which is now correct thanks to the root-cause fix.

A distinct, Transfer-completion-specific acknowledgment banner (the spec's first example: *"Aplicaste correctamente el concepto en este contexto. Aún falta comprobar que lo conservas con el tiempo."*) was considered but **not added** — the existing generic score message (e.g. "¡Excelente! Gran progreso.") already acknowledges the Transfer success, and the corrected `ContinuationPanel` copy immediately below it already states what's still pending. Adding a third, overlapping acknowledgment layer risked confusing the UX rather than clarifying it; this is a judgment call, not a certification requirement (no required test names this exact string).

---

## RETENTION WAITING

Unchanged, and now correctly reachable: `isRetentionWaiting(stage, retentionDue)` (`learner-journey-contract.ts`) still returns `true` only for `stage === 'RETAIN' && retentionDue === false` — this function was never part of the bug (it operates on an already-correct `stage`, which the fix now supplies correctly). Required test 13 confirms `deriveLearnerJourneyStage` resolves `RETAIN` for the live shape and that `isRetentionWaiting` then correctly reports the temporal-waiting state. Premature Transfer evidence cannot bypass this — the minimum retention interval logic (`memory-policy.ts`) was not touched.

---

## CANONICAL JOURNEY INVARIANT

`RUNG_ORDER` (`concept-mission.ts`) remains exactly `['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER']`, unchanged. `LearnerJourneyStage`'s enum and `deriveLearnerJourneyStage`'s precedence rules are unchanged in structure — only `determineValidationReadiness`'s check ORDER (a different file, one level upstream) was fixed. REINFORCE remains an intervention overlay, never a stage reorder: `BLOCKED_OR_REPAIR` and the `intervention: 'REINFORCE'` logic in `deriveLearnerJourneyStage` are byte-for-byte untouched, confirmed by required test 29.

---

## ACCESSIBILITY

- `DifficultyBadge`: visible compact text is `aria-hidden`; a natural-language `sr-only` string (`Dificultad 4 de 5, Alta`) carries the full meaning to assistive technology, never relying on the "4/5" numeral/slash formatting or on color alone (the badge uses `var(--text-muted)` text color only, no color-only signal). Not a control — no ARIA interactive role, no `tabIndex`. The explanatory `title` attribute is inert/non-interactive, matching this file's own pre-existing convention for the calculator-allowed indicator.
- Canonical stage status (`JourneyStrip`/`ConceptMission`'s milestone rendering) was not touched beyond the `demonstratedBy` gating fix — its existing `aria-current="step"`, semantic `<ol>`/`<li>` structure, and `sr-only` status text (glyph `aria-hidden`, full state announced separately) are unchanged and remain semantically understandable.

---

## REGRESSION SAFETY

- Full existing test suite: 233 files, 3949 tests, all green.
- `determineMasteryState`/mastery and evidence thresholds: untouched (Part O).
- LX-10R1's `buildShapeExamplesBlock`/`questionGenerationCacheKey`/stable-prefix prompt structure: untouched, confirmed present verbatim (required test 30).
- `transfer/submit` (evaluation route): untouched (required test 24) — transfer distance logic, generated context/scenario, independent evidence requirement, evaluation logic, scoring, AI routing, and canonical evidence capture all continue to work exactly as before for a legitimately-due Transfer.
- Two pre-existing tests required updates because they asserted the literal PRE-fix (buggy) behavior or a stale LX-4J-era comment, not because an unrelated invariant changed:
  - `tests/unit/lx3-concept-mission.test.ts` — updated to assert the corrected "no demonstrated flag for an UPCOMING rung" invariant.
  - `tests/unit/lx9r3-progression-novelty-difficulty-results.test.ts` — updated to assert the NEW correct state (difficulty IS now shown; a selector/control is still never introduced), since LX-4J's own premise ("no canonical authority exists") is no longer true.

---

## TESTS

31 required tests across two new files, all passing:

- **`tests/unit/uxcanon-r1-difficulty-presentation.test.ts`** (21 tests) — required tests 1-11.
- **`tests/unit/uxcanon-r1-transfer-sequencing.test.ts`** (28 tests) — required tests 12-31 plus the PART U live Fuerza centrípeta regression case, exercising the REAL `determineValidationReadiness`/`computeLearningState`/`selectActivityType`/`deriveLearnerJourneyStage`/`buildConceptMissionView` functions directly, and the REAL `/api/cognitive/transfer/generate` route with only the provider/DB boundary mocked.

| # | Requirement | Result |
|---|---|---|
| 1-5 | Difficulty 1-5 → Inicial/Básica/Intermedia/Alta/Avanzada | PASS |
| 6 | Active question shows canonical difficulty | PASS |
| 7 | Results show completed difficulty (range, never an average) | PASS |
| 8-9 | No learner control / no selector introduced | PASS |
| 10 | ACTIVITY_LANGUAGE, not shell language | PASS |
| 11 | No second difficulty algorithm | PASS |
| 12-13 | Transfer not executable while Retention unresolved/WAITING | PASS |
| 14-16 | Today/My Path/Concept Mission never recommend/expose premature Transfer | PASS |
| 17 | Journey visualization never marks Transfer complete from evidence alone | PASS |
| 18-19 | Server rejects direct premature Transfer, zero provider calls | PASS |
| 20-21 | History preserved; history and journey remain distinct | PASS |
| 22 | Successful Retention unlocks Transfer | PASS |
| 23-24 | Legitimate Transfer generation/evaluation unchanged | PASS |
| 25-26 | Results/continuation copy integrity | PASS |
| 27 | Consolidated cannot be reached by a premature bypass | PASS |
| 28 | Canonical journey order unchanged | PASS |
| 29 | REINFORCE unchanged | PASS |
| 30 | LX-10R1 performance contracts unchanged | PASS |
| 31 | All existing tests green | PASS (233 files / 3949 tests) |

**Verification, run on the implementation commit:**
```
npx tsc --noEmit   -> clean, 0 errors
npx vitest run     -> 233 test files, 3949 tests, all passed
npm run build       -> clean production build
```

---

## COMMITS

Implementation: `7e67910` — `fix(ux-canon-r1): visible system-defined difficulty; enforce Retention before Transfer canonically`

This report: separate docs commit, immediately following.

Branch: `tmp/lx1` (git worktree only — never `origin/main`, nothing deployed, nothing pushed, no production alteration).
