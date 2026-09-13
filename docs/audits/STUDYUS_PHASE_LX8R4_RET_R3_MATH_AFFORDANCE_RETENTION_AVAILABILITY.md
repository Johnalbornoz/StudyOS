# LX-8R4 + RET-R3

## STATUS

- **Part A (LX-8R4 -- Math Affordance Consistency): PASS.** Math input capability is now a pure, subject-only presentation signal (`isMathCapableContext(subjectName)`) with no `kind`/`integrityMode`/`quizMode` parameter of any kind. It is structurally impossible to reintroduce the evidence-kind coupling that caused the live Potenciación (JUSTIFY-kind) failure, because the function that would need to be miswired no longer accepts the input that caused the bug.
- **Part B (RET-R3 -- Retention Availability): PASS_WITH_CONDITIONS.** A proven, code-level root cause (B4: whole-chunk collision discard) was found and repaired without weakening any gate or raising candidate counts. This fix is certified PASS on its own evidence. However, the *original* live failure may have had more than one contributing cause (B6/B7: possible semantic-verifier/generation-prompt miscalibration), and that portion cannot be proven or disproven from code alone. Per the certification's own explicit allowance, Part B is therefore PASS_WITH_CONDITIONS pending live telemetry after this fix ships. No candidate counts were increased to mask anything; the fix is a control-flow correction only.
- **No LX-9 work was started.** No live/Preview QA is claimed anywhere in this report -- all claims below are code-level and test-level.

---

## PART A -- MATH AFFORDANCE CONSISTENCY

### ROOT CAUSE

Live QA surfaced a mathematical open-response question in Potenciación (identify the error in an exponent expression and explain the correct simplification -- a JUSTIFY-kind question) that rendered with prose + microphone only, no math keyboard. The prior authority, `isMathAnswerContext(subjectName, kind)`, took the question's `ResponseEvidenceContract.kind` as a parameter and excluded EXPLAIN/JUSTIFY from math capability. This conflated two independent axes:

1. **Capability** -- can the learner express mathematics here at all? (a property of the *subject/domain*)
2. **Evidence requirement** -- what kind of response does this question require? (ANSWER_ONLY / SHOW_WORK / JUSTIFY / EXPLAIN -- a property of the *question*)

A JUSTIFY-kind question in a mathematics subject is still fundamentally mathematical; requiring justification prose does not mean the learner should lose the ability to write `x^2` as notation instead of "x to the power of 2" typed out phonetically. The old function silently answered a different question ("should this response also show a justification field?") than the one it was asked ("can this learner write math here?").

### OLD AUTHORITY

```ts
function isMathAnswerContext(subjectName: string | undefined, kind: EvidenceRequirementKind): boolean {
  const subject = inferMathToolbarSubject(subjectName);
  if (kind === 'EXPLAIN' || kind === 'JUSTIFY') return false; // <- the bug
  return subject === 'mathematics' || subject === 'physics';
}
```

### NEW MATH-CAPABILITY AUTHORITY

`src/lib/lx/math-response-contract.ts`:

```ts
export function isMathCapableContext(subjectName: string | undefined): boolean {
  const subject = inferMathToolbarSubject(subjectName);
  return subject === 'mathematics' || subject === 'physics';
}
```

The function takes **exactly one parameter**. There is no `kind`, `EvidenceRequirementKind`, `integrityMode`, `EvidenceMode`, or `quizMode` input anywhere in its signature -- the TypeScript type itself forecloses reintroducing the coupling at any call site, by design rather than by convention. All three call sites in `src/app/dashboard/quiz/page.tsx` (main quiz, resume-verification, inline post-quiz verification) were updated from `isMathAnswerContext(subjectName, xContract.kind)` to `isMathCapableContext(subjectName)`.

### RESPONSE CONTRACT SEPARATION

`ResponseEvidenceContract.kind` (ANSWER_ONLY/SHOW_WORK/JUSTIFY/EXPLAIN) is completely untouched -- it still governs what evidence is *required* (whether a justification block renders, what grading expects). It is simply no longer read by the math-capability check. The two concerns are now fully decoupled: a question's `kind` and its subject's math-capability are computed independently and passed to `UnifiedResponseComposer` as two separate, uncorrelated props (`mathEnabled` from `isMathCapableContext`, evidence-kind-driven UI from the contract itself).

