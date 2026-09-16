# CANON-R5R1B — ZERO-GAP AUTHORITY REPAIR

## STATUS

**CODE_PASS.** A verified, freshly-authorized v1 Practice request no
longer gets vetoed by the legacy, KnowledgeState-only zero-gap guard.
The guard itself is untouched for every other request — a forged
`v1Launch` claim, a failed re-verification, or a genuinely different
canonical stage all still hit it exactly as before this phase. **No
live Preview execution occurred in this environment** (no
`.env.local`/`DATABASE_URL`/live DB access here, as in every prior
phase of this session).

Verified in this environment:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — **248 test files, 4430 tests, all passing** (was
  247/4416 before this phase — +1 new test file, +14 new tests, plus 2
  pre-existing tests updated for the new (legitimate, non-regressive)
  `!v1Marker` condition and the restructured branch this phase adds
  between the 409 return and the pre-existing REINFORCE comment — **zero
  regressions**).
- `npm run build` — clean (Next.js 16.3.1, Turbopack).

## LIVE FAILURE

```
POST /api/learning/session/start  ->  authority: CANONICAL_ENGINE_V1,
                                       stage: PRACTICE, actionState: EXECUTABLE,
                                       launchStatus: READY, v1Launch=1,
                                       maxQuestions=3, difficulty=2

POST /api/quizzes/generate-and-take (same student/concept, v1Launch: true,
                                      quizMode: 'topic_practice',
                                      no client maxQuestions/difficulty)
  ->  409 { error: 'INVALID_GENERATION_CONTRACT',
            reason: 'ZERO_GAP_PRACTICE_MISMATCH',
            message: 'This activity is no longer your next canonical step.' }
```

Two calls, same request chain, two disagreeing authorities.

## ROOT CAUSE

`generate-and-take/route.ts` already computed `v1Marker` (CANON-R5R1's
own fresh, independently-re-verified authorization) BEFORE the legacy
LX-4R zero-gap block ran — but the zero-gap block's own 409 return
never consulted it. The legacy guard derives its answer from a
narrower, KnowledgeState-only evidence-gap calculation
(`deriveEvidenceRequirement`/`resolveQuestionCount`, predating the
Pedagogical Engine v1 entirely) — for the live fixture concept, that
older calculation determined the evidence gap was already `0` (no
REINFORCE signal justified continuing), and returned 409 unconditionally,
even though the fresh v1 decision had already, separately, confirmed
`stage: PRACTICE, actionState: EXECUTABLE` for the exact same
(student, concept) pair moments earlier at session start AND
independently again inside this very request (that is what produced
`v1Marker` in the first place). CANON-R5's own ONE AUTHORITY RULE
forbids two pedagogical authorities disagreeing about whether an
activity is executable; this was exactly that.

## ONE AUTHORITY RULE

Once `v1Marker` exists (a trusted, freshly-verified v1 Practice
authorization — never inferred from `v1Launch` alone), it is the SOLE
authority over whether this concept's Practice is executable. The
legacy zero-gap calculation still runs and may still log/warn for
diagnostics, but it can no longer independently veto generation. The
legacy guard is not deleted, not weakened, and not disabled globally —
it is bypassed **only** for the one narrow case a trusted v1
authorization already exists for.

## BYPASS CONDITION

The 409 return's guard changed from:

```ts
if (!hasReinforceSignal) { ... return 409 ... }
```

to:

```ts
if (!hasReinforceSignal && !v1Marker) { ... return 409 ... }
```

`v1Marker` is the exact same value CANON-R5R1/R5R1A already compute at
the top of `handleGenerateQuiz`, requiring **all** of:
`isCanonicalEngineV1Enabled()`, `validated.v1Launch === true`,
`validated.quizMode === 'topic_practice'`, `validated.conceptId`
present, AND a successful `verifyV1PracticeLaunchMarker` call — which
itself calls `getCanonicalPedagogicalDecision` FRESH and only returns
non-null when the decision is genuinely `EXECUTABLE` PRACTICE/REINFORCE
with a real contract (`resolveV1PracticeEligibility`). A bare
`v1Launch: true` with no successful re-verification, a WAITING/
CONSOLIDATED/LOCKED/BLOCKED decision, or a concept genuinely at PROVE/
RETAIN/LEARN/TRANSFER all leave `v1Marker` `null` — the bypass is
structurally unreachable for any of them.

## LEGACY SAFETY

Nothing about the legacy guard's OWN computation changed:
`deriveEvidenceRequirement`, `resolveQuestionCount`, the
`hasReinforceSignal` calculation, and the REINFORCE execution-minimum
path are all byte-identical. For a non-v1 request (`v1Marker` always
`null`), `!hasReinforceSignal && !v1Marker` reduces to exactly
`!hasReinforceSignal` — the original condition — so legacy
`topic_practice`/`review` behavior is unchanged in every respect,
verified by the two pre-existing regression suites
(`lx9r8-zero-gap-action-quality-gate.test.ts`,
`release-r1-zero-gap-frontend-action-integrity.test.ts`) passing with
only their literal source-match regexes updated for the new,
additive `&& !v1Marker` clause and the new branch it introduces — no
behavioral assertion in either file changed.

## ORDERING

Unchanged from CANON-R5R1/R5R1A: `v1Marker` is computed once, at the
very top of `handleGenerateQuiz`, strictly before the legacy LX-4R
block (which includes the zero-gap check) ever runs — verified by a
source-audit index comparison. The legacy guard is never allowed to
return 409 before canonical verification has had a chance to run; it
already ran first every time, the bug was only that its answer used to
be ignored.

