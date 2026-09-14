# CANON-R2 — Canonical Learning State Machine v1.0

## 1. STATUS

**CODE_PASS** (not "LIVE PASS" — this environment has no live browser, database,
auth, or AI-provider access; confirmed absent again this phase: no `.env`,
no `DATABASE_URL`, no `OPENAI_API_KEY`, no `.vercel` project link).

This phase delivers a new, isolated, independently-testable **Pedagogical
Engine v1.0** module (`src/lib/pedagogical-engine/`) that owns the full
canonical decision model the spec describes — evidence qualification,
ordered requirement/stage transitions, rollback rules, retention timing,
transfer eligibility, difficulty policy, activity contracts, canonical
next action, and reason codes.

**This phase does NOT wire the new engine into any existing route,
service, or component.** Every existing canonical authority
(`determineValidationReadiness`, `computeLearningState`,
`selectActivityType`, `deriveLearnerJourneyStage`,
`buildCanonicalLearningProgress`, `buildConceptMissionView`,
`evidence-sufficiency-contract.ts`, `learning-continuation.service.ts`,
`learning-os-snapshot.service.ts`) is **byte-for-byte untouched**. This
is a deliberate, documented scope decision — see §3 and §27 below — not
an oversight: the spec's own instruction is "DO NOT modify these systems
unless a narrow interface adaptation is strictly required... If a
broader change appears necessary: DOCUMENT IT. DO NOT silently refactor
it." Wiring a brand-new decision engine into five load-bearing production
authorities in the same phase that designs it would be exactly the kind
of high-blast-radius, un-reviewable change this instruction forbids.
§27 documents the integration plan for a future, separately-reviewed
phase.

Build/verification (this phase, on `tmp/lx1`):
- `npx tsc --noEmit` — clean.
- `npx vitest run` — **235 test files, 4061 tests, all passing** (was 234
  files / 3979 tests before this phase — +1 file, +82 tests, zero
  regressions).
- `npm run build` — clean.

## 2. SCOPE

In scope: a new pure TypeScript module implementing the full pedagogical
decision model, plus its required test matrix and this report.

Out of scope (per the spec's own Performance/Prompt/Quality Firewalls
and "DO NOT modify" instruction): question generation, AI provider
routing/model selection, prompt construction/caching, the Quality Gate,
UI/React components, API routes, database schema/migrations, and every
existing canonical decision file listed above.

## 3. ARCHITECTURAL BOUNDARY

The engine lives entirely under `src/lib/pedagogical-engine/` and:

**Owns:**
- Evidence qualification (`qualifyEvidence` — the one shared
  QUALIFIES / DOES_NOT_QUALIFY / UNRESOLVED authority).
- The ordered requirement state machine (LEARN → PRACTICE → PROVE →
  RETAIN → TRANSFER → CONSOLIDATED) and its rollback rules.
- Retention timing (the 3-day minimum wait, WAITING status,
  `waitingUntil`).
- Transfer eligibility and its three-way failure diagnosis
  (Case A / B / C).
- Difficulty policy (canonical per-stage ranges).
- Activity contracts (`ActivityContract` — the shape the generation
  system would consume).
- The canonical next action (`currentStage`) and every reason code.

**Explicitly does NOT own** (never imported, never referenced — verified
by source-audit tests, §25): AI/generation, provider/model routing,
Luna/Terra selection, prompt construction/caching, Quality Gate
implementation, provider retries, Vercel routing, API transport, DB
infrastructure, UI/React/styling, multimodal infra, performance
optimization, or telemetry transport.

## 4. MODULE DEPENDENCY RULES

- `src/lib/pedagogical-engine/index.ts` is the **only** file other code
  should import from (enforced by convention today; a lint boundary rule
  is a natural follow-up, not built in this phase).
- Internal files (`engine.ts`, `policy.ts`, `evidence-qualification.ts`,
  `activity-contract.ts`, `types.ts`) import only from each other.
- Zero imports of `react`, `next/*`, any AI/provider SDK, `@/lib/db`,
  `@vercel/*`, `@neondatabase/*`, or any existing service/route/component
  file. Verified by Engine Isolation tests 1–7 and the Recent-Work
  Regression Audit tests 64–72 (§25).
