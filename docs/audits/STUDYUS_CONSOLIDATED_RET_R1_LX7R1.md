# CONSOLIDATED REPAIR -- RET-R1 + LX-7R1

Branch: `tmp/lx1` (worktree only -- not merged to `main`, not deployed).

## STATUS

**PASS_WITH_CONDITIONS**

Both repairs meet the certification bar on their own terms (A: Retention preserves accepted questions and closes the deficit via bounded recovery without weakening quality; B: no learner-facing subject action is selected by raw mastery/weakest-score heuristics). The condition: per the spec's own instruction, this is **CODE PASS, not LIVE PASS** -- the live 500 was reproduced against real Luna/Terra provider calls, and this environment has no provider credentials to re-run that exact live trace. Verification here is the full existing 37-case retention suite (unchanged, still green), 17 new RET-R1 tests exercising the actual gate-rejection/deficit-recovery path with mocked but realistic provider responses, `tsc`, and `build`. Live QA against real Luna/Terra output is required before calling this LIVE PASS.

## PART A -- RETENTION

### ROOT CAUSE

Exact control flow in `generateRetentionCheckQuestions` (`src/services/quiz-generation.service.ts`), before this repair:

1. Two concurrent Luna chunk calls (3 questions each) -> both succeed, no exact-duplicate/structural-overlap between them.
2. `mapped = mapRawQuestionsToGenerated(merged, ...)` (6 questions) -> `retentionApplyGate(mapped, ...)` (the universal Quality Gate, LX-4P-PERF-R1C-R1) -> **5 accepted, 1 rejected** (matches the live trace exactly: `acceptedCount: 5, rejectedCount: 1, qualityGateResult: DETERMINISTIC_FAIL`).
3. Because `g.accepted.length (5) !== RETENTION_REQUIRED_COUNT (6)`, the old code located **which whole 3-question chunk contained the rejected question** (`chunkAFailed = mapped.slice(0,3).some(q => !acc.has(q))`) and discarded **that entire chunk** -- including its other 1-2 individually-accepted, valid questions -- keeping only the untouched chunk (3) as `retainedQuestions`.
4. It then requested one Terra recovery chunk of 3 brand-new questions (not 1) to replace the whole discarded chunk.
5. The recovery chunk's own gate result in the live trace: **4 accepted, 2 rejected** (`qualityGateResult: DETERMINISTIC_FAIL`).
6. `finalGate.accepted.length (4) !== 6` -> `return []` -- logged as `"retention_check fast path: a question failed the quality gate after bounded recovery -- returning no questions, no second retry"` -- and the route's generic empty-array branch (`src/app/api/quizzes/generate-and-take/route.ts:537-542`) returned `{error: 'GENERATION_FAILED'}`, status 500.

The bug: step 3 discarded 1-2 **already-accepted, valid** questions purely because a *sibling* in the same chunk failed, then demanded a **full 3/3 clean replacement chunk** to recover from what was actually only a 1-question deficit -- doubling the chance of failure on the one bounded recovery attempt.

### CANONICAL RETENTION COUNT

`RETENTION_REQUIRED_COUNT = RETENTION_CHUNK_COUNT (2) * RETENTION_QUESTIONS_PER_CHUNK (3) = 6` (`quiz-generation.service.ts`) -- unchanged, still the only count this fast path supports (`generate-and-take/route.ts` only routes to it when `maxQuestions === RETENTION_REQUIRED_COUNT`).

### BEFORE FLOW

```
Luna chunk A (3) ┐
Luna chunk B (3) ┘→ merge (6) → gate ALL 6 →  5 accepted / 1 rejected
                                   │
                                   ▼
                    discard the WHOLE chunk containing the reject
                    (loses 1-2 valid, already-accepted questions)
                                   │
                                   ▼
                    Terra regenerates a FULL replacement chunk (3)
                                   │
                                   ▼
                    gate the reassembled 6 → 4/6 accepted
                                   │
                                   ▼
                         accepted.length !== 6 → []  → 500
```

### AFTER FLOW