### PRACTICE

Practice-mode questions use the same single main-quiz `UnifiedResponseComposer` call site as every other Practice-evidence-mode question. Math capability is computed identically regardless of `kind` -- unchanged behavior, now provably correct rather than incidentally correct.

### PROVE

Prove is the non-Practice `EvidenceMode` branch of the exact same main-quiz code path; there is no separate wiring for it. `isProveMode` is never referenced anywhere near `isMathCapableContext` in the source (verified by regex in the required test suite), so Prove-mode questions get the identical math-capability signal as Practice.

### RETENTION

`retention_check` renders through the same main-quiz `UnifiedResponseComposer` block; math capability is not conditioned on `quizMode` at all. The block containing the main math-capable call site was isolated and confirmed to contain no `PRACTICE_EVIDENCE_MODES` or `quizMode ===` reference near the `mathEnabled` prop.

### VERIFICATION

Both the resume-verification surface and the inline post-quiz verification surface call `isMathCapableContext(subjectName)` unconditioned on their own locally-derived ASSESSMENT-mode evidence contract kind. Verified directly by slicing both surfaces' source and asserting the `mathEnabled={isMathCapableContext(subjectName)}` pattern appears in each.

### NON-MATH DOMAINS

For a non-mathematical subject (e.g. History, Literature, or an undefined subject name), `isMathCapableContext` correctly returns `false` -- this remains presentation capability tied to the pre-existing `inferMathToolbarSubject` domain heuristic, not per-learner logic. The contract source was confirmed to contain no reference to `preferredInputMode`, `learningStyle`, or `accessibility.` -- this is not gated on learning-style or accessibility settings, only on subject/domain.

### UNIFIED COMPOSER

`UnifiedResponseComposer` itself is functionally unchanged -- it still takes `mathEnabled: boolean` and `voiceEnabled: boolean` as pure inputs from its caller and never re-derives eligibility internally. Its doc comments were updated to state explicitly: `mathEnabled` is a pure CAPABILITY signal, never derived from `responseKind`; integrity modes (Retention/Prove/verification) may remove HELP, but must never remove notation tools. The composer takes no `integrityMode`/`quizMode` prop, so this guarantee cannot be violated at the component boundary either.

### TESTS

- `tests/unit/lx8r4-math-affordance-consistency.test.ts` (**new**, 20 tests) -- dedicated coverage of all 15 required math-affordance tests (capability holds across all 4 evidence kinds; Retention/Prove/verification parity; non-math domains excluded; single-parameter signature; no duplicate classifier; no legacy toolbar; notation survives Independent/no-help modes).
- `tests/unit/lx8r2-math-response-experience.test.ts` -- updated in place for the rename (`isMathCapableContext`), R8 describe block rewritten to assert the new kind-free signature. 33 tests passing.
- `tests/unit/lx8r2-r1-universal-math-surface.test.ts` -- updated in place for the rename via mechanical bulk replacement. 36 tests passing.

---

## PART B -- RETENTION AVAILABILITY

### RET-R2 PATH AUDIT (B1)

Confirmed via direct grep that RET-R2's own fix is live and unmodified: `RETENTION_REQUIRED_COUNT = 6`, `RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK = 4`, `RETENTION_INITIAL_CANDIDATE_COUNT = 8`, `RETENTION_MAX_AI_CALLS_PER_ATTEMPT = 3`, and `recoveryCandidateCount(deficit) = clamp(deficit + 2, 3, 6)` are all present and unchanged in `quiz-generation.service.ts`. RET-R2's own 30-test suite (`ret-r2-candidate-surplus.test.ts`) still passes (updated only for the RET-R3 collision-semantics correction, per B4/test 32 below).

### LIVE FAILURE CLASS

The reported live failure ("Couldn't load the quiz" / "Failed to generate quiz questions") is the learner-facing surface of `RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS` -- the fast path returning `[]` because fewer than 6 candidates survived generation + gating + (bounded) recovery. RET-R2 sized the initial request at 8 candidates specifically to tolerate ordinary rejection without needing recovery at all; a failure surviving RET-R2 therefore implied something was still capable of destroying more of that 8-candidate surplus than RET-R2 accounted for.