- Zero calls to the system clock (`Date.now()` / bare `new Date()`) —
  every timestamp is caller-injected (`PedagogicalEngineInput.now`),
  which is what makes the engine deterministic and unit-testable without
  mocking time.

## 5. PEDAGOGICAL POLICY VERSION

`POLICY_VERSION = 'studyus-canonical-v1'`, exposed on every
`CanonicalPedagogicalDecision.policyVersion`. All numeric pedagogical
parameters live in exactly one place, `CANONICAL_POLICY`
(`src/lib/pedagogical-engine/policy.ts`) — no scattered per-file magic
number anywhere else in the module:

| Stage | Item count | Difficulty | Min score | Independent | Notes |
|---|---|---|---|---|---|
| LEARN | n/a (explanation surface) | 1–2 | n/a | no | understanding only, not mastery |
| PRACTICE | 2–3 | 2–4 | 80% | no | assistance allowed |
| PROVE | exactly 10 | 3–4 | 80% (8/10+) | yes | no hints/tutor/worked examples |
| RETAIN | exactly 10, novel | 3–4 | 80% | yes | min. 3-day wait after qualifying Prove |
| TRANSFER | exactly 3 challenges | 4–5 | 80% overall, no challenge below 50% | yes | NEAR/CONTEXTUAL/HIGHER depths |
| REINFORCE (overlay) | 2–3 | 1–3 | 80% | no | never a journey stage |

The transfer per-challenge failure floor (50%) is a **documented CANON-R2
decision**, not stated numerically by the spec — the spec's own
100/100/20 example already fails on the overall-average rule (73.3% <
80%) alone, so the floor's job is to also independently fail patterns
like 100/100/40 (avg 80%, passes the average, but one challenge is a
near-total wipeout). 50% was chosen as the natural complement to the
80% overall bar; see §22 for the worked regression case.

## 6. ENGINE INPUT / OUTPUT

```ts
interface PedagogicalEngineInput {
  conceptId: string;
  studentId: string;
  now: string;                          // injected, never read from the clock
  evidence: RawEvidenceItem[];           // the full, immutable ledger
  activeCriticalMisconception: boolean;  // a CURRENT, live fact — not derived from evidence alone
  policyVersion?: string;
}

interface CanonicalPedagogicalDecision {
  policyVersion: string;
  conceptId: string;
  studentId: string;
  requirements: RequirementResult[];     // always all 5, LEARN..TRANSFER, in order
  currentStage: PedagogicalStage;        // first unsatisfied requirement, or CONSOLIDATED
  activityContract: ActivityContract | null;
  intervention: 'REINFORCE' | null;
  rollback: RollbackDecision | null;
  reasonCodes: EvidenceQualificationReasonCode[];
  computedAt: string;                    // === input.now, verbatim
}
```

Entry points: `evaluateCanonicalLearningState(input)` and
`rebuildConceptCanonicalState({conceptId, studentId, evidence,
activeCriticalMisconception, now, policyVersion?})` — the second is an
alias matching the spec's own conceptual signature; both call the exact
same code path (§18).

## 7. EVIDENCE QUALIFICATION