```
Luna chunk A (3) ┐
Luna chunk B (3) ┘→ merge (6, or 3 on chunk-failure/collision -- unchanged) → gate EVERY question individually
                                   │
                        acceptedUnique = [5 kept]   deficit = 6 - 5 = 1
                                   │
                                   ▼ (only if deficit > 0)
                    Terra generates ONE replacement chunk (3, the
                    smallest legal unit) → gate it → per-question dedupe
                    against acceptedUnique → take only enough (<=1) to
                    close the deficit; extras are simply unused
                                   │
                                   ▼
                    deficit === 0 → return acceptedUnique (exactly 6)
                    deficit  > 0 → RETENTION_BATCH_INSUFFICIENT, []
```

### DEFICIT RECOVERY

`deficit = RETENTION_REQUIRED_COUNT - acceptedUnique.length`, computed once after the initial per-question gate. If `deficit > 0`, exactly one Terra chunk (3 questions, the smallest legal generation unit) is requested; its gate-accepted questions are deduped per-question against everything already accepted (see UNIQUENESS) and only as many as needed to reach 6 are appended (`for (const q of uniqueReplacements) { if (acceptedUnique.length >= 6) break; acceptedUnique.push(q); }`) -- the final result is capped at exactly `RETENTION_REQUIRED_COUNT` defensively (`acceptedUnique.slice(0, 6)`), so it can never exceed 6.

### QUALITY GATE

Every question -- original and replacement -- goes through the SAME universal `applyQuestionQualityGate` (deterministic contract -> parallel semantic verification where inconclusive) via the unchanged local `retentionApplyGate` helper. No replacement bypasses this; no new acceptance path was introduced.

### UNIQUENESS

Replacements are deduped with a new, per-question `dedupeAgainstAccepted` (quiz-generation.service.ts) that reuses retention's own existing authority verbatim -- `normalizeText` (exact-text) and `computeRetentionStructuralFingerprint` (strict structural shape) -- seeded from the already-accepted set and updated as each replacement is kept, so a replacement can collide with the accepted set *or* with an earlier replacement in the same chunk. The two pre-existing, ALL-OR-NOTHING collision checks (exact-duplicate / structural-overlap between the two ORIGINAL Luna chunks, and between a whole retained chunk and a whole recovery chunk in the chunk-failure/collision branches) are untouched -- they were never the live bug (see ROOT CAUSE) and all their governing tests pass unchanged.

### BOUNDED RECOVERY

`RETENTION_MAX_AI_CALLS_PER_ATTEMPT = 3` is unchanged and still enforced: 2 initial concurrent Luna calls + at most 1 Terra recovery call, never a second retry regardless of how large the remaining deficit is after that one recovery round. Verified by test (12): `executeAIMock.mock.calls.length` never exceeds 3 across every scenario, including ones engineered to still be short after recovery.

### FAILURE BEHAVIOR