### REJECTION REASONS / DUPLICATE-COLLISION AUDIT (B2-B4)

Direct code audit (not live telemetry) found a control-flow bug capable of exactly this: the pre-existing "both chunks valid" branch classified the two chunks' MERGED candidates for an exact-duplicate or structural-overlap collision, and on **any single collision between the two chunks**, discarded the entire "losing" chunk (`rawBaseline = chunkA.questions` or `chunkB.questions`) to keep the other one whole -- silently cutting the effective candidate pool from 8 to 4 candidates **before the Quality Gate ever ran**. With RET-R2's 4-per-chunk sizing, this fully consumed RET-R2's own surplus over a single collision, which is plausible for concepts with a small number of natural problem shapes even with the two chunks' distinct diversification notes.

This is the proven, code-level root cause required by the certification. It was found via code audit, matching the certification's own preferred evidentiary standard.

**Fix implemented:** the whole-chunk discard branch was deleted entirely (`retentionHasExactDuplicate` and `retentionStructuralOverlapGroupCount`, both removed from the source, not merely left unused). Both chunks are now **always merged whole** when both succeed. Collision resolution happens **after** the Quality Gate, **per question**, via `dedupeAgainstAccepted` (RET-R1's pre-existing recovery-wave dedup authority, now reused for the initial pool too) -- a duplicate/overlapping candidate is dropped individually; it never causes an unrelated, unique sibling (from either chunk) to be discarded.

New telemetry categories were added to distinguish this from existing gate rejections: `DUPLICATE_OF_ACCEPTED` and `STRUCTURAL_OVERLAP_WITH_ACCEPTED`, merged into the existing `rejectionReasons` object via object spread (never overwriting the gate's own categories, never conflating a duplicate with a semantic/schema rejection). `classifyRetentionRejections` itself was audited and found to require **no changes**: it only classifies candidates absent from the real gate's own `accepted` array, so a separate post-gate dedup step (which only ever removes candidates already inside `accepted`) cannot cause it to misclassify a dedupe-dropped candidate -- satisfying B3 without touching that function.

### QUALITY-GATE ORDER (B5)

Gate-then-dedupe is the order implemented, matching the certification's own preferred canonical order: `retentionApplyGate` (calling the unmodified `applyQuestionQualityGate`) runs first over the full merged 8-candidate pool; `dedupeAgainstAccepted` runs second, over the gate's own `accepted` array only. A rejected-by-gate candidate is never seen by the dedupe step, and a duplicate-dropped candidate is never seen by the gate's own rejection classification -- the two mechanisms are strictly sequential and non-overlapping.

### SYSTEMATIC PROMPT ISSUES (B6/B7)

Audited the two chunks' diversification notes (distinct, non-generic text per chunk) and the semantic verifier's 7 check criteria (`conceptAligned`, `answerCorrect`, `unambiguous`, `reasoningConsistent`, `distractorsPlausible`, `scenarioAppropriate`, `visualConsistent`) against the generation prompt's structure. No structural contradiction was found from static inspection. **This could not be conclusively ruled out or confirmed without live rejection-reason telemetry**, which this environment does not have. This is the one open item in this certification, documented honestly rather than asserted as fixed -- see STATUS above and CONDITIONS below.

### FIX IMPLEMENTED

Summarized: whole-chunk collision discard removed; per-question dedup (`dedupeAgainstAccepted`, returning a new `RetentionDedupeResult { kept, exactDuplicateCount, structuralOverlapCount }` shape) applied to both the initial merged pool and the recovery wave; fixed, deterministic recovery slot/note defaults (`recoverySlotIndex = 1`, `recoveryNote = RETENTION_VARIANT_B_NOTE_CHUNK_B`) for the "both chunks valid" branch, since there is no longer a single "losing chunk" concept to target a replacement at. The Rule 6B branch (exactly one chunk failed outright) is unchanged.

### CANDIDATE PRESERVATION

Every unique candidate from either chunk survives to the accepted pool; only a genuine exact-text or structural-fingerprint duplicate is dropped, and only that one candidate. Proven directly by required tests 20-22 (a rejected candidate never removes a sibling; a single duplicate drops only itself; every unique candidate across both chunks is kept) and by RET-R2's own updated tests 7-9.

### CALL CAP

`RETENTION_MAX_AI_CALLS_PER_ATTEMPT` remains 3 (2 initial concurrent + at most 1 bounded recovery). No call cap was raised as part of this fix -- the fix is a control-flow correction (what happens to already-generated candidates), not a request-volume increase. Verified directly (required test 19) that even the worst-case full-collision scenario stays within 3 calls.

### FAILURE/RETRY UX (B9)

The learner-facing error state for `retention_check` now shows `quiz.retentionLoadError` ("Couldn't prepare this memory check.") instead of the generic raw error, plus a "Try Again" button (`activeLearning.tryAgain` -- a pre-existing but previously unwired i18n label) that re-invokes the same `generateQuiz` this page already calls from four other places. No new Retention-specific error component was built: this is the same generic error card every quiz-generation failure already used, extended with mode-aware copy, mirroring the file's own pre-existing `modeLabel`/`modeDesc` mode-aware-copy convention. "Back to Dashboard" remains available alongside the new retry -- nothing implies lost progress, and none was lost, since this failure can only occur before the first question is ever shown.

An exhaustive search of the codebase found no other fully-wired recoverable-error pattern to copy (`cognitive/transfer/page.tsx`, `cognitive/explain/page.tsx`, and this page's own other error states were all checked) -- `activeLearning.tryAgain` was the closest existing artifact, and reusing it (rather than inventing new copy) is the most literal application of the "reuse an existing pattern" instruction the codebase allows.

### TELEMETRY

`RETENTION_INITIAL_GATE_COMPLETE` and `RETENTION_RECOVERY_GATE_COMPLETE` now report `rejectionReasons` merging the gate's own categories (e.g. `SCHEMA_INVALID`, `SEMANTIC_REJECTED`, existing `QualityFailureCode`s) with the two new dedupe categories (`DUPLICATE_OF_ACCEPTED`, `STRUCTURAL_OVERLAP_WITH_ACCEPTED`) under their own distinct keys -- never conflated. All telemetry remains counts-only; verified directly (required test 26) that no logged retention event line contains fixture question text, answer, or explanation content.

### TESTS

- `tests/unit/ret-r3-retention-availability.test.ts` (**new**, 19 tests) -- dedicated coverage of required tests 16-32: sizing constants unchanged (16-17), bounded recovery formula (18), call cap (19), no-collateral-rejection (20), the B4 fix itself with direct proof (21-22), semantic/deterministic rejections still function (23-24), telemetry categories and content-safety (25-26), documented B6/B7 audit outcome (27), unchanged Quality Gate (28), fail-closed below 6 (29, plus a second recovery-exhaustion variant), recoverable retry UX (30), Retention remains INDEPENDENT/SOLO (31), prior-test-suite update discipline (32).
- `tests/unit/quiz-generation-retention.test.ts` -- 40/40 passing, fixtures widened (`fullyDuplicatedChunkTexts()`/`fullyOverlappingChunkTexts()`) to preserve deficit/recovery scenarios under the corrected per-question semantics, plus new tests directly proving a single collision no longer forces recovery.
- `tests/unit/ret-r2-candidate-surplus.test.ts` -- 30/30 passing, tests 7-9 updated to assert the corrected collision outcome (non-colliding siblings survive; the gate always sees the full 8-candidate pool).

### CONDITIONS (why Part B is PASS_WITH_CONDITIONS, not full PASS)

B4's fix is a proven, code-level repair of a genuine control-flow bug and is certified PASS on its own merits. However, whether B4 was the *sole* contributor to every live "Couldn't load the quiz" occurrence, or whether a semantic-verifier/generation-prompt miscalibration (B6/B7) also contributes in production, cannot be proven or disproven from code alone. **Requesting live telemetry**: if `RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS` failures persist after this fix ships, the `rejectionReasons` breakdown now logged (which distinguishes deterministic/semantic/duplicate/structural categories) should be reviewed from production logs to determine whether B6/B7 requires further action. No further candidate-count increases should be made without that evidence, per this spec's own standing instruction.

---

## COMMIT

Implementation (`src/`, `tests/`) committed separately from this report, both with the required `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. No LX-9 work was started.