## TESTS

One new file, 14 tests, all passing:

`tests/unit/canon-r5r1b-zero-gap-authority-bypass.test.ts`:
- ordering: `v1Marker` computed before the zero-gap block;
- the 409 guard is `!hasReinforceSignal && !v1Marker` (bypass present
  vs. legacy blocked, both from the SAME condition);
- the legacy 409 branch itself (status, error shape) is still fully
  present, never globally removed;
- a v1-authorized bypass is logged (`ZERO_GAP_LEGACY_AUTHORITY_BYPASSED_BY_V1`),
  never silent, and structurally distinct from the REINFORCE path;
- exactly one `return NextResponse.json` exists inside the zero-gap
  block (no second, undocumented early-exit was introduced);
- `v1Launch` alone cannot bypass: the full guard chain
  (gate/intent/quizMode/conceptId/re-verification) is still required
  to produce `v1Marker` at all;
- R5R1A's server-derived contract override, `storeQuiz` persistence,
  `checkV1ActivityContractCompliance`, and the `v1Qualifies`-gated
  metadata stamping are all confirmed unchanged (source audits);
- no new import from `@/lib/pedagogical-engine`, `@/lib/ai/adapters`,
  or `@/lib/pedagogical-migration` (firewall);
- the LIVE Preview fixture (Part 9 — `studentId
  ec77cac5-841c-41cc-b959-af8ec69ccec5`, `conceptId
  1fb2b93c-0909-4127-9854-a91379825661`, used as a test fixture only,
  never in production logic): a fresh canonical decision for this exact
  pair (LEARN recognized via `LEGACY_MIGRATION_BASELINE`, no other
  evidence) resolves to `stage: PRACTICE, canonicalActivityType:
  PRACTICE` — matching what `session/start` actually reported live —
  and the route's own bypass condition evaluates to `false` (bypass
  active) for that exact authorization;
- a genuinely LEARN-stage concept (no recognition, no evidence) never
  authorizes Practice at all — `v1Marker` stays `null`, so the legacy
  guard's original behavior is fully preserved for that case.

Two pre-existing tests updated (not regressions — each still asserts
the SAME underlying guarantee against the new, slightly longer source):
`tests/unit/lx9r8-zero-gap-action-quality-gate.test.ts` (the guard
condition regex now includes `&& !v1Marker`) and
`tests/unit/release-r1-zero-gap-frontend-action-integrity.test.ts` (the
409-response-shape regex no longer assumes the REINFORCE comment
immediately follows the closing brace, since this phase's own bypass
branch now sits between them).

## FILES CHANGED

```
src/app/api/quizzes/generate-and-take/route.ts   (the 409 guard now requires `&& !v1Marker`; a new, purely diagnostic bypass-logging branch)
tests/unit/canon-r5r1b-zero-gap-authority-bypass.test.ts   (new)
tests/unit/lx9r8-zero-gap-action-quality-gate.test.ts      (updated guard-condition regex)
tests/unit/release-r1-zero-gap-frontend-action-integrity.test.ts   (updated response-shape regex)
docs/CANON_R5R1B_ZERO_GAP_AUTHORITY_REPAIR.md
```

No file under `src/lib/pedagogical-engine/`, `src/lib/ai/`,
`src/lib/pedagogical-migration/`, or `database/` was touched (`git diff
--stat` confirmed empty for all four) — this phase is a single,
surgical repair inside one existing conditional in one route.

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `fix(canon-r5r1b): bypass legacy zero-gap Practice guard for verified v1 authorization` — the implementation and new/updated test files.
2. `docs(canon-r5r1b): zero-gap authority repair report` — this document.

## PREVIEW RETEST PLAN

**Not executed in this environment.** Once this fix is deployed to
Preview (with `CANONICAL_ENGINE_V1_ENABLED=true` and CANON-MIG-R1's
migration repair already applied and re-run there, per that phase's own
LIVE NEXT STEP), a Preview-connected session should:

1. Re-run the exact live failure: `POST /api/learning/session/start`
   for `studentId ec77cac5-841c-41cc-b959-af8ec69ccec5`, `conceptId
   1fb2b93c-0909-4127-9854-a91379825661` (or any other migrated concept
   currently canonically at PRACTICE); confirm `authority:
   CANONICAL_ENGINE_V1`, `launchStatus: READY`, and a `launchTarget`
   containing `v1Launch=1`.
2. Follow that URL into `POST /api/quizzes/generate-and-take` (via the
   quiz page, or a direct replay of the exact same request body);
   confirm it now returns `200` with a real quiz, NOT `409
   ZERO_GAP_PRACTICE_MISMATCH`.
3. Inspect the resulting `quiz_sessions` row's
   `canonical_activity_contract` — confirm it reflects the real
   authorized contract (R5R1A, unchanged by this phase).
4. Submit; confirm `learning_evidence.metadata.pedagogicalPolicyVersion
   === 'studyus-canonical-v1'` and `canonicalResultsStatus === 'OK'`.
5. Separately, confirm a genuinely non-v1 (`v1Launch` absent) zero-gap
   `topic_practice` request for a DIFFERENT concept still returns `409
   ZERO_GAP_PRACTICE_MISMATCH` exactly as before this phase — legacy
   protection intact.

STOP after code + report. No push to `main`. Production was not
activated.