If `deficit > 0` after the one recovery round, `generateRetentionCheckQuestions` still returns `[]` (the route's existing `GENERATION_FAILED`/500 handling for every quiz mode is untouched -- widening it was out of scope for this repair), but now also logs a structured `RETENTION_BATCH_INSUFFICIENT` event carrying `reason: 'RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS'` and the exact metadata fields A8 specifies (`requestedCount, initialGeneratedCount, initialAcceptedCount, initialRejectedCount, replacementGeneratedCount, replacementAcceptedCount, remainingDeficit`) -- no question content, verified by test (11).

### RETENTION INTEGRITY

Unchanged, confirmed by source-contract test: `EvidenceMode` (`RETENTION_CHECK: 'INDEPENDENT'` in `activity-taxonomy.ts`), no evidence/mastery write anywhere in the generation path, no hint/guide language, the Structured Output contract (`GENERATED_QUESTION_BATCH_SCHEMA`, `promptVersion: prompt.version` = v3), and `Practice`/`Quick Check`/gated cumulative-exam-diagnostic batch functions are byte-identical to before this repair.

### AI CALL TOPOLOGY

**Before** (the live failure): 2 Luna + 1 Terra = 3 calls, ~24s, ending in `[]`/500 despite 5 (then 4 more) individually-valid questions being thrown away because they shared a chunk with one that failed.
**After**: the same 2 Luna + at most 1 Terra = 3 calls (topology itself unchanged, since the minimum legal generation unit is still a 3-question chunk) -- but the recovery call, when needed, now only has to close a *real* deficit (as small as 1) instead of having to fully replace a chunk that was mostly fine, and every genuinely-accepted question from both waves is preserved rather than discarded. In the exact live scenario (5/6 then a further partial recovery), the fix converts what was a guaranteed failure into a likely success (5 kept + up to 3 new replacement candidates competing to fill a deficit of only 1, versus the old requirement of a full fresh 3/3). Formal performance certification (latency/call-count targets) remains deferred, as instructed.

## PART B -- SUBJECT ACTION AUTHORITY

### ROOT CAUSE

`/dashboard/subjects/[id]/page.tsx:60,117-121` (before this repair):

```ts
const weakest = [...concepts].sort((a: any, b: any) => a.mastery_score - b.mastery_score)[0];
...
{weakest && (
  <Link href={`/dashboard/quiz?subjectId=${id}&conceptId=${weakest.concept_id}`} className="btn btn-primary">
    {t['subjectDetail.practiceWeak']}
  </Link>
)}
```

### OLD "PRACTICE WEAKEST" AUTHORITY

- **Visible to learner role**: yes -- this is the primary, always-rendered CTA in the subject detail page's header, the same page every learner reaches from Subjects.
- **File**: `src/app/dashboard/subjects/[id]/page.tsx`.
- **Launch path**: a hand-built `<Link href="/dashboard/quiz?subjectId=...&conceptId=...">`.
- **Bypasses `/api/learning/session/start`**: yes, entirely -- no server-side decision re-derivation, no ownership validation, a raw client-constructed URL straight into the quiz route.
- **Selection basis**: purely `mastery_score`, ascending sort, first element -- a raw client-side mastery heuristic with no relation to `LearningDecision`/`LearningState`/`ValidationReadiness`.

### CANONICAL REPLACEMENT

New `resolveSubjectCurrentDecision(snapshot, subjectId)` (`src/lib/lx/path-view.ts`) -- filters the SAME `LearningOSSnapshot.decisions[]` Today/My Path already read (via one added `getLearningOSSnapshot` call, folded into the page's existing parallel-reads `Promise.all`) down to this subject, ranks them with the unchanged canonical `rankLearningDecisions`, and prefers the globally-best concept when it belongs to this subject (guaranteeing agreement with Today/My Path, R20/B6) or the subject's own top-ranked decision otherwise. `buildSubjectPathView` (My Path) was refactored to call this same function instead of its own inline copy of the identical logic -- one authority, not two.

### NO-ACTION BEHAVIOR

When `resolveSubjectCurrentDecision` returns `null` (no active signal anywhere in this subject), the page shows a neutral `<Link href="/dashboard/path/{id}">{t['subjectDetail.viewMyPath']}</Link>` -- never an invented Practice fallback, never a re-derived heuristic pick.

### LAUNCH AUTHORITY

When a decision exists, the CTA is `<StartSessionButton studentId={studentId} actionConceptId={subjectDecision.actionConceptId} label={activityCta(subjectDecision.activityType, t)} .../>` -- the exact same canonical component Today, My Path, and Concept Mission use, posting only `{studentId, actionConceptId}` to `/api/learning/session/start`. The old hand-built `/dashboard/quiz?...conceptId=` link for this CTA is gone (confirmed by source-contract test). The unrelated cumulative-assessment/exam-simulation mode buttons -- learner-*initiated* mode choices, not a concept-selection heuristic -- are untouched, per B5's scope boundary.

### TODAY / MY PATH CONSISTENCY

Because the subject page, My Path, and Today all resolve their "current concept" from the identical `getLearningOSSnapshot` read (Today: `nextExecutableItem` directly; My Path and the subject page: `resolveSubjectCurrentDecision`, which itself prefers `nextExecutableItem`'s concept when it's in-subject), the three surfaces cannot disagree about the same canonical context. Verified by test: `resolveSubjectCurrentDecision` returns the exact global-current decision (concept + activityType) when it belongs to the subject, and the subject's own top-ranked decision otherwise -- never an independently-derived third answer.

## SHARED INTEGRITY

### EVIDENCE

No evidence, mastery, or Knowledge State write was added by either repair. Retention's generation path remains read-then-generate-then-gate only; the subject page remains read-only except for the pre-existing, canonical `StartSessionButton` POST it now also uses (a launch request, not an evidence write).

### LANGUAGE

Unrelated to activity-language integrity: RET-R1 touches only generation/gating flow (no language-selection logic changed); LX-7R1 touches only which concept/decision a CTA points at, still resolved via `getInterfaceLanguage`/`activityCta` exactly as before.

### DECISION AUTHORITY

Neither repair changes `LearningState`, `MasteryState`, `ValidationReadiness`, `computeLearningState`, `rankLearningDecisions`, `buildLearningDecision`, `deriveLearnerJourneyStage`, `selectExecutableNextAction`, or any mastery/evidence threshold. RET-R1 only changes how many of an already-computed Quality Gate's accepted questions are kept and how a deficit is closed; LX-7R1 only changes which existing, already-ranked `LearningDecision` a CTA points at -- it introduces no new ranking, scoring, or selection rule of its own.

### TESTS

- `tests/unit/ret-r1-retention-deficit-recovery.test.ts` (new, 17 cases): all 20 required RET-R1 test items, covering the actual gate-rejection deficit path (mocking `checkQuestionQualityDeterministic` to force a specific question to fail deterministically, reproducing the live trace's shape) -- preserve-5/deficit-1, deficit-only regeneration, accepted-originals-never-regenerated, rejected-replacement-excluded, both gate layers still apply to replacements, duplicate replacement cannot fill a deficit, bounded-recovery-exhausted -> explicit `RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS` failure with full metadata, never a 4th AI call, and integrity/mode-isolation checks (13-20).
- `tests/unit/quiz-generation-retention.test.ts` (pre-existing, 37 cases): **all pass unchanged** -- the collision/chunk-failure branches this repair does not touch remain byte-for-byte compatible.
- `tests/unit/lx4p-perf-r1c-r1-universal-gate.test.ts`: one source-contract assertion updated to match the renamed local variable (`mappedBaseline`) and the new final-failure message, plus a new assertion that the old whole-chunk-discard logic (`chunkAFailed`) is gone.
- `tests/unit/lx7r1-subject-action-authority.test.ts` (new, 14 cases): all 10 required LX-7R1 test items -- no mastery-sort/`weakest` identifier remains, `resolveSubjectCurrentDecision` agrees with the global current decision when in-subject and with the subject's own top-ranked decision otherwise, null-snapshot/no-decision safety, neutral fallback markup present, `StartSessionButton`-only launch (no hand-built quiz URL), cumulative/exam mode buttons untouched, subject analytics still rendered, Today/`buildSubjectPathView` share one authority now, no evidence writes.

Full suite: **201 test files / 3084 tests passing** (up from 199 files / 3070 tests before this phase). `npx tsc --noEmit`: clean. `npm run build`: compiles successfully.

### IMPLEMENTATION COMMIT

`356040c` on `tmp/lx1`: `fix: RET-R1 retention deficit-preserving recovery + LX-7R1 subject action authority` (7 files: `quiz-generation.service.ts`, `path-view.ts`, `subjects/[id]/page.tsx`, `messages.ts`, one updated pre-existing test, two new test files). This report is committed separately, matching the established impl-commit + docs-commit pattern.

---

## CERTIFICATION

**A**: PASS (code) -- Retention now preserves every individually-accepted question and uses bounded, deficit-sized recovery to reach the exact canonical count, without weakening the Quality Gate (every question, original or replacement, still clears the same deterministic + semantic bar). Not yet LIVE PASS -- no provider credentials in this environment to re-run the exact live trace against real Luna/Terra output; live QA is required before that claim.

**B**: PASS -- no learner-facing subject action is selected by raw mastery/weakest-score heuristics anywhere in this codebase; the one remaining instance found by the LX-7 audit is removed and replaced with reuse of the existing canonical decision authority.

Do NOT claim LIVE PASS until QA.

Do NOT start LX-8.

STOP.