`qualifyEvidence(item, context)` (`evidence-qualification.ts`) is the
**one** shared authority converting a raw ledger row into
QUALIFIES / DOES_NOT_QUALIFY / UNRESOLVED, with one of eleven reason
codes: `PASSING_SCORE`, `INSUFFICIENT_SCORE`, `FAILED_ATTEMPT`,
`ASSISTED_WHEN_INDEPENDENCE_REQUIRED`, `CRITICAL_MISCONCEPTION`,
`WRONG_ACTIVITY_TYPE`, `PREMATURE_STAGE_EVIDENCE`,
`TEMPORALLY_INELIGIBLE`, `MISSING_REQUIRED_REASONING`, `NOT_APPLICABLE`,
`UNRESOLVED_POLICY`. Every check (activity type, critical misconception,
prerequisite satisfaction, temporal eligibility, difficulty range, item
count, independence, score) runs through this one function — the
requirement state machine (`engine.ts`) never re-implements or
shortcuts it. This directly realizes Invariant 1/2 ("activity attempt ≠
qualified evidence").

## 8–13. PER-STAGE CONTRACTS

**LEARN** — the lowest possible bar: any single evidence item lacking an
active critical misconception satisfies it (understanding-only, never
mastery — Invariant). Nothing downstream can roll LEARN back.

**PRACTICE** — 2–3 exercises, ≥80%, difficulty 2–4, assistance allowed.
LOCKED until LEARN is satisfied (in practice, always true once any
evidence exists at all, since the same item can satisfy both).

**PROVE** — exactly 10 questions, independent, difficulty 3–4, ≥80%
(8/10+ passes; 7/10 or worse fails). LOCKED until PRACTICE is satisfied.
A genuine failure (`FAILED_ATTEMPT`) rolls back to PRACTICE
(`PROVE_FAILURE_RETURN_TO_PRACTICE`) — PRACTICE is invalidated and a
brand-new qualifying Practice attempt is required before a new Prove can
qualify (a repeated Prove attempted immediately after a failure, with no
intervening repair, correctly does **not** qualify — Test 20).

**RETAIN** — locked without a qualified Prove; a minimum 3-day wait
(`minimumWaitDays: 3`) after the qualifying Prove's own timestamp before
any attempt is temporally eligible (`TEMPORALLY_INELIGIBLE` otherwise,
reported as `WAITING` with a concrete `waitingUntil` date — never a bare
"not yet"). Exactly 10 **novel** questions, difficulty 3–4 (comparable
to a qualifying Prove), ≥80%. A failure rolls back to PROVE
(`RETENTION_FAILURE_RETURN_TO_PROVE`) and **fully invalidates** the
prior qualifying Prove — RETAIN becomes `LOCKED` again, not merely
`UNSATISFIED`, and a brand-new successful Prove creates a brand-new
retention window anchored to the new Prove's own timestamp, never
reusing the old due date (Test 32 proves this with two different
windows in the same ledger).

**TRANSFER** — locked without a qualified Retention. Exactly 3 structured
challenges (NEAR / CONTEXTUAL / HIGHER), difficulty 4–5, ≥80% overall
**and** no completely failed challenge (< 50%, §5) — the spec's own
100/100/20 example fails (Test 38). A response contract may require
shown reasoning (SHOW_WORK/EXPLAIN/JUSTIFY); a missing one disqualifies
(`MISSING_REQUIRED_REASONING`). On failure, three diagnosed outcomes:
  - **Case A** (application-weak, knowledge intact — a partial failure,
    not every challenge below the floor): Prove and Retention remain
    valid; only a Transfer-focused REINFORCE + a new Transfer attempt is
    required (`rolledBackTo: 'TRANSFER'`).
  - **Case B** (foundational failure — every challenge below the 50%
    floor): documented CANON-R2 decision, rolls all the way back to
    PRACTICE, invalidating Prove and Retention.
  - **Case C** (a critical misconception detected during the attempt):
    rolls back to PRACTICE, invalidating everything built on top of it.

**CONSOLIDATED** — requires ALL FIVE requirements SATISFIED **and** no
currently-active critical misconception (`activeCriticalMisconception`
is a live, current input — not derived from historical evidence alone,
since a misconception can be resolved after the attempt that revealed
it). When a live misconception is present, `currentStage` reports
`PRACTICE` with `intervention: 'REINFORCE'`, mirroring the existing
`computeLearningState`/`deriveLearnerJourneyStage` precedent of
misconception-overrides-everything (Test 46).

REINFORCE is implemented strictly as an overlay: it is never a member of
`PedagogicalStage`, never a value of `currentStage`, and is cleared
automatically the moment the stage it targeted is re-satisfied (Test 21,
48) — the engine does not require a caller to manually clear it.

## 14. DIFFICULTY POLICY

`buildActivityContract` (`activity-contract.ts`) is the **one**
authority translating `(currentStage, intervention)` into a
`DifficultyDecision {target, min, max, reasonCode}`, always reading from
`CANONICAL_POLICY` — never a literal number outside `policy.ts`. Ranges
(Tests 51–56): LEARN 1–2, PRACTICE 2–4, PROVE 3–4, RETAIN 3–4, TRANSFER
4–5, REINFORCE 1–3 (regardless of which underlying stage triggered the
intervention — an important distinction from the presentation-layer
`getDifficultyPresentation` built in UX/CANON-R1, which this module does
not import or duplicate: that module renders a difficulty **value** to
the learner; this module **decides** the value's policy range).

## 15. ACTIVITY CONTRACTS

`ActivityContract {activityType, itemCount, difficulty, independence,
supportLevel, minimumScorePercent, evidenceContract,
noveltyRequirements?, transferDepth?}` is the shape a (not-yet-built)
generation-system adapter would consume. `buildActivityContract` returns
`null` only for `CONSOLIDATED`. Boundary enforcement (never built,
verified by omission): the generation system would consume this contract
but never independently decide stage/item-count/passing-score/
assistance/transfer-eligibility/difficulty itself; the Quality Gate would
verify generated content against the contract but never decide target
difficulty itself; UI would render engine output but never calculate
progression itself.

## 16. HISTORY VS. JOURNEY

The evidence ledger (`RawEvidenceItem[]`) is treated as an append-only,
immutable record throughout: the engine only ever reads it (Test 50, 74
— freezing the array and asserting no mutation), and every disqualified
item is still counted (`nonQualifyingEvidenceCount`) and reason-coded,
never dropped. "An activity of this type exists" and "this activity
qualified as evidence" are always two separate facts — `qualifyEvidence`
is the only bridge between them, and `RequirementResult` always reports
both `qualifyingEvidenceCount` and `nonQualifyingEvidenceCount`
separately (Test 13).

## 17. PREMATURE EVIDENCE

An attempt for a stage whose prerequisite is not yet satisfied is
`PREMATURE_STAGE_EVIDENCE` — it never advances that stage, and (per §8's
LEARN rule) it can still count as generic engagement toward LEARN's own
trivial bar, but nothing else (Test 49, 75 — the Radicación case's own
premature Transfer attempt). The evidence itself is never hidden,
deleted, or reinterpreted; only its qualification verdict for the
targeted stage is withheld.

## 18. CANONICAL REBUILD

`rebuildConceptCanonicalState(args)` calls `evaluateCanonicalLearningState`
directly — there is exactly one decision code path, not two parallel
ones that could drift apart (Test 57 proves byte-identical output). The
function signature accepts the spec's own conceptual shape
(`{evidence, policy, retentionContext, conceptContext, now}` →
implemented as `{conceptId, studentId, evidence,
activeCriticalMisconception, now, policyVersion?}`); an external caller
can label the policy version but cannot inject a different numeric
policy through this alias, keeping "raw evidence + policy = canonical
truth" non-bypassable.

## 19. MATERIALIZED STATE

Not built this phase (no DB access in this environment, and no existing
schema was touched). The documented design: a `concept_pedagogical_state`
materialized table would exist purely for read performance, always
derivable by re-running `rebuildConceptCanonicalState` against the raw
`learning_evidence` ledger; on any disagreement between materialized and
rebuilt state, the rebuilt value is authoritative, and the disagreement
itself should be logged (§ Safe Telemetry) — never silently reconciled
by trusting the stale materialized row.

## 20. CANONICAL REVISION

Not built this phase. Documented design: a `canonicalRevision` identifier
— a hash or monotonic counter over `(evidence ledger fingerprint,
policyVersion, activeCriticalMisconception)` — would let every consumer
(Today/My Path/Progress/Subject Detail/Concept Mission/
Results-Continuation) verify they are reading the SAME evidence snapshot
before trusting agreement between two surfaces' displayed stage. This
engine's own determinism (Test 6, 57–61) is the prerequisite property
that makes such a revision identifier meaningful — a non-deterministic
engine could never be safely revisioned.

## 21. RECALCULATION TOOL

Not built or run this phase (no DB, no student/concept identifiers to
target safely). Documented design: a Preview-only CLI script that, for a
given `(studentId, conceptId)` (or all concepts for a student), loads the
raw `learning_evidence` ledger, calls `rebuildConceptCanonicalState`, and
prints a before/after diff against the currently materialized state —
strictly read-only against evidence (never deletes/rewrites a row),
idempotent (safe to run twice), and gated to run against Preview only,
never Production, without a separate, explicit, human-approved step.

## 22. RADICACIÓN REGRESSION CASE

Constructed synthetic evidence matching the reported history — `TRANSFER
0%, PRACTICE 0%, PRACTICE 0%, PRACTICE 33%` — as Test 75. Result: the
premature 0% Transfer attempt never counts (no Retain, let alone Prove,
was ever qualified — `PREMATURE_STAGE_EVIDENCE`); none of the three
Practice attempts reach the 80% bar, so **PRACTICE remains the first
unresolved requirement** and PROVE/RETAIN/TRANSFER are all correctly
`LOCKED`. This matches the spec's own explicit warning ("Do not assume
Practice solely from screenshot," "RETAIN is impossible without
qualified Prove," "TRANSFER evidence existence cannot itself satisfy
Transfer") — the engine never treats the mere existence of a Transfer
attempt, however scored, as progress.

## 23. PERFORMANCE FIREWALL

Untouched this phase, verified by source audit (Tests 64–68): no AI
provider/model choice, no `reasoning_effort` strategy, no
`promptCacheKey`, no prompt prefix ordering, no provider fallback, no
generation telemetry, no semantic verifier architecture, no retry
architecture, no Quality Gate criteria, no DB infrastructure. The new
engine's PROVE/RETAIN=10-question, TRANSFER=3-challenge contracts are a
**pedagogical policy change** (larger question counts than today's
`quick_check`'s 6 or `retention_check`'s 6 — see
`CURRENT_GENERATION_QUESTION_SHAPE_BY_ACTIVITY` in
`evidence-sufficiency-contract.ts`). This is disclosed, not silently
absorbed: **if/when this engine is wired in, a 10-question Prove/Retain
contract will very likely increase per-activity generation latency
versus today's 6-question fast paths, and that is a performance
consequence to measure and decide on separately — it is not resolved or
optimized in this phase**, per the spec's own explicit instruction.

## 24. QUALITY FIREWALL

Untouched — the Quality Gate (`gated-question-generation.service.ts`)
is never imported, never referenced, and its verification criteria are
unchanged. A larger PROVE/RETAIN item count does not imply, and this
phase does not implement, any weakening of per-question quality
verification.

## 25. RECENT-WORK REGRESSION AUDIT

Verified by source-audit tests (Tests 64–72), not by inspection alone:
- LX-10R1 (prompt-size optimization, `promptCacheKey`, Luna/Terra
  routing, `reasoning_effort`): the new engine imports none of
  `quiz-generation.service`, `gated-question-generation`,
  `model-routing`, `token-budgets`, `model-compatibility`.
- UX/CANON-R1 (visible difficulty, Retention-before-Transfer): the new
  engine imports none of `difficulty-presentation.ts`; the
  retention-before-transfer precedence fix in
  `knowledge-state.service.ts` is confirmed still present and correctly
  ordered (Test 72).
- RELEASE-R1 (canonical Concept Mission routing): `ConceptList.tsx` and
  `ErrorPatternList.tsx` are confirmed to still route their "Practicar"
  links to Concept Mission, not a bare, ungated quiz URL (Test 71).
- LX-9R8/R9, LX-8: untouched by this phase — no file outside
  `src/lib/pedagogical-engine/` and its test file was modified.

`git diff --stat` for this phase's implementation commit touches **only**
new files under `src/lib/pedagogical-engine/` and the new test file —
verifiable directly in the commit itself (§29).

## 26. TESTS

`tests/unit/canon-r2-pedagogical-engine.test.ts` — **82 tests**, all
passing, across the 10 required categories: Engine Isolation (1–7),
Practice (8–13), Prove (14–22), Retention (23–33), Transfer (34–43),
Journey (44–50), Difficulty Authority (51–56), Cross-Surface Consistency
(57–63), Recent-Work Regression Audit (64–72), Recalculation (73–80),
plus 2 supplementary direct `qualifyEvidence` unit tests. Every test
exercises the real, unmocked engine — no DB, no React, no Next.js, no AI
provider, no browser.

Full-suite result: `npx vitest run` → **235 files / 4061 tests passing**
(0 failures, 0 skipped), up from 234/3979 before this phase.

## 27. INTEGRATION PLAN (documented, not executed)

Per the spec's explicit "DO NOT modify these systems unless a narrow
interface adaptation is strictly required" instruction, wiring is
deliberately deferred to a future, separately-reviewed phase. The plan:

1. Build a **read-only adapter** (`concept-pedagogical-state.service.ts`,
   new file, IO-bound) that loads `learning_evidence` rows for a
   `(studentId, conceptId)`, maps them to `RawEvidenceItem[]` (a
   straightforward per-row projection: `source_type` → the closest
   `PedagogicalActivityType`, `ai_assistance_type === 'NONE'` →
   `independent: true`, etc.), and calls
   `rebuildConceptCanonicalState`.
2. Run the new engine's output **side-by-side** (logged, never acted on)
   against the existing `computeLearningState` /
   `deriveLearnerJourneyStage` pipeline in Preview for a representative
   set of students/concepts, comparing `currentStage` against the
   existing `LearnerJourneyStage` for disagreements — before any UI or
   routing consumes the new engine at all.
3. Only after that comparison is reviewed and disagreements are
   understood, consider a narrow, single-surface cutover (e.g. Concept
   Mission only) behind an explicit flag — never a simultaneous
   five-surface switch.
4. Never touch `quiz-generation.service.ts`'s question-count clamps in
   the same step as the cutover — the Performance Firewall (§23) applies
   to that future phase too, not just this one.

## 28. PREVIEW VALIDATION PLAN (documented, NOT executed)

This environment has no live browser, DB, or auth — the following is a
plan for a future session with Preview access, not something run here:

1. Deploy the engine (still unwired) to Preview; confirm `npm run build`
   succeeds there too (already confirmed locally, §1).
2. Run the recalculation tool (§21, once built) in dry-run/log-only mode
   against a handful of real Preview students, comparing its output to
   today's live `LearnerJourneyStage` for the same concepts.
3. Specifically re-run it against the Radicación concept
   ("Radicación de números enteros") for the student in the original
   report, and manually confirm the tool's stated `currentStage` matches
   a human's own reading of that student's real evidence history.
4. Confirm the tool never writes to `learning_evidence` — read-only,
   verified by inspecting the query list it issues.
5. Confirm the tool's logs never include student name, question text,
   answer text, or any other PII — only `conceptId`, `policyVersion`,
   `previousStage`/`rebuiltStage`, `previousAction`/`rebuiltAction`,
   reason codes, and qualifying/non-qualifying evidence **counts**.
6. Spot-check 5–10 concepts spanning each of LEARN/PRACTICE/PROVE/
   RETAIN/TRANSFER/CONSOLIDATED to confirm the tool's stage assignment
   matches the existing production stage for concepts with no known
   discrepancy (a sanity check the tool isn't silently wrong everywhere).
7. Specifically construct (or find) a concept currently in
   `WAITING_FOR_RETENTION` and confirm the tool's `waitingUntil` date
   matches the existing `nextReviewAt` semantics within the tool's own
   3-day-minimum-wait model (they are not guaranteed identical models —
   this is exactly the kind of disagreement §27 step 2 exists to catch).
8. Construct a concept with an already-failed Prove/Retention/Transfer
   in its history and confirm the tool's rollback diagnosis matches a
   human's own reading of "what should have happened."
9. Review the side-by-side comparison log (§27 step 2) for any
   systematic disagreement pattern, not just isolated one-offs.
10. Confirm no learner-facing surface changed behavior during this
    entire validation — the tool runs in log-only mode throughout.
11. Get explicit sign-off from a human reviewer on the comparison
    results before proceeding to any cutover planning.
12. **Do NOT manipulate the 3-day Retention rule to accelerate QA. Use a
    separate controlled Preview fixture later if necessary.**

## 29. PRODUCTION MIGRATION PLAN (documented, NOT executed)

Not applicable yet — no code in this phase touches Production, and no
migration is proposed until §27–28 are complete and reviewed. When that
time comes: any schema change (e.g. a `concept_pedagogical_state`
materialized table, §19) would ship as an additive, backward-compatible
migration; any behavior cutover would be staged per-surface (§27 step 3),
never all five surfaces simultaneously; and the existing canonical
authorities would only be modified (not replaced wholesale) with their
own dedicated, reviewed diff — never bundled into the same commit that
introduced the engine itself.

## 30. COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `feat(canon-r2): isolated Canonical Learning State Machine v1.0` —
   the new `src/lib/pedagogical-engine/` module and its test file.
2. `docs(canon-r2): pedagogical engine v1.0 report` — this document.

No other file is touched by either commit (verified: §25).
